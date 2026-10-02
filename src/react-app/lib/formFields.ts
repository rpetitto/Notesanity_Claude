/**
 * Finding the blanks in a worksheet.
 *
 * A teacher building an assignment from a PDF drags a box onto every blank by
 * hand, and a science lab sheet can have a dozen. They don't have to: in the
 * kind of worksheet teachers actually use — a Word document or a slide
 * exported to PDF — every blank is already *data* rather than pixels. A
 * fill-in line is a run of underscore characters sitting in the PDF's text
 * layer with a position, a width and a font size; a ruled line or a table is
 * a set of stroked line segments in its drawing operations. pdf.js hands both
 * over, so this is reading what is already there, not recognising an image.
 *
 * Tables are the case that needs care. A row's bottom border is one long line,
 * but the blanks are the cells: the line has to be cut at every vertical that
 * rises from it, and each piece is only a blank if the cell above it is empty
 * — the header row and a column of timestamps are cells too, and they already
 * have something in them. Frames that run edge to edge are the page's own
 * layout, not somewhere to write, and are left alone whatever they contain.
 *
 * A scanned worksheet is a photograph with no text layer, so the same lines
 * are found in its pixels instead, and "empty" is judged by ink rather than
 * text. That pass only runs when the document itself yields nothing, so a
 * normal PDF never pays for a second render.
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
  source: "underscores" | "rule" | "cell" | "box";
}

interface Rect { x: number; y: number; w: number; h: number }
/** A horizontal rule in page units. */
interface HRule { x0: number; x1: number; y: number }
/** A vertical rule in page units. */
interface VRule { x: number; y0: number; y1: number }

/** Shorter than this and a stray underscore in prose would count. */
const MIN_RUN = 3;
/** A free-standing rule has to be long enough to write on. */
const MIN_RULE_W = 36;
/** A table cell can be narrower — a column for a tick or a number. */
const MIN_CELL_W = 22;
/** Above this a "line" is a filled bar, a table shade, or a picture. */
const MAX_RULE_H = 2.5;
/** A tick box, in points. Smaller is a bullet; larger is a table cell. */
const MIN_BOX = 8;
const MAX_BOX = 20;
/** Room to write, whatever the type size. Matches the editor's own text default. */
const MIN_FIELD_H = 18;
/** Taller than an inch and a "cell" is a section of the page, not a blank in it. */
const MAX_CELL_H = 72;
/** A rule this close to the page's full width is a frame, not a line to write on. */
const FRAME_SHARE = 0.9;
/** Share of a candidate's area that may sit under an existing field before it's a duplicate. */
const MAX_OVERLAP = 0.4;
/** The editor's own tap-vs-drag floor: below this the UI wouldn't call it a field either. */
const MIN_FIELD = 8;
/** How far apart two coordinates can be and still be the same line. */
const TOL = 1.5;

/** Glyphs that draw an empty tick box. Not Wingdings — there, which character is a box depends on the font. */
const BOX_GLYPHS = /[☐□▢◻◽❑]/;

type Matrix = number[] | Float32Array;

/** Apply a pdf.js 6-element transform to a point. */
const apply = (m: Matrix, x: number, y: number): [number, number] =>
  [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

const mul = (a: Matrix, b: Matrix): number[] => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];

const uid = () => Math.random().toString(36).slice(2, 10);

/** Fraction of `a` that lies under `b`. */
function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  const area = a.w * a.h;
  return area > 0 ? (w * h) / area : 0;
}

/* ---------------------------------------------------------------- text */

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

interface TextPass {
  found: FieldCandidate[];
  /** Where every piece of visible text sits, so a box isn't dropped over it. */
  text: Rect[];
}

/**
 * Blanks written as underscores — the case that covers most worksheets — and,
 * as a by-product, the position of every word on the page.
 *
 * The underscore glyph sits a little below the baseline, so the line a student
 * writes on is just under it. The box is placed to sit *on* that line rather
 * than floating above it or straddling it.
 */
