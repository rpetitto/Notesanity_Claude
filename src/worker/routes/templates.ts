/**
 * Notebook templates.
 *
 * A template is a notebook a teacher builds once, outside any class, and then
 * pushes into as many classes as teach from it. Pushing makes an ordinary class
 * notebook — a draft, published to students by the teacher in that class like
 * any other — that remembers the template it came from, page by page and box
 * by box.
 *
 * "Send updates" is add-only, on purpose. It copies across any template page
 * or answer box that has no mirror in a class copy, and touches nothing that
 * already has one. A class copy is the teacher's to change once it's there
 * (a page renamed for this class, a box moved, a page removed), and students
 * have written on it; a sync that rewrote those would be undoing work in six
 * places at once. The price is that a typo fixed in the template stays wrong
 * in the classes — the teacher fixes it there, as they would today.
 */

import { app, db, storage } from "../platform";
import { handler, now, uid, requireTeacher, requireClassTeacher, HttpError, param } from "../lib/session";
import { requireNotebookRoom } from "../lib/plans";
import { MAX_UPLOAD_BYTES, PAGE_PATTERNS, fillFromTemplate, syncPageCount, deleteNotebookCascade } from "./notebooks";

const MAX_TEMPLATE_START_PAGES = 200;

async function ownedTemplate(userId: string, id: string) {
  const nb = await db
    .prepare(`SELECT * FROM notebooks WHERE id = ? AND kind = 'template' AND owner_id = ?`)
    .bind(id, userId)
    .first<any>();
  if (!nb) throw new HttpError(404, "Template not found");
  return nb;
}

/** A key is unique only within its prefix, so the whole path is flattened rather than just its last segment. */
const flatten = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, "-").slice(-100);

/**
 * Every notebook this teacher teaches from, and every template they own, with
 * what a card needs. Templates carry their class copies and how much each one
 * is behind.
 */
app.get("/api/my/teaching-notebooks", handler(async (c) => {
  const user = await requireTeacher(c);
  const rows = await db
    .prepare(
      `SELECT n.id, n.title, n.status, n.page_count, n.updated_at, n.created_at, n.kind, n.archived,
              n.accent_color, n.cover_key IS NOT NULL AS has_cover, n.class_id, n.template_id,
              c.name AS class_name, c.accent_color AS class_color, c.emoji AS class_emoji, c.archived AS class_archived,
              p.id AS first_page_id, p.asset_key AS first_asset_key, p.source_index AS first_source_index,
              p.width AS first_width, p.height AS first_height,
              p.pattern AS first_pattern, p.pattern_color AS first_pattern_color
         FROM notebooks n
         LEFT JOIN classes c ON c.id = n.class_id
         LEFT JOIN enrollments e ON e.class_id = c.id AND e.user_id = ? AND e.role = 'teacher' AND e.status = 'active'
         LEFT JOIN pages p ON p.id = (
           SELECT id FROM pages WHERE notebook_id = n.id AND archived = 0 ORDER BY seq LIMIT 1
         )
        WHERE (n.kind = 'template' AND n.owner_id = ?)
           OR (n.kind = 'class' AND c.id IS NOT NULL AND (c.owner_id = ? OR e.id IS NOT NULL))
        ORDER BY n.updated_at DESC`,
    )
    .bind(user.id, user.id, user.id)
    .all<any>();
  const notebooks = rows.results ?? [];

  // Each template's copies, and what each copy is still missing.
  for (const t of notebooks.filter((n) => n.kind === "template")) {
    const copies = notebooks.filter((n) => n.template_id === t.id);
    t.copies = [];
    for (const copy of copies) {
      const pages = await db
        .prepare(
          `SELECT COUNT(*) AS n FROM pages tp
            WHERE tp.notebook_id = ? AND tp.archived = 0
              AND tp.id NOT IN (SELECT template_page_id FROM pages WHERE notebook_id = ? AND template_page_id IS NOT NULL)`,
        )
        .bind(t.id, copy.id)
        .first<{ n: number }>();
      const fields = await db
        .prepare(
          `SELECT COUNT(*) AS n FROM fields tf
             JOIN pages tp ON tp.id = tf.page_id
            WHERE tf.notebook_id = ? AND tf.archived = 0 AND tp.archived = 0
              AND tf.id NOT IN (SELECT template_field_id FROM fields WHERE notebook_id = ? AND template_field_id IS NOT NULL)`,
        )
        .bind(t.id, copy.id)
        .first<{ n: number }>();
      t.copies.push({
        notebookId: copy.id, classId: copy.class_id, className: copy.class_name, status: copy.status,
        archived: !!copy.archived, pendingPages: pages?.n ?? 0, pendingFields: fields?.n ?? 0,
      });
    }
  }
  return c.json({ notebooks });
}));

