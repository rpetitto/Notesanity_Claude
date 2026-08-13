/**
 * The three-layer render surface.
 *
 *   Layer 1  <canvas>  the PDF page, rendered by pdf.js
 *   Layer 2  <div>     teacher-authored form fields (real HTML inputs)
 *   Layer 3  <canvas>  student ink, teacher ink, plus text boxes and stamps
 *
 * Everything above Layer 1 is positioned in page units and scaled at paint time,
 * so the same annotation data renders identically at any zoom or pixel density.
 *
 * iOS Safari / Apple Pencil notes:
 *  - Apple Pencil arrives as `pointerType === 'pen'` and carries real `pressure`.
 *  - Fingers are ignored for drawing unless the user opts in, which is what makes
 *    palm-resting work on an iPad; a pen seen recently also suppresses touch.
 *  - `touch-action` is only set to `none` while finger-drawing is enabled, so
 *    ordinary scrolling and pinch-zoom keep working the rest of the time.
 *  - `getCoalescedEvents` is used when available to capture the full 120Hz
 *    ProMotion sample rate instead of one point per frame.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FieldRec } from "../lib/api";
import {
  type LayerData, type Stroke, type ToolKind, drawLayer, drawStroke, hitStroke,
} from "../lib/ink";
import { renderPageToCanvas } from "../lib/pdf";
import { cn } from "../lib/utils";

export interface ToolState {
  kind: ToolKind;
  color: string;
  width: number;
  stamp: string;
  fontSize: number;
}

interface Props {
  pdfUrl: string;
  sourceIndex: number;
  pageWidth: number;
  pageHeight: number;
  scale: number;
  fields: FieldRec[];
  fieldValues: Record<string, string>;
  onFieldChange?: (fieldId: string, value: string) => void;
  studentLayer: LayerData;
  teacherLayer: LayerData;
  onLayerChange?: (layer: LayerData) => void;
  /** Which layer new marks go to. `null` makes the page read-only. */
  writeTarget: "student" | "teacher" | null;
  tool: ToolState;
  fingerDraw: boolean;
  fieldsEditable: boolean;
  className?: string;
}

const uid = () => Math.random().toString(36).slice(2, 10);
const DPR = () => Math.min(window.devicePixelRatio || 1, 2);

