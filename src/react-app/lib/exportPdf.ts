/**
 * Taking pages back out of the app: as a PDF, or straight to a printer.
 *
 * Each page is composited the way the screen composites it: the paper first
 * (a PDF page via pdf.js, or a drawn ruling), then what sits on the page —
 * the teacher's text blocks and pictures, the answers typed into its boxes,
 * ticks, choices and uploaded photos — and the ink layers over all of it.
 * The result goes in as one image per page. Rasterising loses the source
 * PDF's selectable text, which is the honest trade for a single code path
 * that captures everything exactly where it sits on screen.
 *
 * Printing renders the same images and hands them to the browser's print
 * dialog from the page itself rather than a popup or an iframe: popups are
 * blocked after an await, and an iPad prints the parent page instead of the
 * iframe.
 *
 * jsPDF is imported dynamically so it only loads when someone exports.
 */

import { drawLayer, parseLayer, type LayerData } from "./ink";
import { isPattern, renderPatternToCanvas, DEFAULT_PATTERN_COLOR } from "./patterns";
import { renderPageToCanvas } from "./pdf";
import { assetUrl, type FieldRec, type PageRec } from "./api";

/** Enough to stay sharp in print without producing enormous files. */
const EXPORT_SCALE = 2;
const INK = "#20302C";
const BODY_FONT = '"Nunito", "Helvetica Neue", Arial, sans-serif';
const DISPLAY_FONT = '"Space Grotesk", "Helvetica Neue", Arial, sans-serif';

export interface ExportPage {
  page: PageRec;
  /** Layers to paint over the paper, in the order they should stack. */
  layers: LayerData[];
}

/** What sits on the pages besides ink: the boxes, and what's in them. */
export interface ExportContent {
  fields: FieldRec[];
  /** Answers by field id. Leave empty to print the pages blank. */
  values: Record<string, string>;
  /** Whose uploaded photos to draw, when a teacher exports a student's work. */
  studentId?: string;
}

/** A filename a filesystem and a Drive will both accept. */
export const pdfFileName = (title: string) =>
  `${title.replace(/[^\w\d\-. ]+/g, "").trim() || "notebook"}.pdf`;

/**
 * "1-3, 5" → [0, 1, 2, 4] for a notebook of `count` pages, in the order
 * written and without repeats. Throws a sentence a person can act on.
 */
export function parsePageRange(text: string, count: number): number[] {
  const out: number[] = [];
  const parts = text.split(/[,;\s]+/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) throw new Error("Type the pages you want, like 1-3, 5.");
  for (const part of parts) {
    const m = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(part);
    if (!m) throw new Error(`"${part}" isn't a page number or a range like 2-4.`);
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b < 1 || a > count || b > count) throw new Error(`This notebook has pages 1 to ${count}.`);
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    for (let i = lo; i <= hi; i++) if (!out.includes(i - 1)) out.push(i - 1);
  }
  return out;
}

