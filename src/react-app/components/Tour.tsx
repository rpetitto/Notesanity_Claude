/**
 * The guided tour: a spotlight on one control at a time, with a card beside it.
 *
 * Three decisions worth knowing about before changing this.
 *
 * **It points at the real thing.** Steps name a `data-tour` attribute and the
 * ring is drawn around whatever that attribute is on, measured live. Nothing
 * here knows a layout, so a control that moves stays pointed at, and one that
 * isn't on screen — a button that collapses into a menu on a phone, an import
 * button hidden because Google isn't configured — takes its step with it
 * rather than leaving the ring around empty space.
 *
 * **It blocks the page while it runs.** The tempting alternative is to let
 * people press the highlighted button, but then the tour is narrating a screen
 * that has moved on underneath it. Blocking makes it a thing you read and
 * finish, and it finishes in half a minute.
 *
 * **It records the ending, not the appearance.** Finishing and skipping are
 * both written to the same row, so a tour never comes back either way; the
 * difference is kept because "everyone skips at step three" is the only signal
 * that step three is wrong. The write is fire-and-forget and the local session
 * cache is updated straight away — a guide that reappears because a request
 * failed is worse than one that never comes back.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { TOURS, tourKey, type TourPlace, type TourStep } from "../lib/tours";
import { Button } from "./ui";

/** Breathing room between the ring and the control it surrounds. */
const PAD = 8;
const CARD_W = 340;
const GAP = 14;

interface Box { top: number; left: number; width: number; height: number }

const reduceMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * The element a step points at, or null.
 *
 * Visibility is part of being found: `hidden sm:flex` leaves the element in the
 * DOM at zero size on a phone, and a ring around a zero-size box is a ring
 * around the top-left corner of the screen.
 */
function resolve(target: TourStep["target"]): HTMLElement | null {
  if (!target) return null;
  for (const name of Array.isArray(target) ? target : [target]) {
    const el = document.querySelector<HTMLElement>(`[data-tour="${name}"]`);
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
  }
  return null;
}

const boxOf = (el: HTMLElement): Box => {
  const r = el.getBoundingClientRect();
  return {
    top: Math.max(4, r.top - PAD),
    left: Math.max(4, r.left - PAD),
    width: Math.min(window.innerWidth - 8, r.width + PAD * 2),
    height: r.height + PAD * 2,
  };
};

const same = (a: Box | null, b: Box | null) =>
  !!a && !!b && Math.abs(a.top - b.top) < 1 && Math.abs(a.left - b.left) < 1 &&
  Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;

