import { app, db } from "../platform";
import {
  handler, now, uid, requireUser, requireClassTeacher, requireClassMember, HttpError, param,} from "../lib/session";
import { logActivity } from "../lib/activity";

/** An empty ink layer still serializes to a few characters, so require real content. */
const HAS_CONTENT = 24;

async function loadAssignment(c: any, assignmentId: string) {
  const a = await db.prepare(`SELECT * FROM assignments WHERE id = ?`).bind(assignmentId).first<any>();
  if (!a) throw new HttpError(404, "Assignment not found");
  const { user, isTeacher } = await requireClassMember(c, a.class_id);
  return { a, user, isTeacher };
}

/**
 * Has this student done anything on these pages, and when last?
 *
 * Deliberately not a fraction. Counting "completion" meant deciding what
 * counts as done, and any answer to that was wrong for somebody: a page of
 * free annotation over a PDF has nothing to tally, a page of questions can be
 * filled with a single character each, and reference pages have nothing to do
 * at all. What a teacher actually needs to know is who has started and who
 * went quiet, so that is what this reports.
 *
 * Ink and typed answers count equally — annotating a diagram is work in the
 * same way that filling a box is.
 */
const HAS_INK = 24; // an empty layer still serializes to a few characters

/**
 * The same signal for every student in a notebook at once, keyed by instance.
 *
 * Asking per student cost two round trips each, so a lecture section of 300 ran
 * over six hundred queries to draw one status grid. The instances are reached
 * through a subquery rather than a bound list of ids so that the number of
 * parameters stays tied to the assignment's page count, not to the roster.
 */
async function workSignals(
  notebookId: string,
  pageIds: string[],
): Promise<Map<string, { started: boolean; lastWorkedAt: string | null }>> {
  const signals = new Map<string, { started: boolean; lastWorkedAt: string | null }>();
  if (pageIds.length === 0) return signals;
  const placeholders = pageIds.map(() => "?").join(",");

  const record = (instanceId: string | null, t: string | null) => {
    if (!instanceId || !t) return;
    const prev = signals.get(instanceId);
    // Latest of the two sources wins: ink and typing are equally "work".
    if (!prev || !prev.lastWorkedAt || t > prev.lastWorkedAt) {
      signals.set(instanceId, { started: true, lastWorkedAt: t });
    }
  };

  const ink = await db
    .prepare(
      `SELECT instance_id, MAX(updated_at) AS t FROM layers
        WHERE instance_id IN (SELECT id FROM instances WHERE notebook_id = ?)
          AND kind = 'student' AND LENGTH(data) > ${HAS_INK}
          AND page_id IN (${placeholders})
        GROUP BY instance_id`,
    )
    .bind(notebookId, ...pageIds)
    .all<{ instance_id: string; t: string | null }>();

  const typed = await db
    .prepare(
      `SELECT v.instance_id, MAX(v.updated_at) AS t FROM field_values v
         JOIN fields f ON f.id = v.field_id
        WHERE v.instance_id IN (SELECT id FROM instances WHERE notebook_id = ?)
          AND f.archived = 0 AND f.page_id IN (${placeholders})
          AND (TRIM(v.value) <> '' OR v.asset_key IS NOT NULL)
        GROUP BY v.instance_id`,
    )
    .bind(notebookId, ...pageIds)
    .all<{ instance_id: string; t: string | null }>();

  for (const r of ink.results ?? []) record(r.instance_id, r.t);
  for (const r of typed.results ?? []) record(r.instance_id, r.t);
  return signals;
}

