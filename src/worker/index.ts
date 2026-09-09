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

import { app, auth, cron } from "./platform";

import "./schema";
import "./routes/auth";
import "./routes/me";
import "./routes/classes";
import "./routes/notebooks";
import "./routes/work";
import "./routes/assignments";
import "./routes/admin";
import "./routes/status";
import "./routes/contact";
import { drainMailQueue } from "./lib/mailqueue";

/**
 * Queued mail goes out a few at a time, every minute.
 *
 * Sign-in links are sent immediately rather than queued, because someone is
 * waiting on them; this drains the invitations, which are not urgent but are
 * numerous. The old two-per-minute trickle existed to fit under a platform
 * ceiling that no longer applies.
 */
cron("drain-mail-queue", "* * * * *", async () => {
  const { sent, failed } = await drainMailQueue();
  return { sent, failed };
});

auth.allow();

app.get("/api/health", (c) => c.json({ ok: true, service: "notesanity" }));
