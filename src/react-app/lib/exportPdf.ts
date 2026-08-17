/**
 * Exporting a notebook back out as a PDF.
 *
 * Sharing a personal notebook isn't possible yet, so this is how work leaves
 * the app — it has to produce something a person can hand in, print or keep.
 *
 * Each page is composited the way the screen composites it: the paper first
 * (a PDF page via pdf.js, or a drawn ruling), then the annotation layers over
 * it, and the result goes in as one image per page. Rasterising loses the
 * source PDF's selectable text, which is the honest trade for a single code
 * path that captures ink, typed notes and stamps exactly as they appear —
 * re-deriving all of that as vector PDF content would be a second renderer to
 * write and keep in step with the first.
 *
 * jsPDF is imported dynamically so it only loads when someone exports.
 */

import { drawLayer, parseLayer, type LayerData } from "./ink";
import { isPattern, renderPatternToCanvas, DEFAULT_PATTERN_COLOR } from "./patterns";
import { renderPageToCanvas } from "./pdf";
import { assetUrl, type PageRec } from "./api";

/** Enough to stay sharp in print without producing enormous files. */
const EXPORT_SCALE = 2;

export interface ExportPage {
  page: PageRec;
  /** Layers to paint over the paper, in the order they should stack. */
  layers: LayerData[];
}

export async function exportNotebookPdf(
  notebookId: string,
  title: string,
  pages: ExportPage[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const { jsPDF } = await import("jspdf");
  let doc: InstanceType<typeof jsPDF> | null = null;

  for (let i = 0; i < pages.length; i++) {
    const { page, layers } = pages[i];
    const canvas = document.createElement("canvas");

    if (isPattern(page.pattern)) {
      renderPatternToCanvas(
        page.pattern, page.pattern_color || DEFAULT_PATTERN_COLOR,
        page.width, page.height, canvas, 1, EXPORT_SCALE,
      );
    } else {
      await renderPageToCanvas(assetUrl(notebookId, page.asset_key), page.source_index, canvas, 1, EXPORT_SCALE);
    }

    // Annotations are stored in page units, so the same scale that sized the
    // paper puts them exactly where they sit on screen.
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.setTransform(EXPORT_SCALE, 0, 0, EXPORT_SCALE, 0, 0);
      for (const layer of layers) drawLayer(ctx, layer, 1);
    }

    const orientation = page.width > page.height ? "landscape" : "portrait";
    if (!doc) {
      doc = new jsPDF({ orientation, unit: "pt", format: [page.width, page.height], compress: true });
    } else {
      doc.addPage([page.width, page.height], orientation);
    }
    // JPEG rather than PNG: a scanned page as lossless PNG can run to megabytes
    // each, and a hundred of those is not a file anyone can email.
    doc.addImage(canvas.toDataURL("image/jpeg", 0.85), "JPEG", 0, 0, page.width, page.height);
    onProgress?.(i + 1, pages.length);
  }

  if (!doc) throw new Error("This notebook has no pages to export.");
  doc.save(`${title.replace(/[^\w\d\-. ]+/g, "").trim() || "notebook"}.pdf`);
}

/** Gather the layers belonging to one page, newest kinds painted last. */
export function layersForPage(
  pageId: string,
  rows: { page_id: string; kind: string; data: string }[],
): LayerData[] {
  const of = (kind: string) => rows.find((r) => r.page_id === pageId && r.kind === kind)?.data;
  return [of("student"), of("teacher")].filter(Boolean).map((d) => parseLayer(d as string));
}
