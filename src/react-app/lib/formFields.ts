/**
 * Finding the blanks in a worksheet.
 *
 * A teacher building an assignment from a PDF drags a box onto every blank by
 * hand, and a science lab sheet can have a dozen. They don't have to: in the
 * kind of worksheet teachers actually use — a Word document exported to PDF —
 * every blank is already *data* rather than pixels. A fill-in line is a run of
 * underscore characters sitting in the PDF's text layer with a position, a
 * width and a font size; a ruled box is a thin rectangle in its drawing
 * operations. pdf.js hands both over, so this is reading what is already
 * there, not recognising an image.
 *
 * What it deliberately does not do: guess at large rectangles. A table border,
 * a picture frame and a page border all look like "a big rectangle", and a
 * wrong guess drops an answer box over the teacher's own content — worse than
 * finding nothing, because it has to be hunted down and deleted.
 *
 * A scanned worksheet is a photograph with no text layer, so nothing is found
 * and the caller has to say so rather than look broken.
 *
 * Everything returned is in page units — the same space as `fields.x/y/w/h`
 * and `pages.width/height` — so a candidate is a field record already.
 */

import { OPS } from "pdfjs-dist";
import type { PDFPageProxy } from "pdfjs-dist";

export interface FieldCandidate {
  id: string;
  type: "text" | "checkbox";
  x: number;
  y: number;
  w: number;
  h: number;
  /** What gave it away — shown in the review overlay, and useful when tuning. */
  source: "underscores" | "rule" | "box";
}

interface Rect { x: number; y: number; w: number; h: number }

/** Shorter than this and a stray underscore in prose would count. */
const MIN_RUN = 3;
/** A rule has to be long enough to write on. Shorter marks are usually rules in a table. */
const MIN_RULE_W = 36;
/** Above this a "line" is a filled bar, a table shade, or a picture. */
const MAX_RULE_H = 2.5;
/** A tick box, in points. Smaller is a bullet; larger is a table cell. */
const MIN_BOX = 8;
const MAX_BOX = 20;
/** Room to write, whatever the type size. Matches the editor's own text default. */
const MIN_FIELD_H = 18;
/** Share of a candidate's area that may sit under an existing field before it's a duplicate. */
const MAX_OVERLAP = 0.4;
/** The editor's own tap-vs-drag floor: below this the UI wouldn't call it a field either. */
const MIN_FIELD = 8;

/** Glyphs that draw an empty tick box. Not Wingdings — there, which character is a box depends on the font. */
const BOX_GLYPHS = /[☐□▢◻◽❑]/;

/** Apply a pdf.js 6-element transform to a point. */
const apply = (m: number[] | Float32Array, x: number, y: number): [number, number] =>
  [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * Relative text widths, for splitting one text item into its parts.
 *
 * Only the *ratios* matter: whatever they come out as, they are scaled so the
 * whole run matches the width pdf.js reports for the item, which is measured
 * in the document's real font. A canvas gives good ratios for Latin text; with
 * no canvas (a test runner, say) character count is the honest fallback.
 */
function makeMeasure(size: number): (s: string) => number {
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    if (typeof document !== "undefined") {
      ctx = document.createElement("canvas").getContext("2d");
      if (ctx) ctx.font = `${size}px sans-serif`;
    }
  } catch { /* no canvas here */ }
  if (!ctx) return (s) => s.length;
  const c = ctx;
  return (s) => c.measureText(s).width;
}

/** Every run of `MIN_RUN`+ underscores in a string, as [start, end) character offsets. */
function underscoreRuns(str: string): [number, number][] {
  const out: [number, number][] = [];
  const re = new RegExp(`_{${MIN_RUN},}`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(str))) out.push([m.index, m.index + m[0].length]);
  return out;
}

/**
 * Blanks written as underscores — the case that covers most worksheets.
 *
 * The underscore glyph sits a little below the baseline, so the line a student
 * writes on is just under it. The box is placed to sit *on* that line rather
 * than floating above it or straddling it.
 */
