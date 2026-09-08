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
