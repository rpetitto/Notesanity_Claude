/**
 * The annotation layer model (Layer 3).
 *
 * Every coordinate is stored in *page units* — the same space as the PDF's own
 * width/height — never in screen pixels. A stroke drawn on a phone therefore lands
 * in exactly the right spot when the teacher opens it on a desktop at another zoom.
 *
 * The serialized shape is deliberately terse (single-letter keys, flat coordinate
 * arrays, rounded numbers) because a full page of handwriting is thousands of
 * points and this payload is autosaved repeatedly.
 */

export type ToolKind = "pen" | "highlighter" | "eraser" | "text" | "stamp" | "shape" | "comment" | "select";

/** The four shapes worth having. Anything more and the picker costs more than it saves. */
export type ShapeKind = "line" | "arrow" | "rect" | "ellipse";

export interface Stroke {
  /** 'p' pen, 'h' highlighter */
  t: "p" | "h";
  /** color */
  c: string;
  /** base width in page units */
  w: number;
  /** flat [x, y, pressure, x, y, pressure, ...] */
  p: number[];
  /** When it was drawn, epoch ms. Absent on marks made before this was recorded. */
  ts?: number;
}

export interface TextBox {
  id: string;
  x: number;
  y: number;
  w: number;
  /** font size in page units */
  s: number;
  c: string;
  v: string;
  /**
   * Rotation in degrees about the box's own centre, absent when upright.
   *
   * Strokes need no such field — a rotation is baked into their points, which
   * is exactly as faithful and costs nothing to draw. A text box and a stamp
   * are DOM elements whose glyphs cannot be rewritten that way, so for those
   * two the angle is stored and applied at paint time.
   */
  r?: number;
  /**
   * Auto width: `w` is whatever the text last measured, not a width anyone
   * chose. Set on a note placed with a tap; cleared the moment a handle
   * resizes it, which is the person choosing.
   */
  a?: 1;
  ts?: number;
}

export interface Stamp {
  id: string;
  x: number;
  y: number;
  /** size in page units */
  s: number;
  /** the emoji itself */
  e: string;
  /** Rotation in degrees about the stamp's centre, absent when upright. */
  r?: number;
  ts?: number;
}

/**
 * A pinned comment. Unlike a free text box this is anchored feedback: it renders
 * as a numbered marker that expands, so a teacher can respond to one specific
 * thing a student drew rather than leaving a single note for the whole page.
 */
export interface Comment {
  id: string;
  x: number;
  y: number;
  /** comment body */
  t: string;
  /**
   * R2 key of a spoken comment, when there is one.
   *
   * Nothing else had to change for this: comments serialize by spread, so a
   * new field round-trips on its own, and the text body stays where it is so
   * a voice note can carry a written line alongside it.
   */
  k?: string;
  /** author display name, so returned work shows who said it */
  a?: string;
  ts?: number;
}

export interface LayerData {
  v: 1;
  s: Stroke[];
  x: TextBox[];
  e: Stamp[];
  c: Comment[];
}

export const emptyLayer = (): LayerData => ({ v: 1, s: [], x: [], e: [], c: [] });

