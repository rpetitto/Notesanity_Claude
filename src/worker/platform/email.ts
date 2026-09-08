/**
 * Transactional email, sent through Cloudflare's own service.
 *
 * The interface is the one the application already calls, so `mailqueue.ts`
 * and the sign-in routes needed no changes. The provider sits behind it
 * deliberately: this is the third mail provider this code has had, and the
 * next one should cost a file rather than a refactor.
 *
 * Two addresses, per the shape of what actually gets sent. Everything the app
 * sends is automated — sign-in links, password resets, class invitations — so
 * it all comes *from* `noreply`. But a teacher who hits reply on a sign-in
 * email should reach a person and not a black hole, so every message carries
 * `support` as its reply-to. Mail that should genuinely come from a human
 * asks for it with `from: "support"`.
 */

import { currentEnv } from "./context";

export const SENDERS = {
  noreply: { email: "noreply@notesanity.com", name: "Notesanity" },
  support: { email: "support@notesanity.com", name: "Notesanity Support" },
} as const;

export type SenderName = keyof typeof SENDERS;

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  /** Which address it comes from. Defaults to `noreply`. */
  from?: SenderName;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
}

/**
 * The string the mail queue watches for.
 *
 * A throttled message is not a failed one: the queue leaves it pending and
 * doesn't spend one of its four attempts on the service being busy. That
 * behaviour is keyed off this marker, so a rate limit from any provider has to
 * surface wearing it.
 */
const RATE_LIMIT_MARKER = "PLUGIN_RATE_LIMIT_EXCEEDED";

export const email = {
  async send(options: SendEmailOptions): Promise<SendEmailResult> {
    const binding = (currentEnv() as Record<string, any>).EMAIL;
    if (!binding) {
      throw new Error("Email is not configured for this environment — no EMAIL binding.");
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
      if (code === "E_RATE_LIMIT_EXCEEDED") {
        throw new Error(`${RATE_LIMIT_MARKER}: ${message}`);
      }
      // The sender not being verified is a setup problem, not a transient one,
      // and reads as gibberish in a mail log without saying so.
      if (code === "E_SENDER_NOT_VERIFIED") {
        throw new Error(
          `${sender.email} isn't verified for sending. Onboard notesanity.com to Cloudflare Email Sending.`,
        );
      }
      throw new Error(code ? `${code}: ${message}` : message);
    }
  },
};
