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
 * Two ways in. The page's script posts JSON and shows the reply inline; with
 * no script (blocked, off, an in-app browser, a submit before it loaded) the
 * form posts itself as an ordinary form. Both reach this handler. The second
 * gets a redirect back to the page, to an anchor the page shows with CSS
 * alone: `#sent`, or `#err-…` naming what to fix. Answering a form post with
 * JSON — or, as it once did, with a 500 because the body wasn't JSON — leaves
 * a person looking at raw text and their message lost.
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

/** What can be wrong with a submission, with the anchor on the page that explains each. */
const PROBLEMS = {
  name: [400, "Please tell us your name."],
  email: [400, "That doesn't look like an email address."],
  wait: [429, "We've just received a message from you — give us a moment to read that one."],
  unreadable: [400, "We couldn't read that message. Try again, or email us directly."],
} as const;
type Problem = keyof typeof PROBLEMS;

class ContactProblem extends HttpError {
  constructor(public problem: Problem) {
    super(PROBLEMS[problem][0], PROBLEMS[problem][1]);
  }
}

app.post("/api/contact", handler(async (c) => {
  const isJson = (c.req.header("Content-Type") ?? "").toLowerCase().includes("application/json");

  if (isJson) {
    const b = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!b || typeof b !== "object") throw new ContactProblem("unreadable");
    await accept(b);
    return c.json({ ok: true });
  }

  // A plain form post — urlencoded or multipart, whichever the browser chose.
  // Every answer is a redirect back to the page, never JSON.
  try {
    const form = await c.req.parseBody();
    const b: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(form)) if (typeof v === "string") b[k] = v;
    await accept(b);
    return c.redirect("/contact#sent", 303);
  } catch (err) {
    if (err instanceof ContactProblem) return c.redirect(`/contact#err-${err.problem}`, 303);
    console.error("contact form failed", err);
    return c.redirect("/contact#err-general", 303);
  }
}));

/**
 * Validate, store and forward one submission. Throws a ContactProblem the
 * person can fix; anything else is ours.
 */
async function accept(b: Record<string, unknown>): Promise<void> {
  // A field positioned off-screen and left empty by anyone using the page.
  // Filled means a bot: it is told it succeeded, and nothing is kept.
  if (clean(b.website, 100)) return;

  const email = clean(b.email, MAX.email).toLowerCase();
  const name = clean(b.name, MAX.name);
  if (!name) throw new ContactProblem("name");
  if (!looksLikeEmail(email)) throw new ContactProblem("email");

  const recent = await db
    .prepare(
      `SELECT id FROM contact_requests
        WHERE email = ? AND created_at > datetime('now', ?)
        LIMIT 1`,
    )
    .bind(email, `-${COOLDOWN_SECONDS} seconds`)
    .first();
  if (recent) throw new ContactProblem("wait");

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
}
