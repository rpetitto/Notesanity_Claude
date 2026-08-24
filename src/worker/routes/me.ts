import { app, db } from "flingit";
import { currentUser, handler, now, requireUser, HttpError } from "../lib/session";

/** Who am I? Returns null (200) when signed out so the client can show the landing page. */
app.get("/api/me", handler(async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ user: null });
  const org = await db.prepare(`SELECT * FROM orgs WHERE id = ?`).bind(user.org_id).first<any>();
  return c.json({
    user: {
      id: user.id, email: user.email, name: user.name, picture: user.picture,
      role: user.role, isAdmin: !!user.is_admin, isSuperadmin: !!user.is_superadmin,
    },
    org: org ? { name: org.name, primaryDomain: org.primary_domain } : null,
  });
}));

/** First-run role choice, only available while the account is still 'pending'. */
app.post("/api/me/role", handler(async (c) => {
  const user = await requireUser(c);
  const { role } = await c.req.json<{ role: string }>();
  if (role !== "teacher" && role !== "student") throw new HttpError(400, "Invalid role");
  if (user.role !== "pending") throw new HttpError(400, "Role is already set");
  await db.prepare(`UPDATE users SET role = ? WHERE id = ?`).bind(role, user.id).run();
  return c.json({ ok: true, role });
}));

/** Admin-only: manage which email domains may sign in, and which imply teacher/student. */
app.get("/api/org", handler(async (c) => {
  const user = await requireUser(c);
  const org = await db.prepare(`SELECT * FROM orgs WHERE id = ?`).bind(user.org_id).first<any>();
  if (!org) throw new HttpError(404, "Org not found");
  return c.json({
    name: org.name,
    primaryDomain: org.primary_domain,
    teacherDomains: org.teacher_domains,
    studentDomains: org.student_domains,
    canEdit: !!user.is_admin,
  });
}));

app.patch("/api/org", handler(async (c) => {
  const user = await requireUser(c);
  if (!user.is_admin) throw new HttpError(403, "Admin access required");
  const body = await c.req.json<{ name?: string; teacherDomains?: string; studentDomains?: string }>();
  const org = await db.prepare(`SELECT * FROM orgs WHERE id = ?`).bind(user.org_id).first<any>();
  if (!org) throw new HttpError(404, "Org not found");
  await db
    .prepare(`UPDATE orgs SET name = ?, teacher_domains = ?, student_domains = ? WHERE id = ?`)
    .bind(
      body.name ?? org.name,
      body.teacherDomains ?? org.teacher_domains,
      body.studentDomains ?? org.student_domains,
      org.id,
    )
    .run();
  return c.json({ ok: true });
}));

/**
 * Admin-only roster of the school, so an admin can promote a teacher.
 *
 * Searched and windowed rather than returned whole: an admin is looking for one
 * person, and sending the entire school to find them cost 302 KB at two
 * thousand users and would cross 3 MB at a district's worth.
 */
app.get("/api/org/users", handler(async (c) => {
  const user = await requireUser(c);
  if (!user.is_admin) throw new HttpError(403, "Admin access required");

  const url = new URL(c.req.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const rawLimit = Number(url.searchParams.get("limit"));
  const limit = Math.min(500, Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 100);
  const rawOffset = Number(url.searchParams.get("offset"));
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;

  const filter = q ? `AND (email LIKE ? OR name LIKE ?)` : "";
  const params = q ? [`%${q}%`, `%${q}%`] : [];

  const rows = await db
    .prepare(
      `SELECT id, email, name, picture, role, is_admin, last_seen_at FROM users
        WHERE org_id = ? ${filter} ORDER BY name LIMIT ? OFFSET ?`,
    )
    .bind(user.org_id, ...params, limit, offset)
    .all();

  const counted = await db
    .prepare(`SELECT COUNT(*) AS n FROM users WHERE org_id = ? ${filter}`)
    .bind(user.org_id, ...params)
    .first<{ n: number }>();

  return c.json({ users: rows.results ?? [], total: counted?.n ?? 0, limit, offset });
}));

app.patch("/api/org/users/:id", handler(async (c) => {
  const user = await requireUser(c);
  if (!user.is_admin) throw new HttpError(403, "Admin access required");
  const { role } = await c.req.json<{ role: string }>();
  if (!["teacher", "student"].includes(role)) throw new HttpError(400, "Invalid role");
  const target = await db
    .prepare(`SELECT * FROM users WHERE id = ? AND org_id = ?`)
    .bind(c.req.param("id"), user.org_id)
    .first<any>();
  if (!target) throw new HttpError(404, "User not found");
  await db.prepare(`UPDATE users SET role = ? WHERE id = ?`).bind(role, target.id).run();
  return c.json({ ok: true });
}));

export const touchedAt = now;

/**
 * Admin-only: what happened to recent sign-in emails.
 *
 * The request endpoint answers identically whatever the outcome, so this is the
 * only place the difference between "refused", "rate limited" and "sent" is
 * visible. Admin-only because it lists addresses that tried to sign in.
 */
app.get("/api/org/mail", handler(async (c) => {
  const user = await requireUser(c);
  if (!user.is_admin) throw new HttpError(403, "Admin access required");
  const rows = await db
    .prepare(`SELECT address, kind, status, detail, created_at FROM mail_log ORDER BY created_at DESC LIMIT 50`)
    .all<any>();
  return c.json({ entries: rows.results ?? [] });
}));