export function parseLayer(raw?: string | null): LayerData {
  if (!raw) return emptyLayer();
  try {
    const parsed = JSON.parse(raw);
    return {
      v: 1,
      s: Array.isArray(parsed.s) ? parsed.s : [],
      x: Array.isArray(parsed.x) ? parsed.x : [],
      e: Array.isArray(parsed.e) ? parsed.e : [],
      // `c` arrived after the first release; older payloads simply lack it.
      c: Array.isArray(parsed.c) ? parsed.c : [],
    };
  } catch {
    return emptyLayer();
  }
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** One stroke, rounded the same way `serializeLayer` rounds it. */
const packStroke = (st: Stroke) => ({
  t: st.t,
  c: st.c,
  w: r1(st.w),
  p: st.p.map((n, i) => (i % 3 === 2 ? r2(n) : r1(n))),
  ...(st.ts ? { ts: st.ts } : {}),
});

/**
 * The tail of a layer: strokes added since `from`, with the small collections
 * whole.
 *
 * Drawing appends to `s` and touches nothing else, so this is what almost every
 * autosave actually contains. Text, stamps and comments are sent in full
 * because they are a handful of short records — the weight of a page is its
 * stroke points.
 */
export function serializeDelta(layer: LayerData, from: number) {
  return {
    s: layer.s.slice(from).map(packStroke),
    x: layer.x.map((t) => ({ ...t, x: r1(t.x), y: r1(t.y), w: r1(t.w), s: r1(t.s), ...(t.r ? { r: r1(t.r) } : {}) })),
    e: layer.e.map((s) => ({ ...s, x: r1(s.x), y: r1(s.y), s: r1(s.s), ...(s.r ? { r: r1(s.r) } : {}) })),
    c: layer.c.map((k) => ({ ...k, x: r1(k.x), y: r1(k.y) })),
  };
}

export function serializeLayer(layer: LayerData): string {
  return JSON.stringify({
    v: 1,
    s: layer.s.map((st) => ({
      t: st.t,
      c: st.c,
      w: r1(st.w),
      p: st.p.map((n, i) => (i % 3 === 2 ? r2(n) : r1(n))),
      // Rebuilt field by field rather than spread, so anything new has to be
      // named here or it is silently dropped on the next save.
      ...(st.ts ? { ts: st.ts } : {}),
    })),
    x: layer.x.map((t) => ({ ...t, x: r1(t.x), y: r1(t.y), w: r1(t.w), s: r1(t.s), ...(t.r ? { r: r1(t.r) } : {}) })),
    e: layer.e.map((s) => ({ ...s, x: r1(s.x), y: r1(s.y), s: r1(s.s), ...(s.r ? { r: r1(s.r) } : {}) })),
    c: layer.c.map((k) => ({ ...k, x: r1(k.x), y: r1(k.y) })),
  });
}

export const isEmptyLayer = (l: LayerData) =>
  l.s.length === 0 && l.x.length === 0 && l.e.length === 0 && l.c.length === 0;

/**
 * A drawn shape, as an ordinary stroke.
 *
 * Deliberately not a new kind of mark. A rectangle is a five-point path and an
 * ellipse is a sampled one, so every piece of machinery that already exists —
 * painting, the eraser, hit testing, the selection box, move, resize and
 * rotate, the PDF export — works on a shape the day it is added, with nothing
 * taught about it. The cost is that a resized ellipse is resampled points
 * rather than a perfect curve, which at these sizes nobody can see.
 */
export function shapePoints(kind: ShapeKind, x0: number, y0: number, x1: number, y1: number): number[] {
  // Shapes are drawn, not pressed, so every point carries the same nib weight.
  const P = 0.6;

  /**
   * Corners have to be sampled, not just stated.
   *
   * `drawStroke` smooths a path with no pressure variation, which is right for
   * a finger-drawn line and wrong for a rectangle: four corners become one
   * rounded blob. Points every few units give the smoothing nothing to round,
   * so the edges stay straight and the corners stay sharp.
   */
  const edge = (out: number[], ax: number, ay: number, bx: number, by: number, step: number) => {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let i = 1; i <= n; i++) out.push(ax + (bx - ax) * (i / n), ay + (by - ay) * (i / n), P);
  };

  const w = Math.abs(x1 - x0);
  const h = Math.abs(y1 - y0);

  if (kind === "line") {
    const out = [x0, y0, P];
    edge(out, x0, y0, x1, y1, Math.max(4, Math.hypot(w, h) / 40));
    return out;
  }

  if (kind === "arrow") {
    const angle = Math.atan2(y1 - y0, x1 - x0);
    const len = Math.hypot(w, h);
    // The head grows with the shaft but stops, so a long arrow isn't all head.
    const head = Math.max(6, Math.min(18, len * 0.22));
    const spread = 0.42;
    const ax = x1 - head * Math.cos(angle - spread);
    const ay = y1 - head * Math.sin(angle - spread);
    const bx = x1 - head * Math.cos(angle + spread);
    const by = y1 - head * Math.sin(angle + spread);
    const step = Math.max(3, len / 40);
    const out = [x0, y0, P];
    edge(out, x0, y0, x1, y1, step);
    edge(out, x1, y1, ax, ay, 3);
    edge(out, ax, ay, x1, y1, 3);
    edge(out, x1, y1, bx, by, 3);
    return out;
  }

  if (kind === "rect") {
    const left = Math.min(x0, x1);
    const right = Math.max(x0, x1);
    const top = Math.min(y0, y1);
    const bottom = Math.max(y0, y1);
    // Around 120 points all told, however big the box, so a full-page
    // rectangle doesn't cost ten times the payload of a small one.
    const step = Math.max(3, ((w + h) * 2) / 120);
    const out = [left, top, P];
    edge(out, left, top, right, top, step);
    edge(out, right, top, right, bottom, step);
    edge(out, right, bottom, left, bottom, step);
    edge(out, left, bottom, left, top, step);
    return out;
  }

  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = w / 2;
  const ry = h / 2;
  const out: number[] = [];
  const steps = 48;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    out.push(cx + rx * Math.cos(t), cy + ry * Math.sin(t), P);
  }
  return out;
}