async function fromText(page: PDFPageProxy, transform: Matrix): Promise<TextPass> {
  const found: FieldCandidate[] = [];
  const text: Rect[] = [];
  const content = await page.getTextContent();

  for (const item of content.items) {
    if (!("str" in item) || !item.str) continue;
    const t = item.transform as number[];
    const size = Math.hypot(t[1], t[3]) || Math.abs(t[3]) || 12;

    if (item.str.trim() && !/^_+$/.test(item.str.trim())) {
      // The glyphs hang from the baseline: most of the em above it, a little below.
      const [bx, by] = apply(transform, t[4], t[5]);
      const h = item.height || size;
      text.push({ x: bx, y: by - h * 0.8, w: item.width || 0, h });
    }

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
      // The glyph hangs just under its baseline; the box rests its bottom
      // edge on that line and is tall enough to write in without reaching
      // the line of text above.
      const lineY = y0 + size * 0.12;
      const h = Math.max(MIN_FIELD_H, size * 1.5);
      found.push({
        id: uid(), type: "text", source: "underscores",
        x: Math.min(x0, x1), y: lineY - h, w: Math.abs(x1 - x0), h,
      });
    }
  }
  return { found, text };
}

/* -------------------------------------------------------------- rules */

/**
 * The blanks a set of rules describes.
 *
 * Every horizontal rule is a candidate line to write on. Where verticals rise
 * from it, it is the bottom of a row of cells, and each cell is its own blank
 * — bounded left and right by those verticals and above by the nearest rule
 * that spans it. Where verticals only drop from it, it is the *top* of a row
 * and nothing is written on it at all.
 *
 * `occupied` says whether a box already has something in it — text, a
 * picture, ink — which is what separates the header row from the empty one
 * beneath it. The rules themselves can't tell.
 */
function cellsFromRules(
  hs: HRule[],
  vs: VRule[],
  pageWidth: number,
  occupied: (r: Rect) => boolean,
): FieldCandidate[] {
  const found: FieldCandidate[] = [];
  const sorted = [...hs].sort((a, b) => a.y - b.y);

  for (const h of sorted) {
    const width = h.x1 - h.x0;
    if (width < MIN_CELL_W) continue;

    // Verticals touching this rule, split by which way they go from it.
    const touching = vs.filter((v) =>
      v.x >= h.x0 - TOL && v.x <= h.x1 + TOL && v.y0 <= h.y + TOL && v.y1 >= h.y - TOL);
    const rising = touching.filter((v) => v.y0 < h.y - MIN_FIELD).sort((a, b) => a.x - b.x);
    const dropping = touching.some((v) => v.y1 > h.y + MIN_FIELD);

    if (!rising.length) {
      // A plain line to write on — unless it is the top edge of a table, or
      // the page's own frame.
      if (dropping || width < MIN_RULE_W || width >= FRAME_SHARE * pageWidth) continue;
      const box = { x: h.x0, y: h.y - MIN_FIELD_H, w: width, h: MIN_FIELD_H };
      if (!occupied(box)) found.push({ id: uid(), type: "text", source: "rule", ...box });
      continue;
    }

    // Cut the rule at every vertical rising from it; the pieces are cells.
    const cuts = [h.x0, ...rising.map((v) => v.x).filter((x) => x > h.x0 + TOL && x < h.x1 - TOL), h.x1];
    const row: { box: Rect; source: FieldCandidate["source"]; full: boolean }[] = [];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const a = cuts[i];
      const b = cuts[i + 1];
      const w = b - a;
      if (w < MIN_CELL_W || w >= FRAME_SHARE * pageWidth) continue;

      // The cell's top: the nearest rule above that spans it, or failing that
      // where its walls stop. Without either, this is a rule with verticals
      // beside it, not a cell, and gets a plain line's box.
      const wallA = rising.find((v) => Math.abs(v.x - a) <= TOL);
      const wallB = rising.find((v) => Math.abs(v.x - b) <= TOL);
      const lid = sorted
        .filter((o) => o.y < h.y - MIN_FIELD && o.x0 <= a + TOL && o.x1 >= b - TOL)
        .sort((p, q) => q.y - p.y)[0];
      let top = lid ? lid.y : -Infinity;
      if (wallA && wallB) top = Math.max(top, wallA.y0, wallB.y0);
      const cellH = h.y - top;

      const box = cellH >= MIN_FIELD_H && cellH <= MAX_CELL_H
        ? { x: a + 1, y: top + 1, w: w - 2, h: cellH - 2 }
        : w >= MIN_RULE_W && !lid
          ? { x: a + 1, y: h.y - MIN_FIELD_H, w: w - 2, h: MIN_FIELD_H }
          : null;
      if (!box) continue;
      row.push({ box, source: lid || (wallA && wallB) ? "cell" : "rule", full: occupied(box) });
    }

    // A row with more full cells than empty ones is a row of labels — the
    // header, or "Name / Date / Period" — and its one empty cell is the
    // corner nobody writes in, not a blank.
    const full = row.filter((c) => c.full).length;
    if (row.length > 1 && full * 2 > row.length) continue;
    for (const c of row) {
      if (!c.full) found.push({ id: uid(), type: "text", source: c.source, ...c.box });
    }
  }
  return found;
}

