import { db } from "flingit";
import { now, uid } from "./session";

/** Why a sign-in email did or didn't arrive. */
export type MailStatus =
  | "sent"            // handed to the provider
  | "refused_domain"  // address isn't on the org's allowlist, so nothing was sent
  | "rate_limited"    // the platform's 3-per-minute cap
  | "failed";         // the provider rejected it

/** Keep the log useful without letting it grow forever. */
const KEEP = 200;

export async function logMail(input: {
  address: string;
  kind: string;
  status: MailStatus;
  detail?: string;
}): Promise<void> {
  try {
    await db
      .prepare(`INSERT INTO mail_log (id, address, kind, status, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(uid(), input.address, input.kind, input.status, input.detail ?? "", now())
      .run();
    await db
      .prepare(
        `DELETE FROM mail_log WHERE id NOT IN (SELECT id FROM mail_log ORDER BY created_at DESC LIMIT ${KEEP})`,
      )
      .run();
  } catch (err) {
    // Diagnostics must never break the thing they are diagnosing.
    console.error("mail log failed", err);
  }
}
