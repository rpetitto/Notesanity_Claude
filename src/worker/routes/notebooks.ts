import { app, db, storage } from "flingit";
import {
  handler, now, uid, requireUser, requireClassTeacher, requireClassMember, HttpError, param,} from "../lib/session";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Teacher-or-enrolled-student access to a notebook, resolved via its class. */
async function notebookAccess(c: any, notebookId: string) {
  const nb = await db.prepare(`SELECT * FROM notebooks WHERE id = ?`).bind(notebookId).first<any>();
  if (!nb) throw new HttpError(404, "Notebook not found");
  const { user, isTeacher } = await requireClassMember(c, nb.class_id);
  return { nb, user, isTeacher };
}

/**
 * Upload a source PDF. The client converts DOCX/PPTX to PDF via the teacher's own
 * Google Drive before calling this, so the Worker only ever handles PDFs.
 * Page records are created in a second call once the client has parsed the PDF.
 */
app.post("/api/classes/:id/notebooks", handler(async (c) => {
  const classId = param(c, "id");
  const teacher = await requireClassTeacher(c, classId);
  const form = await c.req.parseBody();
  const file = form["file"] as File | undefined;
  const title = String(form["title"] ?? "").trim();
  if (!file) throw new HttpError(400, "No file uploaded");
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new HttpError(413, `That file is ${(file.size / 1048576).toFixed(1)}MB — the limit is 25MB.`);
  }

  const notebookId = uid();
  const assetKey = `notebooks/${notebookId}/${uid()}.pdf`;
  await storage.put(assetKey, await file.arrayBuffer(), { contentType: "application/pdf" });

  await db
    .prepare(
      `INSERT INTO notebooks (id, class_id, owner_id, title, source_name, asset_key, page_count, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 'draft', ?, ?)`,
    )
    .bind(notebookId, classId, teacher.id, title || file.name.replace(/\.[^.]+$/, ""), file.name, assetKey, now(), now())
    .run();

  return c.json({ notebook: { id: notebookId, assetKey } });
}));

/** Upload an additional source PDF whose pages can be appended to an existing notebook. */
app.post("/api/notebooks/:id/assets", handler(async (c) => {
  const { nb, isTeacher } = await notebookAccess(c, param(c, "id"));
  if (!isTeacher) throw new HttpError(403, "Teacher access required");
  const form = await c.req.parseBody();
  const file = form["file"] as File | undefined;
  if (!file) throw new HttpError(400, "No file uploaded");
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "File exceeds the 25MB limit");
  const assetKey = `notebooks/${nb.id}/${uid()}.pdf`;
  await storage.put(assetKey, await file.arrayBuffer(), { contentType: "application/pdf" });
  return c.json({ assetKey });
}));