app.get("/api/classes/:id/assignments", handler(async (c) => {
  const classId = param(c, "id");
  const { user, isTeacher } = await requireClassMember(c, classId);
  const rows = await db
    .prepare(
      `SELECT a.*, n.title AS notebook_title, n.accent_color AS notebook_color,
              n.cover_key IS NOT NULL AS notebook_has_cover
         FROM assignments a
         JOIN notebooks n ON n.id = a.notebook_id
        WHERE a.class_id = ? ${isTeacher ? "" : "AND a.status = 'active' AND n.status = 'published' AND (a.release_at IS NULL OR a.release_at <= datetime('now'))"}
        ORDER BY COALESCE(a.due_at, a.created_at) DESC`,
    )
    .bind(classId)
    .all<any>();

  const assignments = [];
  for (const a of rows.results ?? []) {
    const pageIds: string[] = JSON.parse(a.page_ids || "[]");
    const base = {
      id: a.id, title: a.title, notebookId: a.notebook_id, notebookTitle: a.notebook_title,
      notebookColor: a.notebook_color ?? "#2E7D6B", notebookHasCover: !!a.notebook_has_cover,
      pageCount: pageIds.length, releaseAt: a.release_at, dueAt: a.due_at,
      grading: a.grading, pointsMax: a.points_max, status: a.status,
    };
    if (isTeacher) {
      const counts = await db
        .prepare(
          `SELECT
             SUM(CASE WHEN submitted_at IS NOT NULL THEN 1 ELSE 0 END) AS submitted,
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
      assignments.push({
        ...base,
        myStatus: sub?.status ?? "not_started",
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
    // `kind = 'class'`: a student's own notebook is never assignable, even by
    // the teacher who can see it.
    .prepare(`SELECT id FROM notebooks WHERE id = ? AND class_id = ? AND kind = 'class'`)
    .bind(b.notebookId, classId)
    .first();
  if (!nb) throw new HttpError(404, "Notebook not found in this class");

  const id = uid();
  const status = b.status === "active" ? "active" : "draft";
  // Checked before the insert, not after: a refusal that leaves an active
  // assignment behind is the exact state this is here to prevent.
  if (status === "active") await requirePublishedNotebook(b.notebookId);
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

/**
 * Refuse to set work over a notebook the class can't open yet.
 *
 * Activating an assignment is what puts a notebook in front of students, so it
 * is the third door into a draft — the other two being the class listing and a
 * direct link. Draft assignments over draft notebooks are fine and useful:
 * both are the teacher's unfinished work, and neither is visible. It is only
 * the moment of going active that has to insist the notebook went first.
 */
async function requirePublishedNotebook(notebookId: string) {
  const nb = await db
    .prepare(`SELECT status FROM notebooks WHERE id = ?`)
    .bind(notebookId)
    .first<{ status: string }>();
  if (nb?.status !== "published") {
    throw new HttpError(
      400,
      "That notebook hasn't been published to students yet — publish it first, then set the work.",
    );
  }
}

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
  if (status === "active") await requirePublishedNotebook(a.notebook_id);
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

/**
 * What an edit or deletion would actually disturb.
 *
 * Editing an assignment is safe for student *work* — that lives on the notebook
 * instance and is anchored to page UUIDs — but narrowing the page scope hides
 * pages a student may already have filled in, and changing the grading scheme
 * strands grades recorded under the old one. The UI asks for this before showing
 * a confirmation so the warning names real numbers rather than hypotheticals.
 */
app.get("/api/assignments/:id/impact", handler(async (c) => {
  const { a, isTeacher } = await loadAssignment(c, param(c, "id"));
  if (!isTeacher) throw new HttpError(403, "Teacher access required");
  const counts = await db
    .prepare(
      `SELECT SUM(CASE WHEN submitted_at IS NOT NULL THEN 1 ELSE 0 END) AS submitted,
              SUM(CASE WHEN graded_at IS NOT NULL THEN 1 ELSE 0 END) AS graded,
              SUM(CASE WHEN returned_at IS NOT NULL THEN 1 ELSE 0 END) AS returned,
              COUNT(*) AS total
         FROM submissions WHERE assignment_id = ?`,
    )
    .bind(a.id)
    .first<any>();

  // Students who have put something on the assigned pages, submitted or not.
  const pageIds: string[] = JSON.parse(a.page_ids || "[]");
  let started = 0;
  if (pageIds.length) {
    const placeholders = pageIds.map(() => "?").join(",");
    const row = await db
      .prepare(
        `SELECT COUNT(DISTINCT i.student_id) AS n
           FROM layers l JOIN instances i ON i.id = l.instance_id
          WHERE i.notebook_id = ? AND l.kind = 'student'
            AND LENGTH(l.data) > ${HAS_CONTENT} AND l.page_id IN (${placeholders})`,
      )
      .bind(a.notebook_id, ...pageIds)
      .first<{ n: number }>();
    started = row?.n ?? 0;
  }

  return c.json({
    submitted: counts?.submitted ?? 0,
    graded: counts?.graded ?? 0,
    returned: counts?.returned ?? 0,
    total: counts?.total ?? 0,
    started,
    grading: a.grading,
    status: a.status,
  });
}));

/**
 * Delete an assignment. Submissions and grades go with it; the pages and every
 * stroke students drew on them stay, because those belong to the notebook rather
 * than to the assignment.
 */
app.delete("/api/assignments/:id", handler(async (c) => {
  const { a, isTeacher } = await loadAssignment(c, param(c, "id"));
  if (!isTeacher) throw new HttpError(403, "Teacher access required");
  const counts = await db
    .prepare(`SELECT COUNT(*) AS n FROM submissions WHERE assignment_id = ?`)
    .bind(a.id)
    .first<{ n: number }>();
  await db.prepare(`DELETE FROM submissions WHERE assignment_id = ?`).bind(a.id).run();
  await db.prepare(`DELETE FROM assignments WHERE id = ?`).bind(a.id).run();
  return c.json({ ok: true, deletedSubmissions: counts?.n ?? 0 });
}));

/** Assignment detail: the teacher status grid, or the student's own progress. */
app.get("/api/assignments/:id", handler(async (c) => {
  const { a, user, isTeacher } = await loadAssignment(c, param(c, "id"));
  const pageIds: string[] = JSON.parse(a.page_ids || "[]");

  // Resolve each assigned page to its position in the notebook, so the UI can
  // say "pages 4, 7–9" rather than just a count.
  const notebookPages = await db
    .prepare(`SELECT id, seq, label FROM pages WHERE notebook_id = ? AND archived = 0 ORDER BY seq`)
    .bind(a.notebook_id)
    .all<{ id: string; seq: number; label: string }>();
  const ordinal = new Map<string, number>();
  (notebookPages.results ?? []).forEach((p, i) => ordinal.set(p.id, i + 1));

  const pages = (notebookPages.results ?? [])
    .filter((p) => pageIds.includes(p.id))
    .map((p) => ({ ...p, number: ordinal.get(p.id) ?? 0 }));
  const pageNumbers = pages.map((p) => p.number).filter((n) => n > 0);

  const base = {
    id: a.id, classId: a.class_id, notebookId: a.notebook_id, title: a.title,
    instructions: a.instructions, pageIds, pages, pageNumbers,
    releaseAt: a.release_at, dueAt: a.due_at,
    grading: a.grading, pointsMax: a.points_max, status: a.status,
  };

  if (!isTeacher) {
    const sub = await db
      .prepare(`SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ?`)
      .bind(a.id, user.id)
      .first<any>();
    return c.json({
      assignment: base,
      isTeacher: false,
      submission: {
        status: sub?.status ?? "not_started",
        submittedAt: sub?.submitted_at ?? null,
        returnedAt: sub?.returned_at ?? null,
        // The client mirrors the server's lock rather than inferring it, so the
        // page can never offer an action the server would refuse.
        locked: !!sub?.locked,
        graded: !!sub?.graded_at,
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

  // Everything the grid needs is fetched for the whole roster at once. Reading
  // it per student turned a 30-name class into 67 queries and a 300-name one
  // into 609; these four cost the same whatever the roster size.
  const submissions = await db
    .prepare(`SELECT * FROM submissions WHERE assignment_id = ?`)
    .bind(a.id)
    .all<any>();
  const subByStudent = new Map<string, any>();
  for (const s of submissions.results ?? []) subByStudent.set(s.student_id, s);

  const instances = await db
    .prepare(`SELECT id, student_id FROM instances WHERE notebook_id = ?`)
    .bind(a.notebook_id)
    .all<{ id: string; student_id: string }>();
  const instanceByStudent = new Map<string, string>();
  for (const i of instances.results ?? []) instanceByStudent.set(i.student_id, i.id);

  const signals = await workSignals(a.notebook_id, pageIds);

  const rows = [];
  for (const s of roster.results ?? []) {
    const sub = subByStudent.get(s.id);
    const instanceId = instanceByStudent.get(s.id);
    const { started, lastWorkedAt } = (instanceId ? signals.get(instanceId) : undefined)
      ?? { started: false, lastWorkedAt: null };
    let status = sub?.status ?? "not_started";
    if (status === "not_started" && started) status = "in_progress";
    rows.push({
      student: s,
      status,
      submittedAt: sub?.submitted_at ?? null,
      returnedAt: sub?.returned_at ?? null,
      // When they last touched it — the thing a teacher actually scans for.
      lastWorkedAt,
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
      .prepare(`UPDATE submissions SET status = 'submitted', submitted_at = ?, locked = 1, updated_at = ? WHERE id = ?`)
      .bind(now(), now(), existing.id)
      .run();
  } else {
    await db
      .prepare(`INSERT INTO submissions (id, assignment_id, student_id, status, submitted_at, locked, created_at, updated_at) VALUES (?, ?, ?, 'submitted', ?, 1, ?, ?)`)
      .bind(uid(), a.id, user.id, now(), now(), now())
      .run();
  }
  await logActivity({
    actorId: user.id, actorRole: "student", action: "submit",
    detail: `Handed in "${a.title}"`, assignmentId: a.id, notebookId: a.notebook_id, studentId: user.id,
  });
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
  if (sub.graded_at) {
    throw new HttpError(400, "Your teacher has already marked this. Ask them to reopen it if you need to change something.");
  }
  await db
    .prepare(`UPDATE submissions SET status = 'in_progress', submitted_at = NULL, locked = 0, updated_at = ? WHERE id = ?`)
    .bind(now(), sub.id)
    .run();
  await logActivity({
    actorId: user.id, actorRole: "student", action: "unsubmit",
    detail: `Took back "${a.title}" before it was marked`, assignmentId: a.id,
    notebookId: a.notebook_id, studentId: user.id,
  });
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
  await logActivity({
    actorId: user.id, actorRole: "teacher", action: "grade",
    detail: `Marked "${a.title}"`, assignmentId: a.id, notebookId: a.notebook_id, studentId: b.studentId,
  });
  return c.json({ ok: true });
}));

/** Release grades — one student, or the whole class at once. */
app.post("/api/assignments/:id/return", handler(async (c) => {
  const { a, user, isTeacher } = await loadAssignment(c, param(c, "id"));
  if (!isTeacher) throw new HttpError(403, "Teacher access required");
  const { studentId, all } = await c.req.json<{ studentId?: string; all?: boolean }>();
  if (all) {
    await db
      .prepare(`UPDATE submissions SET status = 'returned', returned_at = ?, updated_at = ? WHERE assignment_id = ? AND graded_at IS NOT NULL`)
      .bind(now(), now(), a.id)
      .run();
    await logActivity({
      actorId: user.id, actorRole: "teacher", action: "return",
      detail: `Returned "${a.title}" to the class`, assignmentId: a.id, notebookId: a.notebook_id,
    });
    return c.json({ ok: true, scope: "all" });
  }
  if (!studentId) throw new HttpError(400, "studentId or all is required");
  await db
    .prepare(`UPDATE submissions SET status = 'returned', returned_at = ?, updated_at = ? WHERE assignment_id = ? AND student_id = ?`)
    .bind(now(), now(), a.id, studentId)
    .run();
  await logActivity({
    actorId: user.id, actorRole: "teacher", action: "return",
    detail: `Returned "${a.title}"`, assignmentId: a.id, notebookId: a.notebook_id, studentId,
  });
  return c.json({ ok: true, scope: "one" });
}));

/**
 * Reopen a student's submission so they can work on it again.
 *
 * This is the only way a locked page becomes editable after it was handed in,
 * and it is recorded, so "the page changed after marking" always has an
 * accountable answer.
 */
app.post("/api/assignments/:id/reopen", handler(async (c) => {
  const { a, user, isTeacher } = await loadAssignment(c, param(c, "id"));
  if (!isTeacher) throw new HttpError(403, "Teacher access required");
  const { studentId } = await c.req.json<{ studentId: string }>();
  if (!studentId) throw new HttpError(400, "Which student?");
  const sub = await db
    .prepare(`SELECT id FROM submissions WHERE assignment_id = ? AND student_id = ?`)
    .bind(a.id, studentId)
    .first<{ id: string }>();
  if (!sub) throw new HttpError(404, "No submission to reopen");

  // `returned_at` is cleared too: the work is back with the student, so it is
  // no longer returned, and it should show up as waiting to be handed in and
  // returned again. The grade itself stays, so a teacher reopening a piece for
  // one more paragraph doesn't have to retype the mark they already gave.
  await db
    .prepare(
      `UPDATE submissions
          SET locked = 0, status = 'in_progress', reopened_at = ?, submitted_at = NULL,
              returned_at = NULL, updated_at = ?
        WHERE id = ?`,
    )
    .bind(now(), now(), sub.id)
    .run();
  await logActivity({
    actorId: user.id, actorRole: "teacher", action: "reopen",
    detail: `Reopened "${a.title}" for more work`, assignmentId: a.id,
    notebookId: a.notebook_id, studentId,
  });
  return c.json({ ok: true });
}));

/**
 * The shared history of a piece of work. A student sees their own; a teacher of
 * the class sees any of their students'. Both see the same entries.
 */
app.get("/api/activity", handler(async (c) => {
  const user = await requireUser(c);
  const assignmentId = c.req.query("assignment");
  const notebookId = c.req.query("notebook");
  const studentParam = c.req.query("student");

  let studentId = user.id;
  if (studentParam && studentParam !== user.id) {
    // Only a teacher of the relevant class may read someone else's history.
    const cls = assignmentId
      ? await db.prepare(`SELECT class_id FROM assignments WHERE id = ?`).bind(assignmentId).first<any>()
      : await db.prepare(`SELECT class_id FROM notebooks WHERE id = ?`).bind(notebookId ?? "").first<any>();
    if (!cls) throw new HttpError(404, "Not found");
    await requireClassTeacher(c, cls.class_id);
    studentId = studentParam;
  }

  const clauses = ["student_id = ?"];
  const binds: any[] = [studentId];

  if (assignmentId) {
    // Page edits are logged against the page, not the assignment, so asking for
    // an assignment's history has to pull in work on the pages it covers —
    // otherwise "they edited it after I marked it" wouldn't show up at all.
    const a = await db
      .prepare(`SELECT notebook_id, page_ids FROM assignments WHERE id = ?`)
      .bind(assignmentId)
      .first<any>();
    const pageIds: string[] = a ? JSON.parse(a.page_ids || "[]") : [];
    if (a && pageIds.length) {
      const holes = pageIds.map(() => "?").join(",");
      clauses.push(`(assignment_id = ? OR (notebook_id = ? AND page_id IN (${holes})))`);
      binds.push(assignmentId, a.notebook_id, ...pageIds);
    } else {
      clauses.push("assignment_id = ?");
      binds.push(assignmentId);
    }
  } else if (notebookId) {
    clauses.push("notebook_id = ?");
    binds.push(notebookId);
  }

  const rows = await db
    .prepare(
      `SELECT a.id, a.action, a.detail, a.created_at, a.page_id, a.actor_role, u.name AS actor_name
         FROM activity a LEFT JOIN users u ON u.id = a.actor_id
        WHERE ${clauses.join(" AND ")}
        ORDER BY a.created_at DESC LIMIT 200`,
    )
    .bind(...binds)
    .all<any>();

  return c.json({
    events: (rows.results ?? []).map((r) => ({
      id: r.id, action: r.action, detail: r.detail, at: r.created_at,
      pageId: r.page_id, actor: r.actor_name ?? "Someone", actorRole: r.actor_role,
    })),
  });
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

/**
 * A student's own grades for one class. The teacher gradebook is a matrix of
 * everyone; this is the single row that belongs to the caller, so students get a
 * real grades view instead of a permission error.
 */
app.get("/api/classes/:id/my-grades", handler(async (c) => {
  const classId = param(c, "id");
  const { user } = await requireClassMember(c, classId);
  const cls = await db.prepare(`SELECT name, accent_color FROM classes WHERE id = ?`).bind(classId).first<any>();

  const rows = await db
    .prepare(
      `SELECT a.id, a.title, a.due_at, a.grading, a.points_max, a.notebook_id,
              s.status, s.submitted_at, s.returned_at, s.grade_points, s.grade_letter,
              s.grade_complete, s.feedback
         FROM assignments a
         LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = ?
        WHERE a.class_id = ? AND a.status = 'active'
          AND (a.release_at IS NULL OR a.release_at <= datetime('now'))
        ORDER BY COALESCE(a.due_at, a.created_at)`,
    )
    .bind(user.id, classId)
    .all<any>();

  let earned = 0;
  let possible = 0;
  const assignments = (rows.results ?? []).map((r) => {
    // Only returned work counts — a grade the teacher hasn't released yet must
    // stay invisible to the student.
    const released = !!r.returned_at;
    if (released && r.grading === "points" && r.grade_points !== null) {
      earned += r.grade_points;
      possible += r.points_max;
    }
    return {
      id: r.id,
      title: r.title,
      notebookId: r.notebook_id,
      dueAt: r.due_at,
      grading: r.grading,
      pointsMax: r.points_max,
      status: r.status ?? "not_started",
      submittedAt: r.submitted_at,
      returnedAt: r.returned_at,
      grade: released
        ? {
            points: r.grade_points,
            letter: r.grade_letter,
            complete: r.grade_complete,
            feedback: r.feedback ?? "",
          }
        : null,
    };
  });

  return c.json({
    className: cls?.name ?? "",
    accentColor: cls?.accent_color ?? "#2E7D6B",
    assignments,
    totals: possible > 0 ? { earned, possible, percent: Math.round((earned / possible) * 100) } : null,
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

/** Every assignment across the classes this teacher runs — the top-level view. */
app.get("/api/my/teaching", handler(async (c) => {
  const user = await requireUser(c);
  const rows = await db
    .prepare(
      `SELECT a.*, c.name AS class_name, c.accent_color, c.emoji AS class_emoji,
              n.title AS notebook_title, n.accent_color AS notebook_color,
              n.cover_key IS NOT NULL AS notebook_has_cover
         FROM assignments a
         JOIN classes c ON c.id = a.class_id
         JOIN notebooks n ON n.id = a.notebook_id
         LEFT JOIN enrollments e ON e.class_id = c.id AND e.user_id = ? AND e.role = 'teacher' AND e.status = 'active'
        WHERE c.archived = 0 AND (c.owner_id = ? OR e.id IS NOT NULL)
        ORDER BY COALESCE(a.due_at, a.created_at) DESC`,
    )
    .bind(user.id, user.id)
    .all<any>();

  const assignments = [];
  for (const a of rows.results ?? []) {
    const counts = await db
      .prepare(
        `SELECT SUM(CASE WHEN submitted_at IS NOT NULL THEN 1 ELSE 0 END) AS submitted,
                SUM(CASE WHEN status = 'returned' THEN 1 ELSE 0 END) AS returned,
                SUM(CASE WHEN graded_at IS NOT NULL THEN 1 ELSE 0 END) AS graded,
                COUNT(*) AS total
           FROM submissions WHERE assignment_id = ?`,
      )
      .bind(a.id)
      .first<any>();
    assignments.push({
      id: a.id, title: a.title, classId: a.class_id, className: a.class_name,
      accentColor: a.accent_color, classEmoji: a.class_emoji ?? "",
      notebookId: a.notebook_id, notebookTitle: a.notebook_title,
      notebookColor: a.notebook_color ?? "#2E7D6B", notebookHasCover: !!a.notebook_has_cover,
      pageCount: JSON.parse(a.page_ids || "[]").length,
      dueAt: a.due_at, releaseAt: a.release_at, grading: a.grading, pointsMax: a.points_max,
      status: a.status,
      submitted: counts?.submitted ?? 0, returned: counts?.returned ?? 0,
      graded: counts?.graded ?? 0, total: counts?.total ?? 0,
    });
  }
  return c.json({ assignments });
}));

/** Everything on the signed-in student's plate, across all classes. */
app.get("/api/my/assignments", handler(async (c) => {
  const user = await requireUser(c);
  const rows = await db
    .prepare(
      `SELECT a.*, c.name AS class_name, c.accent_color, c.emoji AS class_emoji,
              n.title AS notebook_title, n.accent_color AS notebook_color
         FROM assignments a
         JOIN classes c ON c.id = a.class_id
         JOIN enrollments e ON e.class_id = c.id AND e.user_id = ? AND e.status = 'active' AND e.role = 'student'
         JOIN notebooks n ON n.id = a.notebook_id
        WHERE a.status = 'active' AND n.status = 'published'
          AND (a.release_at IS NULL OR a.release_at <= datetime('now')) AND c.archived = 0
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
    out.push({
      id: a.id, title: a.title, classId: a.class_id, className: a.class_name,
      accentColor: a.accent_color, classEmoji: a.class_emoji ?? "",
      notebookId: a.notebook_id, notebookTitle: a.notebook_title,
      notebookColor: a.notebook_color ?? "#2E7D6B",
      dueAt: a.due_at, grading: a.grading, pointsMax: a.points_max,
      total: pageIds.length,
      status: sub?.status ?? "not_started",
      grade: sub?.returned_at ? { points: sub.grade_points, letter: sub.grade_letter, complete: sub.grade_complete } : null,
    });
  }
  return c.json({ assignments: out });
}));
