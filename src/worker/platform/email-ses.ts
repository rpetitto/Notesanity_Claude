/**
 * Amazon SES, spoken to directly over its v2 HTTP API.
 *
 * No AWS SDK: it assumes Node and would dwarf the Worker's bundle. Requests
 * are signed with `aws4fetch`, which exists for exactly this — a few kilobytes
 * doing SigV4 over WebCrypto. Signing is the one part of this worth not
 * hand-rolling, since a subtle mistake there fails in ways that are hard to
 * read and easy to get wrong quietly.
 */

import { AwsClient } from "aws4fetch";
import { currentEnv } from "./context";
import { SENDERS, type SendEmailOptions, type SendEmailResult, RATE_LIMIT_MARKER } from "./email-types";

const list = (v?: string | string[]) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]);

export function sesConfigured(): boolean {
  const env = currentEnv() as Record<string, string | undefined>;
  return Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY);
}

export async function sesSend(options: SendEmailOptions): Promise<SendEmailResult> {
  const env = currentEnv() as Record<string, string | undefined>;
  const region = env.AWS_REGION || "us-east-1";

  const client = new AwsClient({
    accessKeyId: env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY!,
    service: "ses",
    region,
  });

  const sender = SENDERS[options.from ?? "noreply"];
  const body = {
    // The display name goes in the header, which is why this is formatted
    // rather than passed as a bare address.
    FromEmailAddress: `${sender.name} <${sender.email}>`,
    Destination: {
      ToAddresses: list(options.to),
      CcAddresses: list(options.cc),
      BccAddresses: list(options.bcc),
    },
    ReplyToAddresses: [options.replyTo ?? SENDERS.support.email],
    Content: {
      Simple: {
        Subject: { Data: options.subject, Charset: "UTF-8" },
        Body: {
          ...(options.text ? { Text: { Data: options.text, Charset: "UTF-8" } } : {}),
          ...(options.html ? { Html: { Data: options.html, Charset: "UTF-8" } } : {}),
        },
      },
    },
  };

  const res = await client.fetch(`https://email.${region}.amazonaws.com/v2/email/outbound-emails`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (res.ok) {
    const json = (await res.json().catch(() => ({}))) as { MessageId?: string };
    return { success: true, messageId: json.MessageId };
  }

  const text = await res.text().catch(() => "");
  let type = "";
  let message = text.slice(0, 300);
  try {
    const err = JSON.parse(text) as { __type?: string; message?: string; Message?: string };
    type = (err.__type ?? "").split("#").pop() ?? "";
    message = err.message ?? err.Message ?? message;
  } catch {
    /* SES occasionally answers with XML or an empty body */
  }

  // Throttling is not the message's fault, so it wears the marker the queue
  // understands: stay pending, don't spend an attempt.
  if (res.status === 429 || /Throttl|TooManyRequests|Limit/i.test(type)) {
    throw new Error(`${RATE_LIMIT_MARKER}: ${message}`);
  }

  // The two setup failures worth naming, because "MessageRejected" alone sends
  // you looking in the wrong place.
  if (/MessageRejected/i.test(type) && /not verified/i.test(message)) {
    throw new Error(
      `${sender.email} isn't verified in SES (${region}). Verify notesanity.com, and check the account is out of the sandbox.`,
    );
  }
  if (/AccountSendingPaused|SendingPaused/i.test(type)) {
    throw new Error("SES has paused sending for this account — check the SES console for the reason.");
  }

  throw new Error(type ? `${type}: ${message}` : `SES returned ${res.status}: ${message}`);
}
