import { app, db } from "../platform";
import { email as mailer } from "../platform/email";
import { HttpError, handler, param, requireClassTeacher, requireUser } from "../lib/session";
import { renderEmail } from "../lib/email";
import { logMail } from "../lib/maillog";
import {
  codeFor, codesFor, formatCode, linkGuardian, lookupCode, requireCode,
} from "../lib/family";
import { workPayload } from "./work";
import { HAS_INK_BYTES } from "../lib/ink";

/**
 * Families: reading along with a child's work, and the teachers and admins who
 * hand out the codes that allow it.
 *
 * Everything a family account reads comes through here or through the
 * notebook routes' read-only family branch, and `requireUser` refuses every
 * write a family account attempts outside `/api/family/`. What a family sees
 * is what the child sees of their own work — their writing, their answers,
 * the teacher's marks and returned grades — and nothing of anyone else's.
 */

const appOrigin = (c: any) => {
  const url = new URL(c.req.url);
  return `${url.protocol}//${url.host}`;
};
const familyLink = (c: any, code: string) => `${appOrigin(c)}/family?code=${formatCode(code)}`;

// --------------------------------------------------------------- codes

/** Checked before anyone signs in, so the page can say whose code it is. */
app.get("/api/family/code/:code", handler(async (c) => {
  const holder = await lookupCode(param(c, "code"));
  if (!holder) return c.json({ valid: false });
  if (!holder.familyAccess) return c.json({ valid: false, reason: "Your child's school hasn't turned on family access yet." });
  // First name only: enough to reassure a parent they typed the right code.
  return c.json({ valid: true, child: holder.studentName.split(" ")[0] });
}));

/** A signed-in parent adding another child. */
app.post("/api/family/link", handler(async (c) => {
  const user = await requireUser(c);
  if (user.role === "student") throw new HttpError(403, "Family codes are for parents and guardians, not student accounts.");
  const { code } = await c.req.json<{ code?: string }>();
  const holder = await requireCode(code);
  await linkGuardian(user.id, holder);
  return c.json({ ok: true, studentId: holder.studentId });
}));

// ------------------------------------------------------------ children

/** The children linked to this account, with the classes each is in. */
app.get("/api/family/children", handler(async (c) => {
  const user = await requireUser(c);
  const [kids, classes] = await db.batch([
    db.prepare(
      `SELECT u.id, u.name, u.picture, o.family_access
         FROM guardian_links g
         JOIN users u ON u.id = g.student_id
         JOIN orgs o ON o.id = g.org_id
        WHERE g.guardian_id = ?
        ORDER BY u.name`,
    ).bind(user.id),
    db.prepare(
      `SELECT e.user_id AS student_id, cl.id, cl.name, cl.section, cl.emoji, t.name AS teacher
         FROM guardian_links g
         JOIN enrollments e ON e.user_id = g.student_id AND e.role = 'student' AND e.status = 'active'
         JOIN classes cl ON cl.id = e.class_id AND cl.archived = 0
         LEFT JOIN users t ON t.id = cl.owner_id
        WHERE g.guardian_id = ?
        ORDER BY cl.name`,
    ).bind(user.id),
  ]);
  const byKid = new Map<string, any[]>();
  for (const r of (classes.results ?? []) as any[]) {
    const list = byKid.get(r.student_id) ?? [];
    list.push({ id: r.id, name: r.section ? `${r.name} · ${r.section}` : r.name, emoji: r.emoji ?? "", teacher: r.teacher ?? "" });
    byKid.set(r.student_id, list);
  }
  return c.json({
    children: ((kids.results ?? []) as any[]).map((k) => ({
      id: k.id, name: k.name, picture: k.picture,
      // The school can switch family access off; the link stays, the view closes.
      open: !!k.family_access,
      classes: byKid.get(k.id) ?? [],
    })),
  });
}));

/** A parent removing a child from their own account. */
app.delete("/api/family/children/:studentId", handler(async (c) => {
  const user = await requireUser(c);
  await db.prepare(`DELETE FROM guardian_links WHERE guardian_id = ? AND student_id = ?`)
    .bind(user.id, param(c, "studentId")).run();
  return c.json({ ok: true });
}));

