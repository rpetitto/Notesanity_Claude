import { app, db, storage } from "flingit";
import {
  handler, now, uid, requireUser, requireClassTeacher, requireClassMember, HttpError, param,} from "../lib/session";
import { sanitizeRichText } from "../lib/richtext";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Everything a teacher can place on a page. */
export const FIELD_TYPES = [
  // Things a student fills in.
  "text", "checkbox", "choice", "prompt", "image", "audio",
  // Things the teacher writes or shows, which take no answer.
  "richtext", "figure",
];

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
      `SELECT id, seq, asset_key, source_index, width, height, label, group_name, archived,
              pattern, pattern_color
         FROM pages WHERE notebook_id = ? ${includeArchived ? "" : "AND archived = 0"}
        ORDER BY seq`,
    )
    .bind(nb.id)
    .all();
  const fields = await db
    .prepare(`SELECT id, page_id, type, x, y, w, h, label, options, prompt, content, media_key IS NOT NULL AS has_media
         FROM fields WHERE notebook_id = ? AND archived = 0`)
    .bind(nb.id)
    .all();
  return c.json({
    notebook: {
      id: nb.id, classId: nb.class_id, title: nb.title, status: nb.status,
      pageCount: nb.page_count, assetKey: nb.asset_key, lastPublishedAt: nb.last_published_at,
      accentColor: nb.accent_color ?? "#2E7D6B", hasCover: !!nb.cover_key,
    },
    pages: pages.results ?? [],
    fields: fields.results ?? [],
    isTeacher,
  });
}));

/**
 * Where a run of `count` new pages should sit in the ordering.
 *
 * `seq` is a real number precisely so pages can be slotted between two
 * existing ones without renumbering the notebook: the run is spread evenly
 * across the gap after the anchor. With no anchor the run goes on the end.
 */
async function seqWindow(notebookId: string, insertAfterPageId: string | null | undefined, count: number) {
  if (insertAfterPageId) {
    const anchor = await db
      .prepare(`SELECT seq, group_name FROM pages WHERE id = ? AND notebook_id = ?`)
      .bind(insertAfterPageId, notebookId)
      .first<{ seq: number; group_name: string }>();
    if (!anchor) throw new HttpError(404, "Anchor page not found");
    const next = await db
      .prepare(`SELECT seq FROM pages WHERE notebook_id = ? AND seq > ? ORDER BY seq LIMIT 1`)
      .bind(notebookId, anchor.seq)
      .first<{ seq: number }>();
    const gap = (next ? next.seq : anchor.seq + 1) - anchor.seq;
    // A page dropped into the middle of a section belongs to that section —
    // otherwise inserting one silently cuts the section in two.
    return { start: anchor.seq, step: gap / (count + 1), groupName: anchor.group_name ?? "" };
  }
  // Appending is "after the last page", so it inherits the same way. Choosing
  // "at the end" and choosing "after page N" where N is last are the same
  // request, and must not give different answers.
  const last = await db
    .prepare(`SELECT seq, group_name FROM pages WHERE notebook_id = ? ORDER BY seq DESC LIMIT 1`)
    .bind(notebookId)
    .first<{ seq: number; group_name: string }>();
  return { start: last?.seq ?? 0, step: 1, groupName: last?.group_name ?? "" };
}

