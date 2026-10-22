/**
 * Generated page backgrounds (Layer 1, without a PDF).
 *
 * A blank page carries no source document — it stores a pattern name and a rule
 * color, and the ruling is drawn here at paint time. That keeps it sharp at any
 * zoom and any pixel density, costs no storage, and means a notebook's blank
 * pages weigh nothing next to its scanned ones.
 *
 * All geometry is in page units (1 unit = 1 PostScript point = 1/72"), the same
 * space as `pages.width`/`pages.height` and the annotation layers, so a rule
 * lands in the same place as the ink drawn over it.
 */

export type PatternKey =
  | "blank"
  | "lined-wide"
  | "lined-college"
  | "dot"
  | "graph"
  | "music"
  | "engineering"
  | "isometric"
  | "coordinate";

export const PATTERNS: { key: PatternKey; label: string; hint: string }[] = [
  { key: "blank", label: "Blank", hint: "Nothing at all" },
  { key: "lined-wide", label: "Wide ruled", hint: "11/32\" lines" },
  { key: "lined-college", label: "College ruled", hint: "9/32\" lines" },
  { key: "dot", label: "Dot grid", hint: "1/4\" dots" },
  { key: "graph", label: "Graph", hint: "1/4\" squares" },
  { key: "music", label: "Music staff", hint: "Five-line staves" },
  { key: "engineering", label: "Engineering", hint: "1/10\" with border" },
  { key: "isometric", label: "Isometric", hint: "Triangular grid" },
  { key: "coordinate", label: "Coordinate plane", hint: "Axes through center" },
];

/**
 * Rule colors: brand accents pulled right down in saturation.
 *
 * A rule is scaffolding, not content — it has to sit far enough back that pencil
 * and pen read cleanly on top of it, which is why these are tints rather than
 * the accents themselves.
 */
export const PATTERN_COLORS: { key: string; label: string; value: string }[] = [
  { key: "graphite", label: "Graphite", value: "#B6BEBB" },
  { key: "mint", label: "Mint", value: "#BFE8D6" },
  { key: "teal", label: "Teal", value: "#A9CFC4" },
  { key: "blue", label: "Blue", value: "#AFC2D8" },
  { key: "plum", label: "Plum", value: "#C6B6D2" },
  { key: "clay", label: "Clay", value: "#E3C0A8" },
  { key: "ochre", label: "Ochre", value: "#EEDCAE" },
  { key: "moss", label: "Moss", value: "#BCCFB0" },
];

export const DEFAULT_PATTERN: PatternKey = "lined-college";
export const DEFAULT_PATTERN_COLOR = PATTERN_COLORS[0].value;

export const isPattern = (v: unknown): v is PatternKey =>
  typeof v === "string" && PATTERNS.some((p) => p.key === v);

const INCH = 72;

/** A repeat closer together than this many device pixels can't be resolved. */
const MIN_SPACING_PX = 3.5;

/**
 * Draw a pattern in page units.
 *
 * `k` is the total device-pixels-per-page-unit already applied to `ctx` by the
 * caller. Two things depend on it, and both only matter at small sizes:
 *
 *  - A rule thinner than one device pixel renders as nothing, so widths have a
 *    floor.
 *  - A repeat *tighter* than a few device pixels renders as a solid wash — a
 *    quarter-inch grid on a 56px thumbnail puts a line every 1.6 pixels, which
 *    fills the page rather than suggesting graph paper. Such a repeat is thinned
 *    out by halving until it can be seen, so a thumbnail still reads as the
 *    pattern it is.
 */