/** The link and the school's switch, or a refusal that says which is missing. */
async function requireChild(c: any, studentId: string) {
  const user = await requireUser(c);
  const row = await db
    .prepare(
      `SELECT u.name, o.family_access FROM guardian_links g
         JOIN users u ON u.id = g.student_id
         JOIN orgs o ON o.id = g.org_id
        WHERE g.guardian_id = ? AND g.student_id = ?`,
    )
    .bind(user.id, studentId)
    .first<{ name: string; family_access: number }>();
  if (!row) throw new HttpError(404, "That isn't one of your children here.");
  if (!row.family_access) throw new HttpError(403, "The school has turned family access off for now.");
  return { user, childName: row.name };
}

/**
 * One child's assignments and notebooks, across every class they're in.
 *
 * Assignments are the ones the child can see — active and released — with
 * where they've got to and, once returned, the grade and feedback. Notebooks
 * are the class's published ones plus the child's own notebooks in those
 * classes, which their teacher can already read. A personal notebook, made
 * outside any class, is the child's alone and isn't shown.
 */
app.get("/api/family/children/:studentId/overview", handler(async (c) => {
  const studentId = param(c, "studentId");
  const { childName } = await requireChild(c, studentId);
  const [assignmentsRes, notebooksRes] = await db.batch([
    db.prepare(
      `SELECT a.id, a.title, a.instructions, a.notebook_id, a.page_ids, a.release_at, a.due_at, a.grading, a.points_max,
              cl.id AS class_id, cl.name AS class_name, n.title AS notebook_title,
              s.status, s.submitted_at, s.returned_at, s.grade_points, s.grade_letter, s.grade_complete, s.feedback,
              -- "Started" the way the teacher's roster decides it: ink or an
              -- answer on one of the assignment's pages.
              (EXISTS (SELECT 1 FROM instances i JOIN layers l ON l.instance_id = i.id
                        WHERE i.notebook_id = a.notebook_id AND i.student_id = e.user_id
                          AND l.kind = 'student' AND l.byte_length > ${HAS_INK_BYTES}
                          AND l.page_id IN (SELECT value FROM json_each(a.page_ids)))
               OR EXISTS (SELECT 1 FROM instances i JOIN field_values v ON v.instance_id = i.id JOIN fields f ON f.id = v.field_id
                        WHERE i.notebook_id = a.notebook_id AND i.student_id = e.user_id AND f.archived = 0
                          AND f.page_id IN (SELECT value FROM json_each(a.page_ids))
                          AND (TRIM(v.value) <> '' OR v.asset_key IS NOT NULL))) AS started
         FROM enrollments e
         JOIN classes cl ON cl.id = e.class_id AND cl.archived = 0
         JOIN assignments a ON a.class_id = cl.id AND a.status = 'active'
                           AND (a.release_at IS NULL OR a.release_at <= datetime('now'))
         JOIN notebooks n ON n.id = a.notebook_id AND n.status = 'published'
         LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = e.user_id
        WHERE e.user_id = ? AND e.role = 'student' AND e.status = 'active'
        ORDER BY COALESCE(a.due_at, a.created_at) DESC`,
    ).bind(studentId),
    db.prepare(
      `SELECT n.id, n.title, n.kind, n.page_count, n.accent_color, n.updated_at,
              cl.id AS class_id, cl.name AS class_name
         FROM enrollments e
         JOIN classes cl ON cl.id = e.class_id AND cl.archived = 0
         JOIN notebooks n ON n.class_id = cl.id AND n.archived = 0
                         AND ((n.kind = 'class' AND n.status = 'published') OR (n.kind = 'student' AND n.owner_id = e.user_id))
        WHERE e.user_id = ? AND e.role = 'student' AND e.status = 'active'
        ORDER BY cl.name, n.title`,
    ).bind(studentId),
  ]);
  return c.json({
    child: { id: studentId, name: childName },
    assignments: ((assignmentsRes.results ?? []) as any[]).map((a) => ({
      id: a.id, title: a.title, instructions: a.instructions ?? "",
      classId: a.class_id, className: a.class_name,
      notebookId: a.notebook_id, notebookTitle: a.notebook_title,
      pageIds: JSON.parse(a.page_ids || "[]") as string[],
      releaseAt: a.release_at, dueAt: a.due_at,
      status: (a.status ?? "not_started") === "not_started" && a.started ? "in_progress" : a.status ?? "not_started",
      submittedAt: a.submitted_at ?? null,
      grade: a.returned_at
        ? { grading: a.grading, pointsMax: a.points_max, points: a.grade_points, letter: a.grade_letter, complete: a.grade_complete, feedback: a.feedback ?? "" }
        : null,
    })),
    notebooks: ((notebooksRes.results ?? []) as any[]).map((n) => ({
      id: n.id, title: n.title, own: n.kind === "student", pageCount: n.page_count,
      color: n.accent_color ?? "#2E7D6B", updatedAt: n.updated_at,
      classId: n.class_id, className: n.class_name,
    })),
  });
}));

