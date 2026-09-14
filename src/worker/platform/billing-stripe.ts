/**
 * Stripe, spoken to directly over its REST API.
 *
 * No Stripe SDK: it assumes Node and would add most of a megabyte to the
 * Worker for a handful of calls. The API is form-encoded and needs nothing
 * but `fetch`; webhook signatures are an HMAC that Web Crypto verifies in
 * constant time. This is the same call `email-ses.ts` makes about the AWS
 * SDK, for the same reasons.
 */

import { currentEnv } from "./context";
import {
  BILLING_RETRYABLE_MARKER,
  type CheckoutOptions, type CheckoutResult, type CheckoutSession,
  type StripeEvent, type StripeSubscription,
} from "./billing-types";

/**
 * Pinned, because Stripe moves fields between versions — `current_period_end`
 * left the subscription object for its items in the 2025 releases. Match this
 * to the version shown in the dashboard when the keys are created.
 */
const STRIPE_API_VERSION = "2025-03-31.basil";

/** Signatures older than this are refused, so a captured delivery can't be replayed later. */
const WEBHOOK_TOLERANCE_SECONDS = 300;

const env = () => currentEnv() as Record<string, string | undefined>;

export function stripeConfigured(): boolean {
  const e = env();
  return Boolean(e.STRIPE_SECRET_KEY && e.STRIPE_WEBHOOK_SECRET);
}

/** Stripe's form encoding: `{ line_items: [{ price }] }` becomes `line_items[0][price]`. */
function form(params: Record<string, unknown>, out = new URLSearchParams(), prefix = ""): URLSearchParams {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((v, i) => {
        if (v !== null && typeof v === "object") form(v as Record<string, unknown>, out, `${name}[${i}]`);
        else out.append(`${name}[${i}]`, String(v));
      });
    } else if (typeof value === "object") {
      form(value as Record<string, unknown>, out, name);
    } else {
      out.append(name, String(value));
    }
  }
  return out;
}

async function stripe<T>(
  method: "GET" | "POST",
  path: string,
  params?: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${env().STRIPE_SECRET_KEY}`,
    "Stripe-Version": STRIPE_API_VERSION,
  };
  let url = `https://api.stripe.com/v1${path}`;
  let body: string | undefined;
  if (method === "GET") {
    if (params) url += `?${form(params)}`;
  } else {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    body = form(params ?? {}).toString();
  }

  const res = await fetch(url, { method, headers, body });

  if (res.ok) return (await res.json().catch(() => ({}))) as T;

  const text = await res.text().catch(() => "");
  let type = "";
  let code = "";
  let param = "";
  let message = text.slice(0, 300);
  try {
    const err = (JSON.parse(text) as { error?: { type?: string; code?: string; param?: string; message?: string } }).error ?? {};
    type = err.type ?? "";
    code = err.code ?? "";
    param = err.param ?? "";
    message = err.message ?? message;
  } catch {
    /* Stripe answers with JSON, but a proxy in between may not */
  }

  // Not our fault and not permanent: wear the marker so the caller waits.
  if (res.status === 429 || res.status >= 500 || type === "rate_limit_error") {
    throw new Error(`${BILLING_RETRYABLE_MARKER}: ${message}`);
  }

  // The two setup mistakes worth naming, because Stripe's own wording sends
  // you to the wrong place for both.
  if (type === "authentication_error") {
    throw new Error(
      "Stripe rejected the secret key — check STRIPE_SECRET_KEY was set with `wrangler secret put`, and that it's the key for this mode (test vs live).",
    );
  }
  if (code === "resource_missing" && param.startsWith("line_items")) {
    throw new Error(
      "The Pro price STRIPE_PRICE_PRO doesn't exist in this Stripe mode — copy the price id from the dashboard into wrangler.jsonc.",
    );
  }

  throw new Error(type ? `${type}: ${message}` : `Stripe returned ${res.status}: ${message}`);
}

export async function stripeCreateCustomer(o: {
  userId: string; orgId: string; email: string; name: string;
}): Promise<{ id: string }> {
  return stripe<{ id: string }>(
    "POST", "/customers",
    { email: o.email, name: o.name, metadata: { user_id: o.userId, org_id: o.orgId } },
    `customer:${o.userId}`,
  );
}

export async function stripeCreateCheckout(o: CheckoutOptions & { customerId: string }): Promise<CheckoutResult> {
  // Keyed to the minute, so a double-click yields one session rather than two.
  const key = `checkout:${o.userId}:${Math.floor(Date.now() / 60_000)}`;
  const session = await stripe<{ id: string; url: string }>(
    "POST", "/checkout/sessions",
    {
      mode: "subscription",
      customer: o.customerId,
      client_reference_id: o.userId,
      line_items: [{ price: o.priceId, quantity: 1 }],
      subscription_data: { metadata: { user_id: o.userId, org_id: o.orgId } },
      success_url: o.successUrl,
      cancel_url: o.cancelUrl,
      allow_promotion_codes: true,
    },
    key,
  );
  return { sessionId: session.id, url: session.url };
}

export async function stripeGetCheckoutSession(id: string): Promise<CheckoutSession> {
  return stripe<CheckoutSession>("GET", `/checkout/sessions/${encodeURIComponent(id)}`);
}

export async function stripeCreatePortalSession(customerId: string, returnUrl: string): Promise<{ url: string }> {
  return stripe<{ url: string }>("POST", "/billing_portal/sessions", { customer: customerId, return_url: returnUrl });
}

export async function stripeGetSubscription(id: string): Promise<StripeSubscription> {
  return stripe<StripeSubscription>("GET", `/subscriptions/${encodeURIComponent(id)}`);
}

const enc = new TextEncoder();

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Check a delivery really came from Stripe, and recently.
 *
 * The header carries a timestamp and one or more `v1` HMACs over
 * `${timestamp}.${rawBody}`. The body must be the exact bytes received — this
 * is why the route reads it once as text before anything parses it.
 * `crypto.subtle.verify` compares in constant time, so there is no hand-rolled
 * loop to get subtly wrong.
 */
export async function stripeVerifyWebhook(rawBody: string, sigHeader: string | undefined): Promise<StripeEvent> {
  if (!sigHeader) throw new Error("Webhook signature didn't verify: no Stripe-Signature header");

  let timestamp = "";
  const signatures: string[] = [];
  for (const part of sigHeader.split(",")) {
    const [k, v] = part.trim().split("=", 2);
    if (k === "t") timestamp = v ?? "";
    else if (k === "v1" && v) signatures.push(v);
  }
  const t = Number(timestamp);
  if (!Number.isFinite(t) || signatures.length === 0) {
    throw new Error("Webhook signature didn't verify: malformed header");
  }
  if (Math.abs(Date.now() / 1000 - t) > WEBHOOK_TOLERANCE_SECONDS) {
    throw new Error("Webhook signature didn't verify: timestamp outside tolerance");
  }

  const key = await crypto.subtle.importKey(
    "raw", enc.encode(env().STRIPE_WEBHOOK_SECRET!), { name: "HMAC", hash: "SHA-256" }, false, ["verify"],
  );
  const payload = enc.encode(`${timestamp}.${rawBody}`);
  for (const sig of signatures) {
    if (sig.length % 2 === 0 && await crypto.subtle.verify("HMAC", key, hexToBytes(sig), payload)) {
      return JSON.parse(rawBody) as StripeEvent;
    }
  }
  throw new Error("Webhook signature didn't verify");
}
