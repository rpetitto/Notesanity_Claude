import { app, db, storage } from "../platform";
import { handler, now, uid, requireUser, HttpError, param} from "../lib/session";
import { coalesceStatement, insertActivity, lockFrom, logActivity, pageLock, pageLockStatement, type LogInput } from "../lib/activity";
import {
  MAX_LAYER_BYTES, type LayerShape,
  inkKey, parseShape, readInk, readInkMany, writeInk,
} from "../lib/ink";

const ARCHIVED_REASON =
  "This class has been archived — everything in it can be read, and nothing in it can be changed.";
const OTHERS_NOTEBOOK_REASON =
  "This is the student's own notebook — you can read it, not write in it";

/**
 * Resolve the notebook instance being worked on and confirm the caller may touch it.
 *
 * Students may only ever reach their own instance. Teachers of the class may read
 * any student's instance and write only to the 'teacher' (grading) layer.
 *
 * Every autosave starts here, so it asks the database once: the notebook, its
 * class, the caller's place in that class and the caller's own instance, in a
 * single joined query. It was five queries in a row, run before every stroke
 * was saved.
 */
async function resolveInstance(c: any, notebookId: string, studentIdParam?: string) {
  const user = await requireUser(c);
  const row = await db
    .prepare(
      `SELECT n.*, cl.id AS cl_id, cl.owner_id AS cl_owner, cl.archived AS cl_archived,
              (SELECT role FROM enrollments WHERE class_id = n.class_id AND user_id = ? AND status = 'active') AS my_role,
              i.id AS i_id
         FROM notebooks n
         LEFT JOIN classes cl ON cl.id = n.class_id
         LEFT JOIN instances i ON i.notebook_id = n.id
                              AND i.student_id = CASE WHEN n.kind = 'student' THEN n.owner_id ELSE ? END
        WHERE n.id = ?`,
    )
    .bind(user.id, user.id, notebookId)
    .first<any>();
  if (!row) throw new HttpError(404, "Notebook not found");
  const { cl_id, cl_owner, cl_archived, my_role, i_id, ...nb } = row;

  // The same answers requireClassMember gives, from the row already in hand.
  const teachesOrThrow = () => {
    if (!cl_id) throw new HttpError(404, "Class not found");
    if (cl_owner === user.id) return true;
    if (!my_role) throw new HttpError(403, "You're not in this class");
    return my_role === "teacher";
  };
  // An archived class is a shelf, not a desk; a notebook with no class has none.
  const archived = !!cl_archived;
  const own = (studentId: string) =>
    i_id ? { id: i_id, notebook_id: nb.id, class_id: nb.class_id, student_id: studentId } : null;

  // A student's own notebook in a class is nobody else's to write in. The
  // owner works in it exactly as they would a personal notebook; a teacher of
  // the class may read it, which is what `readOnly` carries to the callers that
  // save — there is no marking here and no grade.
  //
  // The one exception is the student's own doing: they can open individual
  // pages for their teacher to write on. `canAnnotate` says the caller is that
  // teacher; which pages they were invited onto is a per-page question, asked
  // where the writing happens. `readOnly` stays true either way, because
  // everything else — the answers, the responses, the notebook itself — is
  // still not theirs.
  if (nb.kind === "student") {
    const teachesClass = teachesOrThrow();
    const owns = nb.owner_id === user.id;
    if (!owns && !teachesClass) throw new HttpError(404, "Notebook not found");
    if (studentIdParam && studentIdParam !== nb.owner_id) {
      throw new HttpError(403, "That notebook belongs to one student");
    }
    const instance = own(nb.owner_id) ?? await ensureInstance(nb, nb.owner_id, false);
    return {
      nb, user, isTeacher: false, instance, studentId: nb.owner_id,
      readOnly: !owns || archived,
      canAnnotate: !owns && teachesClass && !archived,
      // Both can be true; the archive is the one that explains more, because
      // it is the one the reader can't do anything about by asking.
      readOnlyReason: archived ? ARCHIVED_REASON : !owns ? OTHERS_NOTEBOOK_REASON : "",
    };
  }

  // In a personal notebook the owner is the one writing, not a teacher looking
  // in — so they resolve to their own instance and can't ask for anyone else's.
  // (There is no one else's: a personal notebook is never shared.)
  let isTeacher = false;
  if (nb.kind === "personal") {
    if (nb.owner_id !== user.id) throw new HttpError(404, "Notebook not found");
  } else {
    isTeacher = teachesOrThrow();
  }

  // Same rule as the notebook routes: a class notebook a teacher hasn't
  // published yet isn't a thing a student can open, by link or by guess.
  if (!isTeacher && nb.status !== "published") throw new HttpError(404, "Notebook not found");
  if (!isTeacher && nb.archived) throw new HttpError(404, "Notebook not found");

  const studentId = studentIdParam && isTeacher ? studentIdParam : user.id;
  if (studentIdParam && !isTeacher && studentIdParam !== user.id) {
    throw new HttpError(403, "You can only open your own notebook");
  }

  const instance = (studentId === user.id ? own(studentId) : null)
    ?? await ensureInstance(nb, studentId, nb.kind !== "personal");
  // An archived class is a shelf, not a desk. Everything in it stays readable —
  // that is the point of keeping it rather than deleting it — and nothing in it
  // is writable, so last term's work can't be quietly edited after the fact.
  return {
    nb, user, isTeacher, instance, studentId,
    readOnly: archived, canAnnotate: false,
    readOnlyReason: archived ? ARCHIVED_REASON : "",
  };
}