/**
 * A child's copy of one notebook, read-only: the same payload the child's own
 * view gets. Nothing is created by looking — a notebook the child hasn't
 * opened yet shows its pages with nothing written on them.
 */
app.get("/api/family/children/:studentId/notebooks/:notebookId", handler(async (c) => {
  const studentId = param(c, "studentId");
  await requireChild(c, studentId);
  const nb = await db
    .prepare(
      `SELECT n.* FROM notebooks n
         JOIN classes cl ON cl.id = n.class_id AND cl.archived = 0
         JOIN enrollments e ON e.class_id = cl.id AND e.user_id = ? AND e.role = 'student' AND e.status = 'active'
        WHERE n.id = ? AND n.archived = 0
          AND ((n.kind = 'class' AND n.status = 'published') OR (n.kind = 'student' AND n.owner_id = ?))`,
    )
    .bind(studentId, param(c, "notebookId"), studentId)
    .first<any>();
  if (!nb) throw new HttpError(404, "Notebook not found");
  const instance = await db
    .prepare(`SELECT id FROM instances WHERE notebook_id = ? AND student_id = ?`)
    .bind(nb.id, studentId)
    .first<{ id: string }>();
  const wanted = (c.req.query("pages") || "").split(",").map((p) => p.trim()).filter(Boolean);
  // No instance yet: an id nothing matches, so the pages come back blank.
  const payload = await workPayload(nb, instance?.id ?? "-", studentId, wanted);
  return c.json({
    notebook: { id: nb.id, title: nb.title, classId: nb.class_id, kind: nb.kind },
    ...payload,
    readOnly: true,
  });
}));

// ------------------------------------------------ teachers: a class's families

async function requireStudentInClass(classId: string, studentId: string) {
  const row = await db
    .prepare(
      `SELECT u.id, u.name, u.email, u.org_id FROM enrollments e JOIN users u ON u.id = e.user_id
        WHERE e.class_id = ? AND e.user_id = ? AND e.role = 'student' AND e.status = 'active'`,
    )
    .bind(classId, studentId)
    .first<{ id: string; name: string; email: string; org_id: string }>();
  if (!row) throw new HttpError(404, "That student isn't in this class.");
  return row;
}

/** Every student in the class with their family code and who's linked. */
app.get("/api/classes/:id/family", handler(async (c) => {
  const classId = param(c, "id");
  const teacher = await requireClassTeacher(c, classId);
  const [studentsRes, linksRes, orgRes] = await db.batch([
    db.prepare(
      `SELECT u.id, u.name, u.email, u.org_id FROM enrollments e JOIN users u ON u.id = e.user_id
        WHERE e.class_id = ? AND e.role = 'student' AND e.status = 'active' ORDER BY u.name`,
    ).bind(classId),
    db.prepare(
      `SELECT g.id, g.student_id, g.created_at, p.id AS guardian_id, p.name, p.email
         FROM guardian_links g
         JOIN enrollments e ON e.user_id = g.student_id AND e.class_id = ? AND e.role = 'student' AND e.status = 'active'
         JOIN users p ON p.id = g.guardian_id
        ORDER BY p.name`,
    ).bind(classId),
    db.prepare(`SELECT family_access FROM orgs WHERE id = ?`).bind(teacher.org_id),
  ]);
  const students = (studentsRes.results ?? []) as { id: string; name: string; email: string; org_id: string }[];
  const codes = await codesFor(students.map((s) => ({ id: s.id, orgId: s.org_id })), teacher.id);
  const links = new Map<string, any[]>();
  for (const l of (linksRes.results ?? []) as any[]) {
    const list = links.get(l.student_id) ?? [];
    list.push({ linkId: l.id, id: l.guardian_id, name: l.name, email: l.email, since: l.created_at });
    links.set(l.student_id, list);
  }
  return c.json({
    familyAccess: !!(orgRes.results?.[0] as any)?.family_access,
    students: students.map((s) => {
      const code = codes.get(s.id)!;
      return { id: s.id, name: s.name, email: s.email, code: formatCode(code), link: familyLink(c, code), guardians: links.get(s.id) ?? [] };
    }),
  });
}));

