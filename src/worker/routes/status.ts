/**
 * Live component status, for the public status page.
 *
 * Every check here does real work — a query that reaches the database, a call
 * that reaches storage — rather than reporting a value someone set by hand. A
 * status page that is updated manually tells you what someone remembered to
 * change; this one tells you what was true a few seconds ago, which is the
 * only version worth publishing.
 *
 * It is deliberately public and deliberately thin: component names, whether
 * they answered, and how long they took. No counts, no identifiers, nothing
 * about who is using the service. The response is cached briefly so that a
 * page left open, or a burst of traffic during an outage, costs one set of
 * checks rather than one per viewer.
 */

import { app, db, storage } from "../platform";
import { handler } from "../lib/session";
import { currentEnv } from "../platform/context";

type State = "operational" | "degraded" | "down";

interface Check {
  key: string;
  name: string;
  /** What a reader loses when this is down, in their terms rather than ours. */
  detail: string;
  state: State;
  ms: number | null;
  note?: string;
}

/** Run a probe, timing it, and turn a throw into a reported failure. */
async function probe(
  key: string,
  name: string,
  detail: string,
  fn: () => Promise<string | void>,
): Promise<Check> {
  const started = Date.now();
  try {
    const note = await fn();
    const ms = Date.now() - started;
    // Answering, but slowly, is worth saying out loud — it is usually what a
    // teacher is experiencing before anything actually breaks.
    return { key, name, detail, state: ms > 2000 ? "degraded" : "operational", ms, note: note || undefined };
  } catch (err) {
    return {
      key, name, detail, state: "down", ms: Date.now() - started,
      note: (err as Error)?.message?.slice(0, 120),
    };
  }
}

app.get("/api/status", handler(async (c) => {
  const checks: Check[] = [];

  // The API answered, or none of this would be running.
  checks.push({
    key: "api", name: "Application", detail: "Signing in, and everything the app asks for",
    state: "operational", ms: null,
  });

  checks.push(
    await probe("database", "Notebooks and grades", "Where work, classes and marking are stored", async () => {
      await db.prepare(`SELECT 1`).first();
    }),
  );

  checks.push(
    await probe("storage", "Uploads", "PDFs, images and audio recordings", async () => {
      // Listing one key under a prefix nothing uses: reaches the bucket without
      // reading anyone's file.
      await storage.list("status-probe/");
    }),
  );

  checks.push(
    await probe("email", "Sign-in emails", "Sign-in links and class invitations", async () => {
      const env = currentEnv() as Record<string, unknown>;
      if (!env.EMAIL && !env.AWS_ACCESS_KEY_ID) throw new Error("No mail provider is configured");
      // Queued mail that has sat for a while means the drain has stopped, which
      // is invisible from the provider's side but very visible to someone
      // waiting on a sign-in link.
      const stuck = await db
        .prepare(
          `SELECT COUNT(*) AS n FROM mail_queue
            WHERE status = 'pending' AND created_at < datetime('now', '-15 minutes')`,
        )
        .first<{ n: number }>();
      if ((stuck?.n ?? 0) > 0) throw new Error("Mail is queued but not being sent");
    }),
  );

  const worst: State = checks.some((c) => c.state === "down")
    ? "down"
    : checks.some((c) => c.state === "degraded")
      ? "degraded"
      : "operational";

  return c.json(
    { state: worst, checks, checkedAt: new Date().toISOString() },
    200,
    { "Cache-Control": "public, max-age=30" },
  );
}));
