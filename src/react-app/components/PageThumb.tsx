import { useEffect, useRef, useState } from "react";
import { renderPageToCanvas } from "../lib/pdf";
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
  pdfUrl, sourceIndex, pageWidth, pageHeight, width = 96, className, dimmed,
}: {
  pdfUrl: string;
  sourceIndex: number;
  pageWidth: number;
  pageHeight: number;
  width?: number;
  className?: string;
  dimmed?: boolean;
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

  useEffect(() => {
    if (!visible || !canvasRef.current) return;
    const signal = { cancelled: false };
    setReady(false);
    // Thumbnails render at 1x DPR; they're decorative and this halves the work.
    renderPageToCanvas(pdfUrl, sourceIndex, canvasRef.current, width / pageWidth, 1, signal)
      .then(() => { if (!signal.cancelled) setReady(true); })
      .catch(() => { /* a broken preview shouldn't break the list */ });
    return () => { signal.cancelled = true; };
  }, [visible, pdfUrl, sourceIndex, width, pageWidth]);

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
