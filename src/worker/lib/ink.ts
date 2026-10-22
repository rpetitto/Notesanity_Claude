/**
 * Where a page's ink actually lives.
 *
 * The strokes themselves are objects in R2; D1 keeps only the `layers` row that
 * describes them — `rev`, `updated_at`, and `byte_length`. That split is the
 * whole point. D1 has a hard 10 GB per-database ceiling and ink is the only
 * thing in this app that grows without bound, so the payload had to leave; but
 * three queries aggregate over ink across hundreds of rows at once (which
 * students have started, how many pages they've worked, when they last did) and
 * those cannot be asked of object storage at any price. Keeping the row and
 * evicting only the blob is what lets both be true.
 *
 * One object per layer, and no chunking. Chunking existed because rewriting a
 * hundred-kilobyte D1 row on every stroke was expensive; R2 has no such penalty,
 * and a Worker gets only six simultaneous connections, so splitting a page
 * across several objects would multiply the cost of the read path — the exact
 * thing that most needed protecting.
 */

import { storage } from "../platform";

/**
 * An empty layer serializes to 35 characters, so the "has anyone written here"
 * threshold has to clear that. It used to be 24, which meant a page drawn on
 * and then erased still counted as started.
 */
export const HAS_INK_BYTES = 40;

/** Generous for real handwriting; stops a runaway client. */
export const MAX_LAYER_BYTES = 512 * 1024;

/** Six simultaneous connections per invocation is a hard runtime limit, not a tuning knob. */
const READ_CONCURRENCY = 6;

export interface LayerShape { v: 1; s: any[]; x: any[]; e: any[]; c: any[] }

/**
 * What's actually stored: the shape plus the revision it represents. The `rev`
 * here is not the authority — D1's is — it's a repair marker, so a retry after
 * a half-completed save can tell "the object already has these strokes" from
 * "append them again".
 */
export interface StoredLayer extends LayerShape { rev: number }

export const emptyShape = (): LayerShape => ({ v: 1, s: [], x: [], e: [], c: [] });

export function parseShape(raw?: string | null): LayerShape {
  if (!raw) return emptyShape();
  try {
    const p = JSON.parse(raw);
    return {
      v: 1,
      s: Array.isArray(p.s) ? p.s : [],
      x: Array.isArray(p.x) ? p.x : [],
      e: Array.isArray(p.e) ? p.e : [],
      c: Array.isArray(p.c) ? p.c : [],
    };
  } catch {
    return emptyShape();
  }
}

export const isEmptyShape = (s: LayerShape): boolean =>
  s.s.length === 0 && s.x.length === 0 && s.e.length === 0 && s.c.length === 0;

/**
 * Derived, never stored. Every call site already holds all four parts, so a key
 * column would be bytes in the one table we're trying to keep small — and the
 * notebook root lets a delete sweep a whole notebook by prefix.
 */
export function inkKey(notebookId: string, instanceId: string, pageId: string, kind: string): string {
  return `notebooks/${notebookId}/ink/${instanceId}/${pageId}-${kind}.json`;
}

/**
 * Read one layer's strokes.
 *
 * `null` means no object exists — a layer that was never written, or one still
 * waiting on the backfill. A failure to *reach* R2 throws instead, and must:
 * treating a transient error as "no ink" would show a student an empty page and
 * then let them save over what was really there.
 */
export async function readInk(key: string): Promise<StoredLayer | null> {
  const obj = await storage.get(key);
  if (!obj) return null;
  const parsed = JSON.parse(await obj.text());
  return { ...parseShape(JSON.stringify(parsed)), rev: typeof parsed.rev === "number" ? parsed.rev : 0 };
}

/**
 * Write one layer's strokes, returning the stored byte length for the D1 row.
 *
 * An empty layer stores nothing and reports zero — erasing a page all the way
 * back to blank should leave no object behind and should not read as "started".
 */
export async function writeInk(key: string, shape: LayerShape, rev: number): Promise<number> {
  if (isEmptyShape(shape)) {
    await storage.delete(key);
    return 0;
  }
  const body = JSON.stringify({ ...shape, rev });
  await storage.put(key, body, { contentType: "application/json" });
  return body.length;
}

/**
 * Read many layers at once, six at a time because that's all the runtime will
 * open. Keyed by the key you asked for; a missing object maps to null.
 *
 * Deliberately not tolerant of partial failure — one unreachable object fails
 * the whole read, for the same reason `readInk` throws.
 */
export async function readInkMany(keys: string[]): Promise<Map<string, StoredLayer | null>> {
  const out = new Map<string, StoredLayer | null>();
  for (let i = 0; i < keys.length; i += READ_CONCURRENCY) {
    const batch = keys.slice(i, i + READ_CONCURRENCY);
    const got = await Promise.all(batch.map((k) => readInk(k)));
    batch.forEach((k, j) => out.set(k, got[j]));
  }
  return out;
}

export async function deleteInk(keys: string[]): Promise<void> {
  if (keys.length) await storage.deleteMany(keys);
}
