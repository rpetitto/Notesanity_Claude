import { useEffect, useRef, useState } from "react";
import { renderPageToCanvas } from "../lib/pdf";
import { isPattern, renderPatternToCanvas, DEFAULT_PATTERN_COLOR } from "../lib/patterns";
import { drawLayerThumb, type LayerData } from "../lib/ink";
import { cn } from "../lib/utils";

/**
 * A small rendered preview of one notebook page.
 *
 * Rendering is deferred until the thumbnail scrolls into view — a long notebook
 * would otherwise fire dozens of pdf.js render jobs at once and lock up a cheap
 * Chromebook. The pdf document itself is cached by URL, so the second thumbnail
 * from the same source costs almost nothing.
 */
export default function PageThumb({
  pdfUrl, sourceIndex, pageWidth, pageHeight, pattern, patternColor, width = 96, className, dimmed,
  overlays,
}: {
  pdfUrl: string;
  sourceIndex: number;
  pageWidth: number;
  pageHeight: number;
  /** Set on a generated page: draw this ruling instead of fetching a PDF. */
  pattern?: string;
  patternColor?: string;
  width?: number;
  className?: string;
  dimmed?: boolean;
  /**
   * Ink to paint over the page, back to front — master markup, then the
   * student's own, then whoever is marking it. Lets a rail answer "which
   * pages have been written on" without opening any of them.
   */
  overlays?: (LayerData | null | undefined)[];
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);

  const height = Math.round((pageHeight / pageWidth) * width);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  // Redraw when the ink changes, not just when its array identity does —
  // a rail repaints on every autosave otherwise.
  const inkKey = (overlays ?? [])
    .map((l) => (l ? `${l.s.length}:${l.e.length}` : ""))
    .join("|");

  useEffect(() => {
    if (!visible || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const signal = { canceled: false };
    const scale = width / pageWidth;
    setReady(false);

    // Ink goes on last, over whatever the page itself is — so for a PDF it has
    // to wait for the render to resolve, or pdf.js paints straight over it.
    //
    // The transform is reset first because the two background renderers leave
    // the context in different states: the pattern one scales to page units and
    // leaves that in place, pdf.js sets its own viewport matrix. Inheriting
    // either would scale these coordinates a second time and fold the ink into
    // the top-left corner, so this asks for identity and does its own scaling.
    const paintInk = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      for (const layer of overlays ?? []) if (layer) drawLayerThumb(ctx, layer, scale);
      ctx.restore();
    };

    // Thumbnails render at 1x DPR; they're decorative and this halves the work.
    if (isPattern(pattern)) {
      renderPatternToCanvas(
        pattern, patternColor || DEFAULT_PATTERN_COLOR,
        pageWidth, pageHeight, canvas, scale, 1,
      );
      paintInk();
      setReady(true);
      return;
    }
    renderPageToCanvas(pdfUrl, sourceIndex, canvas, scale, 1, signal)
      .then(() => { if (!signal.canceled) { paintInk(); setReady(true); } })
      .catch(() => { /* a broken preview shouldn't break the list */ });
    return () => { signal.canceled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, pdfUrl, sourceIndex, width, pageWidth, pageHeight, pattern, patternColor, inkKey]);

  return (
    <div
      ref={wrapRef}
      className={cn("relative overflow-hidden rounded border border-pine/20 bg-white", className)}
      style={{ width, height }}
    >
      <canvas ref={canvasRef} style={{ width, height }} className={cn("block", dimmed && "opacity-40")} />
      {!ready && <div className="absolute inset-0 animate-pulse bg-oat" />}
    </div>
  );
}
