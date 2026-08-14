/**
 * The three-layer render surface.
 *
 *   Layer 1  <canvas>  the PDF page, rendered by pdf.js
 *   Layer 2  <div>     teacher-authored form fields (real HTML inputs)
 *   Layer 3  <canvas>  student ink, teacher ink, plus text, stamps and comments
 *
 * Everything above Layer 1 is positioned in page units and scaled at paint time,
 * so the same annotation data renders identically at any zoom or pixel density.
 *
 * Hit-testing rule: the pointer surface sits *below* the overlays, so form
 * fields, text boxes and comment pins stay clickable without switching tools.
 * Two different things stand aside, and they are not the same set:
 *
 *  - The form-field overlay goes transparent for any tool that *places*
 *    something (pen/highlighter/eraser/stamp/text/comment), so the gesture
 *    reaches the page rather than the field sitting over it.
 *  - The page's own objects go transparent only for the freehand tools
 *    (pen/highlighter/eraser), so a stroke can cross them — but a text box
 *    stays typeable and a comment pin stays openable while their own tool is
 *    selected, which is the whole point of picking that tool.
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
import {
  ImageIcon, Loader2, MessageSquare, Mic, Music, RefreshCw, Square, Trash2, X,
} from "lucide-react";
import { toast } from "sonner";
import type { FieldRec } from "../lib/api";
import {
  type LayerData, type Stroke, type ToolKind, drawLayer, drawStroke, hitStroke, straightenHighlight,
} from "../lib/ink";
import { renderPageToCanvas } from "../lib/pdf";
import { isPattern, renderPatternToCanvas, DEFAULT_PATTERN_COLOR } from "../lib/patterns";
import { cn } from "../lib/utils";

/**
 * `FieldRec` doesn't (yet) declare the `prompt`/`image`/`audio` field types or
 * their extra columns — widen locally rather than editing the shared type, since
 * a plain `text`/`checkbox`/`choice` field from the server still satisfies this.
 */
export type FieldLike = Omit<FieldRec, "type"> & {
  type: FieldRec["type"] | "prompt" | "image" | "audio";
  prompt?: string;
  has_media?: number | boolean;
};

/**
 * A field value entry is normally just the typed text, but `image`/`audio`
 * fields report an uploaded file via `asset_key`/`content_type` instead.
 * Widening this stays backward compatible: a plain string map (what every
 * existing caller passes today) is still assignable here.
 */
export type FieldValue = string | { value?: string; asset_key?: string; content_type?: string };

const fieldText = (v: FieldValue | undefined): string => (typeof v === "string" ? v : v?.value ?? "");

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
  /** Set on a teacher-inserted blank page: draw this ruling instead of a PDF. */
  pattern?: string;
  patternColor?: string;
  scale: number;
  fields: FieldRec[];
  fieldValues: Record<string, FieldValue>;
  onFieldChange?: (fieldId: string, value: string) => void;
  studentLayer: LayerData;
  teacherLayer: LayerData;
  /** Published teacher template annotations, painted below student ink and never editable. */
  masterLayer?: LayerData;
  onLayerChange?: (layer: LayerData) => void;
  /** Which layer new marks go to. `null` makes the page read-only. */
  writeTarget: "student" | "teacher" | null;
  tool: ToolState;
  fingerDraw: boolean;
  fieldsEditable: boolean;
  /** Display name stamped onto new comments. */
  authorName?: string;
  className?: string;
  /** Needed to build asset/response URLs for `prompt`, `image` and `audio` fields. */
  notebookId?: string;
  /** Whose response is being shown/edited — omitted means "the signed-in student". */
  studentId?: string;
  /** Called after a student uploads or removes an `image`/`audio` response, so the parent can refresh. */
  onResponseUploaded?: (fieldId: string) => void;
}

const uid = () => Math.random().toString(36).slice(2, 10);
const DPR = () => Math.min(window.devicePixelRatio || 1, 2);

/**
 * Tools that put something on the page — as opposed to `select`, which just
 * reads it. A tap with one of these has to reach the page underneath the form
 * fields overlay rather than being swallowed by it.
 */
