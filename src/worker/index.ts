/**
 * Notesanity backend.
 *
 * Sign-in is handled by Fling's built-in Google auth. Domain restriction and
 * roles are enforced per-request in lib/session.ts, which also bootstraps the
 * org from the first account to sign in.
 *
 * Note: Google Classroom import and DOCX/PPTX conversion happen entirely in the
 * browser using the teacher's own OAuth token, so this Worker never holds Google
 * API credentials.
 */

import { app, auth, cron } from "flingit";

import "./schema";
import "./routes/auth";
import "./routes/me";
import "./routes/classes";
import "./routes/notebooks";
import "./routes/work";
import "./routes/assignments";
import "./routes/admin";
import { drainMailQueue } from "./lib/mailqueue";

/**
 * Queued mail goes out a few at a time, every minute.
 *
 * The platform ceiling is three sends a minute for the whole project. Draining
 * below that on purpose leaves room for sign-in links, which someone is
 * actively waiting on and which must not queue behind a class invite.
 */
cron("drain-mail-queue", "* * * * *", async () => {
  const { sent, failed } = await drainMailQueue();
  return { sent, failed };
});

auth.allow();

app.get("/api/health", (c) => c.json({ ok: true, service: "notesanity" }));