/** Retire a student's code and make a new one; families already linked stay linked. */
app.post("/api/classes/:id/family/:studentId/new-code", handler(async (c) => {
  const classId = param(c, "id");
  const teacher = await requireClassTeacher(c, classId);
  const s = await requireStudentInClass(classId, param(c, "studentId"));
  const code = await codeFor(s.id, s.org_id, teacher.id, true);
  return c.json({ code: formatCode(code), link: familyLink(c, code) });
}));

/** A teacher unlinking a family from one of their students. */
app.delete("/api/classes/:id/family/:studentId/guardians/:guardianId", handler(async (c) => {
  const classId = param(c, "id");
  await requireClassTeacher(c, classId);
  const s = await requireStudentInClass(classId, param(c, "studentId"));
  await db.prepare(`DELETE FROM guardian_links WHERE student_id = ? AND guardian_id = ?`).bind(s.id, param(c, "guardianId")).run();
  return c.json({ ok: true });
}));

/** Email a family their child's code, as a link that signs them in and links them. */
app.post("/api/classes/:id/family/:studentId/invite", handler(async (c) => {
  const classId = param(c, "id");
  const teacher = await requireClassTeacher(c, classId);
  const s = await requireStudentInClass(classId, param(c, "studentId"));
  const { email: raw } = await c.req.json<{ email?: string }>();
  const address = String(raw ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) throw new HttpError(400, "Enter the family's email address.");
  const code = await codeFor(s.id, s.org_id, teacher.id);
  const link = familyLink(c, code);
  const first = s.name.split(" ")[0];
  const { html, text } = renderEmail({
    preheader: `See ${first}'s notebooks and assignments on Notesanity.`,
    heading: `Follow along with ${first}'s work`,
    body: [
      `${teacher.name} invited you to see ${first}'s notebooks and assignments on Notesanity — what's due, what's been handed in, and the grades and feedback that come back.`,
      `You can look but not change anything. Sign in with any email address; the link below connects your account to ${first}.`,
      `Family code: ${formatCode(code)}`,
    ],
    action: { label: `See ${first}'s work`, url: link },
    note: "If you weren't expecting this, you can ignore it — nothing happens unless you sign in.",
  });
  try {
    const result = await mailer.send({ to: address, subject: `${teacher.name} invited you to follow ${first}'s work`, text, html });
    const ok = !(result && result.success === false);
    await logMail({ address, kind: "family_invite", status: ok ? "sent" : "failed", orgId: s.org_id, detail: ok ? result?.messageId ?? "" : "Provider reported the send as unsuccessful." });
    if (!ok) throw new HttpError(502, "The email didn't send — copy the link instead.");
  } catch (e) {
    if (e instanceof HttpError) throw e;
    const message = (e as Error).message;
    await logMail({ address, kind: "family_invite", status: "failed", orgId: s.org_id, detail: message });
    throw new HttpError(502, "The email didn't send — copy the link instead.");
  }
  return c.json({ ok: true });
}));

// ------------------------------------------------------------ admins

/** Every family link in the school. */
app.get("/api/org/family", handler(async (c) => {
  const user = await requireUser(c);
  if (!user.is_admin) throw new HttpError(403, "Admin access required");
  const rows = await db
    .prepare(
      `SELECT g.id, g.created_at, g.via, p.id AS guardian_id, p.name AS guardian_name, p.email AS guardian_email,
              s.id AS student_id, s.name AS student_name, s.email AS student_email
         FROM guardian_links g
         JOIN users p ON p.id = g.guardian_id
         JOIN users s ON s.id = g.student_id
        WHERE g.org_id = ?
        ORDER BY s.name, p.name`,
    )
    .bind(user.org_id)
    .all<any>();
  return c.json({ links: rows.results ?? [] });
}));

app.delete("/api/org/family/:linkId", handler(async (c) => {
  const user = await requireUser(c);
  if (!user.is_admin) throw new HttpError(403, "Admin access required");
  await db.prepare(`DELETE FROM guardian_links WHERE id = ? AND org_id = ?`).bind(param(c, "linkId"), user.org_id).run();
  return c.json({ ok: true });
}));
