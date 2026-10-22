/**
 * PDF rendering (Layer 1).
 *
 * pdf.js runs entirely in the browser, which is what lets a notebook keep the
 * source document's exact typography and layout without any server-side
 * conversion step. Documents are cached per URL so flipping between pages of the
 * same notebook never refetches.
 */

import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { normalizeLink } from "../../shared/links.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const docs = new Map<string, Promise<PDFDocumentProxy>>();

export function loadPdf(url: string): Promise<PDFDocumentProxy> {
  let doc = docs.get(url);
  if (!doc) {
    doc = pdfjsLib.getDocument({ url, withCredentials: true }).promise;
    docs.set(url, doc);
    doc.catch(() => docs.delete(url));
  }
  return doc;
}

export function forgetPdf(url: string) {
  docs.delete(url);
}

/** A link in the document, placed the way a field is: page units, top-left origin. */
export interface PdfLink {
  x: number;
  y: number;
  w: number;
  h: number;
  url: string;
  /** The words the link sits over, when the page has real text; empty on a scan. */
  label: string;
}

export interface PageSize {
  sourceIndex: number;
  width: number;
  height: number;
  /** The page's own links, when it has any. The server keeps them as link fields. */
  links?: PdfLink[];
}

/**
 * Read every page's intrinsic size — used to create page records after upload —
 * and the links on it, so a worksheet's links still work once it's a notebook.
 *
 * Links are read here, in the pass that already opens every page, rather than
 * later: this is the one moment the whole file is in hand, and every way a
 * document becomes pages (a new notebook, added pages, the page library) comes
 * through here. A Word or PowerPoint file arrives already converted to PDF by
 * Google, and that conversion keeps its links.
 */
export async function readPageSizes(file: Blob): Promise<PageSize[]> {
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  const out: PageSize[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const links = await pageLinks(page);
    out.push({ sourceIndex: i - 1, width: viewport.width, height: viewport.height, ...(links.length ? { links } : {}) });
  }
  await doc.destroy();
  return out;
}

/** The links on one page of a document already in the viewer's cache — for pages imported before links were kept. */
export async function readPageLinks(url: string, sourceIndex: number): Promise<PdfLink[]> {
  const doc = await loadPdf(url);
  return pageLinks(await doc.getPage(sourceIndex + 1));
}

/**
 * A page's web and mail links, in page units.
 *
 * Only links out of the document are kept. A link to another page of the same
 * file (a contents page) has nowhere to go once the pages are a notebook that
 * may have been reordered or split, so it is left as the words it was. Anything
 * the shared link rule refuses — `javascript:`, `file:` — is dropped here, and
 * the server applies the same rule again.
 */
async function pageLinks(page: PDFPageProxy): Promise<PdfLink[]> {
  const viewport = page.getViewport({ scale: 1 });
  let annotations: any[];
  try {
    annotations = await page.getAnnotations({ intent: "display" });
  } catch {
    return [];
  }
  const found: Omit<PdfLink, "label">[] = [];
  for (const a of annotations) {
    if (a?.subtype !== "Link" || !Array.isArray(a.rect)) continue;
    const url = normalizeLink(a.url ?? a.unsafeUrl);
    if (!url) continue;
    const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(a.rect);
    const box = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
    if (box.w < 2 || box.h < 2) continue;
    found.push({ ...box, url });
  }
  if (!found.length) return [];

  const words = await textBoxes(page, viewport);
  return found.map((l) => ({ ...l, label: wordsIn(words, l) }));
}

interface TextBox { str: string; x: number; y: number; w: number; h: number }

/** Where each run of text sits on the page, in the same units as the links. */
async function textBoxes(page: PDFPageProxy, viewport: ReturnType<PDFPageProxy["getViewport"]>): Promise<TextBox[]> {
  try {
    const content = await page.getTextContent();
    const out: TextBox[] = [];
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const t = pdfjsLib.Util.transform(viewport.transform, item.transform as number[]);
      const size = Math.hypot(t[2], t[3]) || item.height || 10;
      // `t` puts the run's baseline at (t[4], t[5]); the letters sit above it.
      out.push({ str: item.str, x: t[4], y: t[5] - size, w: item.width * viewport.scale, h: size });
    }
    return out;
  } catch {
    return [];
  }
}

/** The words a link covers: runs that fall mostly inside its box, in reading order. */
function wordsIn(words: TextBox[], box: { x: number; y: number; w: number; h: number }): string {
  const inside = words.filter((t) => {
    const ox = Math.min(t.x + t.w, box.x + box.w) - Math.max(t.x, box.x);
    const oy = Math.min(t.y + t.h, box.y + box.h) - Math.max(t.y, box.y);
    if (ox <= 0 || oy <= 0) return false;
    return (ox * oy) / Math.max(1, Math.min(t.w * t.h, box.w * box.h)) > 0.5;
  });
  return inside.map((t) => t.str).join(" ").replace(/\s+/g, " ").trim().slice(0, 200);
}

/**
 * Render a page into a canvas at the given CSS scale, accounting for device pixel
 * ratio so ink and text stay sharp on retina/ProMotion displays.
 */
export async function renderPageToCanvas(
  url: string,
  sourceIndex: number,
  canvas: HTMLCanvasElement,
  scale: number,
  dpr: number,
  signal?: { canceled: boolean },
): Promise<void> {
  const doc = await loadPdf(url);
  if (signal?.canceled) return;
  const page = await doc.getPage(sourceIndex + 1);
  if (signal?.canceled) return;

  const viewport = page.getViewport({ scale: scale * dpr });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const task = page.render({ canvasContext: ctx, viewport });
  try {
    await task.promise;
  } catch (err: any) {
    if (err?.name !== "RenderingCanceledException") throw err;
  }
}

/**
 * The words on a page, in reading order, for speech.
 *
 * The same text layer `formFields` reads to find blanks. Items are joined into
 * sentences rather than returned as fragments, because a screen reader given
 * "Name:" and "_____" and "Date:" as separate utterances pauses in all the
 * wrong places. A scanned page is a picture and returns nothing, which the
 * caller has to say out loud rather than sit silent.
 */
export async function readPageText(url: string, sourceIndex: number): Promise<string> {
  const doc = await loadPdf(url);
  const page = await doc.getPage(sourceIndex + 1);
  const content = await page.getTextContent();
  const parts: string[] = [];
  let lastY: number | null = null;

  for (const item of content.items) {
    if (!("str" in item) || !item.str.trim()) continue;
    const y = (item.transform as number[])[5];
    // A jump down the page is a new line, and a new line is a pause.
    if (lastY !== null && Math.abs(y - lastY) > 4) parts.push("\n");
    parts.push(item.str);
    lastY = y;
  }

  return parts
    .join(" ")
    // A run of underscores is a blank to fill, not a word. Say so once.
    .replace(/_{3,}/g, " blank ")
    .replace(/\s*\n\s*/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
}
