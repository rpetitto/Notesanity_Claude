/**
 * Phrases a teacher uses again.
 *
 * Marking a class of thirty means writing "show your working" thirty times,
 * give or take. This is the smallest thing that fixes it: a per-teacher list
 * of sentences, ordered by how often each one has actually been reached for,
 * so the ones that earn their place rise without anyone curating them.
 *
 * Deliberately not per notebook or per class. Its value is that it follows a
 * teacher from one year to the next, which is the same axis the page library
 * sits on.
 */

import { app, db } from "../platform";
import { handler, now, uid, requireTeacher, HttpError, param } from "../lib/session";
import { requirePlan } from "../lib/plans";

/** Most-used first, then most recent: what you reach for is what you reached for. */
app.get("/api/my/comment-bank", handler(async (c) => {
  const user = await requireTeacher(c);
  await requirePlan(user, "pro", "Saved phrases");
  const rows = await db
    .prepare(
      `SELECT id, text, uses FROM comment_bank
        WHERE owner_id = ? ORDER BY uses DESC, created_at DESC LIMIT 60`,
    )
    .bind(user.id)
    .all();
  return c.json({ phrases: rows.results ?? [] });
}));

app.post("/api/my/comment-bank", handler(async (c) => {
  const user = await requireTeacher(c);
  await requirePlan(user, "pro", "Saved phrases");
  const body = await c.req.json<{ text?: string }>();
  const text = (body.text ?? "").trim();
  if (!text) throw new HttpError(400, "There's nothing to save");
  if (text.length > 500) throw new HttpError(400, "A saved phrase tops out at 500 characters");

  // Saving the same sentence twice is a mistake, not a second phrase.
  const existing = await db
    .prepare(`SELECT id FROM comment_bank WHERE owner_id = ? AND text = ?`)
    .bind(user.id, text)
    .first<{ id: string }>();
  if (existing) return c.json({ phrase: { id: existing.id, text, uses: 0 }, existed: true });

  const id = uid();
  await db
    .prepare(`INSERT INTO comment_bank (id, owner_id, text, created_at) VALUES (?, ?, ?, ?)`)
    .bind(id, user.id, text, now())
    .run();
  return c.json({ phrase: { id, text, uses: 0 } });
}));

/** Reaching for one is what promotes it up the list. */
app.post("/api/my/comment-bank/:id/used", handler(async (c) => {
  const user = await requireTeacher(c);
  await db
    .prepare(`UPDATE comment_bank SET uses = uses + 1 WHERE id = ? AND owner_id = ?`)
    .bind(param(c, "id"), user.id)
    .run();
  return c.json({ ok: true });
}));

app.delete("/api/my/comment-bank/:id", handler(async (c) => {
  const user = await requireTeacher(c);
  await db
    .prepare(`DELETE FROM comment_bank WHERE id = ? AND owner_id = ?`)
    .bind(param(c, "id"), user.id)
    .run();
  return c.json({ ok: true });
}));