async function loadImage(url: string): Promise<HTMLImageElement | null> {
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

/** Draw an image inside a box, whole and centered, as `object-contain` does. */
function drawContained(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const s = Math.min(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * s;
  const dh = img.naturalHeight * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/** Lines of plain text wrapped to `width`, honoring the line breaks already in it. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/(\s+)/)) {
      const next = line + word;
      if (line && ctx.measureText(next).width > width && word.trim()) {
        lines.push(line.trimEnd());
        line = word.trimStart();
      } else {
        line = next;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, h: number, size: number) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.font = `${size}px ${BODY_FONT}`;
  ctx.fillStyle = INK;
  ctx.textBaseline = "top";
  const lh = size * 1.2;
  wrap(ctx, text, w).forEach((line, i) => ctx.fillText(line, x, y + i * lh));
  ctx.restore();
}

interface Run { text: string; bold: boolean; italic: boolean; underline: boolean }
interface Block { runs: Run[]; size: number; display: boolean; indent: number; marker: string; after: number }

/**
 * A text block's markup as runs of styled words. The markup is already
 * sanitised server-side to a short list of tags, so this only has to know
 * those: paragraphs, three heading sizes, lists, quotes and inline styles.
 */
function richBlocks(html: string, base: number): Block[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const blocks: Block[] = [];
  const inline = (node: Node, style: Omit<Run, "text">, runs: Run[]) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? "").replace(/\s+/g, " ");
      if (text) runs.push({ text, ...style });
      return;
    }
    if (!(node instanceof Element)) return;
    const tag = node.tagName.toLowerCase();
    if (tag === "br") { runs.push({ text: "\n", ...style }); return; }
    const next = {
      bold: style.bold || tag === "strong" || tag === "b",
      italic: style.italic || tag === "em" || tag === "i",
      underline: style.underline || tag === "u" || tag === "a",
    };
    node.childNodes.forEach((c) => inline(c, next, runs));
  };
  const plain = { bold: false, italic: false, underline: false };
  const block = (el: Element, indent: number, marker: string) => {
    const tag = el.tagName.toLowerCase();
    const sizes: Record<string, number> = { h1: 1.5, h2: 1.25, h3: 1.1 };
    const runs: Run[] = [];
    el.childNodes.forEach((c) => {
      if (c instanceof Element && ["ul", "ol"].includes(c.tagName.toLowerCase())) return;
      inline(c, sizes[tag] ? { ...plain, bold: true } : plain, runs);
    });
    if (runs.some((r) => r.text.trim())) {
      blocks.push({
        runs, size: base * (sizes[tag] ?? 1), display: !!sizes[tag], indent, marker,
        after: base * (tag === "li" ? 0.15 : sizes[tag] ? 0.4 : 0.5),
      });
    }
  };
  const list = (el: Element, indent: number) => {
    let n = 0;
    el.querySelectorAll(":scope > li").forEach((li) => {
      n += 1;
      block(li, indent + base * 1.4, el.tagName.toLowerCase() === "ol" ? `${n}.` : "•");
      li.querySelectorAll(":scope > ul, :scope > ol").forEach((sub) => list(sub, indent + base * 1.4));
    });
  };
  const walk = (parent: Element, indent: number) => {
    parent.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = (node.textContent ?? "").trim();
        if (text) blocks.push({ runs: [{ text, ...plain }], size: base, display: false, indent, marker: "", after: base * 0.5 });
        return;
      }
      if (!(node instanceof Element)) return;
      const tag = node.tagName.toLowerCase();
      if (tag === "ul" || tag === "ol") list(node, indent);
      else if (tag === "blockquote") walk(node, indent + base * 0.7);
      else block(node, indent, "");
    });
  };
  walk(doc.body, 0);
  return blocks;
}

function drawRichText(ctx: CanvasRenderingContext2D, html: string, x: number, y: number, w: number, h: number) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  ctx.textBaseline = "alphabetic";
  let cy = y;
  for (const b of richBlocks(html, 15)) {
    const lh = b.size * 1.4;
    const left = x + b.indent;
    const width = Math.max(10, w - b.indent);
    const font = (r: Run) => `${r.italic ? "italic " : ""}${r.bold ? 700 : 400} ${b.size}px ${b.display ? DISPLAY_FONT : BODY_FONT}`;
    if (b.marker) {
      ctx.font = `400 ${b.size}px ${BODY_FONT}`;
      ctx.fillText(b.marker, left - ctx.measureText(b.marker + " ").width, cy + b.size);
    }
    let cx = left;
    let started = false;
    for (const run of b.runs) {
      ctx.font = font(run);
      for (const piece of run.text.split(/(\s+|\n)/)) {
        if (!piece) continue;
        if (piece === "\n") { cx = left; cy += lh; continue; }
        const pw = ctx.measureText(piece).width;
        if (cx + pw > left + width && piece.trim() && cx > left) { cx = left; cy += lh; }
        if (cx === left && !piece.trim()) continue;
        ctx.fillText(piece, cx, cy + b.size);
        if (run.underline && piece.trim()) ctx.fillRect(cx, cy + b.size + 2, pw, 1);
        cx += pw;
        started = true;
      }
    }
    if (started) cy += lh + b.after;
    if (cy > y + h) break;
  }
  ctx.restore();
}

