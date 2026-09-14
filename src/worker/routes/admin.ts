/**
 * Superadmin: the whole system, in one place.
 *
 * Two rules shape what's here.
 *
 * Reads are wide. A superadmin can see every user, notebook, assignment and
 * grade, because the point of the role is answering "what is actually going on"
 * without a database console.
 *
 * Writes are narrow, and deliberately so. Editing a title or a grade is
 * reversible and obviously scoped; deleting a notebook from a spreadsheet cell
 * is neither, and a grid makes destruction indistinguishable from a typo. So
 * this exposes no deletes — those stay behind the screens that already confirm
 * them and explain what they affect.
 */

import { app, db } from "../platform";
import {
  HttpError, handler, now, param, requireUser, uid, findUserInOrg,
  IMPERSONATE_MINUTES, setImpersonateCookie, clearImpersonateCookie, activeImpersonation,
} from "../lib/session";
import { SUPERADMIN_EMAILS } from "../schema";
import { page } from "../lib/paging";
import { PLANS, type PlanKey } from "../../shared/plans.mjs";

export async function requireSuperadmin(c: any) {
  const user = await requireUser(c);
  // The seed list is authoritative, so a superadmin still works if the column
  // was somehow missed — the migration and this check can't disagree.
  if (!user.is_superadmin && !SUPERADMIN_EMAILS.includes(user.email)) {
    throw new HttpError(403, "Superadmin access required");
  }
  return user;
}

/** Fields a superadmin may change, per table. Anything not listed is read-only. */
const EDITABLE: Record<string, { table: string; columns: string[] }> = {
  orgs: { table: "orgs", columns: ["name", "teacher_domains", "student_domains"] },
  users: { table: "users", columns: ["name", "role", "is_admin", "is_superadmin"] },
  notebooks: { table: "notebooks", columns: ["title", "status"] },
  assignments: { table: "assignments", columns: ["title", "due_at", "status", "points_max"] },
  submissions: { table: "submissions", columns: ["grade_points", "grade_letter", "feedback", "status"] },
};

app.get("/api/admin/overview", handler(async (c) => {
  await requireSuperadmin(c);
  const one = async (sql: string) => (await db.prepare(sql).first<{ n: number }>())?.n ?? 0;
  return c.json({
    users: await one(`SELECT COUNT(*) AS n FROM users`),
    teachers: await one(`SELECT COUNT(*) AS n FROM users WHERE role = 'teacher'`),
    students: await one(`SELECT COUNT(*) AS n FROM users WHERE role = 'student'`),
    classes: await one(`SELECT COUNT(*) AS n FROM classes`),
    notebooks: await one(`SELECT COUNT(*) AS n FROM notebooks`),
    assignments: await one(`SELECT COUNT(*) AS n FROM assignments`),
    submissions: await one(`SELECT COUNT(*) AS n FROM submissions`),
    errorsToday: await one(
      `SELECT COUNT(*) AS n FROM api_log WHERE created_at > datetime('now', '-1 day')`,
    ),
  });
}));

/**
 * The schools on the platform.
 *
 * `primary_domain` is what sign-in resolves against, so it is set once here and
 * never editable in the grid: changing it would strand every account already
 * created under it.
 */
app.get("/api/admin/orgs", handler(async (c) => {
  await requireSuperadmin(c);
  return page(c, {
    select: `o.id, o.name, o.primary_domain, o.teacher_domains, o.student_domains, o.created_at,
             (SELECT COUNT(*) FROM users u WHERE u.org_id = o.id) AS users,
             (SELECT COUNT(*) FROM classes c2 WHERE c2.org_id = o.id) AS classes,
             (SELECT s.plan FROM subscriptions s
               WHERE s.org_id = o.id AND s.plan IN ('school', 'department')
                 AND s.status IN ('active', 'trialing', 'past_due')
                 AND (s.expires_at IS NULL OR s.expires_at > ?)
               ORDER BY CASE s.plan WHEN 'school' THEN 0 ELSE 1 END LIMIT 1) AS plan`,
    selectParams: [now()],
    from: `orgs o`,
    searchable: ["o.name", "o.primary_domain"],
    order: `o.created_at DESC`,
  });
}));

