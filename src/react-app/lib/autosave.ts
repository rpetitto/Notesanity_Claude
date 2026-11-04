/**
 * Resilient autosave.
 *
 * School Wi-Fi drops constantly, so a save is never allowed to be the only copy of
 * a student's work. Every change is mirrored into localStorage the moment it
 * happens; the network write is debounced behind it and retried with backoff until
 * it lands. Only then is the local mirror cleared.
 *
 * On iOS Safari `beforeunload` is unreliable, so the flush is driven by
 * `visibilitychange` and `pagehide`, which do fire when the user switches apps.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type SaveStatus = "idle" | "saving" | "saved" | "offline" | "retrying";

interface Options<T> {
  /** Stable identity for the local mirror. */
  key: string;
  /** Performs the network write. Should throw on failure. */
  save: (value: T) => Promise<void>;
  debounceMs?: number;
  enabled?: boolean;
}

const BACKOFF = [1000, 2000, 4000, 8000, 15000, 30000];

export function useAutosave<T>({ key, save, debounceMs = 1200, enabled = true }: Options<T>) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const pending = useRef<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attempt = useRef(0);
  const inFlight = useRef(false);
  const saveRef = useRef(save);
  saveRef.current = save;

  const flush = useCallback(async () => {
    if (!enabled || inFlight.current || pending.current === null) return;
    const value = pending.current;
    inFlight.current = true;
    setStatus("saving");
    /** When to try again: a backoff after a failure, or a debounce for work that arrived mid-flight. */
    let retryIn: number | null = null;
    try {
      await saveRef.current(value);
      // Only drop the local mirror once the server has definitely accepted it,
      // and only if nothing newer arrived while the request was in flight.
      if (pending.current === value) {
        pending.current = null;
        try { localStorage.removeItem(key); } catch { /* private mode */ }
        setStatus("saved");
      }
      attempt.current = 0;
    } catch (err) {
      // "Offline" is a claim about the network, so only make it when the
      // request never reached a server. A refusal that came back with a status
      // is a different problem, and saying otherwise sent people to check their
      // Wi-Fi over a conflict the app was failing to resolve.
      const reachedServer = typeof (err as { status?: unknown } | null)?.status === "number";
      setStatus(reachedServer || navigator.onLine ? "retrying" : "offline");
      retryIn = BACKOFF[Math.min(attempt.current, BACKOFF.length - 1)];
      attempt.current++;
    } finally {
      inFlight.current = false;
      /**
       * Anything queued while this request was in flight lost its wake-up to
       * the guard at the top — the debounce fired, found a save running, and
       * returned without booking another. Nothing then sent it until the next
       * stroke happened to arrive, and if none did the work was simply never
       * saved. This is that missing wake-up.
       */
      if (retryIn === null && pending.current !== null) retryIn = debounceMs;
      if (retryIn !== null) {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => { void flush(); }, retryIn);
      }
    }
  }, [enabled, key, debounceMs]);

  const queue = useCallback(
    (value: T) => {
      if (!enabled) return;
      pending.current = value;
      try {
        localStorage.setItem(key, JSON.stringify({ at: Date.now(), value }));
      } catch { /* quota or private mode — the network path still runs */ }
      setStatus("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { void flush(); }, debounceMs);
    },
    [enabled, key, debounceMs, flush],
  );

  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden" && pending.current !== null) void flush();
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onHidden);
    const onOnline = () => { if (pending.current !== null) void flush(); };
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onHidden);
      window.removeEventListener("online", onOnline);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [flush]);

  const hasUnsaved = () => pending.current !== null;

  return { status, queue, flush, hasUnsaved };
}

/** Recover work that never made it to the server before the tab died. */
export function readLocalMirror<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return (JSON.parse(raw) as { value: T }).value;
  } catch {
    return null;
  }
}

export function clearLocalMirror(key: string) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}