async function fromText(page: PDFPageProxy, transform: number[] | Float32Array) {
  const found: FieldCandidate[] = [];
  const content = await page.getTextContent();

  for (const item of content.items) {
    if (!("str" in item) || !item.str) continue;
    const t = item.transform as number[];
    const size = Math.hypot(t[1], t[3]) || Math.abs(t[3]) || 12;

    if (BOX_GLYPHS.test(item.str)) {
      // The glyph's own square, near enough: a box character fills its em.
      const [gx, gy] = apply(transform, t[4], t[5]);
      const side = Math.min(MAX_BOX, Math.max(MIN_BOX, size));
      found.push({ id: uid(), type: "checkbox", source: "box", x: gx, y: gy - side, w: side, h: side });
      continue;
    }

    const runs = underscoreRuns(item.str);
    if (!runs.length) continue;

    const measure = makeMeasure(size);
    const whole = measure(item.str) || 1;
    // pdf.js measured this item in its real font; scale our ratios onto that.
    const k = (item.width || 0) / whole;

    for (const [from, to] of runs) {
      const before = k * measure(item.str.slice(0, from));
      const runW = k * measure(item.str.slice(from, to));
      if (runW < MIN_RULE_W) continue;
      const [x0, y0] = apply(transform, t[4] + before, t[5]);
      const [x1] = apply(transform, t[4] + before + runW, t[5]);
      found.push({
        id: uid(),
        type: "text",
        source: "underscores",
        x: Math.min(x0, x1),
        y: y0,
        w: Math.abs(x1 - x0),
        h: size,
      });
    }
  }
  return found;
}

/**
 * Blanks drawn rather than typed: a thin rule to write on, or a small square
 * to tick. Walks the page's drawing operations keeping a transform stack, so a
 * rule inside a translated group lands where it is actually painted.
 */
async function fromDrawing(page: PDFPageProxy, transform: number[] | Float32Array) {
  const found: FieldCandidate[] = [];
  const list = await page.getOperatorList();
  const stack: (number[] | Float32Array)[] = [];
  let ctm: number[] | Float32Array = [1, 0, 0, 1, 0, 0];
  const mul = (a: number[] | Float32Array, b: number[] | Float32Array): number[] => [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];

  /** Rectangles built by the path op immediately before a paint op. */
  let pending: Rect[] = [];

  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i];
    const args = list.argsArray[i];

    if (fn === OPS.save) { stack.push(ctm); continue; }
    if (fn === OPS.restore) { ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0]; continue; }
    if (fn === OPS.transform) { ctm = mul(ctm, args as number[]); continue; }

    if (fn === OPS.constructPath) {
      pending = [];
      const [pathOps, coords] = args as [number[], number[]];
      let c = 0;
      for (const op of pathOps) {
        if (op === OPS.rectangle) {
          pending.push({ x: coords[c], y: coords[c + 1], w: coords[c + 2], h: coords[c + 3] });
          c += 4;
        } else if (op === OPS.moveTo || op === OPS.lineTo) {
          c += 2;
        } else if (op === OPS.curveTo) {
          c += 6;
        } else if (op === OPS.curveTo2 || op === OPS.curveTo3) {
          c += 4;
        }
      }
      continue;
    }

    const paints = fn === OPS.fill || fn === OPS.eoFill || fn === OPS.stroke
      || fn === OPS.fillStroke || fn === OPS.eoFillStroke || fn === OPS.closeFillStroke;
    if (!paints || !pending.length) continue;

    for (const r of pending) {
      // Into page units: both corners through the CTM, then the viewport.
      const [ax, ay] = apply(transform, ...apply(ctm, r.x, r.y));
      const [bx, by] = apply(transform, ...apply(ctm, r.x + r.w, r.y + r.h));
      const x = Math.min(ax, bx);
      const y = Math.min(ay, by);
      const w = Math.abs(bx - ax);
      const h = Math.abs(by - ay);

      if (h <= MAX_RULE_H && w >= MIN_RULE_W) {
        // A rule: the writing goes above it.
        found.push({ id: uid(), type: "text", source: "rule", x, y, w, h });
      } else if (
        w >= MIN_BOX && w <= MAX_BOX && h >= MIN_BOX && h <= MAX_BOX && Math.abs(w - h) <= 3
      ) {
        found.push({ id: uid(), type: "checkbox", source: "box", x, y, w, h });
      }
    }
    pending = [];
  }
  return found;
}

/**
 * Blanks on a page that is only a picture.
 *
 * A scanned worksheet has no text layer and no drawing operations, so the
 * first two passes come back empty. But the blanks are still there: they are
 * long, thin, dark runs of pixels. Finding those directly is both simpler and
 * more reliable than optical character recognition, which is built to read
 * words and makes a poor job of a row of underscores.
 *
 * Only runs when the cheap passes find nothing, so a normal PDF never pays for
 * a second render.
 */
