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

export type SaveStatus = "idle" | "saving" | "saved" | "offline";

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
    } catch {
      setStatus("offline");
      const delay = BACKOFF[Math.min(attempt.current, BACKOFF.length - 1)];
      attempt.current++;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { void flush(); }, delay);
    } finally {
      inFlight.current = false;
    }
  }, [enabled, key]);

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
