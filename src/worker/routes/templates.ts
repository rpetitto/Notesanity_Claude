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
import { MAX_UPLOAD_BYTES, PAGE_PATTERNS, fillFromTemplate, deleteNotebookCascade } from "./notebooks";

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

  // Each template's copies, and what each copy is still missing — counted for
  // every copy in one statement rather than two queries per copy.
  const templates = notebooks.filter((n) => n.kind === "template");
  const copies = notebooks.filter((n) => n.template_id && templates.some((t) => t.id === n.template_id));
  const pending = new Map<string, { pages: number; fields: number }>();
  if (copies.length) {
    const rows = await db
      .prepare(
        `SELECT cp.id,
                (SELECT COUNT(*) FROM pages tp
                  WHERE tp.notebook_id = cp.template_id AND tp.archived = 0
                    AND NOT EXISTS (SELECT 1 FROM pages p WHERE p.notebook_id = cp.id AND p.template_page_id = tp.id)) AS pages,
                (SELECT COUNT(*) FROM fields tf JOIN pages tp ON tp.id = tf.page_id
                  WHERE tf.notebook_id = cp.template_id AND tf.archived = 0 AND tp.archived = 0
                    AND NOT EXISTS (SELECT 1 FROM fields f WHERE f.notebook_id = cp.id AND f.template_field_id = tf.id)) AS fields
           FROM notebooks cp
          WHERE cp.template_id IN (SELECT id FROM notebooks WHERE kind = 'template' AND owner_id = ?)`,
      )
      .bind(user.id)
      .all<{ id: string; pages: number; fields: number }>();
    for (const r of rows.results ?? []) pending.set(r.id, { pages: r.pages, fields: r.fields });
  }
  for (const t of templates) {
    t.copies = copies.filter((n) => n.template_id === t.id).map((copy) => ({
      notebookId: copy.id, classId: copy.class_id, className: copy.class_name, status: copy.status,
      archived: !!copy.archived,
      pendingPages: pending.get(copy.id)?.pages ?? 0, pendingFields: pending.get(copy.id)?.fields ?? 0,
    }));
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
 * Run storage copies a few at a time. A Worker has a small number of
 * connections open at once; starting a copy per recording in a big template
 * all together would queue behind that limit anyway, less politely.
 */
function limiter(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}
type Limit = ReturnType<typeof limiter>;

/** D1 takes a batch as one round trip; this keeps each one a sensible size. */
const BATCH = 80;
async function runBatched(statements: D1PreparedStatement[]) {
  for (let i = 0; i < statements.length; i += BATCH) await db.batch(statements.slice(i, i + BATCH));
}

/**
 * Everything of a template's that a copy needs, read once however many copies
 * it goes into: its live pages in order, their live answer boxes by page, and
 * the teacher's ink by page.
 */
async function templateContents(templateId: string) {
  const [pages, fields, ink] = await db.batch([
    db.prepare(`SELECT * FROM pages WHERE notebook_id = ? AND archived = 0 ORDER BY seq`).bind(templateId),
    db.prepare(
      `SELECT f.* FROM fields f JOIN pages p ON p.id = f.page_id
        WHERE f.notebook_id = ? AND f.archived = 0 AND p.archived = 0`,
    ).bind(templateId),
    db.prepare(`SELECT page_id, draft_data, published_data FROM page_annotations WHERE notebook_id = ?`).bind(templateId),
  ]);
  const fieldsByPage = new Map<string, any[]>();
  for (const f of (fields.results ?? []) as any[]) {
    const list = fieldsByPage.get(f.page_id) ?? [];
    list.push(f);
    fieldsByPage.set(f.page_id, list);
  }
  const inkByPage = new Map<string, string>();
  for (const a of (ink.results ?? []) as any[]) {
    const data = a.draft_data || a.published_data || "";
    if (data) inkByPage.set(a.page_id, data);
  }
  return { pages: (pages.results ?? []) as any[], fields: (fields.results ?? []) as any[], fieldsByPage, inkByPage };
}
type TemplateContents = Awaited<ReturnType<typeof templateContents>>;

/** A field row for a copy, with its own copy of any recording or picture it carries. */
async function fieldInsert(copyId: string, pageId: string, f: any, limit: Limit): Promise<D1PreparedStatement> {
  let mediaKey: string | null = null;
  if (f.media_key) {
    mediaKey = `notebooks/${copyId}/fields/${uid()}`;
    await limit(() => storage.copy(f.media_key, mediaKey!));
  }
  return db
    .prepare(
      `INSERT OR IGNORE INTO fields (id, notebook_id, page_id, type, x, y, w, h, label, options, prompt,
                                     content, media_key, archived, template_field_id, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?
        WHERE EXISTS (SELECT 1 FROM pages WHERE id = ?)`,
    )
    .bind(
      uid(), copyId, pageId, f.type, f.x, f.y, f.w, f.h, f.label ?? "", f.options ?? "",
      f.prompt ?? "", f.content ?? "", mediaKey, f.id, now(), pageId,
    );
}

/**
 * Copy a run of template pages into a class copy, with their boxes and the
 * teacher's ink, each remembering what it mirrors. `seqFor` decides where each
 * lands — a fresh push numbers them as the template does; a sync slots each
 * one between the copies of its template neighbours.
 *
 * Reads come from `contents`, fetched once per template; writes go out in
 * batches. Each insert skips a mirror that already exists (the unique indexes
 * from migration 032), and a box or ink only lands on a page that did, so two
 * syncs racing each other leave one copy of everything rather than two. A page used to cost five round trips of its own, which for a
 * forty-page template pushed into six classes was over a thousand, each
 * holding the database that every other teacher and student shares.
 */
async function copyPages(
  contents: TemplateContents,
  copyId: string,
  pages: any[],
  seqFor: (templatePage: any) => number,
): Promise<{ pages: number; fields: number; pageIds: Map<string, string> }> {
  // One copy of each source document per destination, however many pages share it.
  const limit = limiter(6);
  const copiedAssets = new Map<string, string>();
  await Promise.all(
    [...new Set(pages.map((tp) => tp.asset_key).filter(Boolean))].map(async (src: string) => {
      const dst = `notebooks/${copyId}/tpl-${flatten(src)}`;
      await limit(() => storage.copy(src, dst));
      copiedAssets.set(src, dst);
    }),
  );

  const statements: D1PreparedStatement[] = [];
  const pageIds = new Map<string, string>();
  const fieldJobs: Promise<D1PreparedStatement>[] = [];
  for (const tp of pages) {
    const pageId = uid();
    pageIds.set(tp.id, pageId);
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO pages (id, notebook_id, seq, asset_key, source_index, width, height, label,
                              group_name, archived, pattern, pattern_color, teacher_annotate, template_page_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
        )
        .bind(
          pageId, copyId, seqFor(tp), copiedAssets.get(tp.asset_key) ?? "", tp.source_index, tp.width, tp.height,
          tp.label ?? "", tp.group_name ?? "", tp.pattern ?? "", tp.pattern_color ?? "", tp.teacher_annotate ?? 0,
          tp.id, now(),
        ),
    );
    for (const f of contents.fieldsByPage.get(tp.id) ?? []) fieldJobs.push(fieldInsert(copyId, pageId, f, limit));

    // The teacher's ink on the template page arrives as a draft, to be sent to
    // students when the class copy is published, like any other ink.
    const ink = contents.inkByPage.get(tp.id);
    if (ink) {
      statements.push(
        db
          .prepare(
            `INSERT INTO page_annotations (page_id, notebook_id, draft_data, published_data, rev, updated_at)
             SELECT ?, ?, ?, '', 1, ? WHERE EXISTS (SELECT 1 FROM pages WHERE id = ?)`,
          )
          .bind(pageId, copyId, ink, now(), pageId),
      );
    }
  }
  const fieldStatements = await Promise.all(fieldJobs);
  await runBatched([...statements, ...fieldStatements]);
  return { pages: pages.length, fields: fieldStatements.length, pageIds };
}