/**
 * The row that holds one person's work in one notebook, created on first open.
 *
 * Lazy rather than provisioned up front, which covers a student who enrolled
 * between publishes. `checkEnrolment` is false where ownership has already
 * settled the permission question — a personal or student-owned notebook has
 * no class membership to test.
 *
 * The first open often arrives as two requests at once (the page and its
 * prefetch), so the insert yields to one that got there first instead of
 * failing on the unique (notebook, student) pair.
 */
async function ensureInstance(nb: any, studentId: string, checkEnrolment: boolean) {
  const find = () => db
    .prepare(`SELECT * FROM instances WHERE notebook_id = ? AND student_id = ?`)
    .bind(nb.id, studentId)
    .first<any>();
  const instance = await find();
  if (instance) return instance;

  if (checkEnrolment) {
    const enrolled = await db
      .prepare(`SELECT id FROM enrollments WHERE class_id = ? AND user_id = ? AND status = 'active'`)
      .bind(nb.class_id, studentId)
      .first();
    if (!enrolled) throw new HttpError(404, "That student isn't in this class");
  }
  await db
    .prepare(`INSERT OR IGNORE INTO instances (id, notebook_id, class_id, student_id, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(uid(), nb.id, nb.class_id, studentId, now())
    .run();
  return await find();
}

/**
 * Everything needed to render one student's notebook: pages, fields, their ink
 * layers, teacher markup, and typed field values.
 */
app.get("/api/notebooks/:id/work", handler(async (c) => {
  const studentParam = c.req.query("student") || undefined;
  const { nb, isTeacher, instance, studentId, readOnly, readOnlyReason, canAnnotate } =
    await resolveInstance(c, param(c, "id"), studentParam);

  /**
   * Narrow the whole response to the pages asked for.
   *
   * Ink is one R2 object per layer now, so the cost of this route scales with
   * the number of pages a student has written on. Grading only ever shows the
   * pages an assignment covers, and used to load the entire notebook and throw
   * the rest away — with a next-student prefetch on top of it. Naming the pages
   * turns a class of thirty into thirty small reads instead of thirty whole
   * notebooks.
   */
  const wanted = (c.req.query("pages") || "").split(",").map((p) => p.trim()).filter(Boolean);
  const pageFilter = wanted.length ? ` AND id IN (${wanted.map(() => "?").join(",")})` : "";
  const layerFilter = wanted.length ? ` AND page_id IN (${wanted.map(() => "?").join(",")})` : "";

  // Everything the page needs from the database, in one round trip; the ink
  // itself follows from R2 once we know which layers hold any.
  const [pages, fields, layerRows, values, masterAnnotations, studentRes] = await db.batch([
    db.prepare(
      `SELECT id, seq, asset_key, source_index, width, height, label, group_name, pattern, pattern_color,
              teacher_annotate
         FROM pages WHERE notebook_id = ? AND archived = 0${pageFilter} ORDER BY seq`,
    ).bind(nb.id, ...wanted),
    db.prepare(`SELECT id, page_id, type, x, y, w, h, label, options, prompt, content, media_key IS NOT NULL AS has_media
         FROM fields WHERE notebook_id = ? AND archived = 0${layerFilter}`)
      .bind(nb.id, ...wanted),
    db.prepare(
      `SELECT id, page_id, kind, data, rev, byte_length FROM layers
        WHERE instance_id = ?${layerFilter}`,
    ).bind(instance.id, ...wanted),
    db.prepare(`SELECT field_id, value, asset_key, content_type FROM field_values WHERE instance_id = ?`)
      .bind(instance.id),
    // Published teacher annotations on the master pages — the same for everyone,
    // and narrowed by `?pages=` for the same reason the layers are.
    db.prepare(
      `SELECT page_id, published_data FROM page_annotations
        WHERE notebook_id = ? AND published_data <> ''${layerFilter}`,
    ).bind(nb.id, ...wanted),
    db.prepare(`SELECT id, name, email, picture FROM users WHERE id = ?`).bind(studentId),
  ]) as [D1Result, D1Result, D1Result<{ id: string; page_id: string; kind: string; data: string; rev: number; byte_length: number }>, D1Result, D1Result<any>, D1Result];
  const student = studentRes.results?.[0] ?? null;

  // Only layers that hold something are worth a fetch — a row exists for every
  // page ever touched, including ones erased back to blank.
  const inked = (layerRows.results ?? []).filter((l) => l.byte_length > 0 || l.data !== "");
  const keys = inked.map((l) => inkKey(nb.id, instance.id, l.page_id, l.kind));
  const blobs = await readInkMany(keys);

  const layers = {
    results: inked.map((l, i) => {
      // Until `026` blanks it, a row the backfill hasn't reached still holds
      // its payload in D1. Absent object, not failed read — `readInk` throws
      // on a genuine R2 failure rather than quietly reporting an empty page.
      const stored = blobs.get(keys[i]) ?? parseShape(l.data);
      const { v, s, x, e, c: comments } = stored;
      return {
        page_id: l.page_id,
        kind: l.kind,
        // Rebuilt without the stored `rev`, so the client receives exactly the
        // payload it always has.
        data: JSON.stringify({ v, s, x, e, c: comments }),
        rev: l.rev,
      };
    }),
  };

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
    // Why, so the screen can say so rather than just withholding the pen.
    readOnlyReason,
    // ...except on the pages the student opened up. The pages carry
    // `teacher_annotate`, so the client can offer the pen exactly there.
    canAnnotate,
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
  const { user, isTeacher, instance, readOnly, canAnnotate } = await resolveInstance(c, param(c, "id"), studentParam);
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

  // A reader may write in exactly one circumstance: they teach the class, the
  // notebook is the student's own, this is the teacher layer, and the student
  // opened this page. Checked here rather than in `resolveInstance` because
  // it is a fact about a page, and this is the only route that writes to one.
  if (readOnly) {
    const invited = kind === "teacher" && canAnnotate
      ? await db
          .prepare(`SELECT 1 FROM pages WHERE id = ? AND notebook_id = ? AND teacher_annotate = 1`)
          .bind(pageId, instance.notebook_id)
          .first()
      : null;
    if (!invited) {
      throw new HttpError(
        403,
        !canAnnotate
          ? "This is the student's own notebook — you can read it, not write in it"
          : kind === "student"
            // Being invited onto a page is permission to add your own marks to
            // it, never to alter what the student wrote.
            ? "That's the student's own writing — yours goes on the teacher layer"
            : "This page isn't open for you to write on — the student decides which pages are.",
      );
    }
  }

  if (kind === "teacher" && !isTeacher && !canAnnotate) {
    throw new HttpError(403, "Only teachers can add grading markup");
  }
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
  // marking and passed off as the original. Asked in the same round trip as
  // the layer's current row.
  const [layerRes, lockRes] = await db.batch([
    db.prepare(`SELECT id, rev, data FROM layers WHERE instance_id = ? AND page_id = ? AND kind = ?`)
      .bind(instance.id, pageId, kind),
    ...(kind === "student" ? [pageLockStatement(instance.student_id, instance.notebook_id, pageId)] : []),
  ]);
  if (kind === "student") {
    const lock = lockFrom(lockRes?.results?.[0]);
    if (lock) {
      throw new HttpError(
        423,
        lock.returned
          ? `This page is locked — you handed it in for "${lock.title}" and it's been marked. Ask your teacher to reopen it.`
          : `This page is locked — you handed it in for "${lock.title}".`,
      );
    }
  }

  const key = inkKey(instance.notebook_id, instance.id, pageId, kind);
  const existing = layerRes.results?.[0] as { id: string; rev: number; data: string } | undefined;
  const activity: LogInput = {
    actorId: user.id, actorRole: isTeacher ? "teacher" : "student",
    action: kind === "teacher" ? "annotate" : "edit",
    detail: kind === "teacher" ? "Marked up this page" : "Wrote on this page",
    notebookId: instance.notebook_id, instanceId: instance.id, pageId,
    studentId: instance.student_id,
  };

  if (existing) {
    if (body.rev !== undefined && body.rev < existing.rev) {
      return c.json({ conflict: true, rev: existing.rev }, 409);
    }

    const rev = existing.rev + 1;
    let next: LayerShape;

    if (isDelta) {
      // A delta describes strokes appended to one exact revision. Anything
      // else — a save from another device, a rev the client guessed — has to
      // be refused rather than merged, or the append lands on ink the client
      // never saw. The client answers a 409 by sending the whole layer.
      if (body.rev !== existing.rev) return c.json({ conflict: true, rev: existing.rev }, 409);

      const stored = await readInk(key);

      /*
       * The object already carries this revision, so a previous attempt's put
       * landed and only the row update was lost. Appending the same strokes a
       * second time would duplicate them, so reconcile the row and stop.
       */
      if (stored && stored.rev >= rev) {
        const settled = JSON.stringify({ v: stored.v, s: stored.s, x: stored.x, e: stored.e, c: stored.c, rev: stored.rev });
        await db
          .prepare(`UPDATE layers SET rev = ?, byte_length = ?, updated_at = ? WHERE id = ?`)
          .bind(rev, settled.length, now(), existing.id)
          .run();
        return c.json({ ok: true, rev });
      }

      const d = body.delta!;
      // Falls back to the D1 column for a row the backfill hasn't reached.
      const base = stored ?? parseShape(existing.data);
      next = { v: 1, s: [...base.s, ...d.s], x: d.x ?? [], e: d.e ?? [], c: d.c ?? [] };
    } else {
      next = parseShape(body.data!);
    }

    // R2 first, then the row. The recoverable failure is an object ahead of its
    // row — the branch above repairs that. A row claiming a revision the object
    // doesn't have is not recoverable: the next delta would append onto strokes
    // the client never saw.
    const size = await writeInk(key, next, rev);
    if (size > MAX_LAYER_BYTES) throw new HttpError(413, "That page has too much ink to save");
    // `AND rev = ?`: two saves that both started from this revision can't
    // both claim the next one. The one that loses is told so, and its client
    // answers a conflict the way it always has, by fetching and resending.
    const [updated, folded] = await db.batch([
      db.prepare(`UPDATE layers SET data = '', byte_length = ?, rev = ?, updated_at = ? WHERE id = ? AND rev = ?`)
        .bind(size, rev, now(), existing.id, existing.rev),
      coalesceStatement(activity)!,
    ]);
    if (!updated.meta?.changes) return c.json({ conflict: true, rev }, 409);
    if (!folded.meta?.changes) await insertActivity(activity);
    return c.json({ ok: true, rev });
  }

  // No row yet, so a delta simply *is* the layer — but only if the client
  // believed it was starting from nothing too.
  if (isDelta && (body.rev ?? 0) !== 0) return c.json({ conflict: true, rev: 0 }, 409);
  const fresh: LayerShape = isDelta
    ? { v: 1, s: body.delta!.s, x: body.delta!.x ?? [], e: body.delta!.e ?? [], c: body.delta!.c ?? [] }
    : parseShape(body.data!);

  const size = await writeInk(key, fresh, 1);
  if (size > MAX_LAYER_BYTES) throw new HttpError(413, "That page has too much ink to save");
  const layerId = uid();
  // OR IGNORE: a first save from two tabs at once — the second finds the row
  // the first made, and is told it's behind.
  const inserted = await db
    .prepare(
      `INSERT OR IGNORE INTO layers (id, instance_id, page_id, kind, data, byte_length, rev, updated_at)
       VALUES (?, ?, ?, ?, '', ?, 1, ?)`,
    )
    .bind(layerId, instance.id, pageId, kind, size, now())
    .run();
  if (!inserted.meta?.changes) return c.json({ conflict: true, rev: 1 }, 409);
  await logActivity(activity);
  return c.json({ ok: true, rev: 1 });
}));

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
/** More boxes than any page has; a save claiming more is not a real one. */
const MAX_VALUES_PER_SAVE = 500;

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
  const { nb, user, isTeacher, instance, readOnly, readOnlyReason } = await resolveInstance(c, param(c, "id"), studentParam);
  if (readOnly) throw new HttpError(403, readOnlyReason || OTHERS_NOTEBOOK_REASON);
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
  const { user, isTeacher, instance, readOnly, readOnlyReason } = await resolveInstance(c, param(c, "id"), studentParam);
  if (readOnly) throw new HttpError(403, readOnlyReason || OTHERS_NOTEBOOK_REASON);
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
  const { user, isTeacher, instance, readOnly, readOnlyReason } = await resolveInstance(c, param(c, "id"), studentParam);
  if (readOnly) throw new HttpError(403, readOnlyReason || OTHERS_NOTEBOOK_REASON);
  if (isTeacher && instance.student_id !== user.id) {
    throw new HttpError(403, "Teachers can't type into a student's answers");
  }
  const body = await c.req.json<{ values: { fieldId: string; value: string }[] }>();
  // The last value sent for a box wins, as it did when each was written in turn.
  const latest = new Map<string, string>();
  for (const v of body.values ?? []) {
    if (typeof v?.fieldId === "string" && typeof v.value === "string" && v.value.length <= 8192) latest.set(v.fieldId, v.value);
  }
  if (latest.size === 0) return c.json({ ok: true });
  if (latest.size > MAX_VALUES_PER_SAVE) throw new HttpError(413, "That's too many answers in one save");

  // Which of these boxes are really in this notebook, and which of its pages
  // are handed in — one round trip for both. A box from anywhere else is
  // ignored rather than stored against this student.
  const ids = [...latest.keys()];
  const chunks: string[][] = [];
  for (let k = 0; k < ids.length; k += 90) chunks.push(ids.slice(k, k + 90));
  const results = await db.batch([
    db.prepare(
      `SELECT a.page_ids, a.title FROM submissions s JOIN assignments a ON a.id = s.assignment_id
        WHERE s.student_id = ? AND a.notebook_id = ? AND s.locked = 1
        ORDER BY s.submitted_at DESC`,
    ).bind(instance.student_id, instance.notebook_id),
    ...chunks.map((chunk) =>
      db.prepare(`SELECT id, page_id FROM fields WHERE notebook_id = ? AND id IN (${chunk.map(() => "?").join(",")})`)
        .bind(instance.notebook_id, ...chunk)),
  ]);
  const locks = (results[0].results ?? []) as { page_ids: string; title: string }[];
  const fields = results.slice(1).flatMap((r) => (r.results ?? []) as { id: string; page_id: string }[]);

  // Answers live on a page too, so they freeze with it.
  for (const f of fields) {
    const lock = locks.find((l) => (l.page_ids || "").includes(`"${f.page_id}"`));
    if (lock) throw new HttpError(423, `This page is locked — you handed it in for "${lock.title}".`);
  }
  if (fields.length === 0) return c.json({ ok: true });

  const activity: LogInput = {
    actorId: user.id, actorRole: isTeacher ? "teacher" : "student", action: "answer",
    detail: "Typed an answer", notebookId: instance.notebook_id,
    instanceId: instance.id, studentId: instance.student_id,
  };
  // One batch: every answer as an upsert on the (instance, box) pair it is
  // unique on, and the activity entry folded into the last one.
  const written = await db.batch([
    ...fields.map((f) =>
      db.prepare(
        `INSERT INTO field_values (id, instance_id, field_id, value, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(instance_id, field_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).bind(uid(), instance.id, f.id, latest.get(f.id)!, now())),
    coalesceStatement(activity)!,
  ]);
  if (!written[written.length - 1].meta?.changes) await insertActivity(activity);
  return c.json({ ok: true });
}));
