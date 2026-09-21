/**
 * PDF rendering (Layer 1).
 *
 * pdf.js runs entirely in the browser, which is what lets a notebook keep the
 * source document's exact typography and layout without any server-side
 * conversion step. Documents are cached per URL so flipping between pages of the
 * same notebook never refetches.
 */

import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

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

export interface PageSize {
  sourceIndex: number;
  width: number;
  height: number;
}

/** Read every page's intrinsic size — used to create page records after upload. */
export async function readPageSizes(file: Blob): Promise<PageSize[]> {
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  const out: PageSize[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    out.push({ sourceIndex: i - 1, width: viewport.width, height: viewport.height });
  }
  await doc.destroy();
  return out;
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
