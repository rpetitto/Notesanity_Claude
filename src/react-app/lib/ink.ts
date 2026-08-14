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

export type ToolKind = "pen" | "highlighter" | "eraser" | "text" | "stamp" | "comment" | "select";

export interface Stroke {
  /** 'p' pen, 'h' highlighter */
  t: "p" | "h";
  /** colour */
  c: string;
  /** base width in page units */
  w: number;
  /** flat [x, y, pressure, x, y, pressure, ...] */
  p: number[];
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
}

export interface Stamp {
  id: string;
  x: number;
  y: number;
  /** size in page units */
  s: number;
  /** the emoji itself */
  e: string;
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
  /** author display name, so returned work shows who said it */
  a?: string;
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

export function serializeLayer(layer: LayerData): string {
  return JSON.stringify({
    v: 1,
    s: layer.s.map((st) => ({
      t: st.t,
      c: st.c,
      w: r1(st.w),
      p: st.p.map((n, i) => (i % 3 === 2 ? r2(n) : r1(n))),
    })),
    x: layer.x.map((t) => ({ ...t, x: r1(t.x), y: r1(t.y), w: r1(t.w), s: r1(t.s) })),
    e: layer.e.map((s) => ({ ...s, x: r1(s.x), y: r1(s.y), s: r1(s.s) })),
    c: layer.c.map((k) => ({ ...k, x: r1(k.x), y: r1(k.y) })),
  });
}

export const isEmptyLayer = (l: LayerData) =>
  l.s.length === 0 && l.x.length === 0 && l.e.length === 0 && l.c.length === 0;

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
export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, scale: number) {
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

  const width = stroke.w * scale;

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
    ctx.lineWidth = Math.max(0.4, width * (0.35 + 0.65 * pressure));
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
export function drawLayer(ctx: CanvasRenderingContext2D, layer: LayerData, scale: number) {
  for (const s of layer.s) if (s.t === "h") drawStroke(ctx, s, scale);
  for (const s of layer.s) if (s.t !== "h") drawStroke(ctx, s, scale);
}

// Ink has to stay legible over a printed page, so these are saturated enough to
// read as handwriting while staying in the brand's muted register.
export const PEN_COLORS = ["#20302C", "#2E7D6B", "#3F6C9E", "#A3341F", "#7A5C8E", "#D9A441"];
// Marking convention puts a warm red first.
export const TEACHER_COLORS = ["#A3341F", "#7A5C8E", "#2E7D6B", "#3F6C9E"];
// Highlighters sit under the text, so they stay pale.
export const HIGHLIGHTER_COLORS = ["#7FD1AE", "#F2D98D", "#9EC5E8", "#E5B3C6"];
export const STAMPS = ["✅", "⭐", "👍", "❤️", "🎯", "🔥", "💡", "❓", "❌", "🤔", "👏", "📌"];
