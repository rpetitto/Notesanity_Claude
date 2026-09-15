/**
 * The billing contract, separate from any provider — so that swapping Stripe
 * for something else is a file, not an edit across every route that charges.
 */

export interface CheckoutOptions {
  userId: string;
  orgId: string;
  email: string;
  name: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutResult {
  sessionId: string;
  url: string;
}

export interface CheckoutSession {
  id: string;
  customer: string | null;
  subscription: string | null;
  client_reference_id: string | null;
  status: string;
}

/** Stripe's own vocabulary, stored verbatim so a webhook never has to translate. */
export type SubscriptionStatus =
  | "active" | "trialing" | "past_due" | "canceled"
  | "unpaid" | "incomplete" | "incomplete_expired" | "paused";

export interface StripeSubscription {
  id: string;
  customer: string;
  status: SubscriptionStatus;
  cancel_at_period_end: boolean;
  /** Older API versions put the period on the subscription; newer ones put it on each item. */
  current_period_end?: number;
  items: { data: { price: { id: string }; current_period_end?: number }[] };
  metadata: Record<string, string>;
}

export interface StripeEvent<T = unknown> {
  id: string;
  type: string;
  created: number;
  livemode: boolean;
  data: { object: T };
}

/**
 * The string a billing failure wears when it is Stripe's moment, not ours —
 * a rate limit, an outage. Callers pattern-match on it to retry later rather
 * than report a bug, exactly as the mail queue does with RATE_LIMIT_MARKER.
 */
export const BILLING_RETRYABLE_MARKER = "BILLING_RETRYABLE";
