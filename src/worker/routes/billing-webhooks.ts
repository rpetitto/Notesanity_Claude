/**
 * Stripe telling us something changed.
 *
 * Three rules, each the answer to a real failure mode:
 *
 * The body is read once, as text, before anything else. The signature is an
 * HMAC over the exact bytes Stripe sent, and a body that's been parsed can't
 * be un-parsed — the "Body has already been used" error is the classic
 * Workers-plus-Stripe mistake.
 *
 * The event id is the idempotency key. Stripe retries deliveries for days, and
 * a retry of something already applied must be a cheap 200, not a second
 * application.
 *
 * Nothing in the payload is trusted as state. Every handled event collapses
 * to "re-fetch this subscription from Stripe and apply it" — the payload only
 * says which one. The event describes a moment; Stripe describes now.
 *
 * Inside `handler()` on purpose: a rejected signature then lands in `api_log`
 * and the superadmin "API errors" tab, which is otherwise the one place a
 * misconfigured webhook secret would be invisible.
 */

import { app, db, currentScope } from "../platform";
import { billing, type StripeEvent } from "../platform/billing";
import { handler, now, HttpError } from "../lib/session";
import { applyStripeSubscription } from "../lib/billing-sync";

/** Bounded like api_log: the payloads are forensics, not a ledger. */
const EVENTS_KEEP = 500;

/** Which subscription an event is about, or null for types we don't act on. */
function subscriptionIdFor(event: StripeEvent<any>): string | null {
  const o = event.data.object ?? {};
  switch (event.type) {
    case "checkout.session.completed":
      return typeof o.subscription === "string" ? o.subscription : null;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return typeof o.id === "string" ? o.id : null;
    case "invoice.payment_failed":
    case "invoice.paid":
      // Newer API versions moved this under `parent`; read both.
      return o.parent?.subscription_details?.subscription
        ?? (typeof o.subscription === "string" ? o.subscription : null);
    default:
      return null;
  }
}

async function markProcessed(id: string, error?: string) {
  await db
    .prepare(`UPDATE billing_events SET processed_at = ?, error = ? WHERE id = ?`)
    .bind(error ? null : now(), error ?? null, id)
    .run();
}

async function process(eventId: string, subscriptionId: string) {
  try {
    await applyStripeSubscription(await billing.getSubscription(subscriptionId));
    await markProcessed(eventId);
  } catch (err) {
    // Left unprocessed so Stripe's redelivery re-runs it; the reason is kept.
    await markProcessed(eventId, (err instanceof Error ? err.message : String(err)).slice(0, 500));
  }
}

app.post("/api/billing/webhook", handler(async (c) => {
  const raw = await c.req.raw.text();

  let event: StripeEvent;
  try {
    event = await billing.verifyWebhook(raw, c.req.header("Stripe-Signature"));
  } catch (err) {
    throw new HttpError(400, err instanceof Error ? err.message : "Webhook signature didn't verify");
  }

  const seen = await db
    .prepare(`SELECT processed_at FROM billing_events WHERE id = ?`)
    .bind(event.id)
    .first<{ processed_at: string | null }>();
  if (seen?.processed_at) return c.json({ ok: true, duplicate: true });

  if (!seen) {
    await db
      .prepare(`INSERT INTO billing_events (id, type, payload, received_at) VALUES (?, ?, ?, ?)`)
      .bind(event.id, event.type, raw, now())
      .run();
    await db
      .prepare(
        `DELETE FROM billing_events WHERE id NOT IN
           (SELECT id FROM billing_events ORDER BY received_at DESC LIMIT ${EVENTS_KEEP})`,
      )
      .run();
  }

  const subscriptionId = subscriptionIdFor(event);
  if (!subscriptionId) {
    await markProcessed(event.id);
    return c.json({ ok: true, ignored: true });
  }

  // Answer Stripe now; do the work after. The promise is created inside this
  // request's scope, so the env travels with it into the continuation.
  currentScope().ctx.waitUntil(process(event.id, subscriptionId));
  return c.json({ ok: true });
}));
