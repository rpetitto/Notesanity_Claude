/**
 * The shared reading/writing surface used by both the student workspace and the
 * teacher's grading view. It owns page layout, zoom, lazy rendering and the
 * per-page layer state; callers decide which layer is writable.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { assetUrl, type FieldRec, type LayerRec, type PageRec } from "../lib/api";
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

interface Props {
  notebookId: string;
  pages: PageRec[];
  fields: FieldRec[];
  studentLayers: LayerMap;
  teacherLayers: LayerMap;
  /** Published teacher template annotations, keyed by page id — painted below student ink, never editable. */
  masterLayers?: LayerMap;
  fieldValues: Record<string, FieldValue>;
  writeTarget: "student" | "teacher" | null;
  tool: ToolState;
  fingerDraw: boolean;
  zoom: ZoomMode;
  authorName?: string;
  fieldsEditable: boolean;
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

export default function NotebookSurface({
  notebookId, pages, fields, studentLayers, teacherLayers, masterLayers, fieldValues,
  writeTarget, tool, fingerDraw, zoom, authorName, fieldsEditable,
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

  const scale = useMemo(() => {
    const widest = pages.reduce((m, p) => Math.max(m, p.width), 0) || 612;
    const tallest = pages.reduce((m, p) => Math.max(m, p.height), 0) || 792;
    const usableW = Math.max(280, box.width - 48);
    const fitWidth = Math.min(1.6, usableW / widest);
    if (zoom === "width") return fitWidth;
    if (zoom === "page") {
      // Leave room for the page caption and the gap between pages.
      const usableH = Math.max(240, box.height - 76);
      return Math.max(0.15, Math.min(fitWidth, usableH / tallest));
    }
    return fitWidth * zoom;
  }, [pages, box, zoom]);

  const fieldsByPage = useMemo(() => {
    const map: Record<string, FieldRec[]> = {};
    for (const f of fields) (map[f.page_id] ??= []).push(f);
    return map;
  }, [fields]);

  // Report which page is centred so the caller can show "Page 3 of 12".
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
      <div className="flex flex-col items-center gap-6 px-4 py-6">
        {pages.map((page, i) => (
          <div
            key={page.id}
            ref={(node) => { pageRefs.current[page.id] = node; }}
            data-page-id={page.id}
            className="relative"
          >
            <div className="mb-1.5 flex items-center justify-between text-[16px] text-pine/70">
              <span>{page.label || `Page ${i + 1}`}</span>
            </div>
            <LazyPage width={page.width * scale} height={page.height * scale}>
              <PageCanvas
                pdfUrl={assetUrl(notebookId, page.asset_key)}
                sourceIndex={page.source_index}
                pageWidth={page.width}
                pageHeight={page.height}
                scale={scale}
                fields={fieldsByPage[page.id] ?? []}
                fieldValues={fieldValues}
                onFieldChange={onFieldChange}
                studentLayer={studentLayers[page.id] ?? emptyLayer()}
                teacherLayer={teacherLayers[page.id] ?? emptyLayer()}
                masterLayer={masterLayers?.[page.id]}
                onLayerChange={writeTarget ? handleLayerChange(page.id) : undefined}
                writeTarget={writeTarget}
                tool={tool}
                fingerDraw={fingerDraw}
                fieldsEditable={fieldsEditable}
                authorName={authorName}
                notebookId={notebookId}
                studentId={studentId}
                onResponseUploaded={onResponseUploaded}
              />
            </LazyPage>
          </div>
        ))}
        <div className="h-16" />
      </div>
    </div>
  );
}
