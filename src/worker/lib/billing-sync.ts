/**
 * Bring our record of a Stripe subscription up to date from Stripe's.
 *
 * The one code path for both the webhook and the post-checkout confirm, so
 * the two can never disagree about what a subscription means. It is fed a
 * subscription freshly fetched from Stripe — never fields lifted out of a
 * webhook payload, which describe the moment the event was made, not now —
 * and it is idempotent: run it twice with the same input and the second run
 * changes nothing.
 */

import { db, currentEnv } from "../platform";
import type { StripeSubscription } from "../platform/billing";
import { now, uid } from "./session";
import { ENTITLED_STATUSES } from "./plans";

/** Which plan a Stripe price id sells. Only Pro is bought by card today. */
function planForPrice(priceId: string): "pro" {
  const env = currentEnv() as Record<string, string | undefined>;
  if (priceId === env.STRIPE_PRICE_PRO) return "pro";
  throw new Error(`Stripe price ${priceId} isn't one we sell — check STRIPE_PRICE_PRO in wrangler.jsonc`);
}

export async function applyStripeSubscription(sub: StripeSubscription): Promise<void> {
  const customer = await db
    .prepare(`SELECT user_id, org_id FROM billing_customers WHERE stripe_customer_id = ?`)
    .bind(sub.customer)
    .first<{ user_id: string; org_id: string }>();

  // The customer row is written before Checkout starts, so this is belt and
  // braces: the metadata Checkout was given carries the same ids.
  const userId = customer?.user_id ?? sub.metadata?.user_id;
  if (!userId) throw new Error(`Subscription ${sub.id}: no Notesanity user for customer ${sub.customer}`);
  const orgId = customer?.org_id
    ?? sub.metadata?.org_id
    ?? (await db.prepare(`SELECT org_id FROM users WHERE id = ?`).bind(userId).first<{ org_id: string }>())?.org_id;
  if (!orgId) throw new Error(`Subscription ${sub.id}: user ${userId} has no org`);

  const item = sub.items?.data?.[0];
  if (!item) throw new Error(`Subscription ${sub.id} has no items`);
  const plan = planForPrice(item.price.id);

  // The period moved from the subscription to its items in newer API
  // versions; read both so a version bump can't blank every renewal date.
  const periodEnd = item.current_period_end ?? sub.current_period_end;
  const renewsAt = periodEnd ? new Date(periodEnd * 1000).toISOString() : null;
  const isEntitled = (ENTITLED_STATUSES as readonly string[]).includes(sub.status);
  const ts = now();

  const existing = await db
    .prepare(`SELECT id, ended_at FROM subscriptions WHERE stripe_subscription_id = ?`)
    .bind(sub.id)
    .first<{ id: string; ended_at: string | null }>();

  let subscriptionId: string;
  if (existing) {
    subscriptionId = existing.id;
    await db
      .prepare(
        `UPDATE subscriptions
            SET status = ?, current_period_end = ?, cancel_at_period_end = ?, stripe_price_id = ?,
                updated_at = ?, ended_at = ?
          WHERE id = ?`,
      )
      .bind(
        sub.status, renewsAt, sub.cancel_at_period_end ? 1 : 0, item.price.id, ts,
        isEntitled ? null : (existing.ended_at ?? ts), subscriptionId,
      )
      .run();
  } else {
    subscriptionId = uid();
    await db
      .prepare(
        `INSERT INTO subscriptions
           (id, org_id, plan, status, provider, seat_count, owner_user_id, stripe_customer_id,
            stripe_subscription_id, stripe_price_id, current_period_end, cancel_at_period_end,
            created_at, updated_at, ended_at)
         VALUES (?, ?, ?, ?, 'stripe', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        subscriptionId, orgId, plan, sub.status, userId, sub.customer, sub.id, item.price.id,
        renewsAt, sub.cancel_at_period_end ? 1 : 0, ts, ts, isEntitled ? null : ts,
      )
      .run();
  }

  // The buyer's own seat. Never removed here — entitlement follows the status.
  await db
    .prepare(
      `INSERT OR IGNORE INTO plan_seats (id, subscription_id, org_id, user_id, granted_by, created_at)
       VALUES (?, ?, ?, ?, 'stripe', ?)`,
    )
    .bind(uid(), subscriptionId, orgId, userId, ts)
    .run();
}
