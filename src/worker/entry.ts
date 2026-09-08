/**
 * The Worker itself.
 *
 * Everything the application registers — routes, migrations, the cron job —
 * is declared as a side effect of importing `./index`, exactly as it was under
 * Fling. This file is only responsible for the three things the platform used
 * to do for us: put the request's bindings in scope, make sure the database is
 * migrated before anything queries it, and answer scheduled invocations.
 */

import { app, runInScope, runMigrations, runScheduled, type Bindings } from "./platform";
import "./index";

/**
 * Which database serves this request.
 *
 * One today. The point of asking the question here is that when districts get
 * their own databases, this is the only function that changes — the app keeps
 * calling `db.prepare` and never learns which shard answered.
 */
function databaseFor(env: Bindings, _request: Request): D1Database {
  return env.DB;
}

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    return runInScope({ env, ctx, db: databaseFor(env, request) }, async () => {
      await runMigrations();
      return app.fetch(request, env, ctx);
    });
  },

  async scheduled(event: ScheduledController, env: Bindings, ctx: ExecutionContext): Promise<void> {
    await runInScope({ env, ctx, db: env.DB }, async () => {
      await runMigrations();
      const results = await runScheduled(event.cron);
      for (const r of results) {
        if (!r.ok) console.error(`cron ${r.name} failed: ${r.error}`);
      }
    });
  },
};
