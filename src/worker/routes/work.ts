import { app, db, storage } from "flingit";
import { handler, now, uid, requireUser, requireClassMember, HttpError, param} from "../lib/session";
import { logActivity, pageLock } from "../lib/activity";

// A single page's ink payload. Generous for real handwriting (a dense page of
// strokes compresses to well under this) while stopping a runaway client.
const MAX_LAYER_BYTES = 512 * 1024;

/**
 * Strokes per stored chunk.
 *
 * The whole point of chunking is that appending costs one chunk rather than one
 * page, so this trades write size against row count: at 50, a save rewrites a
 * few kilobytes instead of a hundred, and even a very full page is only a
 * handful of rows to read back.
 */
const CHUNK_STROKES = 20;

/**
 * Chunks one page may hold — 1,200 strokes, several times what a full page of
 * dense handwriting actually contains. This is what bounds a page now that a
 * save no longer carries the whole layer.
 */
const MAX_CHUNKS = 60;

interface LayerShape { v: 1; s: any[]; x: any[]; e: any[]; c: any[] }

const emptyShape = (): LayerShape => ({ v: 1, s: [], x: [], e: [], c: [] });

function parseShape(raw?: string | null): LayerShape {
  if (!raw) return emptyShape();
  try {
    const p = JSON.parse(raw);
    return {
      v: 1,
      s: Array.isArray(p.s) ? p.s : [],
      x: Array.isArray(p.x) ? p.x : [],
      e: Array.isArray(p.e) ? p.e : [],
      c: Array.isArray(p.c) ? p.c : [],
    };
  } catch {
    return emptyShape();
  }
}

/**
 * Split a whole layer into the rows that store it.
 *
 * Chunk 0 carries the text, stamps and comments as well as its share of the
 * strokes, so a layer written before chunking existed is already a valid chunk
 * 0 and reads back correctly with no conversion.
 */
function toChunks(layer: LayerShape): string[] {
  const head = {
    v: 1,
    s: layer.s.slice(0, CHUNK_STROKES),
    x: layer.x, e: layer.e, c: layer.c,
  };
  const out = [JSON.stringify(head)];
  for (let i = CHUNK_STROKES; i < layer.s.length; i += CHUNK_STROKES) {
    out.push(JSON.stringify({ s: layer.s.slice(i, i + CHUNK_STROKES) }));
  }
  return out;
}

/** Rebuild the single JSON payload the client has always received. */
function assemble(head: string, tail: { data: string }[]): string {
  if (tail.length === 0) return head;
  const shape = parseShape(head);
  for (const t of tail) shape.s.push(...parseShape(t.data).s);
  return JSON.stringify(shape);
}

/** Replace every overflow chunk of a layer with the given ones. */
async function writeTail(layerId: string, chunks: string[]) {
  await db.prepare(`DELETE FROM layer_chunks WHERE layer_id = ?`).bind(layerId).run();
  for (let i = 0; i < chunks.length; i++) {
    await db
      .prepare(`INSERT INTO layer_chunks (id, layer_id, seq, data) VALUES (?, ?, ?, ?)`)
      .bind(uid(), layerId, i + 1, chunks[i])
      .run();
  }
}

/**
 * Resolve the notebook instance being worked on and confirm the caller may touch it.
 *
 * Students may only ever reach their own instance. Teachers of the class may read
 * any student's instance and write only to the 'teacher' (grading) layer.
 */
