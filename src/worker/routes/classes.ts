import { app, db, storage } from "flingit";
import {
  handler, now, uid, requireUser, requireTeacher, requireClassTeacher, requireClassMember, HttpError, param,} from "../lib/session";

// Ambiguous characters (0/O, 1/I/L) omitted so codes are easy to read aloud in class.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function makeJoinCode() {
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

async function uniqueJoinCode(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = makeJoinCode();
    const clash = await db.prepare(`SELECT id FROM classes WHERE join_code = ?`).bind(code).first();
    if (!clash) return code;
  }
  throw new HttpError(500, "Could not allocate a join code");
}

/**
 * Provision this student's instance of every published notebook in the class, and
 * flag the enrollment so the teacher gets the assignment-backfill prompt.
 */
async function provisionForStudent(classId: string, studentId: string) {
  const notebooks = await db
    .prepare(`SELECT id FROM notebooks WHERE class_id = ? AND status = 'published'`)
    .bind(classId)
    .all<{ id: string }>();
  for (const nb of notebooks.results ?? []) {
    const exists = await db
      .prepare(`SELECT id FROM instances WHERE notebook_id = ? AND student_id = ?`)
      .bind(nb.id, studentId)
      .first();
    if (!exists) {
      await db
        .prepare(`INSERT INTO instances (id, notebook_id, class_id, student_id, created_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(uid(), nb.id, classId, studentId, now())
        .run();
    }
  }
  const anyAssignments = await db
    .prepare(`SELECT id FROM assignments WHERE class_id = ? AND status = 'active' LIMIT 1`)
    .bind(classId)
    .first();
  if (anyAssignments) {
    await db
      .prepare(`UPDATE enrollments SET backfill_pending = 1 WHERE class_id = ? AND user_id = ?`)
      .bind(classId, studentId)
      .run();
  }
}

/** Classes I teach or am enrolled in, with student counts. */
app.get("/api/classes", handler(async (c) => {
  const user = await requireUser(c);
  const rows = await db
    .prepare(
      // Positional `?` only — the D1 driver rejects numbered (?1) placeholders.
      `SELECT c.*,
              (SELECT COUNT(*) FROM enrollments e2
                WHERE e2.class_id = c.id AND e2.role = 'student' AND e2.status = 'active') AS student_count,
              (SELECT COUNT(*) FROM notebooks n WHERE n.class_id = c.id) AS notebook_count,
              CASE WHEN c.owner_id = ? THEN 'teacher' ELSE COALESCE(e.role, 'student') END AS my_role
         FROM classes c
         LEFT JOIN enrollments e ON e.class_id = c.id AND e.user_id = ? AND e.status = 'active'
        WHERE c.archived = 0 AND (c.owner_id = ? OR e.id IS NOT NULL)
        ORDER BY c.created_at DESC`,
    )
    .bind(user.id, user.id, user.id)
    .all();
  return c.json({ classes: rows.results ?? [] });
}));

app.post("/api/classes", handler(async (c) => {
  const user = await requireTeacher(c);
  const body = await c.req.json<{ name: string; section?: string; accentColor?: string }>();
  if (!body.name?.trim()) throw new HttpError(400, "Class name is required");
  const id = uid();
  await db
    .prepare(
      `INSERT INTO classes (id, org_id, owner_id, name, section, source, join_code, accent_color, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?)`,
    )
    .bind(
      id, user.org_id, user.id, body.name.trim(), body.section?.trim() ?? "",
      await uniqueJoinCode(), body.accentColor ?? "#2E7D6B", now(), now(),
    )
    .run();
  const cls = await db.prepare(`SELECT * FROM classes WHERE id = ?`).bind(id).first();
  return c.json({ class: cls });
}));

/**
 * Create (or refresh) a class from Google Classroom. The browser holds the
 * Classroom OAuth token and posts the course + roster here, so the Worker never
 * needs Google credentials of its own.
 */
app.post("/api/classes/import-classroom", handler(async (c) => {
  const user = await requireTeacher(c);
  const body = await c.req.json<{
    courseId: string; name: string; section?: string;
    students: { email: string; name: string; photoUrl?: string }[];
  }>();
  if (!body.courseId || !body.name) throw new HttpError(400, "Course id and name are required");

  let cls = await db
    .prepare(`SELECT * FROM classes WHERE google_course_id = ? AND owner_id = ?`)
    .bind(body.courseId, user.id)
    .first<any>();

  if (!cls) {
    const id = uid();
    await db
      .prepare(
        `INSERT INTO classes (id, org_id, owner_id, name, section, source, google_course_id, join_code, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'classroom', ?, ?, ?, ?)`,
      )
      .bind(id, user.org_id, user.id, body.name, body.section ?? "", body.courseId, await uniqueJoinCode(), now(), now())
      .run();
    cls = await db.prepare(`SELECT * FROM classes WHERE id = ?`).bind(id).first<any>();
  }

  let added = 0;
  for (const s of body.students ?? []) {
    const email = s.email?.toLowerCase();
    if (!email) continue;
    let student = await db.prepare(`SELECT * FROM users WHERE email = ?`).bind(email).first<any>();
    if (!student) {
      // Pre-create the account so the roster is complete before they ever sign in.
      const sid = uid();
      await db
        .prepare(
          `INSERT INTO users (id, org_id, email, name, picture, role, is_admin, created_at)
           VALUES (?, ?, ?, ?, ?, 'student', 0, ?)`,
        )
        .bind(sid, user.org_id, email, s.name || email, s.photoUrl ?? null, now())
        .run();
      student = { id: sid };
    }
    const existing = await db
      .prepare(`SELECT id FROM enrollments WHERE class_id = ? AND user_id = ?`)
      .bind(cls.id, student.id)
      .first();
    if (!existing) {
      await db
        .prepare(`INSERT INTO enrollments (id, class_id, user_id, role, status, created_at) VALUES (?, ?, ?, 'student', 'active', ?)`)
        .bind(uid(), cls.id, student.id, now())
        .run();
      await provisionForStudent(cls.id, student.id);
      added++;
    }
  }
  return c.json({ class: cls, added });
}));

app.get("/api/classes/:id", handler(async (c) => {
  const classId = param(c, "id");
  const { user, isTeacher } = await requireClassMember(c, classId);
  const cls = await db.prepare(`SELECT * FROM classes WHERE id = ?`).bind(classId).first<any>();
  const roster = await db
    .prepare(
      `SELECT u.id, u.email, u.name, u.picture, e.role, e.status, e.backfill_pending, e.created_at AS joined_at
         FROM enrollments e JOIN users u ON u.id = e.user_id
        WHERE e.class_id = ? AND e.status = 'active' AND e.role = 'student'
        ORDER BY u.name`,
    )
    .bind(classId)
    .all();
  const notebooks = await db
    .prepare(
      `SELECT n.id, n.title, n.status, n.page_count, n.updated_at,
              n.accent_color, n.cover_key IS NOT NULL AS has_cover,
              p.id AS first_page_id, p.asset_key AS first_asset_key,
              p.source_index AS first_source_index, p.width AS first_width, p.height AS first_height,
              p.pattern AS first_pattern, p.pattern_color AS first_pattern_color
         FROM notebooks n
         LEFT JOIN pages p ON p.id = (
           SELECT id FROM pages WHERE notebook_id = n.id AND archived = 0 ORDER BY seq LIMIT 1
         )
        WHERE n.class_id = ? ORDER BY n.created_at DESC`,
    )
    .bind(classId)
    .all();

  const teachers = await db
    .prepare(
      `SELECT u.id, u.email, u.name, u.picture,
              CASE WHEN u.id = ? THEN 1 ELSE 0 END AS is_owner
         FROM users u
        WHERE u.id = ?
        UNION
       SELECT u.id, u.email, u.name, u.picture, 0 AS is_owner
         FROM enrollments e JOIN users u ON u.id = e.user_id
        WHERE e.class_id = ? AND e.role = 'teacher' AND e.status = 'active'`,
    )
    .bind(cls.owner_id, cls.owner_id, classId)
    .all();
  return c.json({
    class: { ...cls, hasCover: !!cls.cover_key, joinCode: isTeacher ? cls.join_code : undefined },
    myRole: isTeacher ? "teacher" : "student",
    roster: isTeacher ? roster.results ?? [] : [],
    teachers: teachers.results ?? [],
    notebooks: notebooks.results ?? [],
    me: { id: user.id },
  });
}));

app.patch("/api/classes/:id", handler(async (c) => {
  const classId = param(c, "id");
  await requireClassTeacher(c, classId);
  const body = await c.req.json<{
    name?: string; section?: string; accentColor?: string; archived?: boolean;
    emoji?: string; clearCover?: boolean;
  }>();
  const cls = await db.prepare(`SELECT * FROM classes WHERE id = ?`).bind(classId).first<any>();
  if (body.accentColor && !/^#[0-9A-Fa-f]{6}$/.test(body.accentColor)) throw new HttpError(400, "Invalid colour");
  // One or two glyphs: enough for any emoji (including ZWJ sequences) without
  // letting the badge become a text field.
  const emoji = body.emoji === undefined ? cls.emoji : Array.from(body.emoji).slice(0, 3).join("");

  await db
    .prepare(
      `UPDATE classes SET name = ?, section = ?, accent_color = ?, archived = ?, emoji = ?, cover_key = ?, updated_at = ?
        WHERE id = ?`,
    )
    .bind(
      body.name ?? cls.name, body.section ?? cls.section, body.accentColor ?? cls.accent_color,
      body.archived === undefined ? cls.archived : body.archived ? 1 : 0,
      emoji ?? "", body.clearCover ? null : cls.cover_key, now(), classId,
    )
    .run();
  return c.json({ ok: true });
}));

const MAX_CLASS_COVER_BYTES = 4 * 1024 * 1024;

/** Featured image for the class tile and header. */
app.post("/api/classes/:id/cover", handler(async (c) => {
  const classId = param(c, "id");
  await requireClassTeacher(c, classId);
  const form = await c.req.parseBody();
  const file = form["file"] as File | undefined;
  if (!file) throw new HttpError(400, "No image uploaded");
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
    throw new HttpError(400, "Featured image must be a PNG, JPEG, WebP or GIF");
  }
  if (file.size > MAX_CLASS_COVER_BYTES) throw new HttpError(413, "Images are limited to 4MB");

  const key = `classes/${classId}/cover-${uid()}`;
  await storage.put(key, await file.arrayBuffer(), { contentType: file.type });
  await db
    .prepare(`UPDATE classes SET cover_key = ?, updated_at = ? WHERE id = ?`)
    .bind(key, now(), classId)
    .run();
  return c.json({ ok: true, coverKey: key });
}));

app.get("/api/classes/:id/cover", handler(async (c) => {
  const classId = param(c, "id");
  await requireClassMember(c, classId);
  const cls = await db.prepare(`SELECT cover_key FROM classes WHERE id = ?`).bind(classId).first<any>();
  if (!cls?.cover_key) throw new HttpError(404, "No featured image set");
  const obj = await storage.get(cls.cover_key);
  if (!obj) throw new HttpError(404, "Image not found");
  return new Response(await obj.arrayBuffer(), {
    headers: { "Content-Type": obj.contentType ?? "image/png", "Cache-Control": "private, max-age=3600" },
  });
}));

/** Rotate the join code, e.g. after a code leaks outside the class. */
app.post("/api/classes/:id/rotate-code", handler(async (c) => {
  const classId = param(c, "id");
  await requireClassTeacher(c, classId);
  const code = await uniqueJoinCode();
  await db.prepare(`UPDATE classes SET join_code = ?, updated_at = ? WHERE id = ?`).bind(code, now(), classId).run();
  return c.json({ joinCode: code });
}));

/** Student self-enrolls with a 6-character class code. */
app.post("/api/classes/join", handler(async (c) => {
  const user = await requireUser(c);
  const { code } = await c.req.json<{ code: string }>();
  const cls = await db
    .prepare(`SELECT * FROM classes WHERE join_code = ? AND archived = 0`)
    .bind((code ?? "").trim().toUpperCase())
    .first<any>();
  if (!cls) throw new HttpError(404, "No class matches that code");
  if (cls.org_id !== user.org_id) throw new HttpError(403, "That class belongs to another school");
  if (cls.owner_id === user.id) throw new HttpError(400, "You already teach this class");

  const existing = await db
    .prepare(`SELECT id, status FROM enrollments WHERE class_id = ? AND user_id = ?`)
    .bind(cls.id, user.id)
    .first<any>();
  if (existing) {
    if (existing.status !== "active") {
      await db.prepare(`UPDATE enrollments SET status = 'active' WHERE id = ?`).bind(existing.id).run();
    }
  } else {
    await db
      .prepare(`INSERT INTO enrollments (id, class_id, user_id, role, status, created_at) VALUES (?, ?, ?, 'student', 'active', ?)`)
      .bind(uid(), cls.id, user.id, now())
      .run();
  }
  await provisionForStudent(cls.id, user.id);
  return c.json({ class: { id: cls.id, name: cls.name } });
}));

/** Invite students by email — creates placeholder accounts they claim on first sign-in. */
app.post("/api/classes/:id/invite", handler(async (c) => {
  const classId = param(c, "id");
  const teacher = await requireClassTeacher(c, classId);
  const { emails } = await c.req.json<{ emails: string[] }>();
  let added = 0;
  for (const raw of emails ?? []) {
    const email = raw.trim().toLowerCase();
    if (!email.includes("@")) continue;
    let student = await db.prepare(`SELECT * FROM users WHERE email = ?`).bind(email).first<any>();
    if (!student) {
      const sid = uid();
      await db
        .prepare(`INSERT INTO users (id, org_id, email, name, role, is_admin, created_at) VALUES (?, ?, ?, ?, 'student', 0, ?)`)
        .bind(sid, teacher.org_id, email, email, now())
        .run();
      student = { id: sid };
    }
    const exists = await db
      .prepare(`SELECT id FROM enrollments WHERE class_id = ? AND user_id = ?`)
      .bind(classId, student.id)
      .first();
    if (!exists) {
      await db
        .prepare(`INSERT INTO enrollments (id, class_id, user_id, role, status, created_at) VALUES (?, ?, ?, 'student', 'active', ?)`)
        .bind(uid(), classId, student.id, now())
        .run();
      await provisionForStudent(classId, student.id);
      added++;
    }
  }
  return c.json({ added });
}));

/**
 * Add co-teachers by email. A co-teacher gets the same rights over the class as
 * the owner — building notebooks, grading, managing the roster — but the owner
 * can't be removed, so a class always has someone responsible for it.
 */
app.post("/api/classes/:id/teachers", handler(async (c) => {
  const classId = param(c, "id");
  const teacher = await requireClassTeacher(c, classId);
  const { emails } = await c.req.json<{ emails: string[] }>();
  const added: string[] = [];
  const skipped: { email: string; reason: string }[] = [];

  for (const raw of emails ?? []) {
    const email = raw.trim().toLowerCase();
    if (!email.includes("@")) continue;

    let person = await db.prepare(`SELECT * FROM users WHERE email = ?`).bind(email).first<any>();
    if (!person) {
      // Pre-create so they're a co-teacher the moment they first sign in.
      const pid = uid();
      await db
        .prepare(`INSERT INTO users (id, org_id, email, name, role, is_admin, created_at) VALUES (?, ?, ?, ?, 'teacher', 0, ?)`)
        .bind(pid, teacher.org_id, email, email, now())
        .run();
      person = { id: pid, role: "teacher" };
    } else if (person.role === "student") {
      skipped.push({ email, reason: "That account is a student — an admin can change their role in Settings." });
      continue;
    }

    const cls = await db.prepare(`SELECT owner_id FROM classes WHERE id = ?`).bind(classId).first<any>();
    if (cls?.owner_id === person.id) { skipped.push({ email, reason: "Already the class owner" }); continue; }

    const existing = await db
      .prepare(`SELECT id, role FROM enrollments WHERE class_id = ? AND user_id = ?`)
      .bind(classId, person.id)
      .first<any>();
    if (existing) {
      await db
        .prepare(`UPDATE enrollments SET role = 'teacher', status = 'active' WHERE id = ?`)
        .bind(existing.id)
        .run();
    } else {
      await db
        .prepare(`INSERT INTO enrollments (id, class_id, user_id, role, status, created_at) VALUES (?, ?, ?, 'teacher', 'active', ?)`)
        .bind(uid(), classId, person.id, now())
        .run();
    }
    added.push(email);
  }
  return c.json({ added: added.length, skipped });
}));

app.delete("/api/classes/:id/teachers/:userId", handler(async (c) => {
  const classId = param(c, "id");
  await requireClassTeacher(c, classId);
  const userId = param(c, "userId");
  const cls = await db.prepare(`SELECT owner_id FROM classes WHERE id = ?`).bind(classId).first<any>();
  if (cls?.owner_id === userId) throw new HttpError(400, "The class owner can't be removed");
  await db
    .prepare(`UPDATE enrollments SET status = 'removed' WHERE class_id = ? AND user_id = ? AND role = 'teacher'`)
    .bind(classId, userId)
    .run();
  return c.json({ ok: true });
}));

/**
 * One student's notebooks in this class, for a teacher browsing their work
 * outside of any particular assignment.
 */
app.get("/api/classes/:id/students/:studentId/notebooks", handler(async (c) => {
  const classId = param(c, "id");
  await requireClassTeacher(c, classId);
  const studentId = param(c, "studentId");

  const student = await db
    .prepare(
      `SELECT u.id, u.name, u.email, u.picture FROM users u
         JOIN enrollments e ON e.user_id = u.id
        WHERE u.id = ? AND e.class_id = ? AND e.status = 'active'`,
    )
    .bind(studentId, classId)
    .first();
  if (!student) throw new HttpError(404, "That student isn't in this class");

  const notebooks = await db
    .prepare(
      `SELECT n.id, n.title, n.page_count, n.updated_at, n.accent_color,
              n.cover_key IS NOT NULL AS has_cover,
              p.asset_key AS first_asset_key, p.source_index AS first_source_index,
              p.width AS first_width, p.height AS first_height,
              p.pattern AS first_pattern, p.pattern_color AS first_pattern_color,
              (SELECT COUNT(DISTINCT l.page_id) FROM layers l
                 JOIN instances i ON i.id = l.instance_id
                WHERE i.notebook_id = n.id AND i.student_id = ?
                  AND l.kind = 'student' AND LENGTH(l.data) > 24) AS pages_worked,
              (SELECT MAX(l.updated_at) FROM layers l
                 JOIN instances i ON i.id = l.instance_id
                WHERE i.notebook_id = n.id AND i.student_id = ? AND l.kind = 'student') AS last_worked_at
         FROM notebooks n
         LEFT JOIN pages p ON p.id = (
           SELECT id FROM pages WHERE notebook_id = n.id AND archived = 0 ORDER BY seq LIMIT 1
         )
        WHERE n.class_id = ? AND n.status = 'published'
        ORDER BY n.created_at DESC`,
    )
    .bind(studentId, studentId, classId)
    .all();

  return c.json({ student, notebooks: notebooks.results ?? [] });
}));

app.delete("/api/classes/:id/students/:userId", handler(async (c) => {
  const classId = param(c, "id");
  await requireClassTeacher(c, classId);
  await db
    .prepare(`UPDATE enrollments SET status = 'removed' WHERE class_id = ? AND user_id = ?`)
    .bind(classId, param(c, "userId"))
    .run();
  return c.json({ ok: true });
}));

/**
 * Late-enrollment backfill. Lists students who joined after assignments already
 * existed, plus the assignments a teacher can choose to hold them to.
 */
app.get("/api/classes/:id/backfill", handler(async (c) => {
  const classId = param(c, "id");
  await requireClassTeacher(c, classId);
  const students = await db
    .prepare(
      `SELECT u.id, u.name, u.email, u.picture, e.created_at AS joined_at
         FROM enrollments e JOIN users u ON u.id = e.user_id
        WHERE e.class_id = ? AND e.status = 'active' AND e.backfill_pending = 1`,
    )
    .bind(classId)
    .all();
  const assignments = await db
    .prepare(
      `SELECT id, title, due_at, grading, points_max FROM assignments
        WHERE class_id = ? AND status = 'active' ORDER BY created_at DESC`,
    )
    .bind(classId)
    .all();
  return c.json({ students: students.results ?? [], assignments: assignments.results ?? [] });
}));

app.post("/api/classes/:id/backfill", handler(async (c) => {
  const classId = param(c, "id");
  await requireClassTeacher(c, classId);
  const { studentId, assignmentIds } = await c.req.json<{ studentId: string; assignmentIds: string[] }>();
  for (const aid of assignmentIds ?? []) {
    const assignment = await db
      .prepare(`SELECT id FROM assignments WHERE id = ? AND class_id = ?`)
      .bind(aid, classId)
      .first();
    if (!assignment) continue;
    const exists = await db
      .prepare(`SELECT id FROM submissions WHERE assignment_id = ? AND student_id = ?`)
      .bind(aid, studentId)
      .first();
    if (!exists) {
      await db
        .prepare(`INSERT INTO submissions (id, assignment_id, student_id, status, created_at, updated_at) VALUES (?, ?, ?, 'not_started', ?, ?)`)
        .bind(uid(), aid, studentId, now(), now())
        .run();
    }
  }
  await db
    .prepare(`UPDATE enrollments SET backfill_pending = 0 WHERE class_id = ? AND user_id = ?`)
    .bind(classId, studentId)
    .run();
  return c.json({ ok: true });
}));