export function drawPattern(
  ctx: CanvasRenderingContext2D,
  pattern: PatternKey,
  color: string,
  w: number,
  h: number,
  k: number,
) {
  /** `n` device pixels, expressed in page units. */
  const px = (n: number) => n / Math.max(k, 0.0001);
  /** Widen a repeat until it is actually resolvable at this scale. */
  const resolve = (spacing: number) => {
    let s = spacing;
    for (let i = 0; i < 8 && s * k < MIN_SPACING_PX; i++) s *= 2;
    return s;
  };
  /** A rule at least a pixel wide, but never so wide it closes up its own gap. */
  const rule = (units: number, spacing: number) => Math.min(Math.max(units, px(1)), spacing / 3);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = "butt";

  const hLines = (raw: number, top: number, bottom: number, width: number) => {
    const spacing = resolve(raw);
    ctx.lineWidth = rule(width, spacing);
    ctx.beginPath();
    for (let y = top; y <= bottom + 0.01; y += spacing) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
  };

  const grid = (raw: number, width: number) => {
    const spacing = resolve(raw);
    ctx.lineWidth = rule(width, spacing);
    ctx.beginPath();
    for (let x = spacing; x < w; x += spacing) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = spacing; y < h; y += spacing) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
  };

  switch (pattern) {
    case "blank":
      break;

    case "lined-wide":
    case "lined-college": {
      const spacing = pattern === "lined-wide" ? (11 / 32) * INCH : (9 / 32) * INCH;
      const top = INCH; // the customary one-inch header
      hLines(spacing, top, h - INCH * 0.5, 0.7);
      // The margin rule, a touch stronger so it still reads as the edge of the
      // writing area rather than as one more line.
      const margin = INCH * 1.25;
      if (margin < w) {
        ctx.lineWidth = Math.max(1, px(1));
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.moveTo(margin, INCH * 0.4);
        ctx.lineTo(margin, h - INCH * 0.4);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      break;
    }

    case "dot": {
      const spacing = resolve(INCH / 4);
      // Big enough to see, small enough to still be a dot and not a blot.
      const r = Math.min(Math.max(0.85, px(0.6)), spacing / 6);
      for (let x = spacing; x < w; x += spacing) {
        for (let y = spacing; y < h; y += spacing) {
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }

    case "graph":
      grid(INCH / 4, 0.7);
      break;

    case "engineering": {
      // Fine 1/10" grid with every fifth line carrying the weight, inside a
      // ruled border — the layout of an engineering pad.
      const inset = INCH * 0.4;
      const fine = resolve(INCH / 10);
      const heavy = resolve(INCH / 2);
      // The fine grid is dropped rather than thinned once it would collide with
      // the heavy one — two grids at the same pitch just reads as one darker grid.
      if (fine < heavy) {
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = rule(0.5, fine);
        ctx.beginPath();
        for (let x = inset; x <= w - inset + 0.01; x += fine) {
          ctx.moveTo(x, inset);
          ctx.lineTo(x, h - inset);
        }
        for (let y = inset; y <= h - inset + 0.01; y += fine) {
          ctx.moveTo(inset, y);
          ctx.lineTo(w - inset, y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      ctx.lineWidth = rule(0.9, heavy);
      ctx.beginPath();
      for (let x = inset; x <= w - inset + 0.01; x += heavy) {
        ctx.moveTo(x, inset);
        ctx.lineTo(x, h - inset);
      }
      for (let y = inset; y <= h - inset + 0.01; y += heavy) {
        ctx.moveTo(inset, y);
        ctx.lineTo(w - inset, y);
      }
      ctx.stroke();

      ctx.lineWidth = Math.max(1.4, px(1));
      ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
      break;
    }

    case "music": {
      // Five lines to a staff, with room between staves for lyrics or chords.
      const gap = 7;             // between the lines of one staff
      const staffHeight = gap * 4;
      const between = 40;        // between one staff and the next
      const left = INCH * 0.6;
      const right = w - INCH * 0.6;
      // Staves are never thinned: five lines *is* the pattern. At thumbnail
      // size they merge into one band per staff, which still reads correctly.
      ctx.lineWidth = rule(0.7, gap);
      ctx.beginPath();
      for (let top = INCH * 0.8; top + staffHeight < h - INCH * 0.5; top += staffHeight + between) {
        for (let i = 0; i < 5; i++) {
          const y = top + i * gap;
          ctx.moveTo(left, y);
          ctx.lineTo(right, y);
        }
      }
      ctx.stroke();
      break;
    }

    case "isometric": {
      // Three families of parallel lines at 60° to each other: vertical, and
      // ±30° from horizontal. Equal perpendicular spacing gives equilateral
      // triangles.
      const side = 24;
      const d = resolve((side * Math.sqrt(3)) / 2);
      const slope = Math.tan(Math.PI / 6);
      const db = d / Math.cos(Math.PI / 6);
      ctx.lineWidth = rule(0.6, d);
      ctx.beginPath();
      for (let x = 0; x <= w + 0.01; x += d) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      // y = slope * x + b, swept across every intercept that crosses the page.
      for (let b = -slope * w; b <= h + 0.01; b += db) {
        ctx.moveTo(0, b);
        ctx.lineTo(w, slope * w + b);
      }
      for (let b = 0; b <= h + slope * w + 0.01; b += db) {
        ctx.moveTo(0, b);
        ctx.lineTo(w, -slope * w + b);
      }
      ctx.stroke();
      break;
    }

    case "coordinate": {
      const spacing = INCH / 4;
      const cx = Math.round(w / 2 / spacing) * spacing;
      const cy = Math.round(h / 2 / spacing) * spacing;
      ctx.globalAlpha = 0.7;
      grid(spacing, 0.6);
      ctx.globalAlpha = 1;

      ctx.lineWidth = Math.max(1.5, px(1));
      ctx.beginPath();
      ctx.moveTo(0, cy);
      ctx.lineTo(w, cy);
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, h);
      ctx.stroke();

      // Ticks every fourth square, so the axes can actually be counted along.
      const tick = 3;
      ctx.lineWidth = Math.max(1, px(1));
      ctx.beginPath();
      for (let x = cx % (spacing * 4); x < w; x += spacing * 4) {
        ctx.moveTo(x, cy - tick);
        ctx.lineTo(x, cy + tick);
      }
      for (let y = cy % (spacing * 4); y < h; y += spacing * 4) {
        ctx.moveTo(cx - tick, y);
        ctx.lineTo(cx + tick, y);
      }
      ctx.stroke();
      break;
    }
  }

  ctx.restore();
}

/**
 * Paint a generated page into a canvas, sizing it the way `renderPageToCanvas`
 * does for a PDF page so the two are interchangeable at the call site.
 */
export function renderPatternToCanvas(
  pattern: PatternKey,
  color: string,
  pageWidth: number,
  pageHeight: number,
  canvas: HTMLCanvasElement,
  scale: number,
  dpr: number,
) {
  const k = scale * dpr;
  canvas.width = Math.floor(pageWidth * k);
  canvas.height = Math.floor(pageHeight * k);
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, pageWidth, pageHeight);
  drawPattern(ctx, pattern, color, pageWidth, pageHeight, k);
}
