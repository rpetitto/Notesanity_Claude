import { db } from "flingit";
import { email as mailer } from "flingit/plugin/email-send";
import { now, uid } from "./session";
import { renderEmail, type EmailContent } from "./email";
import { logMail } from "./maillog";

/**
 * Mail that isn't waiting on a person.
 *
 * A sign-in link is sent immediately because someone is staring at the screen.
 * An invite is not — so it goes on a queue and a scheduled drain sends it,
 * which is the only way a class of twenty-five all get one when the platform
 * allows three sends a minute.
 */
export async function queueMail(input: { address: string; kind: string; subject: string; content: EmailContent }) {
  await db
    .prepare(
      `INSERT INTO mail_queue (id, address, kind, payload, subject, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .bind(uid(), input.address, input.kind, JSON.stringify(input.content), input.subject, now())
    .run();
}

/** Give up after this many tries so one bad address can't block the queue. */
const MAX_ATTEMPTS = 4;

/**
 * Send the next few queued messages.
 *
 * Deliberately below the platform's three-per-minute ceiling: the remainder is
 * headroom for sign-in links, which someone is actively waiting on and which
 * must not be starved by a bulk invite.
 */
export async function drainMailQueue(limit = 2): Promise<{ sent: number; failed: number }> {
  const rows = await db
    .prepare(`SELECT * FROM mail_queue WHERE status = 'pending' ORDER BY created_at LIMIT ?`)
    .bind(limit)
    .all<any>();

  let sent = 0, failed = 0;
  for (const row of rows.results ?? []) {
    try {
      const { html, text } = renderEmail(JSON.parse(row.payload) as EmailContent);
      const result = await mailer.send({ to: row.address, subject: row.subject, text, html });
      if (result && result.success === false) throw new Error("Provider reported the send as unsuccessful.");
      await db.prepare(`UPDATE mail_queue SET status = 'sent', sent_at = ? WHERE id = ?`).bind(now(), row.id).run();
      await logMail({ address: row.address, kind: row.kind, status: "sent", detail: result?.messageId ?? "" });
      sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const attempts = (row.attempts ?? 0) + 1;
      const limited = message.includes("PLUGIN_RATE_LIMIT_EXCEEDED");
      // A rate limit isn't the message's fault — leave it pending and don't
      // spend one of its attempts on the queue being busy.
      const giveUp = !limited && attempts >= MAX_ATTEMPTS;
      await db
        .prepare(`UPDATE mail_queue SET attempts = ?, status = ? WHERE id = ?`)
        .bind(limited ? row.attempts : attempts, giveUp ? "failed" : "pending", row.id)
        .run();
      if (giveUp || limited) {
        await logMail({
          address: row.address, kind: row.kind,
          status: limited ? "rate_limited" : "failed",
          detail: limited ? "Waiting for the per-minute send limit to clear." : message,
        });
      }
      failed++;
      if (limited) break; // nothing else will get through this minute either
    }
  }
  return { sent, failed };
}
