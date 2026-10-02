/**
 * The platform the application is written against.
 *
 * This exists so that leaving Fling costs the app almost nothing: every module
 * under `src/worker` imports `app`, `db`, `storage`, `migrate` and `cron` from
 * one place, and that place is now our own thin layer over native Cloudflare
 * bindings rather than a vendor runtime.
 *
 * The seam is worth keeping after the migration. It is where a request gets
 * pointed at one district's database instead of another's, and where a future
 * change of database would be absorbed — a swap here rather than an edit
 * across 152 call sites.
 */

import { Hono } from "hono";
import type { Bindings } from "./context";

export const app = new Hono<{ Bindings: Bindings; Variables: { requestId: string } }>();

export { db } from "./db";
export { storage } from "./storage";
export { migrate, runMigrations, registeredMigrations } from "./migrate";
export { cron, cronJobs, runScheduled } from "./cron";
export { runInScope, currentEnv, currentDb, currentScope } from "./context";
export type { Bindings, RequestScope } from "./context";
export type { StorageObject, StoragePutOptions } from "./storage";
export { auth } from "./auth";
export type { AuthUser, AuthAllowConfig } from "./auth";
