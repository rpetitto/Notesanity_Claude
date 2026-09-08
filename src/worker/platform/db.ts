/**
 * The database handle the application code already expects.
 *
 * Fling's `db` was written to match Cloudflare D1's API, which is why this file
 * is so short: the binding *is* the implementation. Every `db.prepare(...)` in
 * the app keeps working untouched — the only thing added is resolving which
 * database, per request, so a shard can be chosen later without the 152 call
 * sites knowing anything changed.
 */

import { currentDb } from "./context";

export const db: D1Database = {
  prepare: (query: string) => currentDb().prepare(query),
  batch: (statements: D1PreparedStatement[]) => currentDb().batch(statements),
  exec: (query: string) => currentDb().exec(query),
  withSession: (constraint?: string) => currentDb().withSession(constraint),
  dump: () => currentDb().dump(),
} as D1Database;
