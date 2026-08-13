import { app, db } from "flingit";
import {
  handler, now, uid, requireUser, requireClassTeacher, requireClassMember, HttpError, param,} from "../lib/session";

/** An empty ink layer still serializes to a few characters, so require real content. */
const HAS_CONTENT = 24;

async function loadAssignment(c: any, assignmentId: string) {
  const a = await db.prepare(`SELECT * FROM assignments WHERE id = ?`).bind(assignmentId).first<any>();
  if (!a) throw new HttpError(404, "Assignment not found");
  const { user, isTeacher } = await requireClassMember(c, a.class_id);
  return { a, user, isTeacher };
}

/** Count how many of the assigned pages a student has actually worked on. */
async function completionFor(instanceId: string | null, pageIds: string[]): Promise<number> {
  if (!instanceId || pageIds.length === 0) return 0;
  const placeholders = pageIds.map(() => "?").join(",");
  const inked = await db
    .prepare(
      `SELECT COUNT(DISTINCT page_id) AS n FROM layers
        WHERE instance_id = ? AND kind = 'student' AND LENGTH(data) > ${HAS_CONTENT}
          AND page_id IN (${placeholders})`,
    )
    .bind(instanceId, ...pageIds)
    .first<{ n: number }>();
  const typed = await db
    .prepare(
      `SELECT COUNT(DISTINCT f.page_id) AS n FROM field_values v
         JOIN fields f ON f.id = v.field_id
        WHERE v.instance_id = ? AND TRIM(v.value) <> '' AND f.page_id IN (${placeholders})`,
    )
    .bind(instanceId, ...pageIds)
    .first<{ n: number }>();
  // A page counts once whether the work is ink, typed, or both — take the larger signal.
  return Math.max(inked?.n ?? 0, typed?.n ?? 0);
}

app.get("/api/classes/:id/assignments", handler(async (c) => {
  const classId = param(c, "id");
  const { user, isTeacher } = await requireClassMember(c, classId);
  const rows = await db
    .prepare(
      `SELECT a.*, n.title AS notebook_title FROM assignments a
         JOIN notebooks n ON n.id = a.notebook_id
        WHERE a.class_id = ? ${isTeacher ? "" : "AND a.status = 'active' AND (a.release_at IS NULL OR a.release_at <= datetime('now'))"}
        ORDER BY COALESCE(a.due_at, a.created_at) DESC`,
    )
    .bind(classId)
    .all<any>();

  const assignments = [];
  for (const a of rows.results ?? []) {
    const pageIds: string[] = JSON.parse(a.page_ids || "[]");
    const base = {
      id: a.id, title: a.title, notebookId: a.notebook_id, notebookTitle: a.notebook_title,
      pageCount: pageIds.length, releaseAt: a.release_at, dueAt: a.due_at,
      grading: a.grading, pointsMax: a.points_max, status: a.status,
    };
    if (isTeacher) {
      const counts = await db
        .prepare(
          `SELECT
             SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) AS submitted,
             SUM(CASE WHEN status = 'returned' THEN 1 ELSE 0 END) AS returned,
             COUNT(*) AS total
           FROM submissions WHERE assignment_id = ?`,
        )
        .bind(a.id)
        .first<any>();
      assignments.push({ ...base, submitted: counts?.submitted ?? 0, returned: counts?.returned ?? 0, total: counts?.total ?? 0 });
    } else {
      const sub = await db
        .prepare(`SELECT status, grade_points, grade_letter, grade_complete, feedback, returned_at FROM submissions WHERE assignment_id = ? AND student_id = ?`)
        .bind(a.id, user.id)
        .first<any>();
      const inst = await db
        .prepare(`SELECT id FROM instances WHERE notebook_id = ? AND student_id = ?`)
        .bind(a.notebook_id, user.id)
        .first<{ id: string }>();
      assignments.push({
        ...base,
        myStatus: sub?.status ?? "not_started",
        complete: await completionFor(inst?.id ?? null, pageIds),
        grade: sub?.returned_at
          ? { points: sub.grade_points, letter: sub.grade_letter, complete: sub.grade_complete, feedback: sub.feedback }
          : null,
      });
    }
  }
  return c.json({ assignments, isTeacher });
}));