/** A template that starts on blank paper. */
app.post("/api/my/templates", handler(async (c) => {
  const user = await requireTeacher(c);
  const body = await c.req.json<{ title?: string; pages?: number; pattern?: string; color?: string }>();
  const pages = Math.floor(body.pages ?? 0);
  const pattern = body.pattern ?? "";
  const color = (body.color ?? "").trim();
  if (!PAGE_PATTERNS.includes(pattern)) throw new HttpError(400, "Unknown page pattern");
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new HttpError(400, "Rule color must be a hex value");
  if (!Number.isFinite(pages) || pages < 1) throw new HttpError(400, "A notebook needs at least one page");
  if (pages > MAX_TEMPLATE_START_PAGES) throw new HttpError(400, `A template can start with at most ${MAX_TEMPLATE_START_PAGES} pages`);

  const id = uid();
  await db
    .prepare(
      `INSERT INTO notebooks (id, class_id, owner_id, title, source_name, asset_key, page_count, status, kind, created_at, updated_at)
       VALUES (?, '', ?, ?, '', '', 0, 'draft', 'template', ?, ?)`,
    )
    .bind(id, user.id, body.title?.trim() || "Untitled template", now(), now())
    .run();
  await fillFromTemplate(id, pages, pattern, color);
  return c.json({ notebook: { id } });
}));

/** A template that starts from a document. Pages are added by the client once it has read the PDF. */
app.post("/api/my/templates/upload", handler(async (c) => {
  const user = await requireTeacher(c);
  const form = await c.req.parseBody();
  const file = form["file"] as File | undefined;
  const title = String(form["title"] ?? "").trim();
  if (!file) throw new HttpError(400, "No file uploaded");
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new HttpError(413, `That file is ${(file.size / 1048576).toFixed(1)}MB — the limit is 25MB.`);
  }
  const id = uid();
  const assetKey = `notebooks/${id}/${uid()}.pdf`;
  await storage.put(assetKey, await file.arrayBuffer(), { contentType: "application/pdf" });
  await db
    .prepare(
      `INSERT INTO notebooks (id, class_id, owner_id, title, source_name, asset_key, page_count, status, kind, created_at, updated_at)
       VALUES (?, '', ?, ?, ?, ?, 0, 'draft', 'template', ?, ?)`,
    )
    .bind(id, user.id, title || file.name.replace(/\.[^.]+$/, ""), file.name, assetKey, now(), now())
    .run();
  return c.json({ notebook: { id, assetKey } });
}));

/**
 * Copy a run of template pages into a class copy, with their boxes and the
 * teacher's ink, each remembering what it mirrors. `seqFor` decides where each
 * lands — a fresh push numbers them as the template does; a sync slots each
 * one between the copies of its template neighbours.
 */
