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
 * What `/` should be.
 *
 * The marketing site and the app share a domain, so the root has two jobs: it
 * is the front door for someone who has never seen Notesanity, and the way in
 * for someone who uses it every day. Deciding here, at the edge, means a
 * signed-in student goes straight to their work and never sees a page selling
 * them a product their school already bought — and a visitor gets static HTML
 * rather than downloading the notebook app to read a headline.
 *
 * The cookie is only checked for presence, not validated. Validating would
 * cost a database query on every hit including crawlers, and the answer would
 * be the same in all but one case: someone whose session has expired sees the
 * app shell, which immediately shows them the sign-in page anyway.
 */
const SESSION_COOKIE = "notesanity_session";

const hasSession = (request: Request) =>
  new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=[^;]`).test(request.headers.get("Cookie") ?? "");

/** Serve one of the built assets by name, whatever the request path was. */
const asset = (env: Bindings, request: Request, path: string) =>
  (env as unknown as { ASSETS: { fetch(r: Request): Promise<Response> } }).ASSETS.fetch(
    new Request(new URL(path, request.url), request),
  );

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
    const url = new URL(request.url);

    // The root is the only path both sides want. Everything else is already
    // unambiguous: marketing pages exist as files, app routes don't and fall
    // through to the SPA shell.
    if (url.pathname === "/" && request.method === "GET") {
      // `?signin=1` is how the marketing pages link to the app's sign-in, so it
      // has to reach the app even for a visitor with no session.
      // Two different ways of naming the same file, for a reason. The asset
      // server normalizes `.html` and `index` paths by redirecting, and passing
      // one of those redirects on would either move the visitor off `/` or, for
      // `index`, bounce them back to `/` and round again. So the app case asks
      // for the request as it stands — the root already resolves to the shell —
      // and only the marketing case names a different page, extensionless.
      const wantsApp = hasSession(request) || url.searchParams.has("signin");
      return wantsApp
        ? (env as unknown as { ASSETS: { fetch(r: Request): Promise<Response> } }).ASSETS.fetch(request)
        : asset(env, request, "/landing");
    }

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