/** Keep `notebooks.page_count` in step after pages are added or removed. */
async function syncPageCount(notebookId: string) {
  const count = await db
    .prepare(`SELECT COUNT(*) AS n FROM pages WHERE notebook_id = ? AND archived = 0`)
    .bind(notebookId)
    .first<{ n: number }>();
  await db
    .prepare(`UPDATE notebooks SET page_count = ?, updated_at = ? WHERE id = ?`)
    .bind(count?.n ?? 0, now(), notebookId)
    .run();
}

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

  const { start, step, groupName } = await seqWindow(nb.id, body.insertAfterPageId, body.pages?.length ?? 1);

  const created: string[] = [];
  let i = 1;
  for (const p of body.pages ?? []) {
    const id = uid();
    await db
      .prepare(
        `INSERT INTO pages (id, notebook_id, seq, asset_key, source_index, width, height, group_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, nb.id, start + step * i, assetKey, p.sourceIndex, p.width, p.height, groupName, now())
      .run();
    created.push(id);
    i++;
  }
  await syncPageCount(nb.id);
  return c.json({ created });
}));

/** Rulings a blank page may carry — mirrored from the client's `PatternKey`. */
const PAGE_PATTERNS = [
  "blank", "lined-wide", "lined-college", "dot", "graph",
  "music", "engineering", "isometric", "coordinate",
];
const MAX_BLANK_PAGES = 50;

/**
 * Insert blank pages carrying a drawn ruling rather than a source document.
 *
 * There's no asset and no upload: the page stores the pattern name and rule
 * colour, and the client draws it. Size is taken from the notebook's existing
 * pages so an inserted sheet lines up with the ones around it, falling back to
 * US Letter for a notebook that has none yet.
 */
app.post("/api/notebooks/:id/pages/blank", handler(async (c) => {
  const { nb, isTeacher } = await notebookAccess(c, param(c, "id"));
  if (!isTeacher) throw new HttpError(403, "Teacher access required");
  const body = await c.req.json<{
    pattern?: string;
    color?: string;
    count?: number;
    insertAfterPageId?: string | null;
  }>();

  const pattern = body.pattern ?? "";
  if (!PAGE_PATTERNS.includes(pattern)) throw new HttpError(400, "Unknown page pattern");
  const color = (body.color ?? "").trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new HttpError(400, "Rule colour must be a hex value");
  const count = Math.floor(body.count ?? 1);
  if (!Number.isFinite(count) || count < 1) throw new HttpError(400, "Add at least one page");
  if (count > MAX_BLANK_PAGES) throw new HttpError(400, `Add at most ${MAX_BLANK_PAGES} pages at a time`);

  // Match the notebook's own paper. The anchor page wins when there is one, so
  // a page inserted into a run of A4 doesn't come out Letter-sized.
  const sizeSource = body.insertAfterPageId
    ? await db
        .prepare(`SELECT width, height FROM pages WHERE id = ? AND notebook_id = ?`)
        .bind(body.insertAfterPageId, nb.id)
        .first<{ width: number; height: number }>()
    : await db
        .prepare(`SELECT width, height FROM pages WHERE notebook_id = ? AND archived = 0 ORDER BY seq LIMIT 1`)
        .bind(nb.id)
        .first<{ width: number; height: number }>();
  const width = sizeSource?.width ?? 612;
  const height = sizeSource?.height ?? 792;

  const { start, step, groupName } = await seqWindow(nb.id, body.insertAfterPageId, count);

  const created: string[] = [];
  for (let i = 1; i <= count; i++) {
    const id = uid();
    await db
      .prepare(
        `INSERT INTO pages (id, notebook_id, seq, asset_key, source_index, width, height, pattern, pattern_color, group_name, created_at)
         VALUES (?, ?, ?, '', -1, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, nb.id, start + step * i, width, height, pattern, color, groupName, now())
      .run();
    created.push(id);
  }
  await syncPageCount(nb.id);
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
    action: "group" | "ungroup" | "archive" | "restore" | "delete";
    groupName?: string;
  }>();
  if (!Array.isArray(pageIds) || pageIds.length === 0) throw new HttpError(400, "No pages selected");

  if (action === "delete") {
    const result = await deletePages(nb.id, pageIds);
    return c.json({ ok: true, updated: pageIds.length, ...result });
  }

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

/**
 * Permanently delete pages.
 *
 * This is the destructive counterpart to archiving. Archiving hides a page but
 * keeps every stroke a student ever put on it, so it can come back intact;
 * deleting removes the page, its fields, and all student work on it, and drops
 * the page from any assignment that referenced it. There is no undo, so the
 * response reports what it touched for an honest confirmation message.
 */
