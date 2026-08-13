import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Defers mounting a page until it's near the viewport.
 *
 * A notebook can be dozens of PDF pages; rendering them all at once would stall a
 * cheap Chromebook. The placeholder keeps the exact page dimensions so scroll
 * position never jumps as pages swap in.
 */
export default function LazyPage({
  width, height, children, rootMargin = "800px",
}: {
  width: number;
  height: number;
  children: ReactNode;
  rootMargin?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
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
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible, rootMargin]);

  return (
    <div ref={ref} style={{ width, height }} className="relative">
      {visible ? children : <div className="h-full w-full rounded-sm bg-white shadow-sm" />}
    </div>
  );
}
