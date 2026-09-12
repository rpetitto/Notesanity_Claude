/**
 * Which bindings the code currently running should use.
 *
 * Fling handed out `db` and `storage` as module-level singletons, but on
 * Workers the bindings arrive per request on `env`. An async-local store is
 * what bridges the two, and it is deliberately not a plain module variable:
 * one isolate serves many requests at once, and once a district gets its own
 * database (Cloudflare's recommended shape for multi-tenancy, and the reason
 * this seam exists at all) two in-flight requests will genuinely need
 * different bindings. A shared variable would hand one district's query to
 * another district's database, which is the one bug this design must make
 * impossible.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface Bindings {
  DB: D1Database;
  BUCKET: R2Bucket;
  [key: string]: unknown;
}

export interface RequestScope {
  env: Bindings;
  ctx: ExecutionContext;
  /** The database this request works against — the shard, once sharded. */
  db: D1Database;
}

const store = new AsyncLocalStorage<RequestScope>();

export function runInScope<T>(scope: RequestScope, fn: () => T): T {
  return store.run(scope, fn);
}

export function currentScope(): RequestScope {
  const scope = store.getStore();
  if (!scope) {
    throw new Error(
      "No request scope. Platform primitives can only be used inside a request, " +
        "a scheduled run, or a migration — not at module load time.",
    );
  }
  return scope;
}

export const currentEnv = () => currentScope().env;
export const currentDb = () => currentScope().db;