/**
 * Make one class copy of a template: the notebook row, then its pages. The
 * unique index on (template_id, class_id) is what stops two pushes that arrive
 * together from making two copies — the existence check alone can't, since
 * both can pass it before either writes.
 */
async function pushOne(template: any, contents: TemplateContents, classId: string, ownerId: string) {
  const copyId = uid();
  let coverKey: string | null = null;
  if (template.cover_key) {
    coverKey = `notebooks/${copyId}/cover-${uid()}`;
    await storage.copy(template.cover_key, coverKey);
  }
  try {
    await db
      .prepare(
        `INSERT INTO notebooks (id, class_id, owner_id, title, source_name, asset_key, page_count, status, kind,
                                accent_color, cover_key, template_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, '', ?, 'draft', 'class', ?, ?, ?, ?, ?)`,
      )
      .bind(
        copyId, classId, ownerId, template.title, template.source_name ?? "", contents.pages.length,
        template.accent_color ?? "#2E7D6B", coverKey, template.id, now(), now(),
      )
      .run();
  } catch (e) {
    if (/UNIQUE/i.test((e as Error).message)) {
      throw new HttpError(409, "This template is already in that class — send updates to it instead.");
    }
    throw e;
  }
  // A fresh copy numbers its pages 1..n, as the template shows them.
  const order = new Map(contents.pages.map((tp, i) => [tp.id, i + 1]));
  const copied = await copyPages(contents, copyId, contents.pages, (tp) => order.get(tp.id)!);
  return { id: copyId, pages: copied.pages, fields: copied.fields };
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

  const copy = await pushOne(template, await templateContents(template.id), classId, user.id);
  return c.json({ notebook: { id: copy.id }, pages: copy.pages, fields: copy.fields });
}));

