/**
 * A teacher's page library.
 *
 * Save any page worth reusing — the Monday warm-up, the lab write-up frame, the
 * exit ticket — and drop it into any notebook later.
 *
 * The bytes are copied in rather than referenced, because every asset lives
 * under the prefix of whatever owns it and deleting a notebook sweeps that
 * whole prefix. An entry pointing at the original PDF would go blank the day
 * the notebook it came from was thrown away, months later, with nothing to
 * explain why. Saving copies into `library/`; inserting copies back out into
 * the destination notebook. That keeps the rule the sweep depends on: a
 * notebook's assets are always under that notebook.
 *
 * Inserting lives in routes/notebooks.ts, next to the other ways of adding a
 * page, because it is a write to a notebook and shares that file's access check
 * and page-ordering helper.
 */

import { app, db, storage } from "../platform";
import { handler, now, uid, requireTeacher, HttpError, param } from "../lib/session";
import {
  MAX_LIBRARY_PAGES, libraryAssetKey, libraryMediaKey, type LibraryField,
} from "../lib/page-library";
import { requirePlan } from "../lib/plans";
import { importedLinks } from "../lib/links";

/** A page's own links, in the shape a library entry keeps its fields. */
const libraryLinks = (page: { width: number; height: number; links?: unknown }): LibraryField[] =>
  importedLinks(page).map((l) => ({
    type: "link", x: l.x, y: l.y, w: l.w, h: l.h, label: l.label, options: "[]", prompt: "", content: l.content, media_key: null,
  }));

async function ownedEntry(userId: string, id: string) {
  const row = await db
    .prepare(`SELECT * FROM library_pages WHERE id = ? AND owner_id = ?`)
    .bind(id, userId)
    .first<any>();
  if (!row) throw new HttpError(404, "That page isn't in your library");
  return row;
}

/** What's in my library, newest first — everything a thumbnail needs to render. */
app.get("/api/my/page-library", handler(async (c) => {
  const user = await requireTeacher(c);
  await requirePlan(user, "pro", "The page library");
  const rows = await db
    .prepare(
      `SELECT id, title, asset_key <> '' AS has_asset, source_index, width, height,
              pattern, pattern_color, created_at
         FROM library_pages WHERE owner_id = ? ORDER BY created_at DESC`,
    )
    .bind(user.id)
    .all();
  return c.json({ pages: rows.results ?? [] });
}));

/**
 * The document behind a saved page, for rendering its thumbnail.
 *
 * Separate from the notebook asset route because that one refuses any key
 * outside the notebook it was asked about. This is the same guard pointed at
 * the library: the entry has to be yours, and the key comes from the row rather
 * than from the request, so there is nothing to aim somewhere else.
 */