app.post("/api/classes/:id/assignments", handler(async (c) => {
  const classId = param(c, "id");
  await requireClassTeacher(c, classId);
  const b = await c.req.json<any>();
  if (!b.title?.trim()) throw new HttpError(400, "Title is required");
  if (!b.notebookId) throw new HttpError(400, "Pick a notebook");
  if (!Array.isArray(b.pageIds) || b.pageIds.length === 0) throw new HttpError(400, "Select at least one page");
  const nb = await db
    .prepare(`SELECT id FROM notebooks WHERE id = ? AND class_id = ?`)
    .bind(b.notebookId, classId)
    .first();
  if (!nb) throw new HttpError(404, "Notebook not found in this class");

  const id = uid();
  const status = b.status === "active" ? "active" : "draft";
  await db
    .prepare(
      `INSERT INTO assignments (id, class_id, notebook_id, title, instructions, page_ids, release_at, due_at, grading, points_max, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id, classId, b.notebookId, b.title.trim(), b.instructions ?? "", JSON.stringify(b.pageIds),
      b.releaseAt || null, b.dueAt || null, b.grading ?? "points", b.pointsMax ?? 100, status, now(), now(),
    )
    .run();

  if (status === "active") await ensureSubmissions(id, classId);
  return c.json({ assignment: { id } });
}));

/** Create a submission row for every active student, so the dashboard is complete from the start. */
async function ensureSubmissions(assignmentId: string, classId: string) {
  const students = await db
    .prepare(`SELECT user_id FROM enrollments WHERE class_id = ? AND role = 'student' AND status = 'active'`)
    .bind(classId)
    .all<{ user_id: string }>();
  for (const s of students.results ?? []) {
    const exists = await db
      .prepare(`SELECT id FROM submissions WHERE assignment_id = ? AND student_id = ?`)
      .bind(assignmentId, s.user_id)
      .first();
    if (!exists) {
      await db
        .prepare(`INSERT INTO submissions (id, assignment_id, student_id, status, created_at, updated_at) VALUES (?, ?, ?, 'not_started', ?, ?)`)
        .bind(uid(), assignmentId, s.user_id, now(), now())
        .run();
    }
  }
}

app.patch("/api/assignments/:id", handler(async (c) => {
  const { a, isTeacher } = await loadAssignment(c, param(c, "id"));
  if (!isTeacher) throw new HttpError(403, "Teacher access required");
  const b = await c.req.json<any>();
  const status = b.status ?? a.status;
  await db
    .prepare(
      `UPDATE assignments SET title = ?, instructions = ?, page_ids = ?, release_at = ?, due_at = ?,
              grading = ?, points_max = ?, status = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(
      b.title ?? a.title, b.instructions ?? a.instructions,
      b.pageIds ? JSON.stringify(b.pageIds) : a.page_ids,
      b.releaseAt === undefined ? a.release_at : b.releaseAt || null,
      b.dueAt === undefined ? a.due_at : b.dueAt || null,
      b.grading ?? a.grading, b.pointsMax ?? a.points_max, status, now(), a.id,
    )
    .run();
  if (status === "active") await ensureSubmissions(a.id, a.class_id);
  return c.json({ ok: true });
}));

/** Assignment detail: the teacher status grid, or the student's own progress. */
app.get("/api/assignments/:id", handler(async (c) => {
  const { a, user, isTeacher } = await loadAssignment(c, param(c, "id"));
  const pageIds: string[] = JSON.parse(a.page_ids || "[]");
  const pages = pageIds.length
    ? (await db
        .prepare(`SELECT id, seq, label FROM pages WHERE id IN (${pageIds.map(() => "?").join(",")}) ORDER BY seq`)
        .bind(...pageIds)
        .all()).results ?? []
    : [];

  const base = {
    id: a.id, classId: a.class_id, notebookId: a.notebook_id, title: a.title,
    instructions: a.instructions, pageIds, pages, releaseAt: a.release_at, dueAt: a.due_at,
    grading: a.grading, pointsMax: a.points_max, status: a.status,
  };

  if (!isTeacher) {
    const sub = await db
      .prepare(`SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ?`)
      .bind(a.id, user.id)
      .first<any>();
    const inst = await db
      .prepare(`SELECT id FROM instances WHERE notebook_id = ? AND student_id = ?`)
      .bind(a.notebook_id, user.id)
      .first<{ id: string }>();
    return c.json({
      assignment: base,
      isTeacher: false,
      submission: {
        status: sub?.status ?? "not_started",
        submittedAt: sub?.submitted_at ?? null,
        complete: await completionFor(inst?.id ?? null, pageIds),
        grade: sub?.returned_at
          ? { points: sub.grade_points, letter: sub.grade_letter, complete: sub.grade_complete, feedback: sub.feedback }
          : null,
      },
    });
  }

  const roster = await db
    .prepare(
      `SELECT u.id, u.name, u.email, u.picture FROM enrollments e JOIN users u ON u.id = e.user_id
        WHERE e.class_id = ? AND e.role = 'student' AND e.status = 'active' ORDER BY u.name`,
    )
    .bind(a.class_id)
    .all<any>();

  const rows = [];
  for (const s of roster.results ?? []) {
    const sub = await db
      .prepare(`SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ?`)
      .bind(a.id, s.id)
      .first<any>();
    const inst = await db
      .prepare(`SELECT id FROM instances WHERE notebook_id = ? AND student_id = ?`)
      .bind(a.notebook_id, s.id)
      .first<{ id: string }>();
    const complete = await completionFor(inst?.id ?? null, pageIds);
    let status = sub?.status ?? "not_started";
    if (status === "not_started" && complete > 0) status = "in_progress";
    rows.push({
      student: s,
      status,
      submittedAt: sub?.submitted_at ?? null,
      returnedAt: sub?.returned_at ?? null,
      complete,
      total: pageIds.length,
      grade: { points: sub?.grade_points ?? null, letter: sub?.grade_letter ?? null, complete: sub?.grade_complete ?? null },
      feedback: sub?.feedback ?? "",
      graded: !!sub?.graded_at,
    });
  }
  return c.json({ assignment: base, isTeacher: true, rows });
}));

app.post("/api/assignments/:id/submit", handler(async (c) => {
  const { a, user, isTeacher } = await loadAssignment(c, param(c, "id"));
  if (isTeacher) throw new HttpError(400, "Teachers don't submit assignments");
  const existing = await db
    .prepare(`SELECT id FROM submissions WHERE assignment_id = ? AND student_id = ?`)
    .bind(a.id, user.id)
    .first<{ id: string }>();
  if (existing) {
    await db
      .prepare(`UPDATE submissions SET status = 'submitted', submitted_at = ?, updated_at = ? WHERE id = ?`)
      .bind(now(), now(), existing.id)
      .run();
  } else {
    await db
      .prepare(`INSERT INTO submissions (id, assignment_id, student_id, status, submitted_at, created_at, updated_at) VALUES (?, ?, ?, 'submitted', ?, ?, ?)`)
      .bind(uid(), a.id, user.id, now(), now(), now())
      .run();
  }
  return c.json({ ok: true });
}));

/** Students may unsubmit while the work is still unreturned — a common classroom need. */
app.post("/api/assignments/:id/unsubmit", handler(async (c) => {
  const { a, user, isTeacher } = await loadAssignment(c, param(c, "id"));
  if (isTeacher) throw new HttpError(400, "Not applicable to teachers");
  const sub = await db
    .prepare(`SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ?`)
    .bind(a.id, user.id)
    .first<any>();
  if (!sub) throw new HttpError(404, "Nothing submitted yet");
  if (sub.returned_at) throw new HttpError(400, "This work has already been returned");
  await db
    .prepare(`UPDATE submissions SET status = 'in_progress', submitted_at = NULL, updated_at = ? WHERE id = ?`)
    .bind(now(), sub.id)
    .run();
  return c.json({ ok: true });
}));

/** Save a grade privately (draft mode) — nothing is visible to the student until returned. */
app.post("/api/assignments/:id/grade", handler(async (c) => {
  const { a, user, isTeacher } = await loadAssignment(c, param(c, "id"));
  if (!isTeacher) throw new HttpError(403, "Teacher access required");
  const b = await c.req.json<{ studentId: string; points?: number | null; letter?: string | null; complete?: boolean | null; feedback?: string }>();
  const existing = await db
    .prepare(`SELECT id FROM submissions WHERE assignment_id = ? AND student_id = ?`)
    .bind(a.id, b.studentId)
    .first<{ id: string }>();
  const completeVal = b.complete === null || b.complete === undefined ? null : b.complete ? 1 : 0;
  if (existing) {
    await db
      .prepare(
        `UPDATE submissions SET grade_points = ?, grade_letter = ?, grade_complete = ?, feedback = ?, graded_at = ?, graded_by = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(b.points ?? null, b.letter ?? null, completeVal, b.feedback ?? "", now(), user.id, now(), existing.id)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO submissions (id, assignment_id, student_id, status, grade_points, grade_letter, grade_complete, feedback, graded_at, graded_by, created_at, updated_at)
         VALUES (?, ?, ?, 'in_progress', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(uid(), a.id, b.studentId, b.points ?? null, b.letter ?? null, completeVal, b.feedback ?? "", now(), user.id, now(), now())
      .run();
  }
  return c.json({ ok: true });
}));

/** Release grades — one student, or the whole class at once. */
app.post("/api/assignments/:id/return", handler(async (c) => {
  const { a, isTeacher } = await loadAssignment(c, param(c, "id"));
  if (!isTeacher) throw new HttpError(403, "Teacher access required");
  const { studentId, all } = await c.req.json<{ studentId?: string; all?: boolean }>();
  if (all) {
    await db
      .prepare(`UPDATE submissions SET status = 'returned', returned_at = ?, updated_at = ? WHERE assignment_id = ? AND graded_at IS NOT NULL`)
      .bind(now(), now(), a.id)
      .run();
    return c.json({ ok: true, scope: "all" });
  }
  if (!studentId) throw new HttpError(400, "studentId or all is required");
  await db
    .prepare(`UPDATE submissions SET status = 'returned', returned_at = ?, updated_at = ? WHERE assignment_id = ? AND student_id = ?`)
    .bind(now(), now(), a.id, studentId)
    .run();
  return c.json({ ok: true, scope: "one" });
}));

/** Class gradebook: every active assignment across every student. */
app.get("/api/classes/:id/gradebook", handler(async (c) => {
  const classId = param(c, "id");
  await requireClassTeacher(c, classId);
  const assignments = await db
    .prepare(`SELECT id, title, grading, points_max, due_at FROM assignments WHERE class_id = ? AND status = 'active' ORDER BY COALESCE(due_at, created_at)`)
    .bind(classId)
    .all<any>();
  const students = await db
    .prepare(
      `SELECT u.id, u.name, u.email FROM enrollments e JOIN users u ON u.id = e.user_id
        WHERE e.class_id = ? AND e.role = 'student' AND e.status = 'active' ORDER BY u.name`,
    )
    .bind(classId)
    .all<any>();
  const subs = await db
    .prepare(
      `SELECT s.assignment_id, s.student_id, s.status, s.grade_points, s.grade_letter, s.grade_complete
         FROM submissions s JOIN assignments a ON a.id = s.assignment_id WHERE a.class_id = ?`,
    )
    .bind(classId)
    .all<any>();
  return c.json({
    assignments: assignments.results ?? [],
    students: students.results ?? [],
    submissions: subs.results ?? [],
  });
}));

app.get("/api/classes/:id/gradebook.csv", handler(async (c) => {
  const classId = param(c, "id");
  await requireClassTeacher(c, classId);
  const cls = await db.prepare(`SELECT name FROM classes WHERE id = ?`).bind(classId).first<any>();
  const assignments = await db
    .prepare(`SELECT id, title, grading, points_max FROM assignments WHERE class_id = ? AND status = 'active' ORDER BY COALESCE(due_at, created_at)`)
    .bind(classId)
    .all<any>();
  const students = await db
    .prepare(
      `SELECT u.id, u.name, u.email FROM enrollments e JOIN users u ON u.id = e.user_id
        WHERE e.class_id = ? AND e.role = 'student' AND e.status = 'active' ORDER BY u.name`,
    )
    .bind(classId)
    .all<any>();
  const subs = await db
    .prepare(
      `SELECT s.assignment_id, s.student_id, s.grade_points, s.grade_letter, s.grade_complete
         FROM submissions s JOIN assignments a ON a.id = s.assignment_id WHERE a.class_id = ?`,
    )
    .bind(classId)
    .all<any>();

  const key = (aid: string, sid: string) => `${aid}:${sid}`;
  const map = new Map<string, any>();
  for (const s of subs.results ?? []) map.set(key(s.assignment_id, s.student_id), s);

  const esc = (v: any) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const header = ["Student", "Email", ...(assignments.results ?? []).map((a: any) =>
    a.grading === "points" ? `${a.title} (/${a.points_max})` : a.title)];
  const lines = [header.map(esc).join(",")];
  for (const st of students.results ?? []) {
    const row = [st.name, st.email];
    for (const a of assignments.results ?? []) {
      const s = map.get(key(a.id, st.id));
      let cell = "";
      if (s) {
        if (a.grading === "points") cell = s.grade_points ?? "";
        else if (a.grading === "letter") cell = s.grade_letter ?? "";
        else if (a.grading === "complete") cell = s.grade_complete === null ? "" : s.grade_complete ? "Complete" : "Incomplete";
      }
      row.push(cell);
    }
    lines.push(row.map(esc).join(","));
  }

  const filename = `${(cls?.name ?? "class").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-gradebook.csv`;
  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}));

/** Everything on the signed-in student's plate, across all classes. */
app.get("/api/my/assignments", handler(async (c) => {
  const user = await requireUser(c);
  const rows = await db
    .prepare(
      `SELECT a.*, c.name AS class_name, c.accent_color, n.title AS notebook_title
         FROM assignments a
         JOIN classes c ON c.id = a.class_id
         JOIN enrollments e ON e.class_id = c.id AND e.user_id = ? AND e.status = 'active' AND e.role = 'student'
         JOIN notebooks n ON n.id = a.notebook_id
        WHERE a.status = 'active' AND (a.release_at IS NULL OR a.release_at <= datetime('now')) AND c.archived = 0
        ORDER BY COALESCE(a.due_at, a.created_at)`,
    )
    .bind(user.id)
    .all<any>();

  const out = [];
  for (const a of rows.results ?? []) {
    const sub = await db
      .prepare(`SELECT status, returned_at, grade_points, grade_letter, grade_complete FROM submissions WHERE assignment_id = ? AND student_id = ?`)
      .bind(a.id, user.id)
      .first<any>();
    const pageIds: string[] = JSON.parse(a.page_ids || "[]");
    const inst = await db
      .prepare(`SELECT id FROM instances WHERE notebook_id = ? AND student_id = ?`)
      .bind(a.notebook_id, user.id)
      .first<{ id: string }>();
    out.push({
      id: a.id, title: a.title, classId: a.class_id, className: a.class_name,
      accentColor: a.accent_color, notebookId: a.notebook_id, notebookTitle: a.notebook_title,
      dueAt: a.due_at, grading: a.grading, pointsMax: a.points_max,
      total: pageIds.length,
      complete: await completionFor(inst?.id ?? null, pageIds),
      status: sub?.status ?? "not_started",
      grade: sub?.returned_at ? { points: sub.grade_points, letter: sub.grade_letter, complete: sub.grade_complete } : null,
    });
  }
  return c.json({ assignments: out });
}));
