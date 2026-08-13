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
      role: user.role, isAdmin: !!user.is_admin,
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

/** Admin-only roster of everyone in the org, so an admin can promote a teacher. */
app.get("/api/org/users", handler(async (c) => {
  const user = await requireUser(c);
  if (!user.is_admin) throw new HttpError(403, "Admin access required");
  const rows = await db
    .prepare(`SELECT id, email, name, picture, role, is_admin, last_seen_at FROM users WHERE org_id = ? ORDER BY name`)
    .bind(user.org_id)
    .all();
  return c.json({ users: rows.results ?? [] });
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
