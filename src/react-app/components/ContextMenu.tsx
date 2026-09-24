/**
 * The right-click / long-press menu for things on a page.
 *
 * One host, mounted once, and a plain function to open it from anywhere: a page
 * row, a teacher's box in the editor, a stroke on a student's page. Every one
 * of those already has its own pointer handling, and a menu owned by each would
 * be five menus that look and close slightly differently.
 *
 * How it opens is the caller's business — `onContextMenu` for a mouse, and
 * `watchLongPress` below for a finger. The pen never opens it: a pen writes.
 * Nothing is only in this menu. It is a shortcut to what the side panel, the
 * toolbar and the keyboard already do, because a long-press is something
 * nobody discovers on their own.
 *
 * Tablets and computers get a menu at the point pressed; a phone gets a sheet
 * from the bottom, where the rows are big and in reach of a thumb.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Minus, Plus } from "lucide-react";
import { cn } from "../lib/utils";

export type ContextEntry =
  | {
      kind?: "item";
      label: string;
      icon?: ReactNode;
      onSelect: () => void;
      danger?: boolean;
      disabled?: boolean;
      /** Shown quietly at the right, e.g. "⌘D". Decoration: the keys work anyway. */
      shortcut?: string;
    }
  | { kind: "separator" }
  /** A quiet line of information, such as when a mark was made. */
  | { kind: "note"; text: string }
  | { kind: "swatches"; label: string; colors: string[]; current?: string; onPick: (color: string) => void }
  /** Smaller / bigger, kept open so a size can be nudged a few times. */
  | { kind: "stepper"; label: string; onSmaller: () => void; onBigger: () => void };

export interface ContextMenuSpec {
  /** Viewport coordinates of the press. */
  x: number;
  y: number;
  /** Names the thing the menu is about: "Text box", "Your note". */
  title?: string;
  entries: ContextEntry[];
}

type Listener = (spec: ContextMenuSpec | null) => void;
let listener: Listener | null = null;
let ringListener: ((at: { x: number; y: number } | null) => void) | null = null;

/** Open the menu. A second open replaces the first. */
export function openContextMenu(spec: ContextMenuSpec) {
  if (!spec.entries.length) return;
  listener?.(spec);
}

export function closeContextMenu() {
  listener?.(null);
}

/**
 * True just after a long-press opened a menu. The release it ends with isn't
 * also a tap, and the `contextmenu` Android fires for the same hold is the
 * same gesture, not a second request. Only a long-press counts: a quick second
 * right-click after closing a menu is a real one.
 */
export function longPressJustFired() {
  return Date.now() - firedAt < 700;
}

const LONG_PRESS_MS = 500;
const RING_AFTER_MS = 220;
const SLOP = 8;
let firedAt = 0;

/** A text control keeps the platform's own menu: copy and paste matter more there. */
export function isEditableTarget(el: EventTarget | null) {
  const node = el as HTMLElement | null;
  return !!node?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
}

/**
 * Watch a finger press for a hold.
 *
 * Only a finger: the caller filters out the cases where the finger is a pen
 * (finger drawing on) or a palm (a pen used a moment ago). Movement past a few
 * pixels, lifting, a second finger or the browser taking over to scroll all
 * cancel it. A ring grows under the finger partway through so the hold reads
 * as deliberate. When it fires, the click that follows the release is eaten.
 */
export function watchLongPress(e: { pointerType: string; isPrimary: boolean; clientX: number; clientY: number; pointerId: number; target: EventTarget | null }, fire: (x: number, y: number) => void) {
  if (e.pointerType !== "touch" || !e.isPrimary || isEditableTarget(e.target)) return;
  const x0 = e.clientX;
  const y0 = e.clientY;
  const id = e.pointerId;
  let done = false;

  const ring = window.setTimeout(() => ringListener?.({ x: x0, y: y0 }), RING_AFTER_MS);
  const timer = window.setTimeout(() => {
    cleanup();
    firedAt = Date.now();
    // Eat the click the release would otherwise produce: the hold was the whole gesture.
    const eat = (ev: Event) => { ev.preventDefault(); ev.stopPropagation(); };
    window.addEventListener("click", eat, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener("click", eat, { capture: true }), 800);
    navigator.vibrate?.(8);
    fire(x0, y0);
  }, LONG_PRESS_MS);

  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > SLOP) cleanup();
  };
  const onEnd = (ev: PointerEvent) => { if (ev.pointerId === id) cleanup(); };
  const onOther = (ev: PointerEvent) => { if (ev.pointerId !== id) cleanup(); };

  function cleanup() {
    if (done) return;
    done = true;
    window.clearTimeout(timer);
    window.clearTimeout(ring);
    ringListener?.(null);
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onEnd, true);
    window.removeEventListener("pointercancel", onEnd, true);
    window.removeEventListener("pointerdown", onOther, true);
  }
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onEnd, true);
  window.addEventListener("pointercancel", onEnd, true);
  window.addEventListener("pointerdown", onOther, true);
}

