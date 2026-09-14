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