/**
 * Switch a school's plan on by hand — the whole of the invoice/PO path.
 *
 * An endpoint rather than a grid edit because it writes an audit trail: who
 * comped it, why, and until when. A comped row entitles exactly as a paid one
 * does; `plan: "free"` ends whatever comp is running.
 */
app.post("/api/admin/orgs/:id/plan", handler(async (c) => {
  const actor = await requireSuperadmin(c);
  const orgId = param(c, "id");
  const body = await c.req.json<{ plan?: string; reason?: string; expiresAt?: string; seatEmail?: string }>();
  const plan = String(body.plan ?? "") as PlanKey;
  if (!(plan in PLANS)) throw new HttpError(400, "Unknown plan");
  const reason = (body.reason ?? "").trim();
  if (!reason) throw new HttpError(400, "Say why — it goes on the record.");
  const org = await db.prepare(`SELECT id FROM orgs WHERE id = ?`).bind(orgId).first();
  if (!org) throw new HttpError(404, "School not found");

  const ts = now();
  // One comp at a time per school: the new one replaces whatever was running.
  await db
    .prepare(
      `UPDATE subscriptions SET status = 'canceled', ended_at = ?, updated_at = ?
        WHERE org_id = ? AND provider = 'comp' AND status = 'active'`,
    )
    .bind(ts, ts, orgId)
    .run();
  if (plan === "free") return c.json({ ok: true, plan });

  const expiresAt = body.expiresAt ? new Date(body.expiresAt).toISOString() : null;
  const id = uid();
  await db
    .prepare(
      `INSERT INTO subscriptions
         (id, org_id, plan, status, provider, seat_count, comped_by, comped_reason, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, 'active', 'comp', ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, orgId, plan, PLANS[plan].seats, actor.id, reason, expiresAt, ts, ts)
    .run();

  // A comped Pro is one person's; the address says whose.
  if (plan === "pro") {
    const email = (body.seatEmail ?? "").trim().toLowerCase();
    if (!email) throw new HttpError(400, "A Pro comp needs the teacher's email");
    const holder = await findUserInOrg(email, orgId);
    if (!holder) throw new HttpError(404, "No account with that email at this school");
    await db
      .prepare(
        `INSERT OR IGNORE INTO plan_seats (id, subscription_id, org_id, user_id, granted_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(uid(), id, orgId, holder.id, actor.id, ts)
      .run();
  }
  return c.json({ ok: true, plan, id, seats: PLANS[plan].seats });
}));

app.post("/api/admin/orgs", handler(async (c) => {
  await requireSuperadmin(c);
  const b = await c.req.json<{
    name?: string; primaryDomain?: string; teacherDomains?: string; studentDomains?: string;
  }>();
  const name = (b.name ?? "").trim();
  const domain = (b.primaryDomain ?? "").trim().toLowerCase().replace(/^@/, "");
  if (!name) throw new HttpError(400, "Give the school a name");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) throw new HttpError(400, "That doesn't look like an email domain");

  const clash = await db
    .prepare(`SELECT name FROM orgs WHERE lower(primary_domain) = ?`)
    .bind(domain)
    .first<{ name: string }>();
  if (clash) throw new HttpError(409, `${domain} already belongs to ${clash.name}`);

  const id = uid();
  await db
    .prepare(
      `INSERT INTO orgs (id, name, primary_domain, teacher_domains, student_domains, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, name, domain, (b.teacherDomains ?? "").trim(), (b.studentDomains ?? "").trim(), now())
    .run();
  return c.json({ id });
}));

app.get("/api/admin/users", handler(async (c) => {
  await requireSuperadmin(c);
  return page(c, {
    select: `u.id, u.email, u.name, u.role, u.is_admin, u.is_superadmin, u.created_at, u.last_seen_at,
             (SELECT COUNT(*) FROM enrollments e WHERE e.user_id = u.id) AS classes`,
    from: `users u`,
    searchable: ["u.email", "u.name", "u.role"],
    order: `u.created_at DESC`,
  });
}));

app.get("/api/admin/notebooks", handler(async (c) => {
  await requireSuperadmin(c);
  return page(c, {
    select: `n.id, n.title, n.status, n.page_count, n.created_at, n.updated_at,
             c.name AS class_name, u.email AS owner_email,
             (SELECT COUNT(*) FROM assignments a WHERE a.notebook_id = n.id) AS assignments`,
    from: `notebooks n
           LEFT JOIN classes c ON c.id = n.class_id
           LEFT JOIN users u ON u.id = n.owner_id`,
    searchable: ["n.title", "c.name", "u.email"],
    order: `n.updated_at DESC`,
  });
}));

app.get("/api/admin/assignments", handler(async (c) => {
  await requireSuperadmin(c);
  return page(c, {
    select: `a.id, a.title, a.status, a.due_at, a.grading, a.points_max, a.created_at,
             c.name AS class_name, n.title AS notebook_title,
             (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id) AS submissions,
             (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id AND s.graded_at IS NOT NULL) AS graded`,
    from: `assignments a
           LEFT JOIN classes c ON c.id = a.class_id
           LEFT JOIN notebooks n ON n.id = a.notebook_id`,
    searchable: ["a.title", "c.name", "n.title"],
    order: `a.created_at DESC`,
  });
}));

app.get("/api/admin/grades", handler(async (c) => {
  await requireSuperadmin(c);
  return page(c, {
    select: `s.id, u.email AS student_email, a.title AS assignment, c.name AS class_name,
             s.status, s.grade_points, s.grade_letter, s.grade_complete, s.feedback,
             a.points_max, s.submitted_at, s.returned_at, s.graded_at`,
    from: `submissions s
           LEFT JOIN users u ON u.id = s.student_id
           LEFT JOIN assignments a ON a.id = s.assignment_id
           LEFT JOIN classes c ON c.id = a.class_id`,
    searchable: ["u.email", "a.title", "c.name", "s.status"],
    order: `COALESCE(s.graded_at, s.submitted_at, s.id) DESC`,
  });
}));

app.get("/api/admin/logs", handler(async (c) => {
  await requireSuperadmin(c);
  const orgId = new URL(c.req.url).searchParams.get("org_id");
  return page(c, {
    select: `l.id, l.method, l.path, l.status, l.duration_ms, l.message, l.created_at,
             u.email AS user_email, o.name AS org_name`,
    from: `api_log l LEFT JOIN users u ON u.id = l.user_id LEFT JOIN orgs o ON o.id = l.org_id`,
    searchable: ["l.path", "l.message", "u.email"],
    order: `l.created_at DESC`,
    scope: orgId ? { condition: `l.org_id = ?`, params: [orgId] } : undefined,
  });
}));

/**
 * Row-count usage for one school — the "what's actually going on at school X"
 * question a support conversation needs answered fast. R2 storage isn't
 * included: keys are namespaced by class, not by org, so an accurate byte
 * count means joining class -> org first or walking prefixes — worth doing
 * if this becomes a frequent ask, not before.
 */
app.get("/api/admin/orgs/:id/usage", handler(async (c) => {
  await requireSuperadmin(c);
  const orgId = param(c, "id");
  const one = async (sql: string, ...params: unknown[]) =>
    (await db.prepare(sql).bind(...params).first<{ n: number }>())?.n ?? 0;
  return c.json({
    users: await one(`SELECT COUNT(*) AS n FROM users WHERE org_id = ?`, orgId),
    classes: await one(`SELECT COUNT(*) AS n FROM classes WHERE org_id = ?`, orgId),
    notebooks: await one(
      `SELECT COUNT(*) AS n FROM notebooks n2
        LEFT JOIN classes cl ON cl.id = n2.class_id
        LEFT JOIN users owner ON owner.id = n2.owner_id
        WHERE COALESCE(cl.org_id, owner.org_id) = ?`,
      orgId,
    ),
    submissions: await one(
      `SELECT COUNT(*) AS n FROM submissions s
        JOIN assignments a ON a.id = s.assignment_id
        JOIN classes cl ON cl.id = a.class_id
        WHERE cl.org_id = ?`,
      orgId,
    ),
  });
}));

/**
 * Impersonation log — the audit trail for the feature below. Read-only, and
 * deliberately not in EDITABLE: nobody, including a superadmin, edits their
 * own audit history through a spreadsheet cell.
 */
app.get("/api/admin/impersonations", handler(async (c) => {
  await requireSuperadmin(c);
  return page(c, {
    select: `i.id, i.reason, i.started_at, i.expires_at, i.ended_at,
             sa.email AS superadmin_email, tu.email AS target_email, tu.name AS target_name`,
    from: `impersonation_sessions i
           LEFT JOIN users sa ON sa.id = i.superadmin_id
           LEFT JOIN users tu ON tu.id = i.target_user_id`,
    searchable: ["sa.email", "tu.email", "tu.name", "i.reason"],
    order: `i.started_at DESC`,
  });
}));

/**
 * Start viewing as another user — for support, when the fastest way to
 * understand what someone's seeing is to see it. Read-only: the write guard
 * in lib/session.ts's handler() refuses every mutating request while a
 * session is active, this endpoint's own row is the audit trail, and the
 * session expires on its own in 30 minutes even if nobody ends it early.
 */
app.post("/api/admin/impersonate", handler(async (c) => {
  const actor = await requireSuperadmin(c);
  const body = await c.req.json<{ targetUserId?: string; reason?: string }>();
  const targetUserId = (body.targetUserId ?? "").trim();
  const reason = (body.reason ?? "").trim();
  if (!reason) throw new HttpError(400, "Say why — it goes on the record.");
  if (!targetUserId) throw new HttpError(400, "Choose who to view as");
  if (targetUserId === actor.id) throw new HttpError(400, "You're already signed in as yourself");

  const target = await db.prepare(`SELECT id, name, email FROM users WHERE id = ?`).bind(targetUserId).first<any>();
  if (!target) throw new HttpError(404, "User not found");

  const id = uid();
  const expiresAt = new Date(Date.now() + IMPERSONATE_MINUTES * 60_000).toISOString();
  await db
    .prepare(
      `INSERT INTO impersonation_sessions (id, superadmin_id, target_user_id, reason, started_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, actor.id, targetUserId, reason, now(), expiresAt)
    .run();
  setImpersonateCookie(c, id);
  return c.json({ ok: true, targetName: target.name, targetEmail: target.email, expiresAt });
}));

/** End an impersonation session early. Allowlisted in the write guard, so this works even mid-session. */
app.post("/api/admin/impersonate/end", handler(async (c) => {
  const active = await activeImpersonation(c);
  if (active) {
    await db.prepare(`UPDATE impersonation_sessions SET ended_at = ? WHERE id = ?`).bind(now(), active.id).run();
  }
  clearImpersonateCookie(c);
  return c.json({ ok: true });
}));

/**
 * Change one cell.
 *
 * The table and column are checked against the allowlist above rather than
 * interpolated from the request, so a crafted body can't reach a column — or a
 * table — that was never meant to be editable.
 */
app.patch("/api/admin/:kind/:id", handler(async (c) => {
  const actor = await requireSuperadmin(c);
  const kind = param(c, "kind");
  const id = param(c, "id");
  const spec = EDITABLE[kind];
  if (!spec) throw new HttpError(400, "That table isn't editable");

  const body = await c.req.json<{ column: string; value: unknown }>();
  if (!spec.columns.includes(body.column)) throw new HttpError(400, `Column "${body.column}" isn't editable`);

  // Nobody can strip their own superadmin: it's the one change that can leave
  // the system with no one able to undo it.
  if (kind === "users" && body.column === "is_superadmin" && id === actor.id && !body.value) {
    throw new HttpError(400, "You can't remove your own superadmin access.");
  }

  const value =
    body.value === null || body.value === undefined
      ? null
      : typeof body.value === "boolean"
        ? (body.value ? 1 : 0)
        : body.value as string | number;

  await db
    .prepare(`UPDATE ${spec.table} SET ${body.column} = ? WHERE id = ?`)
    .bind(value, id)
    .run();

  if (spec.table === "notebooks" || spec.table === "assignments") {
    await db.prepare(`UPDATE ${spec.table} SET updated_at = ? WHERE id = ?`).bind(now(), id).run();
  }
  return c.json({ ok: true });
}));
