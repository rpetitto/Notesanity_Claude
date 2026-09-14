/**
 * Per-school admin oversight — notebooks, assignments and grades, scoped to
 * the requesting admin's own org_id.
 *
 * This is the school-admin counterpart to routes/admin.ts's superadmin
 * console: same paged-grid shape (see lib/paging.ts, shared by both), same
 * read-only-in-the-grid philosophy, but every query is pinned to one org so
 * an admin can never see another school's data. None of notebooks,
 * assignments or submissions carry `org_id` directly, so each is reached by
 * joining back through `classes.org_id` (or, for a personal notebook with no
 * class, through its owner's `org_id`) — the same join shape used by
 * GET /api/org/overview in me.ts.
 */

import { app } from "../platform";
import { HttpError, handler, requireUser } from "../lib/session";
import { page } from "../lib/paging";

async function requireOrgAdmin(c: any) {
  const user = await requireUser(c);
  if (!user.is_admin) throw new HttpError(403, "Admin access required");
  return user;
}

app.get("/api/org/notebooks", handler(async (c) => {
  const admin = await requireOrgAdmin(c);
  return page(c, {
    select: `n.id, n.title, n.status, n.page_count, n.created_at, n.updated_at,
             c.name AS class_name, u.email AS owner_email,
             (SELECT COUNT(*) FROM assignments a WHERE a.notebook_id = n.id) AS assignments`,
    from: `notebooks n
           LEFT JOIN classes c ON c.id = n.class_id
           LEFT JOIN users u ON u.id = n.owner_id`,
    searchable: ["n.title", "c.name", "u.email"],
    order: `n.updated_at DESC`,
    scope: { condition: `COALESCE(c.org_id, u.org_id) = ?`, params: [admin.org_id] },
  });
}));

app.get("/api/org/assignments", handler(async (c) => {
  const admin = await requireOrgAdmin(c);
  return page(c, {
    select: `a.id, a.title, a.status, a.due_at, a.grading, a.points_max, a.created_at,
             c.name AS class_name, n.title AS notebook_title,
             (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id) AS submissions,
             (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id AND s.graded_at IS NOT NULL) AS graded`,
    from: `assignments a
           JOIN classes c ON c.id = a.class_id
           LEFT JOIN notebooks n ON n.id = a.notebook_id`,
    searchable: ["a.title", "c.name", "n.title"],
    order: `a.created_at DESC`,
    scope: { condition: `c.org_id = ?`, params: [admin.org_id] },
  });
}));

app.get("/api/org/grades", handler(async (c) => {
  const admin = await requireOrgAdmin(c);
  return page(c, {
    select: `s.id, u.email AS student_email, a.title AS assignment, c.name AS class_name,
             s.status, s.grade_points, s.grade_letter, s.grade_complete, s.feedback,
             a.points_max, s.submitted_at, s.returned_at, s.graded_at`,
    from: `submissions s
           LEFT JOIN users u ON u.id = s.student_id
           JOIN assignments a ON a.id = s.assignment_id
           JOIN classes c ON c.id = a.class_id`,
    searchable: ["u.email", "a.title", "c.name", "s.status"],
    order: `COALESCE(s.graded_at, s.submitted_at, s.id) DESC`,
    scope: { condition: `c.org_id = ?`, params: [admin.org_id] },
  });
}));