/** Stream a source PDF to any class member. */
app.get("/api/notebooks/:id/asset", handler(async (c) => {
  const { nb } = await notebookAccess(c, param(c, "id"));
  const key = c.req.query("key") || nb.asset_key;
  if (!key || !String(key).startsWith(`notebooks/${nb.id}/`)) throw new HttpError(400, "Invalid asset key");
  const obj = await storage.get(key);
  if (!obj) throw new HttpError(404, "Asset not found");
  return new Response(await obj.arrayBuffer(), {
    headers: {
      "Content-Type": "application/pdf",
      // Immutable: asset keys are content-addressed by uuid and never rewritten.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}));

/** Full notebook: pages (ordered) plus their form fields. */
app.get("/api/notebooks/:id", handler(async (c) => {
  const { nb, isTeacher } = await notebookAccess(c, param(c, "id"));
  const includeArchived = isTeacher && c.req.query("archived") === "1";
  const pages = await db
    .prepare(
      `SELECT id, seq, asset_key, source_index, width, height, label, group_name, archived
         FROM pages WHERE notebook_id = ? ${includeArchived ? "" : "AND archived = 0"}
        ORDER BY seq`,
    )
    .bind(nb.id)
    .all();
  const fields = await db
    .prepare(`SELECT id, page_id, type, x, y, w, h, label, options FROM fields WHERE notebook_id = ? AND archived = 0`)
    .bind(nb.id)
    .all();
  return c.json({
    notebook: {
      id: nb.id, classId: nb.class_id, title: nb.title, status: nb.status,
      pageCount: nb.page_count, assetKey: nb.asset_key, lastPublishedAt: nb.last_published_at,
    },
    pages: pages.results ?? [],
    fields: fields.results ?? [],
    isTeacher,
  });
}));

/**
 * Append pages. The client parses the PDF with pdf.js and reports each page's
 * index and dimensions. New pages always get fresh UUIDs, so existing student
 * work is never re-anchored.
 */
app.post("/api/notebooks/:id/pages", handler(async (c) => {
  const { nb, isTeacher } = await notebookAccess(c, param(c, "id"));
  if (!isTeacher) throw new HttpError(403, "Teacher access required");
  const body = await c.req.json<{
    assetKey?: string;
    pages: { sourceIndex: number; width: number; height: number }[];
    insertAfterPageId?: string | null;
  }>();
  const assetKey = body.assetKey || nb.asset_key;
  if (!assetKey) throw new HttpError(400, "No asset to draw pages from");

  // Work out the seq window we're inserting into.
  let start: number, step: number;
  if (body.insertAfterPageId) {
    const anchor = await db
      .prepare(`SELECT seq FROM pages WHERE id = ? AND notebook_id = ?`)
      .bind(body.insertAfterPageId, nb.id)
      .first<{ seq: number }>();
    if (!anchor) throw new HttpError(404, "Anchor page not found");
    const next = await db
      .prepare(`SELECT seq FROM pages WHERE notebook_id = ? AND seq > ? ORDER BY seq LIMIT 1`)
      .bind(nb.id, anchor.seq)
      .first<{ seq: number }>();
    start = anchor.seq;
    const gap = (next ? next.seq : anchor.seq + 1) - anchor.seq;
    step = gap / ((body.pages?.length ?? 1) + 1);
  } else {
    const last = await db
      .prepare(`SELECT MAX(seq) AS m FROM pages WHERE notebook_id = ?`)
      .bind(nb.id)
      .first<{ m: number | null }>();
    start = last?.m ?? 0;
    step = 1;
  }

  const created: string[] = [];
  let i = 1;
  for (const p of body.pages ?? []) {
    const id = uid();
    await db
      .prepare(
        `INSERT INTO pages (id, notebook_id, seq, asset_key, source_index, width, height, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, nb.id, start + step * i, assetKey, p.sourceIndex, p.width, p.height, now())
      .run();
    created.push(id);
    i++;
  }
  const count = await db
    .prepare(`SELECT COUNT(*) AS n FROM pages WHERE notebook_id = ? AND archived = 0`)
    .bind(nb.id)
    .first<{ n: number }>();
  await db
    .prepare(`UPDATE notebooks SET page_count = ?, updated_at = ? WHERE id = ?`)
    .bind(count?.n ?? 0, now(), nb.id)
    .run();
  return c.json({ created });
}));

/**
 * Archive / restore / relabel / reorder a page.
 * Archiving is a soft delete: student ink for the page stays in the database and
 * reappears intact if the page is restored.
 */
app.patch("/api/notebooks/:id/pages/:pageId", handler(async (c) => {
  const { nb, isTeacher } = await notebookAccess(c, param(c, "id"));
  if (!isTeacher) throw new HttpError(403, "Teacher access required");
  const page = await db
    .prepare(`SELECT * FROM pages WHERE id = ? AND notebook_id = ?`)
    .bind(param(c, "pageId"), nb.id)
    .first<any>();
  if (!page) throw new HttpError(404, "Page not found");
  const body = await c.req.json<{ archived?: boolean; label?: string; seq?: number; groupName?: string }>();
  await db
    .prepare(`UPDATE pages SET archived = ?, label = ?, seq = ?, group_name = ? WHERE id = ?`)
    .bind(
      body.archived === undefined ? page.archived : body.archived ? 1 : 0,
      body.label ?? page.label,
      body.seq ?? page.seq,
      body.groupName === undefined ? page.group_name : body.groupName,
      page.id,
    )
    .run();
  const count = await db
    .prepare(`SELECT COUNT(*) AS n FROM pages WHERE notebook_id = ? AND archived = 0`)
    .bind(nb.id)
    .first<{ n: number }>();
  await db
    .prepare(`UPDATE notebooks SET page_count = ?, updated_at = ? WHERE id = ?`)
    .bind(count?.n ?? 0, now(), nb.id)
    .run();
  return c.json({ ok: true });
}));

/**
 * Apply one action to a multi-selection of pages — grouping, archiving, or
 * restoring. Backs the selection toolbar in the notebook's page list.
 */
app.post("/api/notebooks/:id/pages/bulk", handler(async (c) => {
  const { nb, isTeacher } = await notebookAccess(c, param(c, "id"));
  if (!isTeacher) throw new HttpError(403, "Teacher access required");
  const { pageIds, action, groupName } = await c.req.json<{
    pageIds: string[];
    action: "group" | "ungroup" | "archive" | "restore";
    groupName?: string;
  }>();
  if (!Array.isArray(pageIds) || pageIds.length === 0) throw new HttpError(400, "No pages selected");

  for (const pid of pageIds) {
    const owned = await db
      .prepare(`SELECT id FROM pages WHERE id = ? AND notebook_id = ?`)
      .bind(pid, nb.id)
      .first();
    if (!owned) continue;
    if (action === "group") {
      await db.prepare(`UPDATE pages SET group_name = ? WHERE id = ?`).bind(groupName ?? "", pid).run();
    } else if (action === "ungroup") {
      await db.prepare(`UPDATE pages SET group_name = '' WHERE id = ?`).bind(pid).run();
    } else if (action === "archive" || action === "restore") {
      await db.prepare(`UPDATE pages SET archived = ? WHERE id = ?`).bind(action === "archive" ? 1 : 0, pid).run();
    }
  }

  const count = await db
    .prepare(`SELECT COUNT(*) AS n FROM pages WHERE notebook_id = ? AND archived = 0`)
    .bind(nb.id)
    .first<{ n: number }>();
  await db
    .prepare(`UPDATE notebooks SET page_count = ?, updated_at = ? WHERE id = ?`)
    .bind(count?.n ?? 0, now(), nb.id)
    .run();
  return c.json({ ok: true, updated: pageIds.length });
}));

/** Assignments that draw on this notebook, shown alongside its pages. */
app.get("/api/notebooks/:id/assignments", handler(async (c) => {
  const { nb, isTeacher } = await notebookAccess(c, param(c, "id"));
  const rows = await db
    .prepare(
      `SELECT id, title, page_ids, due_at, release_at, grading, points_max, status, created_at
         FROM assignments
        WHERE notebook_id = ? ${isTeacher ? "" : "AND status = 'active'"}
        ORDER BY COALESCE(due_at, created_at) DESC`,
    )
    .bind(nb.id)
    .all<any>();

  const assignments = [];
  for (const a of rows.results ?? []) {
    const pageIds: string[] = JSON.parse(a.page_ids || "[]");
    const counts = isTeacher
      ? await db
          .prepare(
            `SELECT SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) AS submitted,
                    SUM(CASE WHEN status = 'returned' THEN 1 ELSE 0 END) AS returned,
                    COUNT(*) AS total
               FROM submissions WHERE assignment_id = ?`,
          )
          .bind(a.id)
          .first<any>()
      : null;
    assignments.push({
      id: a.id, title: a.title, pageIds, pageCount: pageIds.length,
      dueAt: a.due_at, releaseAt: a.release_at, grading: a.grading,
      pointsMax: a.points_max, status: a.status,
      submitted: counts?.submitted ?? 0, returned: counts?.returned ?? 0, total: counts?.total ?? 0,
    });
  }
  return c.json({ assignments, isTeacher });
}));

/** Reorder the whole notebook in one call (drag-and-drop commit). */
app.post("/api/notebooks/:id/reorder", handler(async (c) => {
  const { nb, isTeacher } = await notebookAccess(c, param(c, "id"));
  if (!isTeacher) throw new HttpError(403, "Teacher access required");
  const { pageIds } = await c.req.json<{ pageIds: string[] }>();
  let seq = 1;
  for (const pid of pageIds ?? []) {
    await db.prepare(`UPDATE pages SET seq = ? WHERE id = ? AND notebook_id = ?`).bind(seq++, pid, nb.id).run();
  }
  await db.prepare(`UPDATE notebooks SET updated_at = ? WHERE id = ?`).bind(now(), nb.id).run();
  return c.json({ ok: true });
}));

app.post("/api/notebooks/:id/fields", handler(async (c) => {
  const { nb, isTeacher } = await notebookAccess(c, param(c, "id"));
  if (!isTeacher) throw new HttpError(403, "Teacher access required");
  const body = await c.req.json<{
    pageId: string; type: string; x: number; y: number; w: number; h: number;
    label?: string; options?: string[];
  }>();
  const page = await db
    .prepare(`SELECT id FROM pages WHERE id = ? AND notebook_id = ?`)
    .bind(body.pageId, nb.id)
    .first();
  if (!page) throw new HttpError(404, "Page not found");
  if (!["text", "checkbox", "choice"].includes(body.type)) throw new HttpError(400, "Unsupported field type");
  const id = uid();
  await db
    .prepare(
      `INSERT INTO fields (id, notebook_id, page_id, type, x, y, w, h, label, options, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id, nb.id, body.pageId, body.type, body.x, body.y, body.w, body.h,
      body.label ?? "", JSON.stringify(body.options ?? []), now(), now(),
    )
    .run();
  await db.prepare(`UPDATE notebooks SET updated_at = ? WHERE id = ?`).bind(now(), nb.id).run();
  return c.json({ field: { id } });
}));

/** Move/resize/relabel a field. Student values stay attached via the field UUID. */
app.patch("/api/notebooks/:id/fields/:fieldId", handler(async (c) => {
  const { nb, isTeacher } = await notebookAccess(c, param(c, "id"));
  if (!isTeacher) throw new HttpError(403, "Teacher access required");
  const field = await db
    .prepare(`SELECT * FROM fields WHERE id = ? AND notebook_id = ?`)
    .bind(param(c, "fieldId"), nb.id)
    .first<any>();
  if (!field) throw new HttpError(404, "Field not found");
  const b = await c.req.json<any>();
  await db
    .prepare(
      `UPDATE fields SET x = ?, y = ?, w = ?, h = ?, label = ?, options = ?, archived = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(
      b.x ?? field.x, b.y ?? field.y, b.w ?? field.w, b.h ?? field.h,
      b.label ?? field.label, b.options ? JSON.stringify(b.options) : field.options,
      b.archived === undefined ? field.archived : b.archived ? 1 : 0, now(), field.id,
    )
    .run();
  await db.prepare(`UPDATE notebooks SET updated_at = ? WHERE id = ?`).bind(now(), nb.id).run();
  return c.json({ ok: true });
}));

app.delete("/api/notebooks/:id/fields/:fieldId", handler(async (c) => {
  const { nb, isTeacher } = await notebookAccess(c, param(c, "id"));
  if (!isTeacher) throw new HttpError(403, "Teacher access required");
  await db
    .prepare(`UPDATE fields SET archived = 1, updated_at = ? WHERE id = ? AND notebook_id = ?`)
    .bind(now(), param(c, "fieldId"), nb.id)
    .run();
  return c.json({ ok: true });
}));

app.patch("/api/notebooks/:id", handler(async (c) => {
  const { nb, isTeacher } = await notebookAccess(c, param(c, "id"));
  if (!isTeacher) throw new HttpError(403, "Teacher access required");
  const { title } = await c.req.json<{ title?: string }>();
  await db
    .prepare(`UPDATE notebooks SET title = ?, updated_at = ? WHERE id = ?`)
    .bind(title?.trim() || nb.title, now(), nb.id)
    .run();
  return c.json({ ok: true });
}));

/**
 * Publish / "Update Student Notebooks".
 *
 * Because student work is anchored to page and field UUIDs, propagation is
 * additive: we provision an instance row for any student who lacks one and
 * report what changed. Nothing student-authored is ever rewritten here.
 */
app.post("/api/notebooks/:id/publish", handler(async (c) => {
  const { nb, isTeacher } = await notebookAccess(c, param(c, "id"));
  if (!isTeacher) throw new HttpError(403, "Teacher access required");

  const since = nb.last_published_at;
  const summary = since
    ? {
        pagesAdded: (await db
          .prepare(`SELECT COUNT(*) AS n FROM pages WHERE notebook_id = ? AND created_at > ?`)
          .bind(nb.id, since).first<{ n: number }>())?.n ?? 0,
        pagesArchived: (await db
          .prepare(`SELECT COUNT(*) AS n FROM pages WHERE notebook_id = ? AND archived = 1`)
          .bind(nb.id).first<{ n: number }>())?.n ?? 0,
        fieldsChanged: (await db
          .prepare(`SELECT COUNT(*) AS n FROM fields WHERE notebook_id = ? AND updated_at > ?`)
          .bind(nb.id, since).first<{ n: number }>())?.n ?? 0,
      }
    : null;

  const students = await db
    .prepare(`SELECT user_id FROM enrollments WHERE class_id = ? AND role = 'student' AND status = 'active'`)
    .bind(nb.class_id)
    .all<{ user_id: string }>();

  let provisioned = 0;
  for (const s of students.results ?? []) {
    const exists = await db
      .prepare(`SELECT id FROM instances WHERE notebook_id = ? AND student_id = ?`)
      .bind(nb.id, s.user_id)
      .first();
    if (!exists) {
      await db
        .prepare(`INSERT INTO instances (id, notebook_id, class_id, student_id, created_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(uid(), nb.id, nb.class_id, s.user_id, now())
        .run();
      provisioned++;
    }
  }

  await db
    .prepare(`UPDATE notebooks SET status = 'published', last_published_at = ?, updated_at = ? WHERE id = ?`)
    .bind(now(), now(), nb.id)
    .run();

  return c.json({ ok: true, provisioned, summary });
}));

/** Notebooks visible to the signed-in student, across all their classes. */
app.get("/api/my/notebooks", handler(async (c) => {
  const user = await requireUser(c);
  const rows = await db
    .prepare(
      `SELECT n.id, n.title, n.page_count, n.updated_at, c.id AS class_id, c.name AS class_name, c.accent_color
         FROM notebooks n
         JOIN classes c ON c.id = n.class_id
         JOIN enrollments e ON e.class_id = c.id AND e.user_id = ? AND e.status = 'active'
        WHERE n.status = 'published' AND c.archived = 0
        ORDER BY n.updated_at DESC`,
    )
    .bind(user.id)
    .all();
  return c.json({ notebooks: rows.results ?? [] });
}));