/** Squared distance from point to segment — used by the eraser's hit test. */
function distToSegmentSq(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return (px - cx) ** 2 + (py - cy) ** 2;
}

/** Index of the topmost stroke within `radius` of (x, y), or -1. */
export function hitStroke(strokes: Stroke[], x: number, y: number, radius: number): number {
  const rSq = radius * radius;
  for (let i = strokes.length - 1; i >= 0; i--) {
    const p = strokes[i].p;
    const tolerance = rSq + (strokes[i].w / 2) ** 2;
    if (p.length === 3) {
      if ((p[0] - x) ** 2 + (p[1] - y) ** 2 <= tolerance) return i;
      continue;
    }
    for (let j = 0; j + 5 < p.length; j += 3) {
      if (distToSegmentSq(x, y, p[j], p[j + 1], p[j + 3], p[j + 4]) <= tolerance) return i;
    }
  }
  return -1;
}

/**
 * Straighten a highlighter stroke that was aimed along a line of text.
 *
 * A hand dragged across a line wanders a little vertically but travels a long
 * way horizontally. When a stroke fits that shape we replace it with a level
 * bar at the average height — what a highlighter run against a ruler would
 * give. Anything else is left exactly as drawn: a short dab, a circled
 * diagram, a deliberate diagonal or a wavy underline all fail one of the
 * tests below, which is also the escape hatch for anyone who wants the raw
 * gesture kept.
 *
 * Returns the input array untouched when no snapping applies, so callers can
 * use the result unconditionally.
 */
