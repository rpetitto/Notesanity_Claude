/**
 * The shared reading/writing surface used by both the student workspace and the
 * teacher's grading view. It owns page layout, zoom, lazy rendering and the
 * per-page layer state; callers decide which layer is writable.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { assetUrl, type FieldRec, type LayerRec, type PageRec } from "../lib/api";
import { type LayerData, emptyLayer, parseLayer } from "../lib/ink";
import PageCanvas, { type ToolState } from "./PageCanvas";
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

interface Props {
  notebookId: string;
  pages: PageRec[];
  fields: FieldRec[];
  studentLayers: LayerMap;
  teacherLayers: LayerMap;
  fieldValues: Record<string, string>;
  writeTarget: "student" | "teacher" | null;
  tool: ToolState;
  fingerDraw: boolean;
  zoom: number;
  fieldsEditable: boolean;
  onLayerChange: (pageId: string, layer: LayerData) => void;
  onFieldChange: (fieldId: string, value: string) => void;
  onVisiblePageChange?: (pageId: string) => void;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  header?: React.ReactNode;
}

export default function NotebookSurface({
  notebookId, pages, fields, studentLayers, teacherLayers, fieldValues,
  writeTarget, tool, fingerDraw, zoom, fieldsEditable,
  onLayerChange, onFieldChange, onVisiblePageChange, scrollRef, header,
}: Props) {
  const innerRef = useRef<HTMLDivElement>(null);
  const containerRef = scrollRef ?? innerRef;
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setContainerWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  // Fit the widest page to the available width, then apply the user's zoom.
  const baseScale = useMemo(() => {
    const widest = pages.reduce((m, p) => Math.max(m, p.width), 0) || 612;
    const usable = Math.max(280, containerWidth - 48);
    return Math.min(1.6, usable / widest);
  }, [pages, containerWidth]);

  const scale = baseScale * zoom;

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
    <div ref={containerRef} className="h-full overflow-auto bg-slate-100" style={{ overscrollBehavior: "contain" }}>
      {header}
      <div className="flex flex-col items-center gap-6 px-4 py-6">
        {pages.map((page, i) => (
          <div
            key={page.id}
            ref={(node) => { pageRefs.current[page.id] = node; }}
            data-page-id={page.id}
            className="relative"
          >
            <div className="mb-1.5 flex items-center justify-between text-xs text-slate-500">
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
                onLayerChange={writeTarget ? handleLayerChange(page.id) : undefined}
                writeTarget={writeTarget}
                tool={tool}
                fingerDraw={fingerDraw}
                fieldsEditable={fieldsEditable}
              />
            </LazyPage>
          </div>
        ))}
        <div className="h-16" />
      </div>
    </div>
  );
}