function outline(ctx: CanvasRenderingContext2D, f: FieldRec, alpha = 0.45) {
  ctx.save();
  ctx.strokeStyle = `rgba(32, 48, 44, ${alpha})`;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(f.x, f.y, f.w, f.h, 3);
  ctx.stroke();
  ctx.restore();
}

/** Everything on the page that isn't paper or ink, in page units. */
async function drawFields(ctx: CanvasRenderingContext2D, notebookId: string, fields: FieldRec[], content: ExportContent) {
  const media = (f: FieldRec) => `/api/notebooks/${notebookId}/fields/${f.id}/media`;
  for (const f of fields) {
    const value = content.values[f.id] ?? "";
    if (f.type === "richtext") {
      drawRichText(ctx, f.content ?? "", f.x, f.y, f.w, f.h);
    } else if (f.type === "figure") {
      const img = f.has_media ? await loadImage(media(f)) : null;
      if (img) drawContained(ctx, img, f.x, f.y, f.w, f.h);
    } else if (f.type === "checkbox") {
      outline(ctx, f);
      if (value === "1") {
        ctx.save();
        ctx.strokeStyle = INK;
        ctx.lineWidth = Math.max(1.5, Math.min(f.w, f.h) * 0.12);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(f.x + f.w * 0.2, f.y + f.h * 0.52);
        ctx.lineTo(f.x + f.w * 0.42, f.y + f.h * 0.74);
        ctx.lineTo(f.x + f.w * 0.82, f.y + f.h * 0.27);
        ctx.stroke();
        ctx.restore();
      }
    } else if (f.type === "choice") {
      outline(ctx, f);
      let options: string[] = [];
      try { options = JSON.parse(f.options || "[]"); } catch { options = []; }
      // On paper there's no dropdown to open, so a blank one lists its
      // choices for circling.
      const size = Math.max(9, Math.min(16, f.h * 0.5));
      drawText(ctx, value || options.join(" / "), f.x + 4, f.y + (f.h - size * 1.2) / 2, f.w - 8, f.h, value ? size : Math.min(size, 11));
    } else if (f.type === "prompt") {
      outline(ctx, f);
      let top = f.y + 3;
      if (f.prompt) {
        const size = Math.max(10, Math.min(13, f.h * 0.14));
        ctx.save();
        ctx.font = `600 ${size}px ${BODY_FONT}`;
        const lines = wrap(ctx, f.prompt, f.w - 8);
        ctx.restore();
        drawText(ctx, f.prompt, f.x + 4, top, f.w - 8, f.h - 6, size);
        top += lines.length * size * 1.2 + 4;
      }
      if (f.has_media) {
        const img = await loadImage(media(f));
        const room = Math.max(0, (f.y + f.h - top) * (value ? 0.5 : 1));
        if (img && room > 8) { drawContained(ctx, img, f.x + 4, top, f.w - 8, room); top += room; }
      }
      if (value) drawText(ctx, value, f.x + 4, top, f.w - 8, f.y + f.h - top, Math.max(11, Math.min(16, f.h * 0.16)));
    } else if (f.type === "text") {
      if (value) drawText(ctx, value, f.x + 3, f.y + 2, f.w - 6, f.h - 4, Math.max(11, Math.min(16, f.h * 0.42)));
    } else if (f.type === "image") {
      if (value) {
        const qs = new URLSearchParams();
        if (content.studentId) qs.set("student", content.studentId);
        const img = await loadImage(`/api/notebooks/${notebookId}/responses/${f.id}${qs.toString() ? `?${qs}` : ""}`);
        if (img) drawContained(ctx, img, f.x, f.y, f.w, f.h);
      }
    }
    // Audio and links have nothing to show on paper.
  }
}

