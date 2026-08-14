import { app, db, storage } from "flingit";
import { handler, now, uid, requireUser, requireClassMember, HttpError, param} from "../lib/session";
import { logActivity, pageLock } from "../lib/activity";

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
    .prepare(`SELECT id, page_id, type, x, y, w, h, label, options, prompt, media_key IS NOT NULL AS has_media
         FROM fields WHERE notebook_id = ? AND archived = 0`)
    .bind(nb.id)
    .all();
  const layers = await db
    .prepare(`SELECT page_id, kind, data, rev FROM layers WHERE instance_id = ?`)
    .bind(instance.id)
    .all();
  const values = await db
    .prepare(`SELECT field_id, value, asset_key, content_type FROM field_values WHERE instance_id = ?`)
    .bind(instance.id)
    .all();
  // Published teacher annotations on the master pages — the same for everyone.
  const masterAnnotations = await db
    .prepare(`SELECT page_id, published_data FROM page_annotations WHERE notebook_id = ? AND published_data <> ''`)
    .bind(nb.id)
    .all<any>();

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
    masterAnnotations: (masterAnnotations.results ?? []).map((a: any) => ({
      pageId: a.page_id, data: a.published_data,
    })),
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

  // Handed-in work stays frozen, including after it is returned, until a teacher
  // reopens it. That closes the window where a page could be changed after
  // marking and passed off as the original.
  if (kind === "student") {
    const lock = await pageLock(instance.student_id, instance.notebook_id, pageId);
    if (lock) {
      throw new HttpError(
        423,
        lock.returned
          ? `This page is locked — you handed it in for "${lock.title}" and it's been marked. Ask your teacher to reopen it.`
          : `This page is locked — you handed it in for "${lock.title}".`,
      );
    }
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
    await logActivity({
      actorId: user.id, actorRole: isTeacher ? "teacher" : "student",
      action: kind === "teacher" ? "annotate" : "edit",
      detail: kind === "teacher" ? "Marked up this page" : "Wrote on this page",
      notebookId: instance.notebook_id, instanceId: instance.id, pageId,
      studentId: instance.student_id,
    });
    return c.json({ ok: true, rev });
  }

  await db
    .prepare(`INSERT INTO layers (id, instance_id, page_id, kind, data, rev, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?)`)
    .bind(uid(), instance.id, pageId, kind, body.data, now())
    .run();
  await logActivity({
    actorId: user.id, actorRole: isTeacher ? "teacher" : "student",
    action: kind === "teacher" ? "annotate" : "edit",
    detail: kind === "teacher" ? "Marked up this page" : "Wrote on this page",
    notebookId: instance.notebook_id, instanceId: instance.id, pageId,
    studentId: instance.student_id,
  });
  return c.json({ ok: true, rev: 1 });
}));

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

// Checked against the *field's* type, not just "is this any media file" — an
// audio clip dropped into an image box would render as a broken picture.
const ACCEPTED: Record<string, RegExp> = {
  image: /^image\/(png|jpe?g|webp|gif|heic|heif)$/,
  audio: /^audio\/(webm|mpeg|mp3|mp4|ogg|wav|x-wav|x-m4a|m4a|aac|3gpp|flac)$/,
};

/**
 * A browser recording arrives as `audio/webm;codecs=opus`, not `audio/webm` —
 * MediaRecorder always names the codec. Compare on the bare type so a perfectly
 * good recording isn't refused over a parameter.
 */
const bareType = (value: string) => (value || "").split(";")[0].trim().toLowerCase();

/**
 * Upload a student's image or audio response into an `image` / `audio` field.
 *
 * The file is stored under the notebook and referenced from the field value, so
 * it travels with the same permission model as everything else: only the owning
 * student can write it, and only class members can read it.
 */