/** Where to open a menu for an element that has no pointer position — a "…" button, Shift+F10. */
export function pointFor(el: Element | null): { x: number; y: number } {
  const r = el?.getBoundingClientRect();
  return r ? { x: r.left + Math.min(r.width, 24), y: r.bottom } : { x: 24, y: 24 };
}

/** ⌘ on Apple keyboards, Ctrl elsewhere — for the shortcut hints only. */
export const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

const FOCUSABLE = "[data-menu-focus]";

export function ContextMenuHost() {
  const [spec, setSpec] = useState<ContextMenuSpec | null>(null);
  const [ring, setRing] = useState<{ x: number; y: number } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [sheet, setSheet] = useState(false);

  useEffect(() => {
    listener = (next) => {
      if (next) returnFocus.current = document.activeElement as HTMLElement | null;
      setPos(null);
      setSheet(window.innerWidth < 640);
      setSpec(next);
    };
    ringListener = setRing;
    return () => { listener = null; ringListener = null; };
  }, []);

  const close = useCallback(() => {
    setSpec(null);
    const back = returnFocus.current;
    returnFocus.current = null;
    if (back && document.contains(back)) back.focus?.({ preventScroll: true });
  }, []);

  // Measured after it renders, so it can open up or left when there's no room.
  useLayoutEffect(() => {
    if (!spec || sheet || !panel.current) return;
    const r = panel.current.getBoundingClientRect();
    const pad = 8;
    let left = spec.x;
    let top = spec.y;
    if (left + r.width > window.innerWidth - pad) left = Math.max(pad, spec.x - r.width);
    if (top + r.height > window.innerHeight - pad) top = Math.max(pad, spec.y - r.height);
    setPos({ left, top });
  }, [spec, sheet]);

  useEffect(() => {
    if (!spec) return;
    const first = panel.current?.querySelector<HTMLElement>(`${FOCUSABLE}:not([disabled])`);
    first?.focus({ preventScroll: true });
    const onDown = (e: PointerEvent) => {
      if (panel.current?.contains(e.target as Node)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      const items = Array.from(panel.current?.querySelectorAll<HTMLElement>(`${FOCUSABLE}:not([disabled])`) ?? []);
      const at = items.indexOf(document.activeElement as HTMLElement);
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); items[(at + 1) % items.length]?.focus(); }
      else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); items[(at - 1 + items.length) % items.length]?.focus(); }
      else if (e.key === "Home") { e.preventDefault(); items[0]?.focus(); }
      else if (e.key === "End") { e.preventDefault(); items[items.length - 1]?.focus(); }
      else if (e.key === "Tab") { e.preventDefault(); items[(at + (e.shiftKey ? -1 : 1) + items.length) % items.length]?.focus(); }
    };
    // The menu belongs to a spot on the page; scrolling moves the spot.
    const onScroll = (e: Event) => { if (!sheet && !panel.current?.contains(e.target as Node)) close(); };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [spec, sheet, close]);

  const run = (fn: () => void, keepOpen = false) => () => {
    if (!keepOpen) close();
    fn();
  };

  const body = spec && (
    <>
      {spec.title && (
        <p className="px-4 pb-1 pt-3 font-display text-[16px] font-bold text-pine/60">{spec.title}</p>
      )}
      {spec.entries.map((entry, i) => {
        if (entry.kind === "separator") return <div key={i} className="my-1 border-t-2 border-pine/10" role="separator" />;
        if (entry.kind === "note") {
          return <p key={i} className="px-4 py-2 text-[16px] leading-snug text-pine/65">{entry.text}</p>;
        }
        if (entry.kind === "swatches") {
          return (
            <div key={i} className="px-4 py-2" role="group" aria-label={entry.label}>
              <p className="mb-1.5 text-[16px] text-pine/65">{entry.label}</p>
              <div className="flex flex-wrap gap-2">
                {entry.colors.map((c) => (
                  <button
                    key={c}
                    type="button"
                    data-menu-focus
                    role="menuitemradio"
                    aria-checked={entry.current?.toLowerCase() === c.toLowerCase()}
                    aria-label={`Color ${c}`}
                    onClick={run(() => entry.onPick(c))}
                    className={cn(
                      "h-11 w-11 rounded-full border-[3px] border-white outline-none ring-2 ring-pine/20 focus-visible:ring-[3px] focus-visible:ring-mint",
                      entry.current?.toLowerCase() === c.toLowerCase() && "ring-[3px] ring-pine",
                    )}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
          );
        }
        if (entry.kind === "stepper") {
          return (
            <div key={i} className="flex items-center justify-between gap-3 px-4 py-1.5">
              <span className="font-display text-[17px] font-bold text-pine">{entry.label}</span>
              <span className="flex gap-1.5">
                <button type="button" data-menu-focus aria-label={`${entry.label}: smaller`} onClick={run(entry.onSmaller, true)}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border-2 border-pine/25 text-pine hover:bg-oat focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-mint">
                  <Minus className="h-4 w-4" strokeWidth={2.5} />
                </button>
                <button type="button" data-menu-focus aria-label={`${entry.label}: bigger`} onClick={run(entry.onBigger, true)}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border-2 border-pine/25 text-pine hover:bg-oat focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-mint">
                  <Plus className="h-4 w-4" strokeWidth={2.5} />
                </button>
              </span>
            </div>
          );
        }
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            data-menu-focus
            disabled={entry.disabled}
            onClick={run(entry.onSelect)}
            className={cn(
              "flex min-h-[48px] w-full items-center gap-2.5 px-4 py-2.5 text-left outline-none transition-colors",
              "disabled:pointer-events-none disabled:opacity-45",
              entry.danger
                ? "text-[#a3341f] hover:bg-[#a3341f]/8 focus-visible:bg-[#a3341f]/8"
                : "text-pine hover:bg-oat focus-visible:bg-oat",
            )}
          >
            {entry.icon && <span className="shrink-0 [&>svg]:h-5 [&>svg]:w-5">{entry.icon}</span>}
            <span className="min-w-0 flex-1 font-display text-[17px] font-bold">{entry.label}</span>
            {entry.shortcut && <span className="shrink-0 text-[15px] text-pine/45">{entry.shortcut}</span>}
          </button>
        );
      })}
    </>
  );

  return createPortal(
    <>
      {ring && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[70] h-14 w-14 -translate-x-1/2 -translate-y-1/2 animate-[nsy-press_280ms_ease-out_forwards] rounded-full border-[3px] border-mint"
          style={{ left: ring.x, top: ring.y }}
        />
      )}
      {spec && (sheet ? (
        <div className="fixed inset-0 z-[70] flex items-end">
          <div className="absolute inset-0 bg-pine/40" onClick={close} aria-hidden />
          <div
            ref={panel}
            role="menu"
            aria-label={spec.title ?? "Actions"}
            className="relative max-h-[80vh] w-full overflow-y-auto rounded-t-[22px] border-[3px] border-pine bg-white pb-2 shadow-xl"
            style={{ paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom))" }}
          >
            <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-pine/20" aria-hidden />
            {body}
          </div>
        </div>
      ) : (
        <div
          ref={panel}
          role="menu"
          aria-label={spec.title ?? "Actions"}
          onContextMenu={(e) => e.preventDefault()}
          className="fixed z-[70] w-[264px] overflow-hidden rounded-[16px] border-[3px] border-pine bg-white py-1 shadow-[4px_4px_0_0_var(--color-pine)]"
          style={{ left: pos?.left ?? spec.x, top: pos?.top ?? spec.y, visibility: pos ? "visible" : "hidden" }}
        >
          {body}
        </div>
      ))}
    </>,
    document.body,
  );
}