export default function PageCanvas({
  pdfUrl, sourceIndex, pageWidth, pageHeight, scale,
  fields, fieldValues, onFieldChange,
  studentLayer, teacherLayer, onLayerChange,
  writeTarget, tool, fingerDraw, fieldsEditable, className,
}: Props) {
  const baseRef = useRef<HTMLCanvasElement>(null);
  const studentRef = useRef<HTMLCanvasElement>(null);
  const teacherRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);

  const [baseReady, setBaseReady] = useState(false);
  const [editingText, setEditingText] = useState<string | null>(null);

  const cssW = pageWidth * scale;
  const cssH = pageHeight * scale;

  // ---- Layer 1: the PDF page ----
  useEffect(() => {
    const canvas = baseRef.current;
    if (!canvas) return;
    const signal = { cancelled: false };
    setBaseReady(false);
    renderPageToCanvas(pdfUrl, sourceIndex, canvas, scale, DPR(), signal)
      .then(() => { if (!signal.cancelled) setBaseReady(true); })
      .catch((err) => console.error("PDF render failed", err));
    return () => { signal.cancelled = true; };
  }, [pdfUrl, sourceIndex, scale]);

  // ---- Layer 3: committed ink ----
  const paint = useCallback((canvas: HTMLCanvasElement | null, layer: LayerData) => {
    if (!canvas) return;
    const dpr = DPR();
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    drawLayer(ctx, layer, scale);
  }, [cssW, cssH, scale]);

  useLayoutEffect(() => { paint(studentRef.current, studentLayer); }, [paint, studentLayer]);
  useLayoutEffect(() => { paint(teacherRef.current, teacherLayer); }, [paint, teacherLayer]);

  useLayoutEffect(() => {
    const canvas = liveRef.current;
    if (!canvas) return;
    const dpr = DPR();
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    const ctx = canvas.getContext("2d");
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, [cssW, cssH]);

  // ---- pointer input ----
  const drawing = useRef(false);
  const points = useRef<number[]>([]);
  const drawnUpTo = useRef(0);
  const lastPenAt = useRef(0);
  const activePointer = useRef<number | null>(null);

  const activeLayer = writeTarget === "teacher" ? teacherLayer : studentLayer;
  const isDrawTool = tool.kind === "pen" || tool.kind === "highlighter";
  const canWrite = writeTarget !== null && !!onLayerChange;

  const toPage = (e: PointerEvent | React.PointerEvent, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
  };

  const shouldAcceptPointer = (e: React.PointerEvent | PointerEvent) => {
    if (e.pointerType === "pen") return true;
    if (e.pointerType === "mouse") return (e as PointerEvent).buttons !== 2;
    // touch
    if (!fingerDraw) return false;
    // Suppress the palm: a pen used in the last moment wins over touch contacts.
    return Date.now() - lastPenAt.current > 1200;
  };

  const commitStroke = useCallback(() => {
    if (points.current.length < 3 || !onLayerChange) {
      points.current = [];
      return;
    }
    const stroke: Stroke = {
      t: tool.kind === "highlighter" ? "h" : "p",
      c: tool.color,
      w: tool.width,
      p: points.current.slice(),
    };
    onLayerChange({ ...activeLayer, s: [...activeLayer.s, stroke] });
    points.current = [];
    const ctx = liveRef.current?.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, cssW, cssH);
  }, [activeLayer, onLayerChange, tool, cssW, cssH]);

  const drawLive = useCallback(() => {
    const ctx = liveRef.current?.getContext("2d");
    if (!ctx) return;
    const p = points.current;
    // Paint only what's new — repainting the whole stroke each frame gets
    // expensive on low-powered Chromebooks once a stroke is long.
    const partial: Stroke = {
      t: tool.kind === "highlighter" ? "h" : "p",
      c: tool.color,
      w: tool.width,
      p: p.slice(Math.max(0, drawnUpTo.current)),
    };
    if (partial.p.length >= 6) {
      drawStroke(ctx, partial, scale);
      drawnUpTo.current = p.length - 3;
    }
  }, [tool, scale]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "pen") lastPenAt.current = Date.now();
    if (!canWrite) return;
    if (!shouldAcceptPointer(e)) return;

    const surface = e.currentTarget;
    const { x, y } = toPage(e, surface);

    if (tool.kind === "eraser") {
      e.preventDefault();
      activePointer.current = e.pointerId;
      surface.setPointerCapture(e.pointerId);
      eraseAt(x, y);
      return;
    }

    if (tool.kind === "text") {
      const id = uid();
      onLayerChange?.({
        ...activeLayer,
        x: [...activeLayer.x, { id, x, y, w: Math.min(220, pageWidth - x - 8), s: tool.fontSize, c: tool.color, v: "" }],
      });
      setEditingText(id);
      return;
    }

    if (tool.kind === "stamp") {
      onLayerChange?.({
        ...activeLayer,
        e: [...activeLayer.e, { id: uid(), x, y, s: tool.fontSize * 1.8, e: tool.stamp }],
      });
      return;
    }

    if (!isDrawTool) return;

    e.preventDefault();
    drawing.current = true;
    activePointer.current = e.pointerId;
    surface.setPointerCapture(e.pointerId);
    points.current = [x, y, e.pressure > 0 ? e.pressure : 0.5];
    drawnUpTo.current = 0;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "pen") lastPenAt.current = Date.now();
    if (activePointer.current !== e.pointerId) return;
    const surface = e.currentTarget;

    if (tool.kind === "eraser") {
      const { x, y } = toPage(e, surface);
      eraseAt(x, y);
      return;
    }

    if (!drawing.current) return;
    e.preventDefault();

    const native = e.nativeEvent as PointerEvent;
    const samples =
      typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [native];
    for (const s of samples.length ? samples : [native]) {
      const { x, y } = toPage(s, surface);
      const p = points.current;
      // Drop sub-pixel jitter; keeps payloads small without visible loss.
      const n = p.length;
      if (n >= 3) {
        const dx = x - p[n - 3];
        const dy = y - p[n - 2];
        if (dx * dx + dy * dy < 0.25) continue;
      }
      p.push(x, y, s.pressure > 0 ? s.pressure : 0.5);
    }
    drawLive();
  };

  const endStroke = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointer.current !== e.pointerId) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    activePointer.current = null;
    if (drawing.current) {
      drawing.current = false;
      commitStroke();
    }
  };

  const eraseAt = (x: number, y: number) => {
    if (!onLayerChange) return;
    const radius = Math.max(4, tool.width * 1.5);
    const idx = hitStroke(activeLayer.s, x, y, radius);
    if (idx >= 0) {
      const next = activeLayer.s.slice();
      next.splice(idx, 1);
      onLayerChange({ ...activeLayer, s: next });
      return;
    }
    const stamp = activeLayer.e.find((s) => Math.abs(s.x - x) < s.s && Math.abs(s.y - y) < s.s);
    if (stamp) onLayerChange({ ...activeLayer, e: activeLayer.e.filter((s) => s.id !== stamp.id) });
  };

  const updateText = (id: string, v: string) => {
    if (!onLayerChange) return;
    onLayerChange({ ...activeLayer, x: activeLayer.x.map((t) => (t.id === id ? { ...t, v } : t)) });
  };
  const removeText = (id: string) => {
    if (!onLayerChange) return;
    onLayerChange({ ...activeLayer, x: activeLayer.x.filter((t) => t.id !== id) });
    setEditingText(null);
  };

  const interactive = canWrite && tool.kind !== "select";
  const blockTouchScroll = interactive && fingerDraw && (isDrawTool || tool.kind === "eraser");

  return (
    <div
      className={cn("relative bg-white shadow-sm select-none", className)}
      style={{
        width: cssW,
        height: cssH,
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <canvas ref={baseRef} style={{ width: cssW, height: cssH }} className="absolute inset-0 block" />
      {!baseReady && <div className="absolute inset-0 animate-pulse bg-slate-100" />}

      {/* Layer 2 — form fields */}
      <div className="absolute inset-0" style={{ pointerEvents: fieldsEditable ? "auto" : "none" }}>
        {fields.map((f) => (
          <FieldControl
            key={f.id}
            field={f}
            scale={scale}
            value={fieldValues[f.id] ?? ""}
            editable={fieldsEditable}
            onChange={(v) => onFieldChange?.(f.id, v)}
          />
        ))}
      </div>

      <canvas ref={studentRef} style={{ width: cssW, height: cssH }} className="absolute inset-0 block pointer-events-none" />
      <canvas ref={teacherRef} style={{ width: cssW, height: cssH }} className="absolute inset-0 block pointer-events-none" />
      <canvas ref={liveRef} style={{ width: cssW, height: cssH }} className="absolute inset-0 block pointer-events-none" />

      {/* Text boxes and stamps live above the ink so they stay editable. */}
      <div className="absolute inset-0" style={{ pointerEvents: "none" }}>
        {[...studentLayer.x.map((t) => ({ t, own: writeTarget === "student" })),
          ...teacherLayer.x.map((t) => ({ t, own: writeTarget === "teacher" }))].map(({ t, own }) => (
          <div
            key={t.id}
            className="absolute"
            style={{ left: t.x * scale, top: t.y * scale, width: t.w * scale, pointerEvents: own ? "auto" : "none" }}
          >
            {own && editingText === t.id ? (
              <textarea
                autoFocus
                value={t.v}
                onChange={(e) => updateText(t.id, e.target.value)}
                onBlur={() => { if (!t.v.trim()) removeText(t.id); else setEditingText(null); }}
                className="w-full resize-none rounded border border-blue-400 bg-white/95 px-1 py-0.5 outline-none"
                style={{ fontSize: t.s * scale, lineHeight: 1.25, color: t.c }}
                rows={2}
              />
            ) : (
              <div
                onClick={() => own && setEditingText(t.id)}
                className={cn("whitespace-pre-wrap break-words", own && "cursor-text hover:bg-blue-50/50 rounded")}
                style={{ fontSize: t.s * scale, lineHeight: 1.25, color: t.c }}
              >
                {t.v}
              </div>
            )}
          </div>
        ))}
        {[...studentLayer.e, ...teacherLayer.e].map((s) => (
          <div
            key={s.id}
            className="absolute -translate-x-1/2 -translate-y-1/2 leading-none"
            style={{ left: s.x * scale, top: s.y * scale, fontSize: s.s * scale }}
          >
            {s.e}
          </div>
        ))}
      </div>

      {/* Pointer surface sits on top so drawing beats text/field hit-testing. */}
      {interactive && (
        <div
          className="absolute inset-0"
          style={{
            touchAction: blockTouchScroll ? "none" : "auto",
            cursor: tool.kind === "eraser" ? "cell" : isDrawTool ? "crosshair" : "copy",
            // Text and stamp tools place a single mark, then get out of the way of
            // the element they just created.
            pointerEvents: "auto",
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onPointerLeave={endStroke}
          onContextMenu={(e) => e.preventDefault()}
        />
      )}
    </div>
  );
}

function FieldControl({
  field, scale, value, editable, onChange,
}: {
  field: FieldRec; scale: number; value: string; editable: boolean; onChange: (v: string) => void;
}) {
  const style = {
    left: field.x * scale,
    top: field.y * scale,
    width: field.w * scale,
    height: field.h * scale,
  } as const;

  if (field.type === "checkbox") {
    return (
      <button
        type="button"
        disabled={!editable}
        onClick={() => onChange(value === "1" ? "" : "1")}
        title={field.label}
        className={cn(
          "absolute flex items-center justify-center rounded border-2 transition-colors",
          value === "1" ? "border-blue-600 bg-blue-50 text-blue-700" : "border-blue-300/70 bg-white/60",
          editable ? "cursor-pointer hover:border-blue-500" : "cursor-default",
        )}
        style={style}
      >
        {value === "1" && (
          <svg viewBox="0 0 24 24" className="h-4/5 w-4/5" fill="none" stroke="currentColor" strokeWidth={3}>
            <path d="M4 12l5 5L20 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
    );
  }

  if (field.type === "choice") {
    let options: string[] = [];
    try { options = JSON.parse(field.options || "[]"); } catch { options = []; }
    return (
      <select
        disabled={!editable}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title={field.label}
        className="absolute rounded border-2 border-blue-300/70 bg-white/80 px-1 outline-none focus:border-blue-500"
        style={{ ...style, fontSize: Math.max(11, field.h * scale * 0.5) }}
      >
        <option value="">—</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }

  return (
    <textarea
      disabled={!editable}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.label}
      className={cn(
        "absolute resize-none rounded border-2 bg-white/70 px-1 py-0.5 outline-none",
        editable ? "border-blue-300/70 focus:border-blue-500 focus:bg-white" : "border-transparent bg-transparent",
      )}
      style={{ ...style, fontSize: Math.max(11, Math.min(16, field.h * scale * 0.42)), lineHeight: 1.2 }}
    />
  );
}