async function deletePages(notebookId: string, pageIds: string[]) {
  let removedFromAssignments = 0;
  for (const pid of pageIds) {
    const owned = await db
      .prepare(`SELECT id FROM pages WHERE id = ? AND notebook_id = ?`)
      .bind(pid, notebookId)
      .first();
    if (!owned) continue;

    // Student answers hang off fields, so they go before the fields themselves.
    await db
      .prepare(`DELETE FROM field_values WHERE field_id IN (SELECT id FROM fields WHERE page_id = ?)`)
      .bind(pid)
      .run();
    await db.prepare(`DELETE FROM fields WHERE page_id = ?`).bind(pid).run();
    await db.prepare(`DELETE FROM layers WHERE page_id = ?`).bind(pid).run();
    await db.prepare(`DELETE FROM pages WHERE id = ?`).bind(pid).run();

    // Drop the page from any assignment scope that referenced it.
    const affected = await db
      .prepare(`SELECT id, page_ids FROM assignments WHERE notebook_id = ? AND page_ids LIKE ?`)
      .bind(notebookId, `%"${pid}"%`)
      .all<{ id: string; page_ids: string }>();
    for (const a of affected.results ?? []) {
      const remaining = (JSON.parse(a.page_ids || "[]") as string[]).filter((x) => x !== pid);
      await db
        .prepare(`UPDATE assignments SET page_ids = ?, updated_at = ? WHERE id = ?`)
        .bind(JSON.stringify(remaining), now(), a.id)
        .run();
      removedFromAssignments++;
    }
  }

  const count = await db
    .prepare(`SELECT COUNT(*) AS n FROM pages WHERE notebook_id = ? AND archived = 0`)
    .bind(notebookId)
    .first<{ n: number }>();
  await db
    .prepare(`UPDATE notebooks SET page_count = ?, updated_at = ? WHERE id = ?`)
    .bind(count?.n ?? 0, now(), notebookId)
    .run();

  return { removedFromAssignments };
}

app.delete("/api/notebooks/:id/pages/:pageId", handler(async (c) => {
  const { nb, isTeacher } = await notebookAccess(c, param(c, "id"));
  if (!isTeacher) throw new HttpError(403, "Teacher access required");
  const result = await deletePages(nb.id, [param(c, "pageId")]);
  return c.json({ ok: true, ...result });
}));

/**
 * Set explicit order and group for a run of pages in one call — the commit for
 * drag-and-drop. Sequence numbers are rewritten from the given order, so a page
 * dragged into a section lands exactly where it was dropped.
 */
app.post("/api/notebooks/:id/pages/arrange", handler(async (c) => {
  const { nb, isTeacher } = await notebookAccess(c, param(c, "id"));
  if (!isTeacher) throw new HttpError(403, "Teacher access required");
  const { pages } = await c.req.json<{ pages: { id: string; groupName?: string }[] }>();
  if (!Array.isArray(pages) || pages.length === 0) throw new HttpError(400, "No pages to arrange");

  let seq = 1;
  for (const p of pages) {
    const owned = await db
      .prepare(`SELECT id FROM pages WHERE id = ? AND notebook_id = ?`)
      .bind(p.id, nb.id)
      .first();
    if (!owned) continue;
    if (p.groupName === undefined) {
      await db.prepare(`UPDATE pages SET seq = ? WHERE id = ?`).bind(seq, p.id).run();
    } else {
      await db
        .prepare(`UPDATE pages SET seq = ?, group_name = ? WHERE id = ?`)
        .bind(seq, p.groupName, p.id)
        .run();
    }
    seq++;
  }
  await db.prepare(`UPDATE notebooks SET updated_at = ? WHERE id = ?`).bind(now(), nb.id).run();
  return c.json({ ok: true, arranged: pages.length });
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
            `SELECT SUM(CASE WHEN submitted_at IS NOT NULL THEN 1 ELSE 0 END) AS submitted,
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
    label?: string; options?: string[]; prompt?: string; content?: string;
  }>();
  const page = await db
    .prepare(`SELECT id FROM pages WHERE id = ? AND notebook_id = ?`)
    .bind(body.pageId, nb.id)
    .first();
  if (!page) throw new HttpError(404, "Page not found");
  if (!FIELD_TYPES.includes(body.type)) throw new HttpError(400, "Unsupported field type");
  const id = uid();
  await db
    .prepare(
      `INSERT INTO fields (id, notebook_id, page_id, type, x, y, w, h, label, options, prompt, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id, nb.id, body.pageId, body.type, body.x, body.y, body.w, body.h,
      body.label ?? "", JSON.stringify(body.options ?? []), body.prompt ?? "",
      sanitizeRichText(body.content ?? ""), now(), now(),
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
      `UPDATE fields SET x = ?, y = ?, w = ?, h = ?, label = ?, options = ?, prompt = ?, content = ?, archived = ?, updated_at = ?
        WHERE id = ?`,
    )
    .bind(
      b.x ?? field.x, b.y ?? field.y, b.w ?? field.w, b.h ?? field.h,
      b.label ?? field.label, b.options ? JSON.stringify(b.options) : field.options,
      b.prompt ?? field.prompt ?? "",
      // Sanitised on the way in, so what is stored is already safe to render.
      b.content === undefined ? field.content ?? "" : sanitizeRichText(b.content),
      b.archived === undefined ? field.archived : b.archived ? 1 : 0, now(), field.id,
    )
    .run();
  await db.prepare(`UPDATE notebooks SET updated_at = ? WHERE id = ?`).bind(now(), nb.id).run();
  return c.json({ ok: true });
}));