/** One page, composited, on a canvas at print resolution. */
async function renderPage(notebookId: string, { page, layers }: ExportPage, content?: ExportContent): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  if (isPattern(page.pattern)) {
    renderPatternToCanvas(
      page.pattern, page.pattern_color || DEFAULT_PATTERN_COLOR,
      page.width, page.height, canvas, 1, EXPORT_SCALE,
    );
  } else {
    await renderPageToCanvas(assetUrl(notebookId, page.asset_key), page.source_index, canvas, 1, EXPORT_SCALE);
  }
  // Fields and annotations are stored in page units, so the same scale that
  // sized the paper puts them exactly where they sit on screen.
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.setTransform(EXPORT_SCALE, 0, 0, EXPORT_SCALE, 0, 0);
    if (content) await drawFields(ctx, notebookId, content.fields.filter((f) => f.page_id === page.id), content);
    for (const layer of layers) drawLayer(ctx, layer, 1);
  }
  return canvas;
}

/**
 * Render the pages and hand back the PDF itself.
 *
 * Separated from saving it because the file has two destinations — the
 * machine in front of you, or Drive — and only the last step differs.
 */
export async function renderNotebookPdf(
  notebookId: string,
  pages: ExportPage[],
  onProgress?: (done: number, total: number) => void,
  content?: ExportContent,
): Promise<Blob> {
  if (document.fonts?.ready) await document.fonts.ready;
  const { jsPDF } = await import("jspdf");
  let doc: InstanceType<typeof jsPDF> | null = null;
  for (let i = 0; i < pages.length; i++) {
    const { page } = pages[i];
    const canvas = await renderPage(notebookId, pages[i], content);
    const orientation = page.width > page.height ? "landscape" : "portrait";
    if (!doc) doc = new jsPDF({ orientation, unit: "pt", format: [page.width, page.height], compress: true });
    else doc.addPage([page.width, page.height], orientation);
    // JPEG rather than PNG: a scanned page as lossless PNG can run to megabytes
    // each, and a hundred of those is not a file anyone can email.
    doc.addImage(canvas.toDataURL("image/jpeg", 0.85), "JPEG", 0, 0, page.width, page.height);
    onProgress?.(i + 1, pages.length);
  }
  if (!doc) throw new Error("There are no pages to export.");
  return doc.output("blob");
}

/** Render and download, which is what most people mean by "export". */
export async function exportNotebookPdf(
  notebookId: string,
  title: string,
  pages: ExportPage[],
  onProgress?: (done: number, total: number) => void,
  content?: ExportContent,
): Promise<void> {
  const blob = await renderNotebookPdf(notebookId, pages, onProgress, content);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = pdfFileName(title);
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick: too early and Safari cancels its own download.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Render the pages and open the print dialog with only them on it.
 *
 * The pages go into a container that print CSS shows alone, one per sheet,
 * edge to edge; the rest of the app is hidden while printing and the
 * container is removed afterwards.
 */
export async function printNotebookPages(
  notebookId: string,
  pages: ExportPage[],
  onProgress?: (done: number, total: number) => void,
  content?: ExportContent,
): Promise<void> {
  if (!pages.length) throw new Error("There are no pages to print.");
  if (document.fonts?.ready) await document.fonts.ready;
  document.getElementById("print-root")?.remove();
  const root = document.createElement("div");
  root.id = "print-root";
  root.setAttribute("aria-hidden", "true");
  const urls: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    const canvas = await renderPage(notebookId, pages[i], content);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
    if (!blob) continue;
    const url = URL.createObjectURL(blob);
    urls.push(url);
    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    img.dataset.printPage = String(i + 1);
    root.appendChild(img);
    onProgress?.(i + 1, pages.length);
  }
  document.body.appendChild(root);
  await Promise.all(Array.from(root.querySelectorAll("img")).map((img) => img.decode().catch(() => {})));
  const cleanup = () => {
    root.remove();
    urls.forEach((u) => URL.revokeObjectURL(u));
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
  // Some browsers never fire afterprint; the images are only needed while the dialog is up.
  setTimeout(() => { if (document.getElementById("print-root") === root) cleanup(); }, 120_000);
}

/** Gather the layers belonging to one page, newest kinds painted last. */
export function layersForPage(
  pageId: string,
  rows: { page_id: string; kind: string; data: string }[],
): LayerData[] {
  const of = (kind: string) => rows.find((r) => r.page_id === pageId && r.kind === kind)?.data;
  return [of("student"), of("teacher")].filter(Boolean).map((d) => parseLayer(d as string));
}