async function fromPixels(page: PDFPageProxy, vp: { width: number; height: number }) {
  const found: FieldCandidate[] = [];
  if (typeof document === "undefined") return found;

  // Enough resolution to resolve a hairline, not so much that a phone stalls.
  const scale = Math.max(0.8, Math.min(2, 1100 / vp.width));
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(vp.width * scale);
  canvas.height = Math.floor(vp.height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return found;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: page.getViewport({ scale }) }).promise;

  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const dark = (i: number) => data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114 < 140;
  const minLen = MIN_RULE_W * scale;

  // One pass down the image collecting horizontal runs of dark pixels, and
  // stacking runs that sit directly on top of each other into one line, so a
  // three-pixel-thick rule is one candidate rather than three.
  type Run = { x0: number; x1: number; top: number; bottom: number };
  let open: Run[] = [];
  const done: Run[] = [];

  for (let y = 0; y < height; y++) {
    const rowRuns: Run[] = [];
    let start = -1;
    for (let x = 0; x <= width; x++) {
      const isDark = x < width && dark((y * width + x) * 4);
      if (isDark && start < 0) start = x;
      else if (!isDark && start >= 0) {
        if (x - start >= minLen) rowRuns.push({ x0: start, x1: x, top: y, bottom: y });
        start = -1;
      }
    }
    const next: Run[] = [];
    for (const r of rowRuns) {
      // Same line as one directly above? Then it is that line, one row taller.
      const prev = open.find((o) => o.bottom === y - 1
        && Math.min(o.x1, r.x1) - Math.max(o.x0, r.x0) > 0.7 * Math.min(o.x1 - o.x0, r.x1 - r.x0));
      if (prev) { prev.bottom = y; prev.x0 = Math.min(prev.x0, r.x0); prev.x1 = Math.max(prev.x1, r.x1); next.push(prev); }
      else next.push(r);
    }
    for (const o of open) if (!next.includes(o)) done.push(o);
    open = next;
  }
  done.push(...open);

  for (const r of done) {
    const thickness = (r.bottom - r.top + 1) / scale;
    // Thicker than a rule is a filled bar, a table shade or a photograph.
    if (thickness > MAX_RULE_H + 1.5) continue;
    found.push({
      id: uid(), type: "text", source: "rule",
      x: r.x0 / scale, y: r.top / scale, w: (r.x1 - r.x0) / scale, h: thickness,
    });
  }
  return found;
}

/** Fraction of `a` that lies under `b`. */
function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  const area = a.w * a.h;
  return area > 0 ? (w * h) / area : 0;
}

/**
 * Every blank this page appears to have, minus anything already covered by a
 * field the teacher has.
 *
 * Takes a loaded page rather than a URL so the caller reuses the cached
 * document it already rendered from, and so the algorithm can be tested
 * without a browser.
 */
export async function detectFieldsOnPage(
  page: PDFPageProxy,
  existing: Rect[] = [],
): Promise<FieldCandidate[]> {
  const vp = page.getViewport({ scale: 1 });
  const transform = vp.transform as unknown as number[];

  const [text, drawn] = await Promise.all([
    fromText(page, transform).catch(() => [] as FieldCandidate[]),
    fromDrawing(page, transform).catch(() => [] as FieldCandidate[]),
  ]);

  // Nothing in the document itself: this is a photograph of a worksheet, so
  // look at the pixels instead.
  const raster = text.length || drawn.length
    ? []
    : await fromPixels(page, vp).catch(() => [] as FieldCandidate[]);

  // Underscore runs and vector rules both describe a line to write on, so give
  // them the same shape here rather than in two places: a box whose bottom
  // edge rests on the line.
  const sized = [...text, ...drawn, ...raster].map((c) => {
    if (c.type !== "text") return c;
    // Underscores sit just under their baseline; a drawn rule is the line
    // itself. Either way the box rests its bottom edge on the line, and is
    // tall enough to write in without reaching the line above.
    const lineY = c.source === "underscores" ? c.y + c.h * 0.12 : c.y + c.h;
    const size = c.source === "underscores" ? c.h : 12;
    const h = Math.max(MIN_FIELD_H, size * 1.5);
    return { ...c, y: lineY - h, h };
  });

  // Nearest-first, so a merge keeps the leftmost start.
  sized.sort((a, b) => (a.y - b.y) || (a.x - b.x));

  const out: FieldCandidate[] = [];
  for (const c of sized) {
    if (c.w < MIN_FIELD || c.h < MIN_FIELD) continue;
    if (c.x < 0 || c.y < 0 || c.x > vp.width || c.y > vp.height) continue;
    // A rule under a run of underscores is the same blank twice; so is a
    // second pass over a page whose fields are already placed.
    if (out.some((o) => overlap(c, o) > MAX_OVERLAP)) continue;
    if (existing.some((e) => overlap(c, e) > MAX_OVERLAP)) continue;
    out.push(c);
  }
  return out;
}