const MAX_PUSH_PAIRS = 60;

/**
 * Push several templates into several classes in one request — the "Push to
 * classes…" dialog. Pairs that already have a copy are skipped rather than
 * refused, permission is checked once for the whole set of classes, and the
 * plan's allowance is checked once for the whole set of new notebooks, so a
 * push either fits or is refused before anything is made.
 */
app.post("/api/templates/push", handler(async (c) => {
  const user = await requireTeacher(c);
  const body = await c.req.json<{ templateIds?: string[]; classIds?: string[] }>();
  const templateIds = [...new Set(body.templateIds ?? [])];
  const classIds = [...new Set(body.classIds ?? [])];
  if (!templateIds.length) throw new HttpError(400, "Which templates?");
  if (!classIds.length) throw new HttpError(400, "Which classes?");
  if (templateIds.length * classIds.length > MAX_PUSH_PAIRS) {
    throw new HttpError(400, `That's more than ${MAX_PUSH_PAIRS} notebooks at once — push in smaller groups.`);
  }

  const tq = templateIds.map(() => "?").join(",");
  const cq = classIds.map(() => "?").join(",");
  const [templatesRes, classesRes, existingRes] = await db.batch([
    db.prepare(`SELECT * FROM notebooks WHERE id IN (${tq}) AND kind = 'template' AND owner_id = ?`).bind(...templateIds, user.id),
    db.prepare(
      `SELECT c.id FROM classes c
         LEFT JOIN enrollments e ON e.class_id = c.id AND e.user_id = ? AND e.role = 'teacher' AND e.status = 'active'
        WHERE c.id IN (${cq}) AND (c.owner_id = ? OR e.id IS NOT NULL)`,
    ).bind(user.id, ...classIds, user.id),
    db.prepare(`SELECT template_id, class_id FROM notebooks WHERE template_id IN (${tq}) AND class_id IN (${cq})`)
      .bind(...templateIds, ...classIds),
  ]);
  const templates = (templatesRes.results ?? []) as any[];
  if (templates.length !== templateIds.length) throw new HttpError(404, "Template not found");
  if ((classesRes.results ?? []).length !== classIds.length) throw new HttpError(403, "You don't teach one of those classes");

  const have = new Set(((existingRes.results ?? []) as any[]).map((r) => `${r.template_id}:${r.class_id}`));
  const todo = templates.flatMap((t) => classIds.filter((cid) => !have.has(`${t.id}:${cid}`)).map((cid) => ({ t, cid })));
  if (todo.length) await requireNotebookRoom(user, todo.length);

  const made: { templateId: string; classId: string; notebookId: string }[] = [];
  const skipped: { templateId: string; classId: string }[] = [];
  const contents = new Map<string, TemplateContents>();
  for (const { t, cid } of todo) {
    if (!contents.has(t.id)) contents.set(t.id, await templateContents(t.id));
    try {
      const copy = await pushOne(t, contents.get(t.id)!, cid, user.id);
      made.push({ templateId: t.id, classId: cid, notebookId: copy.id });
    } catch (e) {
      // Someone else's push got there between our check and our write.
      if (e instanceof HttpError && e.status === 409) skipped.push({ templateId: t.id, classId: cid });
      else throw e;
    }
  }
  for (const key of have) {
    const [templateId, classId] = key.split(":");
    skipped.push({ templateId, classId });
  }
  return c.json({ made, skipped });
}));