async function resolveInstance(c: any, notebookId: string, studentIdParam?: string) {
  const nb = await db.prepare(`SELECT * FROM notebooks WHERE id = ?`).bind(notebookId).first<any>();
  if (!nb) throw new HttpError(404, "Notebook not found");

  // A student's own notebook in a class is nobody else's to write in. The
  // owner works in it exactly as they would a personal notebook; a teacher of
  // the class may read it, which is what `readOnly` carries to the callers that
  // save — there is no teacher layer here and no marking.
  if (nb.kind === "student") {
    const { user: u, isTeacher: teachesClass } = await requireClassMember(c, nb.class_id);
    const owns = nb.owner_id === u.id;
    if (!owns && !teachesClass) throw new HttpError(404, "Notebook not found");
    if (studentIdParam && studentIdParam !== nb.owner_id) {
      throw new HttpError(403, "That notebook belongs to one student");
    }
    const instance = await ensureInstance(nb, nb.owner_id, false);
    return { nb, user: u, isTeacher: false, instance, studentId: nb.owner_id, readOnly: !owns };
  }

  // In a personal notebook the owner is the one writing, not a teacher looking
  // in — so they resolve to their own instance and can't ask for anyone else's.
  // (There is no one else's: a personal notebook is never shared.)
  const { user, isTeacher } = nb.kind === "personal"
    ? await (async () => {
        const u = await requireUser(c);
        if (nb.owner_id !== u.id) throw new HttpError(404, "Notebook not found");
        return { user: u, isTeacher: false };
      })()
    : await requireClassMember(c, nb.class_id);

  const studentId = studentIdParam && isTeacher ? studentIdParam : user.id;
  if (studentIdParam && !isTeacher && studentIdParam !== user.id) {
    throw new HttpError(403, "You can only open your own notebook");
  }

  const instance = await ensureInstance(nb, studentId, nb.kind !== "personal");
  return { nb, user, isTeacher, instance, studentId, readOnly: false };
}

/**
 * The row that holds one person's work in one notebook, created on first open.
 *
 * Lazy rather than provisioned up front, which covers a student who enrolled
 * between publishes. `checkEnrolment` is false where ownership has already
 * settled the permission question — a personal or student-owned notebook has
 * no class membership to test.
 */
