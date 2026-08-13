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

import { app, auth } from "flingit";

import "./schema";
import "./routes/me";
import "./routes/classes";
import "./routes/notebooks";
import "./routes/work";
import "./routes/assignments";

auth.allow();

app.get("/api/health", (c) => c.json({ ok: true, service: "notesanity" }));