export function straightenHighlight(p: number[], nibWidth: number): number[] {
  if (p.length < 12) return p; // fewer than four samples — nothing to judge

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, sumY = 0, n = 0;
  for (let i = 0; i + 2 < p.length; i += 3) {
    const x = p[i];
    const y = p[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    sumY += y;
    n++;
  }

  const span = maxX - minX;
  const drift = maxY - minY;
  // Long enough to be highlighting something, level enough to have been aimed
  // along a line, and far wider than it is tall so shapes are never caught.
  const tolerance = Math.max(nibWidth * 0.8, span * 0.06);
  if (span < 24 || drift > tolerance || span < drift * 5) return p;

  // Keep the direction of travel so erasing and hit-testing behave the same.
  const rightwards = p[0] <= p[p.length - 3];
  const y = sumY / n;
  return rightwards ? [minX, y, 0.5, maxX, y, 0.5] : [maxX, y, 0.5, minX, y, 0.5];
}

/**
 * Paint one stroke.
 *
 * Pen strokes taper with stylus pressure, which means drawing segment-by-segment
 * so each can carry its own width. Highlighters and pressure-less input draw as a
 * single smoothed path, which is both faster and visually cleaner.
 */
export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  scale: number,
  /**
   * Floor for the rendered width, in device pixels. Zero everywhere the ink is
   * shown at reading size; a thumbnail passes ~1, because scaling a 3pt nib
   * down to a 52px preview gives a quarter of a pixel and draws nothing.
   */
  minWidth = 0,
) {
  const p = stroke.p;
  if (p.length < 3) return;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = stroke.c;

  if (stroke.t === "h") {
    ctx.globalAlpha = 0.32;
    // Highlighter sits *under* the base text visually; multiply keeps print legible.
    ctx.globalCompositeOperation = "multiply";
  }

  const width = Math.max(stroke.w * scale, minWidth);

  // A single point renders as a dot.
  if (p.length === 3) {
    ctx.fillStyle = stroke.c;
    ctx.beginPath();
    ctx.arc(p[0] * scale, p[1] * scale, width / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  const varies = stroke.t === "p" && hasPressureVariation(p);

  if (!varies) {
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(p[0] * scale, p[1] * scale);
    for (let i = 0; i + 5 < p.length; i += 3) {
      const cx = p[i + 3] * scale;
      const cy = p[i + 4] * scale;
      const mx = (p[i] * scale + cx) / 2;
      const my = (p[i + 1] * scale + cy) / 2;
      ctx.quadraticCurveTo(p[i] * scale, p[i + 1] * scale, mx, my);
    }
    ctx.lineTo(p[p.length - 3] * scale, p[p.length - 2] * scale);
    ctx.stroke();
    ctx.restore();
    return;
  }

  for (let i = 0; i + 5 < p.length; i += 3) {
    const pressure = (p[i + 2] + p[i + 5]) / 2;
    ctx.lineWidth = Math.max(0.4, minWidth, width * (0.35 + 0.65 * pressure));
    ctx.beginPath();
    ctx.moveTo(p[i] * scale, p[i + 1] * scale);
    ctx.lineTo(p[i + 3] * scale, p[i + 4] * scale);
    ctx.stroke();
  }
  ctx.restore();
}

function hasPressureVariation(p: number[]): boolean {
  let min = 1;
  let max = 0;
  for (let i = 2; i < p.length; i += 3) {
    if (p[i] < min) min = p[i];
    if (p[i] > max) max = p[i];
  }
  return max - min > 0.05;
}

/** Repaint an entire layer. Highlighters first so pen ink stays on top. */
export function drawLayer(ctx: CanvasRenderingContext2D, layer: LayerData, scale: number, minWidth = 0) {
  for (const s of layer.s) if (s.t === "h") drawStroke(ctx, s, scale, minWidth);
  for (const s of layer.s) if (s.t !== "h") drawStroke(ctx, s, scale, minWidth);
}

/**
 * Paint a layer into a thumbnail.
 *
 * Deliberately not the same as `drawLayer`. A preview is answering "is there
 * anything on this page?", and at a fiftieth of full size faithful rendering
 * answers it with an invisible hairline — so strokes get a width floor and
 * come out heavier than they really are. Stamps are drawn here as well, which
 * `drawLayer` never does: on the live page they are DOM elements sitting over
 * the canvas, and a thumbnail has no DOM to put them in.
 *
 * Text boxes and comment pins are left out. Both are UI as much as content —
 * a bordered box, a numbered marker — and at this size they'd read as specks
 * rather than as writing.
 */
export function drawLayerThumb(ctx: CanvasRenderingContext2D, layer: LayerData, scale: number, minWidth = 1) {
  drawLayer(ctx, layer, scale, minWidth);

  if (!layer.e.length) return;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const stamp of layer.e) {
    // Matches how the live page places them: centred on the point, sized in
    // page units (see the stamp layer in PageCanvas).
    ctx.font = `${Math.max(6, stamp.s * scale)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.fillText(stamp.e, stamp.x * scale, stamp.y * scale);
  }
  ctx.restore();
}

// Ink has to stay legible over a printed page, so these are saturated enough to
// read as handwriting while staying in the brand's muted register.
export const PEN_COLORS = ["#20302C", "#2E7D6B", "#3F6C9E", "#A3341F", "#7A5C8E", "#D9A441"];
// Marking convention puts a warm red first.
export const TEACHER_COLORS = ["#A3341F", "#7A5C8E", "#2E7D6B", "#3F6C9E"];
// Highlighters sit under the text, so they stay pale.
export const HIGHLIGHTER_COLORS = ["#7FD1AE", "#F2D98D", "#9EC5E8", "#E5B3C6"];
export const STAMPS = ["✅", "⭐", "👍", "❤️", "🎯", "🔥", "💡", "❓", "❌", "🤔", "👏", "📌"];

/** What a mark is, for the history tooltip. */
export interface MarkHit {
  kind: "stroke" | "highlight" | "text" | "stamp" | "comment";
  ts?: number;
  detail?: string;
}

/**
 * Topmost mark at a point, for hovering rather than erasing.
 *
 * Searches back to front so the answer matches what the eye sees on top, and
 * covers every kind of mark — a teacher pointing at a stamp or a typed note
 * wants its history as much as they want a pen stroke's.
 */
export function markAt(layer: LayerData, x: number, y: number, radius: number): MarkHit | null {
  for (let i = layer.c.length - 1; i >= 0; i--) {
    const k = layer.c[i];
    if ((k.x - x) ** 2 + (k.y - y) ** 2 <= (radius + 8) ** 2) {
      return { kind: "comment", ts: k.ts, detail: k.t };
    }
  }
  for (let i = layer.e.length - 1; i >= 0; i--) {
    const st = layer.e[i];
    if (Math.abs(st.x - x) <= st.s / 2 && Math.abs(st.y - y) <= st.s / 2) {
      return { kind: "stamp", ts: st.ts, detail: st.e };
    }
  }
  for (let i = layer.x.length - 1; i >= 0; i--) {
    const t = layer.x[i];
    const lines = (t.v.match(/\n/g)?.length ?? 0) + 1;
    const height = Math.max(t.s * 1.5, lines * t.s * 1.3);
    if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + height) {
      return { kind: "text", ts: t.ts, detail: t.v };
    }
  }
  const si = hitStroke(layer.s, x, y, radius);
  if (si >= 0) {
    const st = layer.s[si];
    return { kind: st.t === "h" ? "highlight" : "stroke", ts: st.ts };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Selecting and reshaping one mark
// ---------------------------------------------------------------------------

/** Which mark a selection or a drag is holding. Strokes have no id, so they go by index. */
export type MarkRef =
  | { kind: "stroke"; index: number }
  | { kind: "text"; id: string }
  | { kind: "stamp"; id: string };

/**
 * A mark's box in page units: the upright rectangle plus the angle it is turned
 * through, about its own centre. Everything the selection UI draws and every
 * drag it interprets is expressed in these terms.
 */
export interface MarkBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** degrees */
  rot: number;
}

/** How tall a text box renders, given how many lines it holds. */
export const textHeight = (t: TextBox) =>
  Math.max(t.s * 1.5, ((t.v.match(/\n/g)?.length ?? 0) + 1) * t.s * 1.3);

function strokeBox(st: Stroke): MarkBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i + 2 < st.p.length; i += 3) {
    if (st.p[i] < minX) minX = st.p[i];
    if (st.p[i] > maxX) maxX = st.p[i];
    if (st.p[i + 1] < minY) minY = st.p[i + 1];
    if (st.p[i + 1] > maxY) maxY = st.p[i + 1];
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0, rot: 0 };
  // The nib has width, so the ink reaches half of it past the centre line on
  // every side. A box drawn on the centre line clips the stroke it is holding.
  const pad = st.w / 2;
  return { x: minX - pad, y: minY - pad, w: maxX - minX + st.w, h: maxY - minY + st.w, rot: 0 };
}

/** The box around one mark, or null if the ref points at nothing. */
export function markBox(layer: LayerData, ref: MarkRef): MarkBox | null {
  if (ref.kind === "stroke") {
    const st = layer.s[ref.index];
    return st ? strokeBox(st) : null;
  }
  if (ref.kind === "text") {
    const t = layer.x.find((b) => b.id === ref.id);
    return t ? { x: t.x, y: t.y, w: t.w, h: textHeight(t), rot: t.r ?? 0 } : null;
  }
  const st = layer.e.find((b) => b.id === ref.id);
  // Stamps are drawn centred on their point, so the box is built outwards.
  return st ? { x: st.x - st.s / 2, y: st.y - st.s / 2, w: st.s, h: st.s, rot: st.r ?? 0 } : null;
}

/** Rotate (x, y) about (cx, cy). `cos`/`sin` are passed in so a loop computes them once. */
const spin = (x: number, y: number, cx: number, cy: number, cos: number, sin: number) => ({
  x: cx + (x - cx) * cos - (y - cy) * sin,
  y: cy + (x - cx) * sin + (y - cy) * cos,
});

/**
 * The topmost mark under a point that can be picked up, or null.
 *
 * Distinct from `markAt`, which answers "what is this?" for the history
 * tooltip: this one answers "which one do I now hold?", so it returns a
 * reference rather than a description and it ignores comment pins, which are
 * their own openable objects rather than something to drag a handle on.
 */
export function markRefAt(layer: LayerData, x: number, y: number, radius: number): MarkRef | null {
  for (let i = layer.e.length - 1; i >= 0; i--) {
    const st = layer.e[i];
    // Un-turn the point rather than the stamp: a rotated box is a plain box
    // seen from an angle.
    const a = (-(st.r ?? 0) * Math.PI) / 180;
    const p = spin(x, y, st.x, st.y, Math.cos(a), Math.sin(a));
    if (Math.abs(st.x - p.x) <= st.s / 2 && Math.abs(st.y - p.y) <= st.s / 2) return { kind: "stamp", id: st.id };
  }
  for (let i = layer.x.length - 1; i >= 0; i--) {
    const t = layer.x[i];
    const h = textHeight(t);
    const a = (-(t.r ?? 0) * Math.PI) / 180;
    const p = spin(x, y, t.x + t.w / 2, t.y + h / 2, Math.cos(a), Math.sin(a));
    if (p.x >= t.x && p.x <= t.x + t.w && p.y >= t.y && p.y <= t.y + h) return { kind: "text", id: t.id };
  }
  const si = hitStroke(layer.s, x, y, radius);
  return si >= 0 ? { kind: "stroke", index: si } : null;
}

/**
 * One reshaping of one mark.
 *
 * `scale` carries the box's own angle so the stretch happens along the box's
 * axes rather than the page's — dragging the side handle of a mark turned 30°
 * must widen it along its own width, not the page's.
 */
export type MarkOp =
  | { kind: "move"; dx: number; dy: number }
  | { kind: "scale"; ax: number; ay: number; fx: number; fy: number; rot: number }
  | { kind: "rotate"; cx: number; cy: number; deg: number };

/**
 * Apply an operation to one mark, leaving the rest of the layer alone.
 *
 * Returns a new layer, so the same call serves both the live preview during a
 * drag and the single committed change at the end of one.
 */
export function transformMark(layer: LayerData, ref: MarkRef, op: MarkOp): LayerData {
  // A point mover in page units, plus the factor a length grows by, are all
  // any of the three marks needs — the rest is bookkeeping per mark kind.
  let movePoint: (x: number, y: number) => { x: number; y: number };
  let growX = 1;
  let growY = 1;
  let turn = 0;

  if (op.kind === "move") {
    movePoint = (x, y) => ({ x: x + op.dx, y: y + op.dy });
  } else if (op.kind === "rotate") {
    const a = (op.deg * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    movePoint = (x, y) => spin(x, y, op.cx, op.cy, cos, sin);
    turn = op.deg;
  } else {
    const a = (op.rot * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    growX = op.fx;
    growY = op.fy;
    // Into the box's own frame, stretch, and back out again.
    movePoint = (x, y) => {
      const local = spin(x, y, op.ax, op.ay, cos, -sin);
      return spin(op.ax + (local.x - op.ax) * op.fx, op.ay + (local.y - op.ay) * op.fy, op.ax, op.ay, cos, sin);
    };
  }

  if (ref.kind === "stroke") {
    const grow = (Math.abs(growX) + Math.abs(growY)) / 2;
    return {
      ...layer,
      s: layer.s.map((st, i) => {
        if (i !== ref.index) return st;
        const p = st.p.slice();
        // A flat [x, y, pressure, ...] run: move the first two of every triple
        // and leave pressure be.
        for (let j = 0; j + 2 < p.length; j += 3) {
          const moved = movePoint(p[j], p[j + 1]);
          p[j] = moved.x;
          p[j + 1] = moved.y;
        }
        return { ...st, p, w: grow === 1 ? st.w : Math.max(0.3, st.w * grow) };
      }),
    };
  }

  if (ref.kind === "text") {
    return {
      ...layer,
      x: layer.x.map((t) => {
        if (t.id !== ref.id) return t;
        const h = textHeight(t);
        const c = movePoint(t.x + t.w / 2, t.y + h / 2);
        const w = Math.max(24, t.w * Math.abs(growX));
        // The font follows the box's height; widening alone just rewraps.
        const size = Math.max(6, t.s * Math.abs(growY));
        // A resize is the person picking a width, so the note stops sizing itself.
        const grown = { ...t, w, s: size, r: (t.r ?? 0) + turn, ...(op.kind === "scale" ? { a: undefined } : {}) };
        const gh = textHeight(grown);
        return { ...grown, x: c.x - w / 2, y: c.y - gh / 2, ...((grown.r % 360) === 0 ? { r: undefined } : {}) };
      }),
    };
  }

  return {
    ...layer,
    e: layer.e.map((st) => {
      if (st.id !== ref.id) return st;
      const c = movePoint(st.x, st.y);
      // A stamp is one glyph and stays square, so it takes a single factor.
      const grow = (Math.abs(growX) + Math.abs(growY)) / 2;
      const r = (st.r ?? 0) + turn;
      return { ...st, x: c.x, y: c.y, s: Math.max(6, st.s * grow), r: r % 360 === 0 ? undefined : r };
    }),
  };
}

// ---------------------------------------------------------------------------
// Acting on one mark — what the context menu and the keyboard do to a selection

/** What one mark is, for naming it in a menu. */
export function markInfo(layer: LayerData, ref: MarkRef): { kind: MarkHit["kind"]; color?: string; ts?: number } | null {
  if (ref.kind === "stroke") {
    const st = layer.s[ref.index];
    return st ? { kind: st.t === "h" ? "highlight" : "stroke", color: st.c, ts: st.ts } : null;
  }
  if (ref.kind === "text") {
    const t = layer.x.find((b) => b.id === ref.id);
    return t ? { kind: "text", color: t.c, ts: t.ts } : null;
  }
  const st = layer.e.find((b) => b.id === ref.id);
  return st ? { kind: "stamp", ts: st.ts } : null;
}

export function removeMark(layer: LayerData, ref: MarkRef): LayerData {
  if (ref.kind === "stroke") return { ...layer, s: layer.s.filter((_, i) => i !== ref.index) };
  if (ref.kind === "text") return { ...layer, x: layer.x.filter((t) => t.id !== ref.id) };
  return { ...layer, e: layer.e.filter((st) => st.id !== ref.id) };
}

/**
 * A copy of one mark, nudged down and right so it is visibly a second one.
 * It gets a fresh id and a fresh time: the copy was made now, and the
 * history should say so.
 */
export function duplicateMark(layer: LayerData, ref: MarkRef, offset = 12): { layer: LayerData; ref: MarkRef } | null {
  const ts = Date.now();
  const id = crypto.randomUUID();
  if (ref.kind === "stroke") {
    const st = layer.s[ref.index];
    if (!st) return null;
    const p = st.p.slice();
    for (let j = 0; j + 2 < p.length; j += 3) { p[j] += offset; p[j + 1] += offset; }
    return { layer: { ...layer, s: [...layer.s, { ...st, p, ts }] }, ref: { kind: "stroke", index: layer.s.length } };
  }
  if (ref.kind === "text") {
    const t = layer.x.find((b) => b.id === ref.id);
    if (!t) return null;
    return { layer: { ...layer, x: [...layer.x, { ...t, id, x: t.x + offset, y: t.y + offset, ts }] }, ref: { kind: "text", id } };
  }
  const st = layer.e.find((b) => b.id === ref.id);
  if (!st) return null;
  return { layer: { ...layer, e: [...layer.e, { ...st, id, x: st.x + offset, y: st.y + offset, ts }] }, ref: { kind: "stamp", id } };
}

export function recolorMark(layer: LayerData, ref: MarkRef, color: string): LayerData {
  if (ref.kind === "stroke") return { ...layer, s: layer.s.map((st, i) => (i === ref.index ? { ...st, c: color } : st)) };
  if (ref.kind === "text") return { ...layer, x: layer.x.map((t) => (t.id === ref.id ? { ...t, c: color } : t)) };
  return layer;
}

/** Grow or shrink one mark about its own centre — the size stepper. */
export function resizeMark(layer: LayerData, ref: MarkRef, factor: number): LayerData {
  const box = markBox(layer, ref);
  if (!box) return layer;
  return transformMark(layer, ref, {
    kind: "scale", ax: box.x + box.w / 2, ay: box.y + box.h / 2, fx: factor, fy: factor, rot: box.rot,
  });
}
