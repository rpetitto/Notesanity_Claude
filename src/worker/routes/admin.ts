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

import { app, db } from "flingit";
import { HttpError, handler, now, param, requireUser } from "../lib/session";
import { SUPERADMIN_EMAILS } from "../schema";

async function requireSuperadmin(c: any) {
  const user = await requireUser(c);
  // The seed list is authoritative, so a superadmin still works if the column
  // was somehow missed — the migration and this check can't disagree.
  if (!user.is_superadmin && !SUPERADMIN_EMAILS.includes(user.email)) {
    throw new HttpError(403, "Superadmin access required");
  }
  return user;
}

/**
 * Paging, so a console page costs the same on day one and at fifty thousand users.
 *
 * These tables used to come back whole — every user, every notebook, every
 * grade — which was fine at a few hundred rows and 412 KB of JSON at two
 * thousand. The window is clamped rather than trusted: a crafted `limit` can't
 * ask for the table back.
 */
const PAGE_DEFAULT = 100;
const PAGE_MAX = 500;

function paging(c: any): { limit: number; offset: number; q: string } {
  const url = new URL(c.req.url);
  // An absent parameter has to be caught before Number(), which reads both null
  // and "" as 0 and would otherwise turn "no limit given" into a limit of zero.
  const asInt = (raw: string | null, fallback: number) => {
    if (raw === null || raw.trim() === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
  };
  return {
    limit: Math.min(PAGE_MAX, Math.max(1, asInt(url.searchParams.get("limit"), PAGE_DEFAULT))),
    offset: asInt(url.searchParams.get("offset"), 0),
    q: (url.searchParams.get("q") ?? "").trim().slice(0, 100),
  };
}

/** A case-insensitive contains-match across the columns worth searching. */
function search(q: string, columns: string[]): { where: string; params: string[] } {
  if (!q) return { where: "", params: [] };
  const like = `%${q}%`;
  return {
    where: `WHERE (${columns.map((col) => `${col} LIKE ?`).join(" OR ")})`,
    params: columns.map(() => like),
  };
}

/**
 * Run one windowed query and its matching count.
 *
 * The count uses the same FROM and WHERE as the page, so the total a superadmin
 * reads always describes the rows they are actually looking through.
 */
async function page(
  c: any,
  opts: { select: string; from: string; searchable: string[]; order: string },
) {
  const { limit, offset, q } = paging(c);
  const { where, params } = search(q, opts.searchable);

  const rows = await db
    .prepare(`SELECT ${opts.select} FROM ${opts.from} ${where} ORDER BY ${opts.order} LIMIT ? OFFSET ?`)
    .bind(...params, limit, offset)
    .all<any>();

  const counted = await db
    .prepare(`SELECT COUNT(*) AS n FROM ${opts.from} ${where}`)
    .bind(...params)
    .first<{ n: number }>();

  return c.json({ rows: rows.results ?? [], total: counted?.n ?? 0, limit, offset });
}

/** Fields a superadmin may change, per table. Anything not listed is read-only. */
const EDITABLE: Record<string, { table: string; columns: string[] }> = {
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
  return page(c, {
    select: `l.id, l.method, l.path, l.status, l.duration_ms, l.message, l.created_at,
             u.email AS user_email`,
    from: `api_log l LEFT JOIN users u ON u.id = l.user_id`,
    searchable: ["l.path", "l.message", "u.email"],
    order: `l.created_at DESC`,
  });
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
