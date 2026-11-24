import { app, db } from "../platform";
import { handler, now, param, HttpError } from "../lib/session";
import { inkKey, parseShape, readInkMany } from "../lib/ink";
import { notebookAccess, requireNotebookTeacher } from "./notebooks";

/**
 * The live class view: every student's page as they work on it.
 *
 * A teacher walking the room sees four screens. This shows them all thirty,
 * refreshed every few seconds, so the student stuck on question two and the
 * one who finished ten minutes ago are both visible from the front.
 *
 * The client polls with the `serverTime` of its last answer as `since`, and
 * gets back only the students who did something in between — their current
 * page, its ink and its typed answers, in full, so a tile can be replaced
 * without the client having to merge anything. A quiet class costs two small
 * queries a poll and no reads from storage at all.
 *
 * "Current page" is the page they last wrote on or typed into: nothing records
 * which page a student is merely looking at, and watching wouldn't be worth a
 * write every time a student scrolls. `page` pins every tile to one page
 * instead — "everyone's on question 3 now".
 *
 * Only a teacher of the class may watch, and only its active students appear.
 * Families and students never reach this; it shows nothing a teacher can't
 * already open one student at a time.
 */

const BATCH = 90;

app.get("/api/notebooks/:id/live", handler(async (c) => {
  const { nb } = requireNotebookTeacher(await notebookAccess(c, param(c, "id")));
  if (nb.kind !== "class" || !nb.class_id) throw new HttpError(400, "Only a class notebook has a class to watch");
  const since = c.req.query("since") || "";
  if (since && Number.isNaN(Date.parse(since))) throw new HttpError(400, "That isn't a time");
  const fixed = c.req.query("page") || "";
  if (fixed) {
    const page = await db.prepare(`SELECT id FROM pages WHERE id = ? AND notebook_id = ? AND archived = 0`).bind(fixed, nb.id).first();
    if (!page) throw new HttpError(404, "Page not found");
  }

  // Taken before reading, so anything written while this runs is "since" next time.
  const serverTime = now();
  const sinceSql = since ? " AND l.updated_at > ?" : "";
  const sinceValSql = since ? " AND v.updated_at > ?" : "";
  const pageSql = fixed ? " AND l.page_id = ?" : "";
  const pageValSql = fixed ? " AND f.page_id = ?" : "";
  const extra = (...v: (string | false)[]) => v.filter((x): x is string => !!x);

  const [rosterRes, instRes, layerRes, valueRes] = await db.batch([
    db.prepare(
      `SELECT u.id, u.name, u.picture FROM enrollments e JOIN users u ON u.id = e.user_id
        WHERE e.class_id = ? AND e.role = 'student' AND e.status = 'active' ORDER BY u.name`,
    ).bind(nb.class_id),
    db.prepare(`SELECT id, student_id FROM instances WHERE notebook_id = ?`).bind(nb.id),
    db.prepare(
      `SELECT l.instance_id, l.page_id, l.updated_at FROM layers l
        WHERE l.kind = 'student' AND l.instance_id IN (SELECT id FROM instances WHERE notebook_id = ?)
          AND l.page_id IN (SELECT id FROM pages WHERE notebook_id = ? AND archived = 0)${sinceSql}${pageSql}`,
    ).bind(nb.id, nb.id, ...extra(since && since, fixed && fixed)),
    db.prepare(
      `SELECT v.instance_id, f.page_id, MAX(v.updated_at) AS updated_at FROM field_values v
         JOIN fields f ON f.id = v.field_id
        WHERE f.notebook_id = ? AND f.archived = 0
          AND v.instance_id IN (SELECT id FROM instances WHERE notebook_id = ?)${sinceValSql}${pageValSql}
        GROUP BY v.instance_id, f.page_id`,
    ).bind(nb.id, nb.id, ...extra(since && since, fixed && fixed)),
  ]) as D1Result<any>[];

  const enrolled = new Map<string, any>();
  for (const s of rosterRes.results ?? []) enrolled.set(s.id, s);
  const studentOf = new Map<string, string>();
  for (const i of instRes.results ?? []) if (enrolled.has(i.student_id)) studentOf.set(i.id, i.student_id);

  // Each student's newest activity — which page, and when.
  const latest = new Map<string, { instanceId: string; pageId: string; at: string }>();
  for (const r of [...(layerRes.results ?? []), ...(valueRes.results ?? [])]) {
    const sid = studentOf.get(r.instance_id);
    if (!sid || !r.updated_at) continue;
    const prev = latest.get(sid);
    if (!prev || r.updated_at > prev.at) latest.set(sid, { instanceId: r.instance_id, pageId: fixed || r.page_id, at: r.updated_at });
  }

  // The whole of each changed student's current page: ink, and what's typed on it.
  const changed = [...latest.entries()];
  const updates: { studentId: string; pageId: string; at: string; ink: string | null; values: Record<string, string> }[] = [];
  for (let i = 0; i < changed.length; i += BATCH) {
    const chunk = changed.slice(i, i + BATCH);
    const res = await db.batch(chunk.flatMap(([, x]) => [
      db.prepare(`SELECT byte_length, data FROM layers WHERE instance_id = ? AND page_id = ? AND kind = 'student'`).bind(x.instanceId, x.pageId),
      db.prepare(
        `SELECT v.field_id, v.value FROM field_values v JOIN fields f ON f.id = v.field_id
          WHERE v.instance_id = ? AND f.page_id = ? AND f.archived = 0`,
      ).bind(x.instanceId, x.pageId),
    ])) as D1Result<any>[];
    const layers = chunk.map((_, k) => res[2 * k].results?.[0] as { byte_length: number; data: string } | undefined);
    const inked = chunk.map(([, x], k) => (layers[k] && (layers[k]!.byte_length > 0 || layers[k]!.data) ? inkKey(nb.id, x.instanceId, x.pageId, "student") : null));
    const blobs = await readInkMany(inked.filter((k): k is string => !!k));
    chunk.forEach(([sid, x], k) => {
      let ink: string | null = null;
      if (inked[k]) {
        const { v, s, x: t, e } = blobs.get(inked[k]!) ?? parseShape(layers[k]!.data);
        ink = JSON.stringify({ v, s, x: t, e, c: [] });
      }
      const values: Record<string, string> = {};
      for (const row of res[2 * k + 1].results ?? []) values[row.field_id] = row.value ?? "";
      updates.push({ studentId: sid, pageId: x.pageId, at: x.at, ink, values });
    });
  }

  return c.json({
    serverTime,
    // The roster comes with the first answer, and again if it changes size,
    // so someone joining mid-lesson gets a tile.
    students: !since || c.req.query("count") !== String(enrolled.size)
      ? [...enrolled.values()].map((s) => ({ id: s.id, name: s.name, picture: s.picture ?? null }))
      : undefined,
    updates,
  });
}));