async function copyPages(
  template: any,
  copyId: string,
  pages: any[],
  seqFor: (templatePage: any) => Promise<number> | number,
): Promise<{ pages: number; fields: number }> {
  // One copy of each source document per destination, however many pages share it.
  const copiedAssets = new Map<string, string>();
  const assetFor = async (src: string) => {
    if (!src) return "";
    let dst = copiedAssets.get(src);
    if (!dst) {
      dst = `notebooks/${copyId}/tpl-${flatten(src)}`;
      await storage.copy(src, dst);
      copiedAssets.set(src, dst);
    }
    return dst;
  };

  let fieldsCopied = 0;
  for (const tp of pages) {
    const pageId = uid();
    await db
      .prepare(
        `INSERT INTO pages (id, notebook_id, seq, asset_key, source_index, width, height, label,
                            group_name, archived, pattern, pattern_color, teacher_annotate, template_page_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
      )
      .bind(
        pageId, copyId, await seqFor(tp), await assetFor(tp.asset_key), tp.source_index, tp.width, tp.height,
        tp.label ?? "", tp.group_name ?? "", tp.pattern ?? "", tp.pattern_color ?? "", tp.teacher_annotate ?? 0,
        tp.id, now(),
      )
      .run();

    const fields = await db
      .prepare(`SELECT * FROM fields WHERE notebook_id = ? AND page_id = ? AND archived = 0`)
      .bind(template.id, tp.id)
      .all<any>();
    for (const f of fields.results ?? []) {
      fieldsCopied += await copyField(copyId, pageId, f);
    }

    // The teacher's ink on the template page arrives as a draft, to be sent to
    // students when the class copy is published, like any other ink.
    const ann = await db
      .prepare(`SELECT draft_data, published_data FROM page_annotations WHERE notebook_id = ? AND page_id = ?`)
      .bind(template.id, tp.id)
      .first<any>();
    const ink = ann?.draft_data || ann?.published_data || "";
    if (ink) {
      await db
        .prepare(
          `INSERT INTO page_annotations (page_id, notebook_id, draft_data, published_data, rev, updated_at)
           VALUES (?, ?, ?, '', 1, ?)`,
        )
        .bind(pageId, copyId, ink, now())
        .run();
    }
  }
  return { pages: pages.length, fields: fieldsCopied };
}

async function copyField(copyId: string, pageId: string, f: any): Promise<number> {
  let mediaKey: string | null = null;
  if (f.media_key) {
    mediaKey = `notebooks/${copyId}/fields/${uid()}`;
    await storage.copy(f.media_key, mediaKey);
  }
  await db
    .prepare(
      `INSERT INTO fields (id, notebook_id, page_id, type, x, y, w, h, label, options, prompt,
                           content, media_key, archived, template_field_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .bind(
      uid(), copyId, pageId, f.type, f.x, f.y, f.w, f.h, f.label ?? "", f.options ?? "",
      f.prompt ?? "", f.content ?? "", mediaKey, f.id, now(),
    )
    .run();
  return 1;
}

/** Put a template into a class, as a draft notebook that remembers its origin. */
app.post("/api/templates/:id/push", handler(async (c) => {
  const user = await requireTeacher(c);
  const template = await ownedTemplate(user.id, param(c, "id"));
  const { classId } = await c.req.json<{ classId?: string }>();
  if (!classId) throw new HttpError(400, "Which class?");
  const teacher = await requireClassTeacher(c, classId);
  await requireNotebookRoom(teacher);

  const existing = await db
    .prepare(`SELECT id FROM notebooks WHERE template_id = ? AND class_id = ?`)
    .bind(template.id, classId)
    .first<{ id: string }>();
  if (existing) throw new HttpError(409, "This template is already in that class — send updates to it instead.");

  const copyId = uid();
  let coverKey: string | null = null;
  if (template.cover_key) {
    coverKey = `notebooks/${copyId}/cover-${uid()}`;
    await storage.copy(template.cover_key, coverKey);
  }
  await db
    .prepare(
      `INSERT INTO notebooks (id, class_id, owner_id, title, source_name, asset_key, page_count, status, kind,
                              accent_color, cover_key, template_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '', 0, 'draft', 'class', ?, ?, ?, ?, ?)`,
    )
    .bind(copyId, classId, user.id, template.title, template.source_name ?? "", template.accent_color ?? "#2E7D6B", coverKey, template.id, now(), now())
    .run();

  const pages = await db
    .prepare(`SELECT * FROM pages WHERE notebook_id = ? AND archived = 0 ORDER BY seq`)
    .bind(template.id)
    .all<any>();
  const copied = await copyPages(template, copyId, pages.results ?? [], (tp) => tp.seq);
  await syncPageCount(copyId);
  return c.json({ notebook: { id: copyId }, ...copied });
}));

/**
 * Add-only sync: anything in the template with no mirror in a copy is copied
 * across; everything else is left as the class has it. Copies that belong to
 * someone else (a co-teacher pushed it) are theirs to update.
 */
app.post("/api/templates/:id/sync", handler(async (c) => {
  const user = await requireTeacher(c);
  const template = await ownedTemplate(user.id, param(c, "id"));
  const copies = await db
    .prepare(`SELECT n.* FROM notebooks n JOIN classes c ON c.id = n.class_id WHERE n.template_id = ? AND n.owner_id = ? AND c.archived = 0`)
    .bind(template.id, user.id)
    .all<any>();

  const templatePages = (await db
    .prepare(`SELECT * FROM pages WHERE notebook_id = ? AND archived = 0 ORDER BY seq`)
    .bind(template.id)
    .all<any>()).results ?? [];

  let classes = 0;
  let pagesAdded = 0;
  let fieldsAdded = 0;
  for (const copy of copies.results ?? []) {
    const copyPagesRows = (await db
      .prepare(`SELECT id, seq, template_page_id FROM pages WHERE notebook_id = ? ORDER BY seq`)
      .bind(copy.id)
      .all<{ id: string; seq: number; template_page_id: string | null }>()).results ?? [];
    const mirror = new Map<string, { id: string; seq: number }>();
    for (const cp of copyPagesRows) if (cp.template_page_id) mirror.set(cp.template_page_id, { id: cp.id, seq: cp.seq });

    // New pages, each slotted between the copies of its template neighbours,
    // so the order the template has is the order the class gets.
    const missing = templatePages.filter((tp) => !mirror.has(tp.id));
    const seqFor = (tp: any) => {
      const i = templatePages.indexOf(tp);
      let before: number | null = null;
      for (let k = i - 1; k >= 0; k--) { const m = mirror.get(templatePages[k].id); if (m) { before = m.seq; break; } }
      let after: number | null = null;
      for (let k = i + 1; k < templatePages.length; k++) { const m = mirror.get(templatePages[k].id); if (m) { after = m.seq; break; } }
      const seq = before !== null && after !== null ? (before + after) / 2
        : before !== null ? before + 1
        : after !== null ? after - 1
        : 1;
      // Later pages in this same run slot after this one.
      mirror.set(tp.id, { id: "", seq });
      return seq;
    };
    const copied = await copyPages(template, copy.id, missing, seqFor);
    pagesAdded += copied.pages;
    fieldsAdded += copied.fields;

    // New boxes on pages the class already has.
    const mirroredFields = new Set(
      ((await db
        .prepare(`SELECT template_field_id FROM fields WHERE notebook_id = ? AND template_field_id IS NOT NULL`)
        .bind(copy.id)
        .all<{ template_field_id: string }>()).results ?? []).map((r) => r.template_field_id),
    );
    // Re-read the mirror now that the new pages exist, so a box on a page
    // added a moment ago isn't copied a second time.
    const freshMirror = new Map<string, string>();
    for (const cp of (await db
      .prepare(`SELECT id, template_page_id FROM pages WHERE notebook_id = ? AND template_page_id IS NOT NULL`)
      .bind(copy.id)
      .all<{ id: string; template_page_id: string }>()).results ?? []) {
      freshMirror.set(cp.template_page_id, cp.id);
    }
    const templateFields = (await db
      .prepare(`SELECT f.* FROM fields f JOIN pages p ON p.id = f.page_id WHERE f.notebook_id = ? AND f.archived = 0 AND p.archived = 0`)
      .bind(template.id)
      .all<any>()).results ?? [];
    for (const tf of templateFields) {
      if (mirroredFields.has(tf.id)) continue;
      const pageId = freshMirror.get(tf.page_id);
      if (!pageId) continue;
      fieldsAdded += await copyField(copy.id, pageId, tf);
    }

    await syncPageCount(copy.id);
    await db.prepare(`UPDATE notebooks SET updated_at = ? WHERE id = ?`).bind(now(), copy.id).run();
    classes++;
  }
  return c.json({ classes, pagesAdded, fieldsAdded });
}));

/** Delete a template. Its class copies stand on their own from here. */
app.delete("/api/templates/:id", handler(async (c) => {
  const user = await requireTeacher(c);
  const template = await ownedTemplate(user.id, param(c, "id"));
  await db.prepare(`UPDATE notebooks SET template_id = NULL WHERE template_id = ?`).bind(template.id).run();
  await deleteNotebookCascade(template.id);
  return c.json({ ok: true });
}));
