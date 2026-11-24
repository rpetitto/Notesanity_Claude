import { app, db } from "../platform";
import { handler, now, param, requireTeacher, throttle, HttpError } from "../lib/session";
import { notebookAccess, requireNotebookTeacher } from "./notebooks";
import { copyAsTemplate } from "./templates";

/**
 * "Send a copy to a colleague."
 *
 * A teacher makes a link to one of their notebooks; another teacher who opens
 * it can add a copy to their own templates. What's copied is the notebook as a
 * teacher built it — pages, boxes, answer keys, the teacher's own writing on
 * the pages — and nothing of any student's: their work lives in instances,
 * layers and answers, none of which a copy reads.
 *
 * Any teacher with the link may add it, at any school: a worksheet carries no
 * student data, and the link is the owner's own choice to hand it on. The
 * token is the whole credential, 144 random bits, and stopping sharing
 * revokes it for everyone at once. What the link shows before it's added is
 * only the title, the page count and the sender's name.
 */

const SHAREABLE = new Set(["template", "class"]);

const appOrigin = (c: any) => new URL(c.req.url).origin;

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function activeShare(notebookId: string) {
  return db
    .prepare(`SELECT token, copies, created_at FROM notebook_shares WHERE notebook_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`)
    .bind(notebookId)
    .first<{ token: string; copies: number; created_at: string }>();
}

const shareJson = (c: any, s: { token: string; copies: number } | null) =>
  s ? { token: s.token, url: `${appOrigin(c)}/share/${s.token}`, copies: s.copies } : null;

async function shareableNotebook(c: any) {
  const { nb } = requireNotebookTeacher(await notebookAccess(c, param(c, "id")));
  if (!SHAREABLE.has(nb.kind)) throw new HttpError(400, "Only a class notebook or a template can be sent to a colleague.");
  return nb;
}

app.get("/api/notebooks/:id/share", handler(async (c) => {
  const nb = await shareableNotebook(c);
  return c.json({ share: shareJson(c, await activeShare(nb.id)) });
}));

/** Make the link, or hand back the one that's already live. */
app.post("/api/notebooks/:id/share", handler(async (c) => {
  const nb = await shareableNotebook(c);
  const user = await requireTeacher(c);
  const existing = await activeShare(nb.id);
  if (existing) return c.json({ share: shareJson(c, existing) });
  const token = newToken();
  await db
    .prepare(`INSERT INTO notebook_shares (token, notebook_id, created_by, created_at) VALUES (?, ?, ?, ?)`)
    .bind(token, nb.id, user.id, now())
    .run();
  return c.json({ share: shareJson(c, { token, copies: 0 }) });
}));

/** Stop sharing: every link to this notebook stops working. Copies already made stay. */
app.delete("/api/notebooks/:id/share", handler(async (c) => {
  const nb = await shareableNotebook(c);
  await db.prepare(`UPDATE notebook_shares SET revoked_at = ? WHERE notebook_id = ? AND revoked_at IS NULL`).bind(now(), nb.id).run();
  return c.json({ ok: true });
}));

/** The notebook a live link points at, or a 404 that says nothing about why. */
async function sharedNotebook(token: string) {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) throw new HttpError(404, "That link doesn't open anything. It may have been switched off.");
  const row = await db
    .prepare(
      `SELECT n.*, s.token, u.name AS sender_name FROM notebook_shares s
         JOIN notebooks n ON n.id = s.notebook_id
         LEFT JOIN users u ON u.id = s.created_by
        WHERE s.token = ? AND s.revoked_at IS NULL AND n.archived = 0`,
    )
    .bind(token)
    .first<any>();
  if (!row || !SHAREABLE.has(row.kind)) throw new HttpError(404, "That link doesn't open anything. It may have been switched off.");
  return row;
}

/**
 * What the link is, for anyone holding it — signed in or not, since it's
 * how a colleague without an account finds out what they were sent.
 */
app.get("/api/shares/:token", handler(async (c) => {
  await throttle(c, "strict", "share", param(c, "token"));
  const nb = await sharedNotebook(param(c, "token"));
  const counts = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM pages WHERE notebook_id = ? AND archived = 0) AS pages,
              (SELECT COUNT(*) FROM fields f JOIN pages p ON p.id = f.page_id
                WHERE f.notebook_id = ? AND f.archived = 0 AND p.archived = 0
                  AND f.type IN ('text','prompt','choice','checkbox','image','audio')) AS boxes,
              (SELECT COUNT(*) FROM fields f JOIN pages p ON p.id = f.page_id
                WHERE f.notebook_id = ? AND f.archived = 0 AND p.archived = 0 AND f.answer_key <> '') AS keyed`,
    )
    .bind(nb.id, nb.id, nb.id)
    .first<{ pages: number; boxes: number; keyed: number }>();
  return c.json({
    share: {
      title: nb.title,
      from: nb.sender_name || "A teacher",
      accentColor: nb.accent_color ?? "#2E7D6B",
      pages: counts?.pages ?? 0,
      boxes: counts?.boxes ?? 0,
      keyed: counts?.keyed ?? 0,
    },
  });
}));

/** Add a copy to my templates. */
app.post("/api/shares/:token/copy", handler(async (c) => {
  const user = await requireTeacher(c);
  await throttle(c, "strict", "share-copy", user.id);
  const nb = await sharedNotebook(param(c, "token"));
  const id = await copyAsTemplate(user.id, nb);
  await db.prepare(`UPDATE notebook_shares SET copies = copies + 1 WHERE token = ?`).bind(nb.token).run();
  return c.json({ notebook: { id } });
}));