/**
 * Add-only sync: anything in the template with no mirror in a copy is copied
 * across; everything else is left as the class has it. Copies that belong to
 * someone else (a co-teacher pushed it) are theirs to update.
 *
 * The template is read once for every copy, and each copy costs two reads and
 * its batched writes — not a query per page per copy.
 */
app.post("/api/templates/:id/sync", handler(async (c) => {
  const user = await requireTeacher(c);
  const template = await ownedTemplate(user.id, param(c, "id"));
  const copies = await db
    .prepare(`SELECT n.* FROM notebooks n JOIN classes c ON c.id = n.class_id WHERE n.template_id = ? AND n.owner_id = ? AND c.archived = 0`)
    .bind(template.id, user.id)
    .all<any>();

  const contents = await templateContents(template.id);
  const templatePages = contents.pages;

  let classes = 0;
  let pagesAdded = 0;
  let fieldsAdded = 0;
  for (const copy of copies.results ?? []) {
    const [pagesRes, fieldsRes] = await db.batch([
      db.prepare(`SELECT id, seq, template_page_id FROM pages WHERE notebook_id = ? ORDER BY seq`).bind(copy.id),
      db.prepare(`SELECT template_field_id FROM fields WHERE notebook_id = ? AND template_field_id IS NOT NULL`).bind(copy.id),
    ]);
    const mirror = new Map<string, { id: string; seq: number }>();
    for (const cp of (pagesRes.results ?? []) as { id: string; seq: number; template_page_id: string | null }[]) {
      if (cp.template_page_id) mirror.set(cp.template_page_id, { id: cp.id, seq: cp.seq });
    }
    const mirroredFields = new Set(((fieldsRes.results ?? []) as { template_field_id: string }[]).map((r) => r.template_field_id));

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
    const copied = await copyPages(contents, copy.id, missing, seqFor);
    pagesAdded += copied.pages;
    fieldsAdded += copied.fields;

    // New boxes on pages the class already had. Boxes on the pages just added
    // came across with them, so those pages are left out here.
    const boxes: Promise<D1PreparedStatement>[] = [];
    const limit = limiter(6);
    for (const tf of contents.fields) {
      if (mirroredFields.has(tf.id) || copied.pageIds.has(tf.page_id)) continue;
      const pageId = mirror.get(tf.page_id)?.id;
      if (!pageId) continue;
      boxes.push(fieldInsert(copy.id, pageId, tf, limit));
    }
    const boxStatements = await Promise.all(boxes);
    fieldsAdded += boxStatements.length;

    await runBatched([
      ...boxStatements,
      db.prepare(
        `UPDATE notebooks SET updated_at = ?,
                page_count = (SELECT COUNT(*) FROM pages WHERE notebook_id = ? AND archived = 0)
          WHERE id = ?`,
      ).bind(now(), copy.id, copy.id),
    ]);
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