export default function Tour({ place }: { place: TourPlace }) {
  const { user } = useSession();
  const qc = useQueryClient();
  const key = tourKey(user?.role, place);
  const seen = user?.toursSeen ?? [];
  const steps = key ? TOURS[key] : undefined;

  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [ready, setReady] = useState(false);
  const [closed, setClosed] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const dir = useRef<1 | -1>(1);
  // The card's own height, measured rather than guessed: it decides whether
  // there is room below the ring, and the steps are not all the same length.
  const [cardH, setCardH] = useState(200);

  const eligible = !!key && !!steps && !seen.includes(key) && !closed;

  /**
   * Wait for the screen to finish arriving before starting.
   *
   * Every one of these screens paints a spinner first and its controls a
   * moment later, so starting on mount would put the opening card over an
   * empty page and then ring a button that had moved. This waits for the first
   * step that has something to point at, and gives up quietly after a few
   * seconds — a tour that never starts is a much smaller problem than one that
   * points at the wrong thing.
   */
  useEffect(() => {
    if (!eligible || ready) return;
    let tries = 0;
    const tick = () => {
      if (steps!.some((s) => !s.target || resolve(s.target))) {
        setReady(true);
        return;
      }
      if (++tries > 40) return; // ~6s
      timer = window.setTimeout(tick, 150);
    };
    let timer = window.setTimeout(tick, 250);
    return () => window.clearTimeout(timer);
  }, [eligible, ready, steps]);

  const finish = useCallback(
    (status: "completed" | "dismissed") => {
      setClosed(true);
      if (!key) return;
      // Update the session in place first: the row is the record, but the tour
      // must not come back on the next navigation if the write is slow or lost.
      qc.setQueryData(["me"], (old: any) =>
        old?.user ? { ...old, user: { ...old.user, toursSeen: [...(old.user.toursSeen ?? []), key] } } : old,
      );
      void api.post("/api/me/tours", { tour: key, status, step: index }).catch(() => {
        /* Recorded locally; it will be re-sent as a fresh tour next session. */
      });
    },
    [index, key, qc],
  );

  const step = steps?.[index];

  /** Skip past steps whose control isn't on this screen, in whichever direction we're going. */
  useEffect(() => {
    if (!eligible || !ready || !steps) return;
    if (!step) return;
    if (!step.target || resolve(step.target)) return;
    const next = index + dir.current;
    if (next < 0 || next >= steps.length) finish("completed");
    else setIndex(next);
  }, [eligible, ready, steps, step, index, finish]);

  /** Bring the target into view, then track it for as long as the step is up. */
  useLayoutEffect(() => {
    if (!eligible || !ready || !step) return;
    const el = resolve(step.target);
    if (!el) {
      setBox(null);
      return;
    }
    el.scrollIntoView({ block: "center", inline: "nearest", behavior: reduceMotion() ? "auto" : "smooth" });

    // A frame loop rather than scroll and resize listeners: the things that
    // move a control here are smooth scrolling, a drawer opening and a font
    // landing, and only one of those fires an event we could listen for.
    let raf = 0;
    let current: Box | null = null;
    const track = () => {
      const found = resolve(step.target);
      const next = found ? boxOf(found) : null;
      if (!same(next, current)) {
        current = next;
        setBox(next);
      }
      raf = requestAnimationFrame(track);
    };
    track();
    return () => cancelAnimationFrame(raf);
  }, [eligible, ready, step]);

  const go = useCallback(
    (delta: 1 | -1) => {
      if (!steps) return;
      dir.current = delta;
      const next = index + delta;
      if (next >= steps.length) finish("completed");
      else if (next >= 0) setIndex(next);
    },
    [index, steps, finish],
  );

  useEffect(() => {
    if (!eligible || !ready) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); finish("dismissed"); }
      else if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); go(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [eligible, ready, finish, go]);

  useEffect(() => {
    if (eligible && ready) cardRef.current?.focus();
  }, [eligible, ready, index]);

  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight;
    if (h && Math.abs(h - cardH) > 2) setCardH(h);
  });

  if (!eligible || !ready || !steps || !step) return null;

  const last = index === steps.length - 1;
  const card = cardPosition(box, cardH);

  return createPortal(
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {/* Catches every press, so the page underneath can't move while it's narrated. */}
      <div className="absolute inset-0" />

      {box ? (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-[16px] ring-[3px] ring-mint transition-[top,left,width,height] duration-200 motion-reduce:transition-none"
          style={{
            top: box.top,
            left: box.left,
            width: box.width,
            height: box.height,
            boxShadow: "0 0 0 9999px rgba(32,48,44,.55)",
          }}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-pine/55" />
      )}

      <div
        ref={cardRef}
        tabIndex={-1}
        className="absolute w-[min(340px,calc(100vw-24px))] rounded-[22px] border-[3px] border-pine bg-white p-5 shadow-[6px_6px_0_0_var(--color-pine)] outline-none"
        style={card}
      >
        <div className="label-caps mb-1.5 text-pine/60">
          Step {index + 1} of {steps.length}
        </div>
        <h2 id="tour-title" className="font-display text-[20px] leading-tight text-pine">
          {step.title}
        </h2>
        <p className="mt-2 text-[16px] leading-snug text-pine/80">{step.body}</p>

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => finish("dismissed")}
            className="rounded-full px-2 py-1 text-[16px] font-bold text-pine/60 underline decoration-2 underline-offset-4 hover:text-pine"
          >
            Skip
          </button>
          <div className="ml-auto flex items-center gap-2">
            {index > 0 && (
              <Button size="sm" variant="secondary" onClick={() => go(-1)}>
                Back
              </Button>
            )}
            <Button size="sm" variant="primary" onClick={() => go(1)}>
              {last ? "Got it" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Where the card goes: below the ring, above it if there's no room below, and
 * centered when the step has nothing to point at. Clamped to the viewport in
 * both directions, because a card that runs off a phone screen takes the
 * "Next" button with it.
 */
function cardPosition(box: Box | null, h: number): { top: number; left: number } {
  const w = Math.min(CARD_W, window.innerWidth - 24);
  if (!box) {
    return {
      top: Math.max(12, window.innerHeight / 2 - h / 2),
      left: Math.max(12, window.innerWidth / 2 - w / 2),
    };
  }
  const below = box.top + box.height + GAP;
  const above = box.top - GAP - h;
  // Neither side fits when the ring is around something taller than the screen
  // — a whole section of the class page, say. Pinning it to the bottom keeps
  // the buttons reachable, which matters more than not overlapping.
  const top = below + h < window.innerHeight - 12
    ? below
    : above > 12
      ? above
      : window.innerHeight - h - 12;
  const left = Math.min(
    Math.max(12, box.left + box.width / 2 - w / 2),
    window.innerWidth - w - 12,
  );
  return { top, left };
}