/* ------------------------------------------------------------ drawing */

interface DrawingPass {
  hs: HRule[];
  vs: VRule[];
  boxes: FieldCandidate[];
  /** Pictures on the page: a box over one is over the teacher's content. */
  images: Rect[];
}

/**
 * Every rule the page draws: stroked line segments, stroked rectangles (four
 * rules each), and thin filled rectangles, which is how some generators draw
 * a hairline. Walks the drawing operations keeping a transform stack, so a
 * line inside a translated group lands where it is actually painted. Small
 * squares are tick boxes and come back ready-made.
 */
async function fromDrawing(page: PDFPageProxy, transform: Matrix): Promise<DrawingPass> {
  const hs: HRule[] = [];
  const vs: VRule[] = [];
  const boxes: FieldCandidate[] = [];
  const images: Rect[] = [];
  const list = await page.getOperatorList();
  const stack: Matrix[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];

  /** Shapes built by the path op, waiting for the paint op that follows. */
  type Shape = { kind: "rect"; r: Rect } | { kind: "line"; x0: number; y0: number; x1: number; y1: number };
  let pending: Shape[] = [];

  const toPage = (x: number, y: number) => apply(transform, ...apply(ctm, x, y));
  const addRule = (ax: number, ay: number, bx: number, by: number) => {
    if (Math.abs(ay - by) <= TOL && Math.abs(ax - bx) >= MIN_CELL_W) {
      hs.push({ x0: Math.min(ax, bx), x1: Math.max(ax, bx), y: (ay + by) / 2 });
    } else if (Math.abs(ax - bx) <= TOL && Math.abs(ay - by) >= MIN_FIELD) {
      vs.push({ x: (ax + bx) / 2, y0: Math.min(ay, by), y1: Math.max(ay, by) });
    }
  };

  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i];
    const args = list.argsArray[i];

    if (fn === OPS.save) { stack.push(ctm); continue; }
    if (fn === OPS.restore) { ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0]; continue; }
    if (fn === OPS.transform) { ctm = mul(ctm, args as number[]); continue; }

    if (fn === OPS.paintImageXObject || fn === OPS.paintImageMaskXObject || fn === OPS.paintInlineImageXObject) {
      // An image is painted into the unit square of the current transform.
      const [ax, ay] = toPage(0, 0);
      const [bx, by] = toPage(1, 1);
      images.push({ x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) });
      continue;
    }

    if (fn === OPS.constructPath) {
      pending = [];
      const [pathOps, coords] = args as [number[], number[]];
      let c = 0;
      let cur: [number, number] | null = null;
      let start: [number, number] | null = null;
      for (const op of pathOps) {
        if (op === OPS.rectangle) {
          pending.push({ kind: "rect", r: { x: coords[c], y: coords[c + 1], w: coords[c + 2], h: coords[c + 3] } });
          c += 4;
        } else if (op === OPS.moveTo) {
          cur = start = [coords[c], coords[c + 1]];
          c += 2;
        } else if (op === OPS.lineTo) {
          const next: [number, number] = [coords[c], coords[c + 1]];
          if (cur) pending.push({ kind: "line", x0: cur[0], y0: cur[1], x1: next[0], y1: next[1] });
          cur = next;
          c += 2;
        } else if (op === OPS.closePath) {
          if (cur && start) pending.push({ kind: "line", x0: cur[0], y0: cur[1], x1: start[0], y1: start[1] });
          cur = start;
        } else if (op === OPS.curveTo) {
          cur = [coords[c + 4], coords[c + 5]];
          c += 6;
        } else if (op === OPS.curveTo2 || op === OPS.curveTo3) {
          cur = [coords[c + 2], coords[c + 3]];
          c += 4;
        }
      }
      continue;
    }

    if (fn === OPS.endPath) { pending = []; continue; }

    const stroked = fn === OPS.stroke || fn === OPS.closeStroke
      || fn === OPS.fillStroke || fn === OPS.eoFillStroke || fn === OPS.closeFillStroke || fn === OPS.closeEOFillStroke;
    const filled = fn === OPS.fill || fn === OPS.eoFill
      || fn === OPS.fillStroke || fn === OPS.eoFillStroke || fn === OPS.closeFillStroke || fn === OPS.closeEOFillStroke;
    if (!stroked && !filled) continue;

    for (const s of pending) {
      if (s.kind === "line") {
        if (stroked) addRule(...toPage(s.x0, s.y0), ...toPage(s.x1, s.y1));
        continue;
      }
      const [ax, ay] = toPage(s.r.x, s.r.y);
      const [bx, by] = toPage(s.r.x + s.r.w, s.r.y + s.r.h);
      const x = Math.min(ax, bx);
      const y = Math.min(ay, by);
      const w = Math.abs(bx - ax);
      const h = Math.abs(by - ay);

      if (w >= MIN_BOX && w <= MAX_BOX && h >= MIN_BOX && h <= MAX_BOX && Math.abs(w - h) <= 3) {
        boxes.push({ id: uid(), type: "checkbox", source: "box", x, y, w, h });
      } else if (h <= MAX_RULE_H) {
        // A hairline drawn as a filled sliver.
        hs.push({ x0: x, x1: x + w, y: y + h / 2 });
      } else if (w <= MAX_RULE_H) {
        vs.push({ x: x + w / 2, y0: y, y1: y + h });
      } else if (stroked) {
        // An outlined box is four rules; its inside is judged like any cell.
        // A filled one is shading, and shading is not a place to write.
        hs.push({ x0: x, x1: x + w, y }, { x0: x, x1: x + w, y: y + h });
        vs.push({ x, y0: y, y1: y + h }, { x: x + w, y0: y, y1: y + h });
      }
    }
    pending = [];
  }
  return { hs, vs, boxes, images };
}