app.get("/api/my/page-library/:id/asset", handler(async (c) => {
  const user = await requireTeacher(c);
  await requirePlan(user, "pro", "The page library");
  const entry = await ownedEntry(user.id, param(c, "id"));
  if (!entry.asset_key) throw new HttpError(404, "That page has no document behind it");
  const obj = await storage.get(entry.asset_key);
  if (!obj) throw new HttpError(404, "Asset not found");
  return new Response(await obj.arrayBuffer(), {
    headers: {
      "Content-Type": "application/pdf",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}));

/** Save one of my notebook's pages into my library. */
app.post("/api/my/page-library", handler(async (c) => {
  const user = await requireTeacher(c);
  await requirePlan(user, "pro", "The page library");
  const body = await c.req.json<{ notebookId?: string; pageId?: string; title?: string }>();

  const nb = await db
    .prepare(`SELECT id, owner_id FROM notebooks WHERE id = ?`)
    .bind(String(body.notebookId ?? ""))
    .first<{ id: string; owner_id: string }>();
  if (!nb) throw new HttpError(404, "Notebook not found");
  // The owner, deliberately, not any co-teacher: a library belongs to a person.
  if (nb.owner_id !== user.id) throw new HttpError(403, "You can only save pages from your own notebooks");

  const page = await db
    .prepare(`SELECT * FROM pages WHERE id = ? AND notebook_id = ?`)
    .bind(String(body.pageId ?? ""), nb.id)
    .first<any>();
  if (!page) throw new HttpError(404, "Page not found");

  const count = await db
    .prepare(`SELECT COUNT(*) AS n FROM library_pages WHERE owner_id = ?`)
    .bind(user.id)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_LIBRARY_PAGES) {
    throw new HttpError(409, `Your library is full at ${MAX_LIBRARY_PAGES} pages — remove one to save another.`);
  }

  const title = (body.title ?? page.label ?? "").trim().slice(0, 120) || "Untitled page";

  // Shared across every page saved out of the same document, and skipped
  // entirely when it's already there — so the second save from one packet is
  // instant rather than another 25 MB round trip.
  let assetKey = "";
  if (page.asset_key) {
    assetKey = libraryAssetKey(user.id, page.asset_key);
    await storage.copy(page.asset_key, assetKey);
  }

  const fields = await db
    .prepare(`SELECT * FROM fields WHERE notebook_id = ? AND page_id = ? AND archived = 0`)
    .bind(nb.id, page.id)
    .all<any>();

  const stored: LibraryField[] = [];
  for (const f of fields.results ?? []) {
    let mediaKey: string | null = null;
    if (f.media_key) {
      mediaKey = libraryMediaKey(user.id, f.media_key);
      await storage.copy(f.media_key, mediaKey);
    }
    stored.push({
      type: f.type, x: f.x, y: f.y, w: f.w, h: f.h,
      label: f.label ?? "", options: f.options ?? "", prompt: f.prompt ?? "",
      content: f.content ?? "", media_key: mediaKey,
    });
  }

  /*
   * The teacher's own ink is part of what the page looks like, so it travels.
   * The draft is preferred over the published copy because it is what the
   * teacher is looking at as they save — on an unpublished notebook the
   * published copy is empty, and taking it would silently save a blank page.
   */
  const ann = await db
    .prepare(`SELECT draft_data, published_data FROM page_annotations WHERE notebook_id = ? AND page_id = ?`)
    .bind(nb.id, page.id)
    .first<{ draft_data: string; published_data: string }>();

  const id = uid();
  await db
    .prepare(
      `INSERT INTO library_pages (id, owner_id, title, asset_key, source_index, width, height,
                                  pattern, pattern_color, fields, annotation, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id, user.id, title, assetKey, page.source_index ?? 0, page.width, page.height,
      page.pattern ?? "", page.pattern_color ?? "",
      JSON.stringify(stored), ann?.draft_data || ann?.published_data || "", now(),
    )
    .run();

  return c.json({ id, title });
}));

/** Rename an entry — `label` is often empty, and a library of "Untitled page" is not a library. */
app.patch("/api/my/page-library/:id", handler(async (c) => {
  const user = await requireTeacher(c);
  await requirePlan(user, "pro", "The page library");
  const entry = await ownedEntry(user.id, param(c, "id"));
  const { title } = await c.req.json<{ title?: string }>();
  const clean = (title ?? "").trim().slice(0, 120);
  if (!clean) throw new HttpError(400, "Give it a name");
  await db.prepare(`UPDATE library_pages SET title = ? WHERE id = ?`).bind(clean, entry.id).run();
  return c.json({ ok: true });
}));

/** Take a page back out, and its bytes with it once nothing else needs them. */
app.delete("/api/my/page-library/:id", handler(async (c) => {
  const user = await requireTeacher(c);
  await requirePlan(user, "pro", "The page library");
  const entry = await ownedEntry(user.id, param(c, "id"));
  await db.prepare(`DELETE FROM library_pages WHERE id = ?`).bind(entry.id).run();

  // The document is shared with any other page saved out of the same original,
  // so it only goes once the last of them has.
  if (entry.asset_key) {
    const stillUsed = await db
      .prepare(`SELECT 1 FROM library_pages WHERE owner_id = ? AND asset_key = ?`)
      .bind(user.id, entry.asset_key)
      .first();
    if (!stillUsed) await storage.delete(entry.asset_key);
  }
  for (const f of JSON.parse(entry.fields || "[]") as LibraryField[]) {
    if (f.media_key) await storage.delete(f.media_key);
  }
  return c.json({ ok: true });
}));

/* ---------- bringing a document straight into the library ---------- */

/** Same ceiling as a notebook upload; the file is the same kind of file. */
const MAX_LIBRARY_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Only keys under this person's own library prefix are theirs to read or drop. */
function ownedAssetKey(userId: string, key: string) {
  const prefix = `library/${userId}/assets/`;
  if (!key.startsWith(prefix) || key.includes("..")) throw new HttpError(400, "That isn't one of your library documents");
  return key;
}

/**
 * Upload a PDF to the library itself, ahead of choosing which of its pages to
 * keep. Until now a page reached the library only by way of a notebook, which
 * meant making a notebook you didn't want in order to save two pages out of a
 * packet. The document lands under the library's own prefix, and the pages are
 * picked in a second call once the browser has read them.
 */
app.post("/api/my/page-library/upload", handler(async (c) => {
  const user = await requireTeacher(c);
  await requirePlan(user, "pro", "The page library");
  const form = await c.req.parseBody();
  const file = form["file"] as File | undefined;
  if (!file) throw new HttpError(400, "No file uploaded");
  if (file.size > MAX_LIBRARY_UPLOAD_BYTES) {
    throw new HttpError(413, `That file is ${(file.size / 1048576).toFixed(1)}MB — the limit is 25MB.`);
  }
  const assetKey = `library/${user.id}/assets/upload-${uid()}.pdf`;
  await storage.put(assetKey, await file.arrayBuffer(), { contentType: "application/pdf" });
  return c.json({ assetKey });
}));

/** The document behind an upload, for the picker's thumbnails — before any entry exists to serve it through. */
app.get("/api/my/page-library/asset", handler(async (c) => {
  const user = await requireTeacher(c);
  await requirePlan(user, "pro", "The page library");
  const key = ownedAssetKey(user.id, c.req.query("key") || "");
  const obj = await storage.get(key);
  if (!obj) throw new HttpError(404, "Document not found");
  return new Response(await obj.arrayBuffer(), {
    headers: { "Content-Type": "application/pdf", "Cache-Control": "private, max-age=31536000, immutable" },
  });
}));

/** The pages chosen out of an upload, each becoming its own entry. */
app.post("/api/my/page-library/from-upload", handler(async (c) => {
  const user = await requireTeacher(c);
  await requirePlan(user, "pro", "The page library");
  const body = await c.req.json<{
    assetKey?: string;
    title?: string;
    /** `links`: the file's own links on that page, kept as link fields — see lib/links.ts. */
    pages?: { sourceIndex: number; width: number; height: number; title?: string; links?: unknown }[];
  }>();
  const assetKey = ownedAssetKey(user.id, String(body.assetKey ?? ""));
  const pages = (body.pages ?? []).filter((p) =>
    Number.isInteger(p.sourceIndex) && p.sourceIndex >= 0 && Number.isFinite(p.width) && Number.isFinite(p.height) && p.width > 0 && p.height > 0);
  if (pages.length === 0) throw new HttpError(400, "Pick at least one page");

  const count = await db
    .prepare(`SELECT COUNT(*) AS n FROM library_pages WHERE owner_id = ?`)
    .bind(user.id)
    .first<{ n: number }>();
  const room = MAX_LIBRARY_PAGES - (count?.n ?? 0);
  if (pages.length > room) {
    throw new HttpError(409, room <= 0
      ? `Your library is full at ${MAX_LIBRARY_PAGES} pages — remove some to add more.`
      : `Only ${room} more page${room === 1 ? "" : "s"} fit in your library — pick fewer, or remove some.`);
  }

  const base = (body.title ?? "").trim().slice(0, 100) || "Uploaded page";
  const ids: string[] = [];
  for (const p of pages) {
    const id = uid();
    const title = ((p.title ?? "").trim().slice(0, 120)) || (pages.length === 1 ? base : `${base} — p.${p.sourceIndex + 1}`);
    await db
      .prepare(
        `INSERT INTO library_pages (id, owner_id, title, asset_key, source_index, width, height,
                                    pattern, pattern_color, fields, annotation, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, '', '', ?, '', ?)`,
      )
      .bind(id, user.id, title, assetKey, p.sourceIndex, p.width, p.height, JSON.stringify(libraryLinks(p)), now())
      .run();
    ids.push(id);
  }
  return c.json({ ids });
}));

/**
 * An upload nothing was kept from. Refused while any entry still draws on it.
 * A POST with its own name rather than a DELETE on the asset path, because
 * `DELETE /:id` above would take "asset" for an entry id first.
 */
app.post("/api/my/page-library/discard-upload", handler(async (c) => {
  const user = await requireTeacher(c);
  const { key: raw } = await c.req.json<{ key?: string }>();
  const key = ownedAssetKey(user.id, String(raw ?? ""));
  const used = await db
    .prepare(`SELECT 1 FROM library_pages WHERE owner_id = ? AND asset_key = ?`)
    .bind(user.id, key)
    .first();
  if (used) throw new HttpError(409, "Pages in your library still use that document");
  await storage.delete(key);
  return c.json({ ok: true });
}));
