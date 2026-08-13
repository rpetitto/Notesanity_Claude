import { app, db } from "flingit";
import { handler, now, uid, requireUser, requireClassMember, HttpError, param} from "../lib/session";

// A single page's ink payload. Generous for real handwriting (a dense page of
// strokes compresses to well under this) while stopping a runaway client.
const MAX_LAYER_BYTES = 512 * 1024;

/**
 * Resolve the notebook instance being worked on and confirm the caller may touch it.
 *
 * Students may only ever reach their own instance. Teachers of the class may read
 * any student's instance and write only to the 'teacher' (grading) layer.
 */
async function resolveInstance(c: any, notebookId: string, studentIdParam?: string) {
  const nb = await db.prepare(`SELECT * FROM notebooks WHERE id = ?`).bind(notebookId).first<any>();
  if (!nb) throw new HttpError(404, "Notebook not found");
  const { user, isTeacher } = await requireClassMember(c, nb.class_id);

  const studentId = studentIdParam && isTeacher ? studentIdParam : user.id;
  if (studentIdParam && !isTeacher && studentIdParam !== user.id) {
    throw new HttpError(403, "You can only open your own notebook");
  }

  let instance = await db
    .prepare(`SELECT * FROM instances WHERE notebook_id = ? AND student_id = ?`)
    .bind(nb.id, studentId)
    .first<any>();

  // Lazily provision on first open — covers a student who enrolled between publishes.
  if (!instance) {
    const enrolled = await db
      .prepare(`SELECT id FROM enrollments WHERE class_id = ? AND user_id = ? AND status = 'active'`)
      .bind(nb.class_id, studentId)
      .first();
    if (!enrolled) throw new HttpError(404, "That student isn't in this class");
    const id = uid();
    await db
      .prepare(`INSERT INTO instances (id, notebook_id, class_id, student_id, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(id, nb.id, nb.class_id, studentId, now())
      .run();
    instance = { id, notebook_id: nb.id, class_id: nb.class_id, student_id: studentId };
  }

  return { nb, user, isTeacher, instance, studentId };
}

/**
 * Everything needed to render one student's notebook: pages, fields, their ink
 * layers, teacher markup, and typed field values.
 */
app.get("/api/notebooks/:id/work", handler(async (c) => {
  const studentParam = c.req.query("student") || undefined;
  const { nb, isTeacher, instance, studentId } = await resolveInstance(c, param(c, "id"), studentParam);

  const pages = await db
    .prepare(
      `SELECT id, seq, asset_key, source_index, width, height, label, group_name
         FROM pages WHERE notebook_id = ? AND archived = 0 ORDER BY seq`,
    )
    .bind(nb.id)
    .all();
  const fields = await db
    .prepare(`SELECT id, page_id, type, x, y, w, h, label, options FROM fields WHERE notebook_id = ? AND archived = 0`)
    .bind(nb.id)
    .all();
  const layers = await db
    .prepare(`SELECT page_id, kind, data, rev FROM layers WHERE instance_id = ?`)
    .bind(instance.id)
    .all();
  const values = await db
    .prepare(`SELECT field_id, value FROM field_values WHERE instance_id = ?`)
    .bind(instance.id)
    .all();
  const student = await db
    .prepare(`SELECT id, name, email, picture FROM users WHERE id = ?`)
    .bind(studentId)
    .first();

  return c.json({
    notebook: { id: nb.id, title: nb.title, classId: nb.class_id },
    instanceId: instance.id,
    pages: pages.results ?? [],
    fields: fields.results ?? [],
    layers: layers.results ?? [],
    values: values.results ?? [],
    student,
    isTeacher,
    canEditStudentLayer: !isTeacher || studentId === (await requireUser(c)).id,
  });
}));

/**
 * Autosave one page's ink layer.
 *
 * `rev` is optimistic-concurrency: the client sends the revision it started from
 * and we reject a save that would clobber a newer one, so a stale tab can't wipe
 * work saved from another device.
 */
app.put("/api/notebooks/:id/layers/:pageId", handler(async (c) => {
  const studentParam = c.req.query("student") || undefined;
  const { user, isTeacher, instance } = await resolveInstance(c, param(c, "id"), studentParam);
  const pageId = param(c, "pageId");
  const body = await c.req.json<{ kind: "student" | "teacher"; data: string; rev?: number }>();
  const kind = body.kind === "teacher" ? "teacher" : "student";

  if (kind === "teacher" && !isTeacher) throw new HttpError(403, "Only teachers can add grading markup");
  if (kind === "student" && isTeacher && instance.student_id !== user.id) {
    throw new HttpError(403, "Teachers annotate on the teacher layer, not the student's");
  }
  if (typeof body.data !== "string") throw new HttpError(400, "data must be a string");
  if (body.data.length > MAX_LAYER_BYTES) throw new HttpError(413, "That page has too much ink to save");

  // A submitted assignment locks the student layer until the teacher returns it.
  if (kind === "student") {
    const locked = await db
      .prepare(
        `SELECT s.id FROM submissions s
           JOIN assignments a ON a.id = s.assignment_id
          WHERE s.student_id = ? AND s.status = 'submitted'
            AND a.notebook_id = ? AND a.page_ids LIKE ?`,
      )
      .bind(instance.student_id, instance.notebook_id, `%"${pageId}"%`)
      .first();
    if (locked) throw new HttpError(423, "This page is locked — it's part of a submitted assignment.");
  }

  const existing = await db
    .prepare(`SELECT id, rev FROM layers WHERE instance_id = ? AND page_id = ? AND kind = ?`)
    .bind(instance.id, pageId, kind)
    .first<{ id: string; rev: number }>();

  if (existing) {
    if (body.rev !== undefined && body.rev < existing.rev) {
      return c.json({ conflict: true, rev: existing.rev }, 409);
    }
    const rev = existing.rev + 1;
    await db
      .prepare(`UPDATE layers SET data = ?, rev = ?, updated_at = ? WHERE id = ?`)
      .bind(body.data, rev, now(), existing.id)
      .run();
    return c.json({ ok: true, rev });
  }

  await db
    .prepare(`INSERT INTO layers (id, instance_id, page_id, kind, data, rev, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?)`)
    .bind(uid(), instance.id, pageId, kind, body.data, now())
    .run();
  return c.json({ ok: true, rev: 1 });
}));

/** Save typed answers to teacher-defined form fields. */
app.put("/api/notebooks/:id/values", handler(async (c) => {
  const studentParam = c.req.query("student") || undefined;
  const { user, isTeacher, instance } = await resolveInstance(c, param(c, "id"), studentParam);
  if (isTeacher && instance.student_id !== user.id) {
    throw new HttpError(403, "Teachers can't type into a student's answers");
  }
  const { values } = await c.req.json<{ values: { fieldId: string; value: string }[] }>();
  for (const v of values ?? []) {
    if (typeof v.value !== "string" || v.value.length > 8192) continue;
    const existing = await db
      .prepare(`SELECT id FROM field_values WHERE instance_id = ? AND field_id = ?`)
      .bind(instance.id, v.fieldId)
      .first<{ id: string }>();
    if (existing) {
      await db
        .prepare(`UPDATE field_values SET value = ?, updated_at = ? WHERE id = ?`)
        .bind(v.value, now(), existing.id)
        .run();
    } else {
      await db
        .prepare(`INSERT INTO field_values (id, instance_id, field_id, value, updated_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(uid(), instance.id, v.fieldId, v.value, now())
        .run();
    }
  }
  return c.json({ ok: true });
}));
