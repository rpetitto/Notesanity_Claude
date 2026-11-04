/**
 * What a person is entitled to, and the gates that enforce it.
 *
 * Two questions, kept apart on purpose. `planForUser` answers what someone has
 * *really* bought or been given — that is what the Settings card shows. The
 * `require*` guards answer whether to refuse a request, and while the beta is
 * on they never do: the switch in `src/shared/plans.mjs` short-circuits them
 * before any lookup. Every gate is therefore built, exercised and true to the
 * pricing page from day one, and flipping one constant is what turns it on.
 */

import { BETA_FREE, FREE_NOTEBOOK_LIMIT, FREE_STUDENT_LIMIT, PLANS } from "../../shared/plans.mjs";
import { db } from "../platform";
import { HttpError, now, type AppUser } from "./session";

/** What a person can do. Department buys Pro for its people, so it collapses to `pro` here. */
export type Tier = "free" | "pro" | "school";
/** Why they can do it. */
export type PlanSource = "school" | "department" | "pro" | "free";

export interface UserPlan {
  tier: Tier;
  source: PlanSource;
  subscriptionId: string | null;
  renewsAt: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface Quota {
  used: number;
  /** Class notebooks allowed; null means unlimited. */
  limit: number | null;
  remaining: number | null;
  /** True when nothing is counted against them — because of the plan, or the beta. */
  unlimited: boolean;
}

/**
 * Statuses that still entitle. `past_due` stays in: Stripe is retrying the
 * card, and a teacher mid-semester should not lose their notebooks over a
 * declined renewal they may not have seen yet.
 */
export const ENTITLED_STATUSES = ["active", "trialing", "past_due"] as const;

const RANK: Record<Tier, number> = { free: 0, pro: 1, school: 2 };
export const tierAtLeast = (tier: Tier, min: Tier) => RANK[tier] >= RANK[min];

/**
 * "This subscription row entitles right now." The cutoff is computed here and
 * bound, never `datetime('now')` in SQL: our timestamps are ISO with a `T`,
 * SQLite's have a space, and comparing the two lexically is wrong on the very
 * day it matters.
 */
function entitled(alias: string): { sql: string; params: string[] } {
  const statuses = ENTITLED_STATUSES.map(() => "?").join(",");
  return {
    sql: `${alias}.status IN (${statuses}) AND (${alias}.expires_at IS NULL OR ${alias}.expires_at > ?)`,
    params: [...ENTITLED_STATUSES, now()],
  };
}

interface SubscriptionRow {
  id: string;
  plan: string;
  seat_count: number | null;
  current_period_end: string | null;
  cancel_at_period_end: number;
}

/** The school-wide row that covers everyone, if there is one. */
async function orgWide(orgId: string): Promise<SubscriptionRow | null> {
  const e = entitled("s");
  return db
    .prepare(`SELECT s.id, s.plan, s.seat_count, s.current_period_end, s.cancel_at_period_end
                FROM subscriptions s WHERE s.org_id = ? AND s.plan = 'school' AND ${e.sql}
               ORDER BY s.created_at DESC LIMIT 1`)
    .bind(orgId, ...e.params)
    .first<SubscriptionRow>();
}

/** The seat this person holds on a subscription that still entitles, if any. */
async function seatFor(userId: string): Promise<SubscriptionRow | null> {
  const e = entitled("s");
  return db
    .prepare(`SELECT s.id, s.plan, s.seat_count, s.current_period_end, s.cancel_at_period_end
                FROM plan_seats p JOIN subscriptions s ON s.id = p.subscription_id
               WHERE p.user_id = ? AND ${e.sql}
               ORDER BY CASE s.plan WHEN 'department' THEN 0 ELSE 1 END, s.created_at DESC LIMIT 1`)
    .bind(userId, ...e.params)
    .first<SubscriptionRow>();
}

/** The Department subscription an org admin hands seats out from, if the school has one. */
export async function departmentFor(orgId: string): Promise<SubscriptionRow | null> {
  const e = entitled("s");
  return db
    .prepare(`SELECT s.id, s.plan, s.seat_count, s.current_period_end, s.cancel_at_period_end
                FROM subscriptions s WHERE s.org_id = ? AND s.plan = 'department' AND ${e.sql}
               ORDER BY s.created_at DESC LIMIT 1`)
    .bind(orgId, ...e.params)
    .first<SubscriptionRow>();
}

/**
 * What this person really has, in order: a School plan covering their org, a
 * seat they hold (Department or their own Pro), or nothing.
 */
export async function planForUser(user: Pick<AppUser, "id" | "org_id">): Promise<UserPlan> {
  const school = await orgWide(user.org_id);
  if (school) return describe(school, "school", "school");
  const seat = await seatFor(user.id);
  if (seat) return describe(seat, "pro", seat.plan === "department" ? "department" : "pro");
  return { tier: "free", source: "free", subscriptionId: null, renewsAt: null, cancelAtPeriodEnd: false };
}

function describe(row: SubscriptionRow, tier: Tier, source: PlanSource): UserPlan {
  return {
    tier, source, subscriptionId: row.id,
    renewsAt: row.current_period_end, cancelAtPeriodEnd: !!row.cancel_at_period_end,
  };
}

/** What the gates act on: the real tier, or Pro for everyone while the beta is on. */
export const effectiveTier = (plan: UserPlan): Tier => (BETA_FREE ? (tierAtLeast(plan.tier, "pro") ? plan.tier : "pro") : plan.tier);

/**
 * Class notebooks used against the Free cap. Only `kind = 'class'` counts:
 * "teacher-authored" means the notebooks a class is built from — not a
 * teacher's personal notebook, which students get free too, and not archived
 * ones, so putting a notebook away always makes room.
 */
export async function notebookQuota(user: Pick<AppUser, "id" | "org_id">, plan?: UserPlan): Promise<Quota> {
  const p = plan ?? (await planForUser(user));
  const row = await notebooksUsedStatement(user.id).first<{ n: number }>();
  return quotaFrom(p, row?.n ?? 0);
}

/** The count behind the Free cap, for a caller that batches it with its own reads. */
export const notebooksUsedStatement = (userId: string) =>
  db.prepare(`SELECT COUNT(*) AS n FROM notebooks WHERE owner_id = ? AND kind = 'class' AND archived = 0`).bind(userId);

export function quotaFrom(p: UserPlan, used: number): Quota {
  const limit = p.tier === "free" ? PLANS.free.notebookLimit : null;
  return {
    used, limit,
    remaining: limit === null ? null : Math.max(0, limit - used),
    unlimited: BETA_FREE || limit === null,
  };
}

/** Refuse unless the person's tier is at least `min`. Never refuses during the beta. */
export async function requirePlan(user: AppUser, min: "pro" | "school", what: string): Promise<UserPlan | null> {
  if (BETA_FREE) return null;
  const plan = await planForUser(user);
  if (!tierAtLeast(plan.tier, min)) {
    throw new HttpError(
      402,
      `${what} is part of ${min === "pro" ? "Pro" : "the School plan"}. Upgrade in Settings to use it.`,
    );
  }
  return plan;
}

/**
 * Refuse a new class notebook once a Free teacher is at the cap. Never refuses
 * during the beta.
 *
 * Order matters in the message. Archiving genuinely does free a slot and a
 * teacher is entitled to know it, but leading with it made the one moment
 * we ask for the sale into an instruction for avoiding it. The offer comes
 * first now; the free way out still follows, in the same breath.
 */
export async function requireNotebookRoom(user: AppUser, count = 1): Promise<void> {
  if (BETA_FREE) return;
  const quota = await notebookQuota(user);
  if (quota.limit !== null && quota.used + count > quota.limit) {
    throw new HttpError(
      402,
      `You've used all ${FREE_NOTEBOOK_LIMIT} class notebooks on the Free plan. `
      + `Upgrade to Pro for unlimited notebooks, or archive one you've finished with.`,
    );
  }
}

/**
 * How many more students this class can take: null for no limit, which is
 * every class during the beta and every class whose owner is on a paid plan.
 * The owner's plan decides, not the plan of whoever is adding the student —
 * a co-teacher on Pro doesn't lift the cap on a Free teacher's class.
 */
export async function studentRoom(classId: string): Promise<number | null> {
  if (BETA_FREE) return null;
  const row = await db
    .prepare(
      `SELECT c.owner_id, u.org_id,
              (SELECT COUNT(*) FROM enrollments WHERE class_id = c.id AND role = 'student' AND status = 'active') AS n
         FROM classes c JOIN users u ON u.id = c.owner_id
        WHERE c.id = ?`,
    )
    .bind(classId)
    .first<{ owner_id: string; org_id: string; n: number }>();
  if (!row) return null;
  const plan = await planForUser({ id: row.owner_id, org_id: row.org_id });
  const limit = plan.tier === "free" ? PLANS.free.studentLimit : null;
  return limit === null ? null : Math.max(0, limit - row.n);
}

/** Said to the teacher, beside each student an invite or import couldn't add. */
export const CLASS_FULL_FOR_TEACHER =
  `The class is full: a class on the Free plan can have ${FREE_STUDENT_LIMIT} students. Upgrade to Pro for bigger classes.`;
/** Said to a student trying to join with a code. */
export const CLASS_FULL_FOR_STUDENT = "This class is full. Ask your teacher to make room for you.";