async function ensureInstance(nb: any, studentId: string, checkEnrolment: boolean) {
  let instance = await db
    .prepare(`SELECT * FROM instances WHERE notebook_id = ? AND student_id = ?`)
    .bind(nb.id, studentId)
    .first<any>();

  if (!instance) {
    if (checkEnrolment) {
      const enrolled = await db
        .prepare(`SELECT id FROM enrollments WHERE class_id = ? AND user_id = ? AND status = 'active'`)
        .bind(nb.class_id, studentId)
        .first();
      if (!enrolled) throw new HttpError(404, "That student isn't in this class");
    }
    const id = uid();
    await db
      .prepare(`INSERT INTO instances (id, notebook_id, class_id, student_id, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(id, nb.id, nb.class_id, studentId, now())
      .run();
    instance = { id, notebook_id: nb.id, class_id: nb.class_id, student_id: studentId };
  }

  return instance;
}

/**
 * Everything needed to render one student's notebook: pages, fields, their ink
 * layers, teacher markup, and typed field values.
 */
app.get("/api/notebooks/:id/work", handler(async (c) => {
  const studentParam = c.req.query("student") || undefined;
  const { nb, isTeacher, instance, studentId, readOnly } = await resolveInstance(c, param(c, "id"), studentParam);

  const pages = await db
    .prepare(
      `SELECT id, seq, asset_key, source_index, width, height, label, group_name, pattern, pattern_color
         FROM pages WHERE notebook_id = ? AND archived = 0 ORDER BY seq`,
    )
    .bind(nb.id)
    .all();
  const fields = await db
    .prepare(`SELECT id, page_id, type, x, y, w, h, label, options, prompt, content, media_key IS NOT NULL AS has_media
         FROM fields WHERE notebook_id = ? AND archived = 0`)
    .bind(nb.id)
    .all();
  const layerRows = await db
    .prepare(`SELECT id, page_id, kind, data, rev FROM layers WHERE instance_id = ?`)
    .bind(instance.id)
    .all<{ id: string; page_id: string; kind: string; data: string; rev: number }>();

  // One more query for the whole instance, not one per page: the chunks are
  // grouped in memory so a hundred-page notebook still costs two reads.
  const chunkRows = await db
    .prepare(
      `SELECT c.layer_id, c.data FROM layer_chunks c
         JOIN layers l ON l.id = c.layer_id
        WHERE l.instance_id = ? ORDER BY c.layer_id, c.seq`,
    )
    .bind(instance.id)
    .all<{ layer_id: string; data: string }>();

  const tails = new Map<string, { data: string }[]>();
  for (const r of chunkRows.results ?? []) {
    const list = tails.get(r.layer_id);
    if (list) list.push({ data: r.data });
    else tails.set(r.layer_id, [{ data: r.data }]);
  }

  const layers = {
    results: (layerRows.results ?? []).map((l) => ({
      page_id: l.page_id,
      kind: l.kind,
      data: assemble(l.data, tails.get(l.id) ?? []),
      rev: l.rev,
    })),
  };
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
    notebook: { id: nb.id, title: nb.title, classId: nb.class_id, kind: nb.kind ?? "class" },
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
    // A teacher looking into a student's own notebook is a reader. Told plainly
    // here so the client doesn't offer a pen whose every save would be refused.
    readOnly,
    canEditStudentLayer: !readOnly && (!isTeacher || studentId === (await requireUser(c)).id),
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
  const { user, isTeacher, instance, readOnly } = await resolveInstance(c, param(c, "id"), studentParam);
  if (readOnly) throw new HttpError(403, "This is the student's own notebook — you can read it, not write in it");
  const pageId = param(c, "pageId");
  const body = await c.req.json<{
    kind: "student" | "teacher";
    data?: string;
    rev?: number;
    /**
     * Append-only save: the strokes drawn since `rev`, plus the small
     * non-stroke collections in full. Drawing only ever adds to `s`, so this
     * is the shape of almost every autosave — sending a few hundred bytes
     * instead of re-uploading the whole page of ink each time.
     */
    delta?: { s: unknown[]; x: unknown[]; e: unknown[]; c: unknown[] };
  }>();
  const kind = body.kind === "teacher" ? "teacher" : "student";

  if (kind === "teacher" && !isTeacher) throw new HttpError(403, "Only teachers can add grading markup");
  if (kind === "student" && isTeacher && instance.student_id !== user.id) {
    throw new HttpError(403, "Teachers annotate on the teacher layer, not the student's");
  }
  const isDelta = !!body.delta;
  if (!isDelta && typeof body.data !== "string") throw new HttpError(400, "data must be a string");
  if (isDelta && !Array.isArray(body.delta!.s)) throw new HttpError(400, "delta.s must be an array");
  if (!isDelta && body.data!.length > MAX_LAYER_BYTES) {
    throw new HttpError(413, "That page has too much ink to save");
  }

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

    if (isDelta) {
      // A delta describes strokes appended to one exact revision. Anything
      // else — a save from another device, a rev the client guessed — has to
      // be refused rather than merged, or the append lands on ink the client
      // never saw. The client answers a 409 by sending the whole layer.
      if (body.rev !== existing.rev) return c.json({ conflict: true, rev: existing.rev }, 409);

      const head = await db
        .prepare(`SELECT data FROM layers WHERE id = ?`)
        .bind(existing.id)
        .first<{ data: string }>();
      const last = await db
        .prepare(`SELECT id, seq, data FROM layer_chunks WHERE layer_id = ? ORDER BY seq DESC LIMIT 1`)
        .bind(existing.id)
        .first<{ id: string; seq: number; data: string }>();

      const d = body.delta!;
      const headShape = parseShape(head?.data);
      // Append into the chunk that is actually last — chunk 0 only while the
      // page is still new. This is the whole saving: a full chunk is never
      // rewritten just because another stroke arrived.
      const tailShape = last ? parseShape(last.data) : headShape;
      const room = Math.max(0, CHUNK_STROKES - tailShape.s.length);
      const fill = d.s.slice(0, room);
      const spill = d.s.slice(room);

      if ((last ? last.seq : 0) + Math.ceil(spill.length / CHUNK_STROKES) > MAX_CHUNKS) {
        throw new HttpError(413, "That page has too much ink to save");
      }

      // Text, stamps and comments live in chunk 0, so it is touched only when
      // one of them actually changed — not on every stroke.
      const metaChanged =
        JSON.stringify([headShape.x, headShape.e, headShape.c]) !==
        JSON.stringify([d.x ?? [], d.e ?? [], d.c ?? []]);

      if (!last) {
        const merged = { v: 1, s: [...headShape.s, ...fill], x: d.x ?? [], e: d.e ?? [], c: d.c ?? [] };
        await db.prepare(`UPDATE layers SET data = ? WHERE id = ?`).bind(JSON.stringify(merged), existing.id).run();
      } else {
        if (fill.length) {
          await db
            .prepare(`UPDATE layer_chunks SET data = ? WHERE id = ?`)
            .bind(JSON.stringify({ s: [...tailShape.s, ...fill] }), last.id)
            .run();
        }
        if (metaChanged) {
          await db
            .prepare(`UPDATE layers SET data = ? WHERE id = ?`)
            .bind(JSON.stringify({ ...headShape, x: d.x ?? [], e: d.e ?? [], c: d.c ?? [] }), existing.id)
            .run();
        }
      }

      let seq = (last?.seq ?? 0) + 1;
      for (let i = 0; i < spill.length; i += CHUNK_STROKES) {
        await db
          .prepare(`INSERT INTO layer_chunks (id, layer_id, seq, data) VALUES (?, ?, ?, ?)`)
          .bind(uid(), existing.id, seq++, JSON.stringify({ s: spill.slice(i, i + CHUNK_STROKES) }))
          .run();
      }

      await db.prepare(`UPDATE layers SET rev = ?, updated_at = ? WHERE id = ?`).bind(rev, now(), existing.id).run();
    } else {
      // A full save replaces the layer outright, so it re-splits from scratch.
      const chunks = toChunks(parseShape(body.data!));
      if (chunks.length > MAX_CHUNKS) throw new HttpError(413, "That page has too much ink to save");
      await db
        .prepare(`UPDATE layers SET data = ?, rev = ?, updated_at = ? WHERE id = ?`)
        .bind(chunks[0], rev, now(), existing.id)
        .run();
      await writeTail(existing.id, chunks.slice(1));
    }
    await logActivity({
      actorId: user.id, actorRole: isTeacher ? "teacher" : "student",
      action: kind === "teacher" ? "annotate" : "edit",
      detail: kind === "teacher" ? "Marked up this page" : "Wrote on this page",
      notebookId: instance.notebook_id, instanceId: instance.id, pageId,
      studentId: instance.student_id,
    });
    return c.json({ ok: true, rev });
  }

  // No row yet, so a delta simply *is* the layer — but only if the client
  // believed it was starting from nothing too.
  if (isDelta && (body.rev ?? 0) !== 0) return c.json({ conflict: true, rev: 0 }, 409);
  const fresh = isDelta
    ? JSON.stringify({ v: 1, s: body.delta!.s, x: body.delta!.x ?? [], e: body.delta!.e ?? [], c: body.delta!.c ?? [] })
    : body.data!;
  if (fresh.length > MAX_LAYER_BYTES) throw new HttpError(413, "That page has too much ink to save");

  const chunks = toChunks(parseShape(fresh));
  if (chunks.length > MAX_CHUNKS) throw new HttpError(413, "That page has too much ink to save");
  const layerId = uid();
  await db
    .prepare(`INSERT INTO layers (id, instance_id, page_id, kind, data, rev, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?)`)
    .bind(layerId, instance.id, pageId, kind, chunks[0], now())
    .run();
  await writeTail(layerId, chunks.slice(1));
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
  const { nb, user, isTeacher, instance, readOnly } = await resolveInstance(c, param(c, "id"), studentParam);
  if (readOnly) throw new HttpError(403, "This is the student's own notebook — you can read it, not write in it");
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
  const { user, isTeacher, instance, readOnly } = await resolveInstance(c, param(c, "id"), studentParam);
  if (readOnly) throw new HttpError(403, "This is the student's own notebook — you can read it, not write in it");
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
  const { user, isTeacher, instance, readOnly } = await resolveInstance(c, param(c, "id"), studentParam);
  if (readOnly) throw new HttpError(403, "This is the student's own notebook — you can read it, not write in it");
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
