/**
 * Two fingers on the page zoom the page, not the app.
 *
 * On a phone, a pinch is the browser's gesture by default and it scales the
 * whole viewport — header, toolbar and all — which is the wrong thing for a
 * notebook: what someone wants closer is the page under their fingers. So the
 * app gives up viewport zoom (see main.tsx and index.html) and this hook
 * takes the gesture instead, driving the same zoom multiplier the toolbar's
 * zoom menu sets. The point under the fingers stays put: the container's
 * scroll position is corrected as the content grows around it, applied after
 * React has rendered the new size so there's nothing to fight.
 *
 * `zoom` is the multiplier of fit-width that the screens already use, so a
 * pinch and the menu speak the same units and neither surprises the other.
 */

import { useLayoutEffect, useRef, type RefObject } from "react";

interface Options {
  min?: number;
  max?: number;
  /** False on a read-only or unwired surface: the gesture is left alone. */
  enabled?: boolean;
}

export function usePinchZoom(
  ref: RefObject<HTMLElement | null>,
  zoom: number,
  onZoom: (zoom: number) => void,
  { min = 0.25, max = 3, enabled = true }: Options = {},
) {
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const onZoomRef = useRef(onZoom);
  onZoomRef.current = onZoom;

  const pinch = useRef<{
    startDist: number;
    startZoom: number;
    /** The content point under the fingers, in zoom-independent units. */
    ax: number;
    ay: number;
  } | null>(null);
  /** Where to scroll once the new size is on screen, and for which zoom. */
  const pending = useRef<{ x: number; y: number; zoom: number } | null>(null);
  const frame = useRef(0);
  /**
   * The element the listeners are on. Checked every render rather than once:
   * on most screens the scroll container only exists after the notebook has
   * loaded, so a hook that looked at the ref on mount would find nothing and
   * never look again.
   */
  const attached = useRef<HTMLElement | null>(null);
  const detach = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    const el = enabled ? ref.current : null;
    if (el === attached.current) return;
    detach.current();
    attached.current = el;
    if (!el) { detach.current = () => {}; return; }

    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const mid = (t: TouchList) => {
      const r = el.getBoundingClientRect();
      return { x: (t[0].clientX + t[1].clientX) / 2 - r.left, y: (t[0].clientY + t[1].clientY) / 2 - r.top };
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      const m = mid(e.touches);
      const z = zoomRef.current;
      pinch.current = {
        startDist: dist(e.touches),
        startZoom: z,
        ax: (el.scrollLeft + m.x) / z,
        ay: (el.scrollTop + m.y) / z,
      };
    };
    const onMove = (e: TouchEvent) => {
      const p = pinch.current;
      if (!p || e.touches.length !== 2) return;
      e.preventDefault();
      const z = Math.min(max, Math.max(min, p.startZoom * (dist(e.touches) / p.startDist)));
      const m = mid(e.touches);
      pending.current = { x: p.ax * z - m.x, y: p.ay * z - m.y, zoom: z };
      // One state update per frame, however many touch samples arrive.
      if (!frame.current) {
        frame.current = requestAnimationFrame(() => {
          frame.current = 0;
          const next = pending.current;
          if (next) onZoomRef.current(next.zoom);
        });
      }
    };
    const onEnd = (e: TouchEvent) => { if (e.touches.length < 2) pinch.current = null; };
    const swallow = (e: Event) => e.preventDefault();

    el.addEventListener("touchstart", onStart, { passive: false });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    // Safari's own pinch events, which fire regardless of touch-action.
    el.addEventListener("gesturestart", swallow);
    el.addEventListener("gesturechange", swallow);
    detach.current = () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
      el.removeEventListener("gesturestart", swallow);
      el.removeEventListener("gesturechange", swallow);
      if (frame.current) { cancelAnimationFrame(frame.current); frame.current = 0; }
    };
  });

  // On unmount, let go of whatever is attached.
  useLayoutEffect(() => () => { detach.current(); attached.current = null; }, []);

  // The size has changed on screen: put the anchored point back under the fingers.
  useLayoutEffect(() => {
    const el = ref.current;
    const next = pending.current;
    if (!el || !next || Math.abs(next.zoom - zoom) > 1e-6) return;
    el.scrollLeft = next.x;
    el.scrollTop = next.y;
    pending.current = null;
  }, [ref, zoom]);
}