/* ------------------------------------------------------------- pixels */

/**
 * Blanks on a page that is only a picture.
 *
 * A scanned worksheet has no text layer and no drawing operations, so the
 * passes above come back empty. But the lines are still there: long, thin,
 * dark runs of pixels with light on either side. Finding those directly is
 * both simpler and more reliable than optical character recognition, which
 * is built to read words and makes a poor job of a row of underscores.
 *
 * The "light on either side" part matters: white lettering on a dark banner
 * is also full of long dark runs, and without it every gap between letters
 * came back as a line to write on.
 */
async function fromPixels(page: PDFPageProxy, vp: { width: number; height: number }): Promise<FieldCandidate[]> {
  if (typeof document === "undefined") return [];

  // Enough resolution to resolve a hairline, not so much that a phone stalls.
  const scale = Math.max(0.8, Math.min(2, 1100 / vp.width));
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(vp.width * scale);
  canvas.height = Math.floor(vp.height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: page.getViewport({ scale }) }).promise;

  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const dark = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < dark.length; i++, p += 4) {
    dark[i] = data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114 < 140 ? 1 : 0;
  }
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : dark[y * width + x]);

  /**
   * Straight dark runs along one axis, stacked with the run beside them into
   * one line, so a three-pixel-thick rule is one candidate rather than three.
   * `along` is the axis the run lies on; `across` steps through the other.
   */
  type Run = { a0: number; a1: number; c0: number; c1: number };
  const runs = (minLen: number, pick: (along: number, across: number) => number, lenAlong: number, lenAcross: number) => {
    let open: Run[] = [];
    const done: Run[] = [];
    for (let c = 0; c < lenAcross; c++) {
      const here: Run[] = [];
      let start = -1;
      for (let a = 0; a <= lenAlong; a++) {
        const isDark = a < lenAlong && pick(a, c) === 1;
        if (isDark && start < 0) start = a;
        else if (!isDark && start >= 0) {
          if (a - start >= minLen) here.push({ a0: start, a1: a, c0: c, c1: c });
          start = -1;
        }
      }
      const next: Run[] = [];
      for (const r of here) {
        const prev = open.find((o) => o.c1 === c - 1
          && Math.min(o.a1, r.a1) - Math.max(o.a0, r.a0) > 0.7 * Math.min(o.a1 - o.a0, r.a1 - r.a0));
        if (prev) { prev.c1 = c; prev.a0 = Math.min(prev.a0, r.a0); prev.a1 = Math.max(prev.a1, r.a1); next.push(prev); }
        else next.push(r);
      }
      for (const o of open) if (!next.includes(o)) done.push(o);
      open = next;
    }
    done.push(...open);
    return done;
  };

  /** Mostly light pixels along a line just outside the run? Then it's a line on paper, not a gap in lettering. */
  const lightBeside = (pick: (along: number, across: number) => number, a0: number, a1: number, c: number) => {
    let lit = 0;
    for (let a = a0; a < a1; a++) if (pick(a, c) === 0) lit++;
    return lit >= 0.85 * (a1 - a0);
  };

  const maxThick = (MAX_RULE_H + 1.5) * scale;
  const hs: HRule[] = [];
  for (const r of runs(MIN_CELL_W * scale, (a, c) => at(a, c), width, height)) {
    if (r.c1 - r.c0 + 1 > maxThick) continue;
    if (!lightBeside((a, c) => at(a, c), r.a0, r.a1, r.c0 - 2) || !lightBeside((a, c) => at(a, c), r.a0, r.a1, r.c1 + 2)) continue;
    hs.push({ x0: r.a0 / scale, x1: r.a1 / scale, y: (r.c0 + r.c1 + 1) / 2 / scale });
  }
  const vs: VRule[] = [];
  for (const r of runs(MIN_FIELD * scale, (a, c) => at(c, a), height, width)) {
    if (r.c1 - r.c0 + 1 > maxThick) continue;
    if (!lightBeside((a, c) => at(c, a), r.a0, r.a1, r.c0 - 2) || !lightBeside((a, c) => at(c, a), r.a0, r.a1, r.c1 + 2)) continue;
    vs.push({ x: (r.c0 + r.c1 + 1) / 2 / scale, y0: r.a0 / scale, y1: r.a1 / scale });
  }

  /** Ink inside the box, ignoring a hair around the edge where the rules are. */
  const inked = (r: Rect) => {
    const x0 = Math.max(0, Math.round((r.x + 2) * scale));
    const x1 = Math.min(width, Math.round((r.x + r.w - 2) * scale));
    const y0 = Math.max(0, Math.round((r.y + 2) * scale));
    const y1 = Math.min(height, Math.round((r.y + r.h - 2) * scale));
    if (x1 <= x0 || y1 <= y0) return true;
    let n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) n += dark[y * width + x];
    return n > 0.01 * (x1 - x0) * (y1 - y0);
  };

  return cellsFromRules(hs, vs, vp.width, inked);
}

