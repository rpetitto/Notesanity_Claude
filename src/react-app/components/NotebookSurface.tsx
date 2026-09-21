/**
 * The shared reading/writing surface used by both the student workspace and the
 * teacher's grading view. It owns page layout, zoom, lazy rendering and the
 * per-page layer state; callers decide which layer is writable.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePinchZoom } from "../lib/usePinchZoom";
import { readPageText } from "../lib/pdf";
import { assetUrl } from "../lib/api";
import { isPattern } from "../lib/patterns";
import { Volume2, Square as StopIcon } from "lucide-react";
import { toast } from "sonner";
import { pageSource, type FieldRec, type LayerRec, type PageRec } from "../lib/api";
import { type LayerData, emptyLayer, parseLayer } from "../lib/ink";
import PageCanvas, { type FieldValue, type ToolState } from "./PageCanvas";
import LazyPage from "./LazyPage";

export type LayerMap = Record<string, LayerData>;

export function buildLayerMaps(layers: LayerRec[]) {
  const student: LayerMap = {};
  const teacher: LayerMap = {};
  const revs: Record<string, number> = {};
  for (const l of layers) {
    const parsed = parseLayer(l.data);
    if (l.kind === "teacher") teacher[l.page_id] = parsed;
    else student[l.page_id] = parsed;
    revs[`${l.kind}:${l.page_id}`] = l.rev;
  }
  return { student, teacher, revs };
}

/**
 * "page" fits a whole page in view (the default when working through an
 * assignment), "width" fills the available width, a number is a multiplier of
 * fit-width.
 */
export type ZoomMode = "page" | "width" | number;

export type WriteTarget = "student" | "teacher" | null;

interface Props {
  notebookId: string;
  pages: PageRec[];
  fields: FieldRec[];
  studentLayers: LayerMap;
  teacherLayers: LayerMap;
  /** Published teacher template annotations, keyed by page id — painted below student ink, never editable. */
  masterLayers?: LayerMap;
  fieldValues: Record<string, FieldValue>;
  /**
   * Which layer this session writes to, or `null` for read-only. A function is
   * asked per page: a student can open individual pages of their own notebook
   * to their teacher, so writability is a property of the page, not the screen.
   */
  writeTarget: WriteTarget | ((pageId: string) => WriteTarget);
  tool: ToolState;
  fingerDraw: boolean;
  zoom: ZoomMode;
  /** Set by a pinch on the surface; a number, in the same units as `zoom`. */
  onZoomChange?: (zoom: number) => void;
  authorName?: string;
  fieldsEditable: boolean;
  /** Teacher view: hovering a student's mark reveals when it was made. */
  showMarkHistory?: boolean;
  /** Teacher previewing their own notebook: fields take typing, uploads don't happen. */
  preview?: boolean;
  onLayerChange: (pageId: string, layer: LayerData) => void;
  onFieldChange: (fieldId: string, value: string) => void;
  onVisiblePageChange?: (pageId: string) => void;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  header?: React.ReactNode;
  /** Whose response is being shown/edited — omitted means "the signed-in student". */
  studentId?: string;
  /** Called after a student uploads or removes an `image`/`audio` response. */
  onResponseUploaded?: (fieldId: string) => void;
}

/**
 * Reads the page out.
 *
 * Browsers ship a speech synthesiser, so this costs nothing but the text,
 * which pdf.js already has. It helps a student who reads slowly and a teacher
 * checking a worksheet with their hands full, and it is the one accessibility
 * feature this architecture can honestly offer: the page is a rendered
 * document, so its own typeface can't be swapped, but its words can be spoken.
 */
function ReadAloud({ notebookId, page }: { notebookId: string; page: PageRec }) {
  const [speaking, setSpeaking] = useState(false);

  // Leaving the page mid-sentence should not leave a voice running.
  useEffect(() => () => { try { window.speechSynthesis?.cancel(); } catch { /* unsupported */ } }, []);

  if (typeof window === "undefined" || !window.speechSynthesis || isPattern(page.pattern)) return null;

  const stop = () => { window.speechSynthesis.cancel(); setSpeaking(false); };

  const start = async () => {
    try {
      const text = await readPageText(assetUrl(notebookId, page.asset_key), page.source_index);
      if (!text) {
        toast("There's nothing on this page to read", {
          description: "The words are part of the picture here, so there's no text to speak.",
        });
        return;
      }
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 0.95;
      utter.onend = () => setSpeaking(false);
      utter.onerror = () => setSpeaking(false);
      setSpeaking(true);
      window.speechSynthesis.speak(utter);
    } catch (e) {
      setSpeaking(false);
      toast.error((e as Error).message);
    }
  };

  return (
    <button
      type="button"
      onClick={() => (speaking ? stop() : void start())}
      title={speaking ? "Stop reading" : "Read this page out loud"}
      aria-label={speaking ? "Stop reading this page" : "Read this page out loud"}
      className="flex h-8 items-center gap-1.5 rounded-full px-2 text-pine/60 hover:bg-pine/8 hover:text-pine"
    >
      {speaking ? <StopIcon className="h-3.5 w-3.5" strokeWidth={2.5} /> : <Volume2 className="h-3.5 w-3.5" strokeWidth={2.5} />}
      <span className="text-[15px]">{speaking ? "Stop" : "Read aloud"}</span>
    </button>
  );
}

