/**
 * What every mail provider agrees on.
 *
 * Separate from the provider implementations so that adding one is a file
 * rather than an edit: this is the third mail provider this code has had, and
 * the shape has outlived all of them.
 */

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
 * doesn't spend one of its four attempts on the provider being busy. That
 * behaviour is keyed off this marker, so a rate limit from any provider has to
 * surface wearing it.
 */
export const RATE_LIMIT_MARKER = "PLUGIN_RATE_LIMIT_EXCEEDED";