app.post("/api/notebooks/:id/responses/:fieldId", handler(async (c) => {
  const studentParam = c.req.query("student") || undefined;
  const { nb, user, isTeacher, instance } = await resolveInstance(c, param(c, "id"), studentParam);
  if (isTeacher && instance.student_id !== user.id) {
    throw new HttpError(403, "Teachers can't answer on a student's behalf");
  }
  const fieldId = param(c, "fieldId");
  const field = await db
    .prepare(`SELECT id, type FROM fields WHERE id = ? AND notebook_id = ? AND archived = 0`)
    .bind(fieldId, nb.id)
    .first<any>();
  if (!field) throw new HttpError(404, "Field not found");
  if (field.type !== "image" && field.type !== "audio") {
    throw new HttpError(400, "That field doesn't accept a file");
  }

  const form = await c.req.parseBody();
  const file = form["file"] as File | undefined;
  if (!file) throw new HttpError(400, "No file uploaded");
  const accepted = ACCEPTED[field.type];
  if (!accepted.test(bareType(file.type))) {
    throw new HttpError(
      400,
      field.type === "image"
        ? `That's a ${bareType(file.type) || "file"} — this box takes an image.`
        : `That's a ${bareType(file.type) || "file"} — this box takes an audio recording.`,
    );
  }
  if (file.size > MAX_RESPONSE_BYTES) throw new HttpError(413, "Uploads are limited to 10MB");

  const key = `notebooks/${nb.id}/responses/${instance.id}/${fieldId}-${uid()}`;
  await storage.put(key, await file.arrayBuffer(), { contentType: file.type });

  const existing = await db
    .prepare(`SELECT id FROM field_values WHERE instance_id = ? AND field_id = ?`)
    .bind(instance.id, fieldId)
    .first<{ id: string }>();
  if (existing) {
    await db
      .prepare(`UPDATE field_values SET asset_key = ?, content_type = ?, value = '', updated_at = ? WHERE id = ?`)
      .bind(key, file.type, now(), existing.id)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO field_values (id, instance_id, field_id, value, asset_key, content_type, updated_at)
         VALUES (?, ?, ?, '', ?, ?, ?)`,
      )
      .bind(uid(), instance.id, fieldId, key, file.type, now())
      .run();
  }
  await logActivity({
    actorId: user.id, actorRole: isTeacher ? "teacher" : "student", action: "upload",
    detail: field.type === "image" ? "Added an image" : "Added a recording",
    notebookId: nb.id, instanceId: instance.id, studentId: instance.student_id,
  });
  return c.json({ ok: true, contentType: file.type });
}));

/** Serve a student's uploaded response to anyone who may view their work. */
app.get("/api/notebooks/:id/responses/:fieldId", handler(async (c) => {
  const studentParam = c.req.query("student") || undefined;
  const { instance } = await resolveInstance(c, param(c, "id"), studentParam);
  const row = await db
    .prepare(`SELECT asset_key, content_type FROM field_values WHERE instance_id = ? AND field_id = ?`)
    .bind(instance.id, param(c, "fieldId"))
    .first<any>();
  if (!row?.asset_key) throw new HttpError(404, "Nothing uploaded yet");
  const obj = await storage.get(row.asset_key);
  if (!obj) throw new HttpError(404, "File not found");
  return new Response(await obj.arrayBuffer(), {
    headers: {
      "Content-Type": row.content_type ?? obj.contentType ?? "application/octet-stream",
      "Cache-Control": "private, max-age=300",
    },
  });
}));

app.delete("/api/notebooks/:id/responses/:fieldId", handler(async (c) => {
  const studentParam = c.req.query("student") || undefined;
  const { user, isTeacher, instance } = await resolveInstance(c, param(c, "id"), studentParam);
  if (isTeacher && instance.student_id !== user.id) throw new HttpError(403, "Not your response to remove");
  await db
    .prepare(`UPDATE field_values SET asset_key = NULL, content_type = NULL, updated_at = ? WHERE instance_id = ? AND field_id = ?`)
    .bind(now(), instance.id, param(c, "fieldId"))
    .run();
  return c.json({ ok: true });
}));

/** Save typed answers to teacher-defined form fields. */
app.put("/api/notebooks/:id/values", handler(async (c) => {
  const studentParam = c.req.query("student") || undefined;
  const { user, isTeacher, instance } = await resolveInstance(c, param(c, "id"), studentParam);
  if (isTeacher && instance.student_id !== user.id) {
    throw new HttpError(403, "Teachers can't type into a student's answers");
  }
  const { values } = await c.req.json<{ values: { fieldId: string; value: string }[] }>();

  // Answers live on a page too, so they freeze with it.
  for (const v of values ?? []) {
    const field = await db
      .prepare(`SELECT page_id FROM fields WHERE id = ?`)
      .bind(v.fieldId)
      .first<{ page_id: string }>();
    if (!field) continue;
    const lock = await pageLock(instance.student_id, instance.notebook_id, field.page_id);
    if (lock) throw new HttpError(423, `This page is locked — you handed it in for "${lock.title}".`);
  }
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
  if ((values ?? []).length) {
    await logActivity({
      actorId: user.id, actorRole: isTeacher ? "teacher" : "student", action: "answer",
      detail: "Typed an answer", notebookId: instance.notebook_id,
      instanceId: instance.id, studentId: instance.student_id,
    });
  }
  return c.json({ ok: true });
}));
