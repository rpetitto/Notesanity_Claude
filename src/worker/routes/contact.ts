/**
 * The public contact form.
 *
 * Open to anyone, which is the whole difficulty: every other endpoint in this
 * app is behind a session, and this one has to accept a stranger's POST without
 * becoming a way to send mail through us or to fill the database with junk.
 *
 * Three things do that work, in order of how much they catch:
 *
 *  - A honeypot field real people never see and never fill.
 *  - A per-address cooldown, so a script cannot loop on one submission.
 *  - Fixed recipients. The message always goes to support@; nothing a submitter
 *    types can redirect it, which is what turns a contact form into an open
 *    relay.
 *
 * The row is written before the email is attempted, and the reply reports
 * success once it is stored. An enquiry that reached us but whose notification
 * failed is not a failed enquiry, and telling a district "something went wrong"
 * when their message is safely in the database would be a lie that costs a lead.
 */

import { app, db } from "../platform";
import { email as mailer } from "../platform/email";
import { handler, now, uid, HttpError } from "../lib/session";

/** Long enough to stop a loop, short enough that a real correction isn't blocked. */
const COOLDOWN_SECONDS = 45;

const MAX = { name: 120, email: 200, organization: 200, region: 80, choice: 80, message: 4000 };

const clean = (v: unknown, limit: number) => String(v ?? "").trim().slice(0, limit);

/** Deliberately permissive: rejecting odd but valid addresses loses real people. */
const looksLikeEmail = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

app.post("/api/contact", handler(async (c) => {
  const b = await c.req.json<Record<string, unknown>>();

  // A field positioned off-screen and left empty by anyone using the page.
  if (clean(b.website, 100)) return c.json({ ok: true });

  const email = clean(b.email, MAX.email).toLowerCase();
  const name = clean(b.name, MAX.name);
  if (!name) throw new HttpError(400, "Please tell us your name.");
  if (!looksLikeEmail(email)) throw new HttpError(400, "That doesn't look like an email address.");

  const recent = await db
    .prepare(
      `SELECT id FROM contact_requests
        WHERE email = ? AND created_at > datetime('now', ?)
        LIMIT 1`,
    )
    .bind(email, `-${COOLDOWN_SECONDS} seconds`)
    .first();
  if (recent) {
    throw new HttpError(429, "We've just received a message from you — give us a moment to read that one.");
  }

  const row = {
    id: uid(),
    role: clean(b.role, MAX.choice),
    name,
    email,
    region: clean(b.region, MAX.region),
    organization: clean(b.organization, MAX.organization),
    interest: clean(b.interest, MAX.choice),
    heard: clean(b.heardFrom, MAX.choice),
    message: clean(b.message, MAX.message),
  };

  await db
    .prepare(
      `INSERT INTO contact_requests (id, role, name, email, region, organization, interest, heard_from, message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(row.id, row.role, row.name, row.email, row.region, row.organization, row.interest, row.heard, row.message, now())
    .run();

  const lines = [
    ["Name", row.name],
    ["Email", row.email],
    ["Role", row.role],
    ["School or district", row.organization],
    ["State", row.region],
    ["Interested in", row.interest],
    ["Heard about us", row.heard],
  ].filter(([, v]) => v);

  try {
    await mailer.send({
      to: "support@notesanity.com",
      // Replying goes straight back to the person who wrote in, rather than to
      // ourselves — the whole point of the notification is to be answerable.
      replyTo: row.email,
      subject: `Notesanity enquiry — ${row.name}${row.organization ? ` (${row.organization})` : ""}`,
      text:
        lines.map(([k, v]) => `${k}: ${v}`).join("\n") +
        (row.message ? `\n\nMessage:\n${row.message}` : ""),
      html:
        `<table cellpadding="6">${lines
          .map(([k, v]) => `<tr><td><b>${k}</b></td><td>${esc(v)}</td></tr>`)
          .join("")}</table>` +
        (row.message ? `<p><b>Message</b></p><p>${esc(row.message).replace(/\n/g, "<br>")}</p>` : ""),
    });
  } catch (err) {
    // Stored is what matters. The failure is recorded on the row so an enquiry
    // nobody was told about can still be found.
    await db
      .prepare(`UPDATE contact_requests SET status = ? WHERE id = ?`)
      .bind(`stored, not emailed: ${(err as Error).message}`.slice(0, 180), row.id)
      .run();
  }

  return c.json({ ok: true });
}));