const MAX_FIELD_MEDIA_BYTES = 6 * 1024 * 1024;

/** Attach a teacher-supplied image — a prompt illustration or a `figure` block. */
app.post("/api/notebooks/:id/fields/:fieldId/media", handler(async (c) => {
  const { nb, isTeacher } = await notebookAccess(c, param(c, "id"));
  if (!isTeacher) throw new HttpError(403, "Teacher access required");
  const fieldId = param(c, "fieldId");
  const field = await db
    .prepare(`SELECT id FROM fields WHERE id = ? AND notebook_id = ?`)
    .bind(fieldId, nb.id)
    .first();
  if (!field) throw new HttpError(404, "Field not found");

  const form = await c.req.parseBody();
  const file = form["file"] as File | undefined;
  if (!file) throw new HttpError(400, "No image uploaded");
  if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(file.type)) throw new HttpError(400, "That needs to be an image file");
  if (file.size > MAX_FIELD_MEDIA_BYTES) throw new HttpError(413, "Images are limited to 6MB");

  const key = `notebooks/${nb.id}/fields/${fieldId}-${uid()}`;
  await storage.put(key, await file.arrayBuffer(), { contentType: file.type });
  await db
    .prepare(`UPDATE fields SET media_key = ?, updated_at = ? WHERE id = ?`)
    .bind(key, now(), fieldId)
    .run();
  return c.json({ ok: true });
}));

app.get("/api/notebooks/:id/fields/:fieldId/media", handler(async (c) => {
  const { nb } = await notebookAccess(c, param(c, "id"));
  const field = await db
    .prepare(`SELECT media_key FROM fields WHERE id = ? AND notebook_id = ?`)
    .bind(param(c, "fieldId"), nb.id)
    .first<any>();
  if (!field?.media_key) throw new HttpError(404, "No image on this field");
  const obj = await storage.get(field.media_key);
  if (!obj) throw new HttpError(404, "Image not found");
  return new Response(await obj.arrayBuffer(), {
    headers: { "Content-Type": obj.contentType ?? "image/png", "Cache-Control": "private, max-age=3600" },
  });
}));

app.delete("/api/notebooks/:id/fields/:fieldId/media", handler(async (c) => {
  const { nb, isTeacher } = await notebookAccess(c, param(c, "id"));
  if (!isTeacher) throw new HttpError(403, "Teacher access required");
  await db
    .prepare(`UPDATE fields SET media_key = NULL, updated_at = ? WHERE id = ? AND notebook_id = ?`)
    .bind(now(), param(c, "fieldId"), nb.id)
    .run();
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
  const b = await c.req.json<{ title?: string; accentColor?: string; clearCover?: boolean }>();
  if (b.accentColor && !/^#[0-9A-Fa-f]{6}$/.test(b.accentColor)) throw new HttpError(400, "Invalid colour");
  await db
    .prepare(`UPDATE notebooks SET title = ?, accent_color = ?, cover_key = ?, updated_at = ? WHERE id = ?`)
    .bind(
      b.title?.trim() || nb.title,
      b.accentColor ?? nb.accent_color ?? "#2E7D6B",
      b.clearCover ? null : nb.cover_key,
      now(),
      nb.id,
    )
    .run();
  return c.json({ ok: true });
}));

const MAX_COVER_BYTES = 4 * 1024 * 1024;

/** Upload a cover image for the notebook tile. */
app.post("/api/notebooks/:id/cover", handler(async (c) => {
  const { nb, isTeacher } = await notebookAccess(c, param(c, "id"));
  if (!isTeacher) throw new HttpError(403, "Teacher access required");
  const form = await c.req.parseBody();
  const file = form["file"] as File | undefined;
  if (!file) throw new HttpError(400, "No image uploaded");
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
    throw new HttpError(400, "Cover must be a PNG, JPEG, WebP or GIF image");
  }
  if (file.size > MAX_COVER_BYTES) throw new HttpError(413, "Cover images are limited to 4MB");

  const key = `notebooks/${nb.id}/cover-${uid()}`;
  await storage.put(key, await file.arrayBuffer(), { contentType: file.type });
  await db
    .prepare(`UPDATE notebooks SET cover_key = ?, updated_at = ? WHERE id = ?`)
    .bind(key, now(), nb.id)
    .run();
  return c.json({ ok: true, coverKey: key });
}));

