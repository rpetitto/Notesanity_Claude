/**
 * Buying Pro, managing it afterwards, and handing out Department seats.
 *
 * Only Pro is sold by card. Department and School are a conversation and an
 * invoice, after which a superadmin switches the school on from the admin
 * console — so the only Checkout here is the single-teacher one.
 */

import { app, db, currentEnv } from "../platform";
import { billing, billingConfigured } from "../platform/billing";
import { BETA_FREE } from "../../shared/plans.mjs";
import { handler, now, uid, requireUser, requireTeacher, HttpError, param } from "../lib/session";
import { planForUser, departmentFor, tierAtLeast } from "../lib/plans";
import { applyStripeSubscription } from "../lib/billing-sync";

const origin = (c: any) => new URL(c.req.url).origin;

async function customerFor(user: { id: string; org_id: string; email: string; name: string }): Promise<string> {
  const row = await db
    .prepare(`SELECT stripe_customer_id FROM billing_customers WHERE user_id = ?`)
    .bind(user.id)
    .first<{ stripe_customer_id: string }>();
  if (row) return row.stripe_customer_id;
  const created = await billing.createCustomer({ userId: user.id, orgId: user.org_id, email: user.email, name: user.name });
  await db
    .prepare(`INSERT INTO billing_customers (user_id, org_id, stripe_customer_id, created_at) VALUES (?, ?, ?, ?)`)
    .bind(user.id, user.org_id, created.id, now())
    .run();
  return created.id;
}

app.post("/api/billing/checkout", handler(async (c) => {
  const user = await requireTeacher(c);
  // The server refuses, not just the button: that is the guarantee the
  // pricing page and the app can't disagree about what "free" means.
  if (BETA_FREE) throw new HttpError(409, "Notesanity is free while it's in beta — there's nothing to buy yet.");
  if (!billingConfigured()) throw new HttpError(503, "Billing isn't set up yet.");

  const plan = await planForUser(user);
  if (tierAtLeast(plan.tier, "pro")) throw new HttpError(409, "You already have Pro.");

  const priceId = (currentEnv() as Record<string, string | undefined>).STRIPE_PRICE_PRO;
  if (!priceId) throw new HttpError(503, "The Pro price isn't configured — STRIPE_PRICE_PRO is missing from wrangler.jsonc.");

  const customerId = await customerFor(user);
  const session = await billing.createCheckout({
    userId: user.id, orgId: user.org_id, email: user.email, name: user.name, priceId, customerId,
    successUrl: `${origin(c)}/settings?billing=success&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${origin(c)}/settings?billing=cancel`,
  });
  return c.json({ url: session.url });
}));

/**
 * The redirect back from Checkout, made correct on arrival.
 *
 * The webhook is usually seconds behind the redirect. Rather than land the
 * teacher on a Settings page that still says Free, this reads the session and
 * applies the subscription through the same idempotent path the webhook uses.
 */
app.post("/api/billing/confirm", handler(async (c) => {
  const user = await requireTeacher(c);
  const { sessionId } = await c.req.json<{ sessionId?: string }>();
  if (!sessionId) throw new HttpError(400, "Missing session id");
  const session = await billing.getCheckoutSession(sessionId);
  if (session.client_reference_id !== user.id) throw new HttpError(403, "That checkout isn't yours");
  if (session.subscription) {
    await applyStripeSubscription(await billing.getSubscription(session.subscription));
  }
  return c.json({ plan: await planForUser(user) });
}));

app.post("/api/billing/portal", handler(async (c) => {
  const user = await requireUser(c);
  const row = await db
    .prepare(`SELECT stripe_customer_id FROM billing_customers WHERE user_id = ?`)
    .bind(user.id)
    .first<{ stripe_customer_id: string }>();
  if (!row) throw new HttpError(404, "No billing account yet");
  const portal = await billing.createPortalSession(row.stripe_customer_id, `${origin(c)}/settings`);
  return c.json({ url: portal.url });
}));

/** A school admin gives one of their teachers a Department seat. */
app.put("/api/org/seats/:userId", handler(async (c) => {
  const admin = await requireUser(c);
  if (!admin.is_admin) throw new HttpError(403, "Admin access required");
  const sub = await departmentFor(admin.org_id);
  if (!sub) throw new HttpError(404, "Your school doesn't have a Department plan");

  const target = await db
    .prepare(`SELECT id, role FROM users WHERE id = ? AND org_id = ?`)
    .bind(param(c, "userId"), admin.org_id)
    .first<{ id: string; role: string }>();
  if (!target) throw new HttpError(404, "User not found");
  if (target.role !== "teacher") throw new HttpError(400, "Seats are for teachers");

  const used = await db
    .prepare(`SELECT COUNT(*) AS n FROM plan_seats WHERE subscription_id = ?`)
    .bind(sub.id)
    .first<{ n: number }>();
  const total = sub.seat_count ?? 0;
  const already = await db
    .prepare(`SELECT 1 FROM plan_seats WHERE subscription_id = ? AND user_id = ?`)
    .bind(sub.id, target.id)
    .first();
  if (!already && (used?.n ?? 0) >= total) {
    throw new HttpError(409, `All ${total} Department seats are assigned — remove one to add another.`);
  }
  await db
    .prepare(
      `INSERT OR IGNORE INTO plan_seats (id, subscription_id, org_id, user_id, granted_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(uid(), sub.id, admin.org_id, target.id, admin.id, now())
    .run();
  return c.json({ ok: true });
}));

app.delete("/api/org/seats/:userId", handler(async (c) => {
  const admin = await requireUser(c);
  if (!admin.is_admin) throw new HttpError(403, "Admin access required");
  const sub = await departmentFor(admin.org_id);
  if (!sub) throw new HttpError(404, "Your school doesn't have a Department plan");
  await db
    .prepare(`DELETE FROM plan_seats WHERE subscription_id = ? AND user_id = ? AND org_id = ?`)
    .bind(sub.id, param(c, "userId"), admin.org_id)
    .run();
  return c.json({ ok: true });
}));

/** Who holds the school's Department seats — for the People list's toggles. */
app.get("/api/org/seats", handler(async (c) => {
  const admin = await requireUser(c);
  if (!admin.is_admin) throw new HttpError(403, "Admin access required");
  const sub = await departmentFor(admin.org_id);
  if (!sub) return c.json({ department: null });
  const rows = await db
    .prepare(`SELECT user_id FROM plan_seats WHERE subscription_id = ?`)
    .bind(sub.id)
    .all<{ user_id: string }>();
  const holders = (rows.results ?? []).map((r) => r.user_id);
  return c.json({ department: { total: sub.seat_count ?? 0, used: holders.length, holders } });
}));
