/**
 * Billing, provider-agnostic.
 *
 * Application code imports `billing` from here and never learns what Stripe
 * is. There is no zero-config default the way email has one: with no keys set
 * every call fails with a sentence naming the fix, which is the honest answer
 * for a development environment that hasn't been given a Stripe account.
 */

import {
  stripeConfigured,
  stripeCreateCustomer, stripeCreateCheckout, stripeGetCheckoutSession,
  stripeCreatePortalSession, stripeGetSubscription, stripeVerifyWebhook,
} from "./billing-stripe";
import type { CheckoutOptions } from "./billing-types";

export type {
  CheckoutOptions, CheckoutResult, CheckoutSession, StripeEvent, StripeSubscription, SubscriptionStatus,
} from "./billing-types";
export { BILLING_RETRYABLE_MARKER } from "./billing-types";
export { stripeConfigured as billingConfigured } from "./billing-stripe";

function unconfigured(): never {
  throw new Error(
    "Billing isn't configured for this environment — set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET with `wrangler secret put` (or in .dev.vars).",
  );
}

export const billing = {
  createCustomer(o: { userId: string; orgId: string; email: string; name: string }) {
    return stripeConfigured() ? stripeCreateCustomer(o) : unconfigured();
  },
  createCheckout(o: CheckoutOptions & { customerId: string }) {
    return stripeConfigured() ? stripeCreateCheckout(o) : unconfigured();
  },
  getCheckoutSession(id: string) {
    return stripeConfigured() ? stripeGetCheckoutSession(id) : unconfigured();
  },
  createPortalSession(customerId: string, returnUrl: string) {
    return stripeConfigured() ? stripeCreatePortalSession(customerId, returnUrl) : unconfigured();
  },
  getSubscription(id: string) {
    return stripeConfigured() ? stripeGetSubscription(id) : unconfigured();
  },
  verifyWebhook(rawBody: string, sigHeader: string | undefined) {
    return stripeConfigured() ? stripeVerifyWebhook(rawBody, sigHeader) : unconfigured();
  },
};
