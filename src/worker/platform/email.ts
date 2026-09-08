/**
 * Transactional email.
 *
 * The interface matches what the app already calls so `mailqueue.ts` and the
 * sign-in routes need no edits. The provider behind it becomes Amazon SES in a
 * later step; until credentials exist this reports failure honestly rather
 * than pretending to send, so a message stays queued and retryable instead of
 * being marked delivered and lost.
 *
 * The queue's rate-limit handling keys off `PLUGIN_RATE_LIMIT_EXCEEDED`, so
 * whatever replaces this must keep throwing that string for a throttle — a
 * throttled message must not burn one of its attempts.
 */

import { currentEnv } from "./context";

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
}

export const email = {
  async send(options: SendEmailOptions): Promise<SendEmailResult> {
    const env = currentEnv() as Record<string, unknown>;
    const configured = Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY);

    if (!configured) {
      // Deliberately a throw, not a quiet false: the caller records the reason
      // against the message and leaves it pending, which is what should happen
      // to mail that genuinely has not gone anywhere.
      throw new Error("Email is not configured yet — no sending provider is set for this environment.");
    }

    throw new Error("Email provider not implemented in this step.");
  },
};