const PLACEMENT_TOOLS: ToolKind[] = ["pen", "highlighter", "eraser", "stamp", "text", "comment"];

/**
 * The subset that paints freehand. These also make the page's own objects —
 * text boxes, comment pins — pointer-transparent, so a stroke can cross one
 * instead of being caught by it.
 *
 * The others must NOT do that: a text box you just placed has to be typeable,
 * and a comment pin has to be openable, while its own tool is still selected.
 */
const MARKING_TOOLS: ToolKind[] = ["pen", "highlighter", "eraser"];

export default function PageCanvas({
  pdfUrl, sourceIndex, pageWidth, pageHeight, pattern, patternColor, scale,
  fields, fieldValues, onFieldChange,
  studentLayer, teacherLayer, masterLayer, onLayerChange,
  writeTarget, tool, fingerDraw, fieldsEditable, authorName, className,
  notebookId = "", studentId, onResponseUploaded,
}: Props) {
  const baseRef = useRef<HTMLCanvasElement>(null);
  const masterRef = useRef<HTMLCanvasElement>(null);
  const studentRef = useRef<HTMLCanvasElement>(null);
  const teacherRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);

  const [baseReady, setBaseReady] = useState(false);
  const [editingText, setEditingText] = useState<string | null>(null);
  const [openComment, setOpenComment] = useState<string | null>(null);

  const cssW = pageWidth * scale;
  const cssH = pageHeight * scale;

  // ---- Layer 1: the page itself, from a PDF or drawn ----
  useEffect(() => {
    const canvas = baseRef.current;
    if (!canvas) return;
    const signal = { cancelled: false };
    setBaseReady(false);
    if (isPattern(pattern)) {
      renderPatternToCanvas(
        pattern, patternColor || DEFAULT_PATTERN_COLOR,
        pageWidth, pageHeight, canvas, scale, DPR(),
      );
      setBaseReady(true);
      return;
    }
    renderPageToCanvas(pdfUrl, sourceIndex, canvas, scale, DPR(), signal)
      .then(() => { if (!signal.cancelled) setBaseReady(true); })
      .catch((err) => console.error("PDF render failed", err));
    return () => { signal.cancelled = true; };
  }, [pdfUrl, sourceIndex, scale, pattern, patternColor, pageWidth, pageHeight]);

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

  useLayoutEffect(() => {
    if (masterLayer) paint(masterRef.current, masterLayer);
  }, [paint, masterLayer]);
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
  /**
   * A press that lands on a text box or a field while a pen is selected is
   * ambiguous: the user may be starting a stroke across it, or reaching for the
   * box to type in. We hold the gesture until it declares itself — movement
   * means draw, release without movement means select.
   */
  const pendingTap = useRef<{ x: number; y: number; clientX: number; clientY: number; target: HTMLElement } | null>(null);
  const DRAG_SLOP = 5;
  const drawnUpTo = useRef(0);
  const lastPenAt = useRef(0);
  const activePointer = useRef<number | null>(null);

  const activeLayer = writeTarget === "teacher" ? teacherLayer : studentLayer;
  const isMarking = MARKING_TOOLS.includes(tool.kind);
  const isPlacing = PLACEMENT_TOOLS.includes(tool.kind);
  const isDrawTool = tool.kind === "pen" || tool.kind === "highlighter";
  const canWrite = writeTarget !== null && !!onLayerChange;

  const toPage = (e: PointerEvent | React.PointerEvent, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
  };

  const shouldAcceptPointer = (e: React.PointerEvent | PointerEvent) => {
    if (e.pointerType === "pen") return true;
    if (e.pointerType === "mouse") return (e as PointerEvent).buttons !== 2;
    if (!fingerDraw) return false;
    // Suppress the palm: a pen used in the last moment wins over touch contacts.
    return Date.now() - lastPenAt.current > 1200;
  };

  const commitStroke = useCallback(() => {
    if (points.current.length < 3 || !onLayerChange) {
      points.current = [];
      return;
    }
    const highlighter = tool.kind === "highlighter";
    const path = highlighter ? straightenHighlight(points.current, tool.width) : points.current;
    const stroke: Stroke = {
      t: highlighter ? "h" : "p",
      c: tool.color,
      w: tool.width,
      p: path.slice(),
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

    // Highlighters repaint whole. The stroke can snap straight at any moment as
    // the gesture develops, so the preview has to be able to un-draw itself —
    // and translucent segments painted over each other would darken at the
    // joins anyway. A highlight is a few hundred points at most.
    if (tool.kind === "highlighter") {
      ctx.clearRect(0, 0, cssW, cssH);
      const path = straightenHighlight(p, tool.width);
      if (path.length >= 6) drawStroke(ctx, { t: "h", c: tool.color, w: tool.width, p: path }, scale);
      return;
    }

    // Pen paints only what's new — repainting the whole stroke each frame gets
    // expensive on low-powered Chromebooks once a stroke is long.
    const partial: Stroke = {
      t: "p",
      c: tool.color,
      w: tool.width,
      p: p.slice(Math.max(0, drawnUpTo.current)),
    };
    if (partial.p.length >= 6) {
      drawStroke(ctx, partial, scale);
      drawnUpTo.current = p.length - 3;
    }
  }, [tool, scale, cssW, cssH]);

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
      // Without this the browser's own mousedown focus lands on the page and
      // clobbers the new box's autoFocus, leaving the student typing into
      // nothing.
      e.preventDefault();
      const id = uid();
      onLayerChange?.({
        ...activeLayer,
        x: [...activeLayer.x, { id, x, y, w: Math.min(220, pageWidth - x - 8), s: tool.fontSize, c: tool.color, v: "" }],
      });
      setEditingText(id);
      return;
    }

    if (tool.kind === "stamp") {
      e.preventDefault();
      onLayerChange?.({
        ...activeLayer,
        e: [...activeLayer.e, { id: uid(), x, y, s: tool.fontSize * 1.8, e: tool.stamp }],
      });
      return;
    }

    if (tool.kind === "comment") {
      // Same reason as text: the pin opens straight into an editable note.
      e.preventDefault();
      const id = uid();
      onLayerChange?.({
        ...activeLayer,
        c: [...activeLayer.c, { id, x, y, t: "", a: authorName }],
      });
      setOpenComment(id);
      return;
    }

    if (!isDrawTool) return;

    e.preventDefault();
    activePointer.current = e.pointerId;
    surface.setPointerCapture(e.pointerId);
    points.current = [x, y, e.pressure > 0 ? e.pressure : 0.5];
    drawnUpTo.current = 0;

    // Did this press land on something typeable? If so, wait to see whether it
    // becomes a stroke before stealing the tap from it.
    const under = typeableUnder(e.clientX, e.clientY);
    if (under) {
      pendingTap.current = { x, y, clientX: e.clientX, clientY: e.clientY, target: under };
      drawing.current = false;
      return;
    }
    drawing.current = true;
  };

  /**
   * The interactive overlay sits above the pointer surface but is made
   * pointer-transparent while marking, so we hit-test it by hand.
   */
  const typeableUnder = (clientX: number, clientY: number): HTMLElement | null => {
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      const node = el as HTMLElement;
      if (node.dataset?.typeable === "1") return node;
    }
    return null;
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

    // Movement past the slop turns a held tap into a stroke, starting from where
    // the press actually began so no ink is lost.
    if (pendingTap.current) {
      const dx = e.clientX - pendingTap.current.clientX;
      const dy = e.clientY - pendingTap.current.clientY;
      if (dx * dx + dy * dy < DRAG_SLOP * DRAG_SLOP) return;
      pendingTap.current = null;
      drawing.current = true;
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

    // Released without moving, over something typeable — that was a tap to type,
    // not a stroke. Hand the gesture to the element the user aimed at.
    if (pendingTap.current) {
      const target = pendingTap.current.target;
      pendingTap.current = null;
      points.current = [];
      const focusable = target.matches("textarea, input, select")
        ? target
        : target.querySelector<HTMLElement>("textarea, input, select");
      if (focusable) focusable.focus();
      else target.click();
      return;
    }

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
  const updateComment = (id: string, t: string) => {
    if (!onLayerChange) return;
    onLayerChange({ ...activeLayer, c: activeLayer.c.map((k) => (k.id === id ? { ...k, t } : k)) });
  };
  const removeComment = (id: string) => {
    if (!onLayerChange) return;
    onLayerChange({ ...activeLayer, c: activeLayer.c.filter((k) => k.id !== id) });
    setOpenComment(null);
  };

  const interactive = canWrite && tool.kind !== "select";
  const blockTouchScroll = interactive && fingerDraw && isMarking;

  // Placing anything needs the gesture to reach the page, so the form-field
  // overlay stands aside for every placement tool.
  const fieldPointerEvents = isPlacing && canWrite ? "none" : "auto";
  // The page's own objects only stand aside for freehand marks, so that the
  // text box or comment a tool just created stays usable.
  const objectPointerEvents = isMarking && canWrite ? "none" : "auto";

  const textOwners = [
    ...studentLayer.x.map((t) => ({ t, own: writeTarget === "student" })),
    ...teacherLayer.x.map((t) => ({ t, own: writeTarget === "teacher" })),
  ];
  const comments = [
    ...studentLayer.c.map((k) => ({ k, own: writeTarget === "student", teacher: false })),
    ...teacherLayer.c.map((k) => ({ k, own: writeTarget === "teacher", teacher: true })),
  ];

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
      {!baseReady && <div className="absolute inset-0 animate-pulse bg-oat" />}

      {masterLayer && (
        <canvas ref={masterRef} style={{ width: cssW, height: cssH }} className="absolute inset-0 block pointer-events-none" />
      )}
      <canvas ref={studentRef} style={{ width: cssW, height: cssH }} className="absolute inset-0 block pointer-events-none" />
      <canvas ref={teacherRef} style={{ width: cssW, height: cssH }} className="absolute inset-0 block pointer-events-none" />
      <canvas ref={liveRef} style={{ width: cssW, height: cssH }} className="absolute inset-0 block pointer-events-none" />

      {/* Pointer surface — sits under the interactive overlay so fields and pins
          stay clickable; only marking tools take over the full page. */}
      {interactive && (
        <div
          className="absolute inset-0"
          style={{
            touchAction: blockTouchScroll ? "none" : "auto",
            cursor: tool.kind === "eraser" ? "cell" : isDrawTool ? "crosshair" : "copy",
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onPointerLeave={endStroke}
          onContextMenu={(e) => e.preventDefault()}
        />
      )}

      {/* Layer 2 — form fields */}
      <div className="absolute inset-0" style={{ pointerEvents: fieldsEditable ? fieldPointerEvents : "none" }}>
        {fields.map((f) => (
          <FieldControl
            key={f.id}
            typeable
            field={f}
            scale={scale}
            value={fieldValues[f.id]}
            editable={fieldsEditable}
            onChange={(v) => onFieldChange?.(f.id, v)}
            notebookId={notebookId}
            studentId={studentId}
            onResponseUploaded={onResponseUploaded}
          />
        ))}
      </div>

      {/* Text boxes, stamps and comment pins */}
      <div className="absolute inset-0" style={{ pointerEvents: "none" }}>
        {textOwners.map(({ t, own }) => (
          <div
            key={t.id}
            className="absolute"
            data-typeable={own ? "1" : undefined}
            style={{
              left: t.x * scale,
              top: t.y * scale,
              width: t.w * scale,
              pointerEvents: own ? objectPointerEvents : "none",
            }}
          >
            {own && editingText === t.id ? (
              <textarea
                autoFocus
                value={t.v}
                onChange={(e) => updateText(t.id, e.target.value)}
                onBlur={() => { if (!t.v.trim()) removeText(t.id); else setEditingText(null); }}
                className="w-full resize-none rounded border border-pine bg-white/95 px-1 py-0.5 outline-none"
                style={{ fontSize: t.s * scale, lineHeight: 1.25, color: t.c }}
                rows={2}
              />
            ) : (
              <div
                onClick={() => own && setEditingText(t.id)}
                className={cn("whitespace-pre-wrap break-words", own && "cursor-text rounded hover:bg-mint/20/50")}
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

        {comments.map(({ k, own, teacher }, i) => (
          <CommentPin
            key={k.id}
            index={i + 1}
            comment={k}
            scale={scale}
            teacher={teacher}
            editable={own}
            open={openComment === k.id}
            pointerEvents={objectPointerEvents}
            onOpen={() => setOpenComment(openComment === k.id ? null : k.id)}
            onChange={(v) => updateComment(k.id, v)}
            onDelete={() => removeComment(k.id)}
            onClose={() => { if (!k.t.trim() && own) removeComment(k.id); else setOpenComment(null); }}
          />
        ))}
      </div>
    </div>
  );
}

function CommentPin({
  index, comment, scale, teacher, editable, open, pointerEvents, onOpen, onChange, onDelete, onClose,
}: {
  index: number;
  comment: { id: string; x: number; y: number; t: string; a?: string };
  scale: number;
  teacher: boolean;
  editable: boolean;
  open: boolean;
  pointerEvents: "auto" | "none";
  onOpen: () => void;
  onChange: (v: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="absolute"
      style={{ left: comment.x * scale, top: comment.y * scale, pointerEvents }}
    >
      <button
        type="button"
        onClick={onOpen}
        title={comment.t || "Comment"}
        className={cn(
          "flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-pine font-display text-[16px] text-pine shadow-md",
          teacher ? "bg-mint" : "bg-white",
        )}
      >
        {index}
      </button>

      {open && (
        <div className="absolute left-3 top-3 z-20 w-56 rounded-lg border border-pine/20 bg-white p-2 shadow-lg">
          <div className="mb-1 flex items-center gap-1.5 text-[16px] text-pine/70">
            <MessageSquare className="h-3 w-3" />
            {comment.a || (teacher ? "Teacher" : "Student")}
            <button onClick={onClose} className="ml-auto rounded p-0.5 hover:bg-oat">
              <X className="h-3 w-3" />
            </button>
          </div>
          {editable ? (
            <>
              <textarea
                autoFocus
                value={comment.t}
                onChange={(e) => onChange(e.target.value)}
                rows={3}
                placeholder="Add a comment…"
                className="w-full resize-none rounded border border-pine/35 px-1.5 py-1 text-[16px] outline-none focus:border-pine"
              />
              <div className="mt-1 flex justify-between">
                <button onClick={onDelete} className="text-[16px] text-[#a3341f] hover:underline">Delete</button>
                <button onClick={onClose} className="text-[16px] text-pine hover:underline">Done</button>
              </div>
            </>
          ) : (
            <p className="whitespace-pre-wrap break-words text-[16px] text-pine">{comment.t}</p>
          )}
        </div>
      )}
    </div>
  );
}

function FieldControl({
  field, scale, value, editable, onChange, typeable, notebookId, studentId, onResponseUploaded,
}: {
  field: FieldLike;
  scale: number;
  value: FieldValue | undefined;
  editable: boolean;
  onChange: (v: string) => void;
  notebookId: string;
  studentId?: string;
  onResponseUploaded?: (fieldId: string) => void;
  /** Marks the control as a tap target while a marking tool is active. */
  typeable?: boolean;
}) {
  const style = {
    left: field.x * scale,
    top: field.y * scale,
    width: field.w * scale,
    height: field.h * scale,
  } as const;

  if (field.type === "prompt") {
    return (
      <div
        className="absolute flex flex-col overflow-hidden rounded border-2 border-pine/45 bg-white/70"
        style={style}
        title={field.label}
      >
        {field.prompt && (
          <div
            className="shrink-0 px-1.5 pt-1 text-[16px] font-semibold text-pine"
            style={{ fontSize: Math.max(10, Math.min(13, field.h * scale * 0.14)) }}
          >
            {field.prompt}
          </div>
        )}
        {!!field.has_media && (
          <img
            src={`/api/notebooks/${notebookId}/fields/${field.id}/media`}
            alt=""
            className="min-h-0 flex-1 object-contain px-1"
          />
        )}
        <textarea
          {...(typeable ? { "data-typeable": "1" } : {})}
          disabled={!editable}
          value={fieldText(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Your answer"
          className={cn(
            "min-h-0 flex-1 resize-none bg-transparent px-1.5 py-0.5 outline-none",
            editable ? "focus:bg-white/60" : "",
          )}
          style={{ fontSize: Math.max(11, Math.min(16, field.h * scale * 0.16)), lineHeight: 1.2 }}
        />
      </div>
    );
  }

  if (field.type === "image") {
    return (
      <ResponseImageField
        field={field}
        style={style}
        editable={editable}
        notebookId={notebookId}
        studentId={studentId}
        onResponseUploaded={onResponseUploaded}
        typeable={typeable}
      />
    );
  }

  if (field.type === "audio") {
    return (
      <ResponseAudioField
        field={field}
        style={style}
        editable={editable}
        notebookId={notebookId}
        studentId={studentId}
        onResponseUploaded={onResponseUploaded}
        typeable={typeable}
      />
    );
  }

  const text = fieldText(value);

  const tap = typeable ? { "data-typeable": "1" } : {};

  if (field.type === "checkbox") {
    return (
      <button
        {...tap}
        type="button"
        disabled={!editable}
        onClick={() => onChange(text === "1" ? "" : "1")}
        title={field.label}
        className={cn(
          "absolute flex items-center justify-center rounded border-2 transition-colors",
          text === "1" ? "border-pine bg-mint/20 text-pine" : "border-pine/45 bg-white/60",
          editable ? "cursor-pointer hover:border-pine" : "cursor-default",
        )}
        style={style}
      >
        {text === "1" && (
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
        {...tap}
        disabled={!editable}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        title={field.label}
        className="absolute rounded border-2 border-pine/45 bg-white/80 px-1 outline-none focus:border-pine"
        style={{ ...style, fontSize: Math.max(11, field.h * scale * 0.5) }}
      >
        <option value="">—</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }

  return (
    <textarea
      {...tap}
      disabled={!editable}
      value={text}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.label}
      className={cn(
        "absolute resize-none rounded border-2 bg-white/70 px-1 py-0.5 outline-none",
        editable ? "border-pine/45 focus:border-pine focus:bg-white" : "border-transparent bg-transparent",
      )}
      style={{ ...style, fontSize: Math.max(11, Math.min(16, field.h * scale * 0.42)), lineHeight: 1.2 }}
    />
  );
}

/** Builds the URL for a student's uploaded image/audio response, with an optional cache-buster. */
function responseUrl(notebookId: string, fieldId: string, studentId: string | undefined, v: number) {
  const params = new URLSearchParams();
  if (studentId) params.set("student", studentId);
  if (v) params.set("v", String(v));
  const qs = params.toString();
  return `/api/notebooks/${notebookId}/responses/${fieldId}${qs ? `?${qs}` : ""}`;
}

/**
 * Probe whether a student response exists yet, via a lightweight HEAD request.
 * Only run on mount / after `nonce` changes — after an upload or delete we
 * already know the answer, so callers set state directly instead of re-probing.
 */
function useResponseProbe(url: string, nonce: number) {
  const [exists, setExists] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    setExists(null);
    fetch(url, { method: "HEAD", credentials: "same-origin" })
      .then((res) => { if (!cancelled) setExists(res.ok); })
      .catch(() => { if (!cancelled) setExists(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, nonce]);
  return [exists, setExists] as const;
}

function ResponseImageField({
  field, style, editable, notebookId, studentId, onResponseUploaded, typeable,
}: {
  field: FieldLike;
  style: { left: number; top: number; width: number; height: number };
  editable: boolean;
  notebookId: string;
  studentId?: string;
  onResponseUploaded?: (fieldId: string) => void;
  typeable?: boolean;
}) {
  const tap = typeable ? { "data-typeable": "1" } : {};
  const [cacheBust, setCacheBust] = useState(0);
  const url = responseUrl(notebookId, field.id, studentId, cacheBust);
  const [exists, setExists] = useResponseProbe(url, 0);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const qs = studentId ? `?student=${encodeURIComponent(studentId)}` : "";
      const res = await fetch(`/api/notebooks/${notebookId}/responses/${field.id}${qs}`, {
        method: "POST",
        credentials: "same-origin",
        body: form,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        let reason = "";
        try { reason = JSON.parse(body)?.error ?? ""; } catch { reason = body.slice(0, 140); }
        throw new Error(reason || `Upload failed (${res.status})`);
      }
      setExists(true);
      setCacheBust((n) => n + 1);
      onResponseUploaded?.(field.id);
    } catch (err) {
      toast.error((err as Error).message || "Couldn't upload that image");
    } finally {
      setUploading(false);
    }
  };

  const remove = async () => {
    try {
      const qs = studentId ? `?student=${encodeURIComponent(studentId)}` : "";
      const res = await fetch(`/api/notebooks/${notebookId}/responses/${field.id}${qs}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error();
      setExists(false);
      onResponseUploaded?.(field.id);
    } catch {
      toast.error("Couldn't remove that image");
    }
  };

  return (
    <div
      className="absolute overflow-hidden rounded border-2 border-pine/45 bg-white/60"
      style={style}
      title={field.label}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }}
      />

      {uploading ? (
        <div className="flex h-full w-full items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-pine" />
        </div>
      ) : exists ? (
        <div className="group relative h-full w-full">
          <img src={url} alt={field.label} className="h-full w-full object-contain" />
          {editable && (
            <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1 bg-gradient-to-t from-black/40 to-transparent p-1 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                {...tap}
                type="button"
                onClick={() => inputRef.current?.click()}
                title="Replace image"
                className="flex h-6 w-6 items-center justify-center rounded bg-white/90 text-pine hover:bg-white"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
              <button
                {...tap}
                type="button"
                onClick={() => void remove()}
                title="Remove image"
                className="flex h-6 w-6 items-center justify-center rounded bg-white/90 text-[#a3341f] hover:bg-white"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      ) : editable ? (
        <button
          {...tap}
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex h-full min-h-10 w-full flex-col items-center justify-center gap-1 border-2 border-dashed border-pine/35 bg-oat/70 text-pine/70 hover:border-pine hover:text-pine"
        >
          <ImageIcon className="h-5 w-5" />
          <span className="text-[16px] font-medium">Add image</span>
        </button>
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[16px] text-pine/55">No image</div>
      )}
    </div>
  );
}

const MAX_RECORDING_SECONDS = 180;

function ResponseAudioField({
  field, style, editable, notebookId, studentId, onResponseUploaded, typeable,
}: {
  field: FieldLike;
  style: { left: number; top: number; width: number; height: number };
  editable: boolean;
  notebookId: string;
  studentId?: string;
  onResponseUploaded?: (fieldId: string) => void;
  typeable?: boolean;
}) {
  const tap = typeable ? { "data-typeable": "1" } : {};
  const [cacheBust, setCacheBust] = useState(0);
  const url = responseUrl(notebookId, field.id, studentId, cacheBust);
  const [exists, setExists] = useResponseProbe(url, 0);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const canRecord =
    typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof window.MediaRecorder !== "undefined";

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => {
    // Never leave a microphone open when the field unmounts mid-recording.
    if (timerRef.current) clearInterval(timerRef.current);
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    stopTracks();
  }, [stopTracks]);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const qs = studentId ? `?student=${encodeURIComponent(studentId)}` : "";
      const res = await fetch(`/api/notebooks/${notebookId}/responses/${field.id}${qs}`, {
        method: "POST",
        credentials: "same-origin",
        body: form,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        let reason = "";
        try { reason = JSON.parse(body)?.error ?? ""; } catch { reason = body.slice(0, 140); }
        throw new Error(reason || `Upload failed (${res.status})`);
      }
      setExists(true);
      setCacheBust((n) => n + 1);
      onResponseUploaded?.(field.id);
    } catch (err) {
      toast.error((err as Error).message || "Couldn't upload that recording");
    } finally {
      setUploading(false);
    }
  };

  const remove = async () => {
    try {
      const qs = studentId ? `?student=${encodeURIComponent(studentId)}` : "";
      const res = await fetch(`/api/notebooks/${notebookId}/responses/${field.id}${qs}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error();
      setExists(false);
      onResponseUploaded?.(field.id);
    } catch {
      toast.error("Couldn't remove that recording");
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : undefined;
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stopTracks();
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        setRecording(false);
        // Let any final dataavailable land before assembling — browsers differ on
        // whether it arrives before or after this handler.
        setTimeout(() => {
          const type = recorder.mimeType || "audio/webm";
          const blob = new Blob(chunksRef.current, { type });
          chunksRef.current = [];
          if (blob.size === 0) {
            toast.error("That recording came back empty — try once more.");
            return;
          }
          const ext = type.includes("webm") ? "webm" : type.includes("ogg") ? "ogg" : "m4a";
          void upload(new File([blob], `recording.${ext}`, { type }));
        }, 0);
      };
      recorder.onerror = () => toast.error("Recording stopped unexpectedly.");
      recorderRef.current = recorder;
      // A timeslice makes the browser hand over chunks as it goes, so a crash or
      // an early stop still leaves usable audio.
      recorder.start(500);
      setRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => {
        setElapsed((s) => {
          const next = s + 1;
          if (next >= MAX_RECORDING_SECONDS) recorderRef.current?.stop();
          return next;
        });
      }, 1000);
    } catch {
      toast.error("Couldn't access the microphone");
      stopTracks();
    }
  };

  const stopRecording = () => {
    const rec = recorderRef.current;
    if (!rec || rec.state === "inactive") return;
    // Flush whatever is buffered before stopping.
    try { rec.requestData(); } catch { /* not all browsers implement it */ }
    rec.stop();
  };

  // A teacher can draw this field tiny, so the box floors out at a minimum
  // size rather than compressing controls down to nothing — but the floor
  // has to stay modest, or it swallows the page content around it. The
  // player needs more width than the record/attach controls do, so each
  // state gets its own (small) minimum instead of one size for all three.
  const minSize = exists ? { minWidth: 190, minHeight: 60 } : { minWidth: 96, minHeight: 44 };

  return (
    <div
      className="absolute overflow-hidden rounded border-2 border-pine/45 bg-white/60"
      style={{ ...style, ...minSize }}
      title={field.label}
    >
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        capture
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }}
      />

      {uploading ? (
        <div className="flex h-full w-full items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-pine" />
        </div>
      ) : exists ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-1.5">
          <audio {...tap} controls src={url} className="w-full shrink-0" style={{ height: 36, minHeight: 36 }} />
          {editable && (
            <div className="flex gap-3">
              <button {...tap} type="button" onClick={() => inputRef.current?.click()} className="text-[14px] font-bold text-pine hover:underline">
                Replace
              </button>
              <button {...tap} type="button" onClick={() => void remove()} className="text-[14px] font-bold text-[#a3341f] hover:underline">
                Remove
              </button>
            </div>
          )}
        </div>
      ) : editable ? (
        recording ? (
          <div className="flex h-full w-full items-center justify-center gap-2 px-2 text-pine/75">
            <button
              {...tap}
              type="button"
              onClick={stopRecording}
              title="Stop recording"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-[#a3341f] bg-white text-[#a3341f] hover:bg-[#fbe9e4]"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>
            <span className="text-[14px] font-bold tabular-nums">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</span>
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center gap-1.5 border-2 border-dashed border-pine/35 bg-oat/70 px-1.5 text-pine/70">
            {canRecord && (
              <button
                {...tap}
                type="button"
                onClick={() => void startRecording()}
                title="Record audio"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-pine bg-mint text-pine"
              >
                <Mic className="h-4 w-4" strokeWidth={2.5} />
              </button>
            )}
            <button
              {...tap}
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-pine/45 bg-white text-pine hover:border-pine"
              title="Attach an audio file"
            >
              <Music className="h-4 w-4" strokeWidth={2.5} />
            </button>
          </div>
        )
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[14px] text-pine/55">No recording</div>
      )}
    </div>
  );
}
