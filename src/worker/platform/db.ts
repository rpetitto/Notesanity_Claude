/**
 * The database handle the application code already expects.
 *
 * Fling's `db` was written to match Cloudflare D1's API, which is why this file
 * is so short: the binding *is* the implementation. Every `db.prepare(...)` in
 * the app keeps working untouched — the only thing added is resolving which
 * database, per request, so a shard can be chosen later without the 152 call
 * sites knowing anything changed.
 */

import { currentDb, currentScope } from "./context";

/**
 * Count each trip to the database against the request making it.
 *
 * D1 runs one query at a time per database, so a request's round trips are
 * both its own latency and time every other request waits. The count goes out
 * on the response as Server-Timing, where a route that has crept back into a
 * query-per-row loop shows up in the browser's network panel.
 */
const tick = () => {
  const scope = currentScope();
  scope.trips = (scope.trips ?? 0) + 1;
};

const raw = new WeakMap<object, D1PreparedStatement>();

function counted(stmt: D1PreparedStatement): D1PreparedStatement {
  const proxy = new Proxy(stmt, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      if (prop === "bind") return (...args: unknown[]) => counted(value.apply(target, args));
      if (prop === "first" || prop === "all" || prop === "run" || prop === "raw") {
        return (...args: unknown[]) => { tick(); return value.apply(target, args); };
      }
      return value.bind(target);
    },
  });
  raw.set(proxy, stmt);
  return proxy;
}

/** The binding's own statement behind a counted one — `batch` must be handed those. */
const unwrap = (stmt: D1PreparedStatement) => raw.get(stmt) ?? stmt;

export const db: D1Database = {
  prepare: (query: string) => counted(currentDb().prepare(query)),
  batch: (statements: D1PreparedStatement[]) => { tick(); return currentDb().batch(statements.map(unwrap)); },
  exec: (query: string) => currentDb().exec(query),
  withSession: (constraint?: string) => currentDb().withSession(constraint),
  dump: () => currentDb().dump(),
} as D1Database;