export default function NotebookSurface({
  notebookId, pages, fields, studentLayers, teacherLayers, masterLayers, fieldValues,
  writeTarget, tool, fingerDraw, zoom, onZoomChange, authorName, fieldsEditable, showMarkHistory, preview,
  onLayerChange, onFieldChange, onVisiblePageChange, scrollRef, header,
  studentId, onResponseUploaded,
}: Props) {
  const innerRef = useRef<HTMLDivElement>(null);
  const containerRef = scrollRef ?? innerRef;
  const [box, setBox] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  const fitWidth = useMemo(() => {
    const widest = pages.reduce((m, p) => Math.max(m, p.width), 0) || 612;
    const usableW = Math.max(280, box.width - 48);
    return Math.min(1.6, usableW / widest);
  }, [pages, box]);

  const scale = useMemo(() => {
    const tallest = pages.reduce((m, p) => Math.max(m, p.height), 0) || 792;
    if (zoom === "width") return fitWidth;
    if (zoom === "page") {
      // Leave room for the page caption and the gap between pages.
      const usableH = Math.max(240, box.height - 76);
      return Math.max(0.15, Math.min(fitWidth, usableH / tallest));
    }
    return fitWidth * zoom;
  }, [pages, box, zoom, fitWidth]);

  // A pinch works in the menu's units — a multiple of fit-width — so "Fit
  // page" and "Fit width" are first read back as the number they amount to.
  usePinchZoom(containerRef, scale / fitWidth, (z) => onZoomChange?.(z), { enabled: !!onZoomChange });

  const fieldsByPage = useMemo(() => {
    const map: Record<string, FieldRec[]> = {};
    for (const f of fields) (map[f.page_id] ??= []).push(f);
    return map;
  }, [fields]);

  // Report which page is centerd so the caller can show "Page 3 of 12".
  const pageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !onVisiblePageChange) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const mid = el.scrollTop + el.clientHeight / 2;
        let best: string | null = null;
        let bestDist = Infinity;
        for (const p of pages) {
          const node = pageRefs.current[p.id];
          if (!node) continue;
          const center = node.offsetTop + node.offsetHeight / 2;
          const dist = Math.abs(center - mid);
          if (dist < bestDist) { bestDist = dist; best = p.id; }
        }
        if (best) onVisiblePageChange(best);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [containerRef, pages, onVisiblePageChange]);

  const handleLayerChange = useCallback(
    (pageId: string) => (layer: LayerData) => onLayerChange(pageId, layer),
    [onLayerChange],
  );

  return (
    <div ref={containerRef} className="h-full overflow-auto bg-oat" style={{ overscrollBehavior: "contain" }}>
      {header}
      {/* Start-aligned with auto margins, not centred: a page zoomed wider
          than the screen has to scroll from its left edge, and a centred flex
          item splits its overflow both ways with the left half unreachable. */}
      <div className="flex flex-col items-start gap-6 px-4 py-6">
        {pages.map((page, i) => {
          const target = typeof writeTarget === "function" ? writeTarget(page.id) : writeTarget;
          return (
          <div
            key={page.id}
            ref={(node) => { pageRefs.current[page.id] = node; }}
            data-page-id={page.id}
            className="relative mx-auto"
          >
            <div className="mb-1.5 flex items-center justify-between gap-2 text-[16px] text-pine/70">
              <span className="truncate">{page.label || `Page ${i + 1}`}</span>
              <ReadAloud notebookId={notebookId} page={page} />
            </div>
            <LazyPage width={page.width * scale} height={page.height * scale}>
              <PageCanvas
                {...pageSource(notebookId, page)}
                scale={scale}
                fields={fieldsByPage[page.id] ?? []}
                fieldValues={fieldValues}
                onFieldChange={onFieldChange}
                studentLayer={studentLayers[page.id] ?? emptyLayer()}
                teacherLayer={teacherLayers[page.id] ?? emptyLayer()}
                masterLayer={masterLayers?.[page.id]}
                onLayerChange={target ? handleLayerChange(page.id) : undefined}
                writeTarget={target}
                tool={tool}
                fingerDraw={fingerDraw}
                fieldsEditable={fieldsEditable}
                showMarkHistory={showMarkHistory}
                authorName={authorName}
                notebookId={notebookId}
                studentId={studentId}
                preview={preview}
                onResponseUploaded={onResponseUploaded}
              />
            </LazyPage>
          </div>
          );
        })}
        <div className="h-16" />
      </div>
    </div>
  );
}