app.get("/api/notebooks/:id/cover", handler(async (c) => {
  const { nb } = await notebookAccess(c, param(c, "id"));
  if (!nb.cover_key) throw new HttpError(404, "No cover set");
  const obj = await storage.get(nb.cover_key);
  if (!obj) throw new HttpError(404, "Cover not found");
  return new Response(await obj.arrayBuffer(), {
    headers: {
      "Content-Type": obj.contentType ?? "image/png",
      "Cache-Control": "private, max-age=3600",
    },
  });
}));

/**
 * Teacher annotations on the master page — worked examples, callouts, model
 * answers. Distinct from marking one student's copy: this is part of the
 * template, so it reaches everyone, and it follows the same draft/publish rule
 * as pages and fields.
 */
app.get("/api/notebooks/:id/annotations", handler(async (c) => {
  const { nb, isTeacher } = await notebookAccess(c, param(c, "id"));
  const rows = await db
    .prepare(`SELECT page_id, draft_data, published_data, rev FROM page_annotations WHERE notebook_id = ?`)
    .bind(nb.id)
    .all<any>();
  // Students only ever see what has been published.
  return c.json({
    annotations: (rows.results ?? []).map((r) => ({
      pageId: r.page_id,
      data: isTeacher ? r.draft_data : r.published_data,
      publishedData: r.published_data,
      rev: r.rev,
      unpublished: isTeacher ? r.draft_data !== r.published_data : false,
    })),
  });
}));

app.put("/api/notebooks/:id/annotations/:pageId", handler(async (c) => {
  const { nb, isTeacher } = await notebookAccess(c, param(c, "id"));
  if (!isTeacher) throw new HttpError(403, "Teacher access required");
  const pageId = param(c, "pageId");
  const page = await db
    .prepare(`SELECT id FROM pages WHERE id = ? AND notebook_id = ?`)
    .bind(pageId, nb.id)
    .first();
  if (!page) throw new HttpError(404, "Page not found");

  const { data } = await c.req.json<{ data: string }>();
  if (typeof data !== "string") throw new HttpError(400, "data must be a string");
  if (data.length > 512 * 1024) throw new HttpError(413, "That page has too much ink to save");

  const existing = await db
    .prepare(`SELECT page_id, rev FROM page_annotations WHERE page_id = ?`)
    .bind(pageId)
    .first<any>();
  if (existing) {
    await db
      .prepare(`UPDATE page_annotations SET draft_data = ?, rev = ?, updated_at = ? WHERE page_id = ?`)
      .bind(data, existing.rev + 1, now(), pageId)
      .run();
    return c.json({ ok: true, rev: existing.rev + 1 });
  }
  await db
    .prepare(
      `INSERT INTO page_annotations (page_id, notebook_id, draft_data, published_data, rev, updated_at)
       VALUES (?, ?, ?, '', 1, ?)`,
    )
    .bind(pageId, nb.id, data, now())
    .run();
  return c.json({ ok: true, rev: 1 });
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

  // Promote annotation drafts so they reach students with this update.
  const pendingAnnotations = await db
    .prepare(`SELECT COUNT(*) AS n FROM page_annotations WHERE notebook_id = ? AND draft_data <> published_data`)
    .bind(nb.id)
    .first<{ n: number }>();
  await db
    .prepare(`UPDATE page_annotations SET published_data = draft_data, published_at = ? WHERE notebook_id = ?`)
    .bind(now(), nb.id)
    .run();

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

  return c.json({ ok: true, provisioned, summary, annotationsPublished: pendingAnnotations?.n ?? 0 });
}));

/** Notebooks visible to the signed-in student, across all their classes. */
app.get("/api/my/notebooks", handler(async (c) => {
  const user = await requireUser(c);
  const rows = await db
    .prepare(
      `SELECT n.id, n.title, n.page_count, n.updated_at, n.accent_color AS notebook_color,
              n.cover_key, c.id AS class_id, c.name AS class_name, c.accent_color
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
