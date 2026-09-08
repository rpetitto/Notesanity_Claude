/**
 * Migrations, registered at import time and run once per database.
 *
 * The 17 existing `migrate(...)` calls declare themselves as a side effect of
 * importing `schema.ts`, so registration has to work with no database in
 * scope — it only records the handler. Running them is a separate, explicit
 * step, which is what makes a database-per-district workable: the same list
 * gets applied to each new shard on its first request.
 *
 * `_migrations` keeps the same name and shape Fling used, so a database
 * carried over from Fling already knows which of these have run and will not
 * replay them over live data.
 */

import { currentDb } from "./context";

interface Migration {
  name: string;
  handler: () => Promise<void>;
}

const migrations: Migration[] = [];

export function migrate(name: string, handler: () => Promise<void>) {
  if (migrations.some((m) => m.name === name)) {
    throw new Error(`Duplicate migration name: ${name}`);
  }
  migrations.push({ name, handler });
}

/**
 * Databases already brought up to date in this isolate.
 *
 * Checking costs a query, and an isolate serves many requests; remembering
 * which handles are current keeps that to once per database per isolate rather
 * than once per request.
 */
const ready = new WeakSet<D1Database>();

export async function runMigrations(): Promise<{ applied: string[] }> {
  const db = currentDb();
  if (ready.has(db)) return { applied: [] };

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS _migrations (
         name TEXT PRIMARY KEY,
         applied_at TEXT NOT NULL DEFAULT (datetime('now'))
       )`,
    )
    .run();

  const done = await db.prepare(`SELECT name FROM _migrations`).all<{ name: string }>();
  const already = new Set((done.results ?? []).map((r) => r.name));

  // Alphabetical, matching what Fling did, so a half-migrated database picks up
  // exactly where it left off rather than in registration order.
  const pending = migrations
    .filter((m) => !already.has(m.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  const applied: string[] = [];
  for (const m of pending) {
    await m.handler();
    await db.prepare(`INSERT INTO _migrations (name) VALUES (?)`).bind(m.name).run();
    applied.push(m.name);
  }

  ready.add(db);
  return { applied };
}

/** Exposed for the migration tooling, which reports what would run. */
export const registeredMigrations = () => migrations.map((m) => m.name);