/* --------------------------------------------------------------- main */

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
    fromText(page, transform).catch(() => ({ found: [], text: [] }) as TextPass),
    fromDrawing(page, transform).catch(() => ({ hs: [], vs: [], boxes: [], images: [] }) as DrawingPass),
  ]);

  // A picture that is the whole page is the page — a scan with a text layer
  // laid over it — and says nothing about where the blanks are.
  const pictures = drawn.images.filter((i) => i.w * i.h < 0.9 * vp.width * vp.height);
  // Both directions, because a box and a piece of text come in every size
  // ratio: "ME" sits wholly inside a cell many times its size, and a box under
  // one word of an underlined heading holds a sliver of one long text item.
  const occupied = (r: Rect) => {
    let covered = 0;
    for (const t of text.text) {
      if (overlap(t, r) > 0.5) return true;
      covered += overlap(r, t);
      if (covered > 0.2) return true;
    }
    return pictures.some((i) => overlap(r, i) > 0.3);
  };

  const ruled = cellsFromRules(drawn.hs, drawn.vs, vp.width, occupied);

  // Nothing in the document itself: this is a photograph of a worksheet, so
  // look at the pixels instead.
  const documentary = text.found.length + ruled.length + drawn.boxes.length;
  const raster = documentary || drawn.hs.length || text.text.length
    ? []
    : await fromPixels(page, vp).catch(() => [] as FieldCandidate[]);

  // Top to bottom, left to right — the order a teacher reads them in, and the
  // order they'll be tabbed through.
  const all = [...text.found, ...drawn.boxes, ...ruled, ...raster]
    .sort((a, b) => (a.y - b.y) || (a.x - b.x));

  const out: FieldCandidate[] = [];
  for (const c of all) {
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
