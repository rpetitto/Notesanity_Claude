/**
 * Transactional email.
 *
 * The interface is the one the application already calls, so `mailqueue.ts`
 * and the sign-in routes need no changes. Which provider actually sends is
 * decided here, from configuration rather than a code change: SES when AWS
 * credentials are present, otherwise Cloudflare's own service. That ordering
 * is deliberate — the default costs nothing to run, and setting two secrets is
 * the whole of switching away from it if a district-wide invite ever needs a
 * larger published quota than Cloudflare will grant.
 *
 * Two addresses, per the shape of what actually gets sent. Everything the app
 * sends is automated — sign-in links, password resets, class invitations — so
 * it all comes *from* `noreply`. But a teacher who hits reply on a sign-in
 * email should reach a person and not a black hole, so every message carries
 * `support` as its reply-to. Mail that should genuinely come from a human asks
 * for it with `from: "support"`.
 */

import { currentEnv } from "./context";
import { SENDERS, RATE_LIMIT_MARKER, type SendEmailOptions, type SendEmailResult } from "./email-types";
import { sesConfigured, sesSend } from "./email-ses";

export { SENDERS } from "./email-types";
export type { SendEmailOptions, SendEmailResult, SenderName } from "./email-types";

/** Send through Cloudflare's Email Sending binding. */
async function cloudflareSend(options: SendEmailOptions): Promise<SendEmailResult> {
  const binding = (currentEnv() as Record<string, any>).EMAIL;
  if (!binding) {
    throw new Error("Email is not configured for this environment — no EMAIL binding and no AWS credentials.");
  }

  const sender = SENDERS[options.from ?? "noreply"];

  try {
    const res = await binding.send({
      from: sender,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      cc: options.cc,
      bcc: options.bcc,
      // An explicit reply-to wins; otherwise replies reach a human.
      replyTo: options.replyTo ?? SENDERS.support.email,
    });
    return { success: true, messageId: res?.messageId };
  } catch (err) {
    const code = (err as { code?: string }).code ?? "";
    const message = (err as Error).message ?? String(err);

    // Throttling is not the message's fault, so it wears the marker the queue
    // understands: stay pending, don't spend one of its four attempts.
    if (code === "E_RATE_LIMIT_EXCEEDED") throw new Error(`${RATE_LIMIT_MARKER}: ${message}`);

    // A setup problem rather than a transient one, and unreadable in a mail log
    // unless it says so.
    if (code === "E_SENDER_NOT_VERIFIED") {
      throw new Error(
        `${sender.email} isn't verified for sending. Onboard notesanity.com to Cloudflare Email Sending.`,
      );
    }
    throw new Error(code ? `${code}: ${message}` : message);
  }
}

export const email = {
  send(options: SendEmailOptions): Promise<SendEmailResult> {
    return sesConfigured() ? sesSend(options) : cloudflareSend(options);
  },
};
