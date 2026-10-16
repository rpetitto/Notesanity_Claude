import { db, storage } from "../platform";
import { HttpError, now, uid } from "./session";
import { deleteInk, inkKey } from "./ink";

/**
 * Restorable deletes, for the superadmin console.
 *
 * Deleting moves rows out rather than flagging them: a snapshot of every row
 * the thing owns goes to storage, then the rows leave the live tables. So no
 * query anywhere needs to learn to skip deleted things, and restoring is
 * putting the same rows back with the same ids. Files in storage stay where
 * they are until the 30 days are up, then go with the snapshot.
 */

export const TRASH_DAYS = 30;

type Part = { table: string; where: string; params: unknown[] };
type Snapshot = { parts: { table: string; rows: Record<string, unknown>[] }[]; prefixes: string[]; studentWork?: string };

const snapshotKey = (id: string) => `trash/${id}.json`;

// Tables and columns come only from the code below, never from a request.
async function capture(parts: Part[]) {
  const out: Snapshot["parts"] = [];
  for (const p of parts) {
    const res = await db.prepare(`SELECT * FROM ${p.table} WHERE ${p.where}`).bind(...p.params).all<Record<string, unknown>>();
    out.push({ table: p.table, rows: res.results ?? [] });
  }
  return out;
}

async function remove(parts: Part[]) {
  // Children first, so a subquery that finds them still has its parent.
  for (const p of [...parts].reverse()) {
    await db.prepare(`DELETE FROM ${p.table} WHERE ${p.where}`).bind(...p.params).run();
  }
}

async function reinsert(parts: Snapshot["parts"]) {
  for (const { table, rows } of parts) {
    for (const row of rows) {
      const cols = Object.keys(row);
      if (!cols.length) continue;
      await db
        .prepare(`INSERT OR IGNORE INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
        .bind(...cols.map((c) => row[c]))
        .run();
    }
  }
}

/** Everything a notebook owns in the database, parents first. */
function notebookParts(id: string): Part[] {
  const inst = `SELECT id FROM instances WHERE notebook_id = ?`;
  return [
    { table: "notebooks", where: "id = ?", params: [id] },
    { table: "pages", where: "notebook_id = ?", params: [id] },
    { table: "fields", where: "notebook_id = ?", params: [id] },
    { table: "page_annotations", where: "notebook_id = ?", params: [id] },
    { table: "instances", where: "notebook_id = ?", params: [id] },
    { table: "layers", where: `instance_id IN (${inst})`, params: [id] },
    { table: "layer_chunks", where: `layer_id IN (SELECT id FROM layers WHERE instance_id IN (${inst}))`, params: [id] },
    { table: "field_values", where: `instance_id IN (${inst})`, params: [id] },
    { table: "assignments", where: "notebook_id = ?", params: [id] },
    { table: "submissions", where: "assignment_id IN (SELECT id FROM assignments WHERE notebook_id = ?)", params: [id] },
  ];
}

/**
 * Who a user is, and what places them anywhere. Their work in class notebooks
 * stays where it is, unreachable without an enrollment or an account, and is
 * erased at the end of the 30 days; their own notebooks travel with them.
 */
function userParts(id: string): Part[] {
  return [
    { table: "users", where: "id = ?", params: [id] },
    { table: "credentials", where: "user_id = ?", params: [id] },
    { table: "enrollments", where: "user_id = ?", params: [id] },
    { table: "submissions", where: "student_id = ?", params: [id] },
    { table: "guardian_links", where: "guardian_id = ? OR student_id = ?", params: [id, id] },
    { table: "family_codes", where: "student_id = ?", params: [id] },
    { table: "user_tours", where: "user_id = ?", params: [id] },
    { table: "plan_seats", where: "user_id = ?", params: [id] },
  ];
}

async function record(kind: string, targetId: string, label: string, orgId: string | null, actorId: string, snap: Snapshot, detail = "") {
  const id = uid();
  await storage.put(snapshotKey(id), JSON.stringify(snap), { contentType: "application/json" });
  await db
    .prepare(
      `INSERT INTO trash (id, kind, target_id, label, org_id, deleted_by, deleted_at, purge_after, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, kind, targetId, label, orgId, actorId, now(), new Date(Date.now() + TRASH_DAYS * 86_400_000).toISOString(), detail)
    .run();
  return id;
}

export async function trashNotebook(notebookId: string, actorId: string) {
  const nb = await db
    .prepare(`SELECT n.id, n.title, c.org_id FROM notebooks n LEFT JOIN classes c ON c.id = n.class_id WHERE n.id = ?`)
    .bind(notebookId)
    .first<{ id: string; title: string; org_id: string | null }>();
  if (!nb) throw new HttpError(404, "Notebook not found");
  const parts = notebookParts(nb.id);
  const snap: Snapshot = { parts: await capture(parts), prefixes: [`notebooks/${nb.id}/`] };
  const id = await record("notebook", nb.id, nb.title, nb.org_id, actorId, snap);
  await remove(parts);
  return id;
}

export async function trashUser(userId: string, actorId: string) {
  const u = await db.prepare(`SELECT id, name, email, org_id, is_superadmin FROM users WHERE id = ?`).bind(userId).first<any>();
  if (!u) throw new HttpError(404, "User not found");
  if (u.id === actorId) throw new HttpError(400, "You can't delete your own account from here.");
  if (u.is_superadmin) throw new HttpError(400, "Remove their superadmin access first.");
  const owns = await db.prepare(`SELECT COUNT(*) AS n FROM classes WHERE owner_id = ?`).bind(u.id).first<{ n: number }>();
  if (owns?.n) {
    throw new HttpError(400, `${u.name} owns ${owns.n} class${owns.n === 1 ? "" : "es"}. Delete those classes first, from inside each class — their students' work goes with them.`);
  }
  // Their own notebooks (personal ones, and their own notebooks in classes) go too.
  const own = await db
    .prepare(`SELECT id FROM notebooks WHERE owner_id = ? AND kind IN ('personal', 'student', 'template')`)
    .bind(u.id)
    .all<{ id: string }>();
  const parts = [...userParts(u.id), ...(own.results ?? []).flatMap((n) => notebookParts(n.id))];
  const snap: Snapshot = {
    parts: await capture(parts),
    prefixes: (own.results ?? []).map((n) => `notebooks/${n.id}/`),
    studentWork: u.id,
  };
  const id = await record("user", u.id, `${u.name} · ${u.email}`, u.org_id, actorId, snap);
  await remove(parts);
  await db.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(u.id).run();
  return id;
}

export async function trashOrg(orgId: string, actorId: string) {
  const org = await db.prepare(`SELECT id, name FROM orgs WHERE id = ?`).bind(orgId).first<{ id: string; name: string }>();
  if (!org) throw new HttpError(404, "School not found");
  const users = await db.prepare(`SELECT COUNT(*) AS n FROM users WHERE org_id = ?`).bind(org.id).first<{ n: number }>();
  if (users?.n) throw new HttpError(400, `${org.name} still has ${users.n} account${users.n === 1 ? "" : "s"}. Move or delete them first.`);
  const parts: Part[] = [{ table: "orgs", where: "id = ?", params: [org.id] }];
  const snap: Snapshot = { parts: await capture(parts), prefixes: [] };
  const id = await record("school", org.id, org.name, org.id, actorId, snap);
  await remove(parts);
  return id;
}

export async function restore(trashId: string) {
  const t = await db.prepare(`SELECT * FROM trash WHERE id = ?`).bind(trashId).first<any>();
  if (!t) throw new HttpError(404, "Not found");
  if (t.restored_at) throw new HttpError(400, "That was already restored.");
  if (t.purged_at) throw new HttpError(410, "That has been erased for good.");
  const obj = await storage.get(snapshotKey(t.id));
  if (!obj) throw new HttpError(410, "The saved copy is gone.");
  const snap = JSON.parse(await obj.text()) as Snapshot;
  // An address that someone has signed up with since can't take its old account back.
  const userRow = snap.parts.find((p) => p.table === "users")?.rows[0] as { email?: string } | undefined;
  if (userRow?.email) {
    const taken = await db.prepare(`SELECT 1 AS yes FROM users WHERE email = ?`).bind(userRow.email).first();
    if (taken) throw new HttpError(409, `${userRow.email} has a new account now, so the old one can't come back. Delete the new one first if it should.`);
  }
  const orgRow = snap.parts.find((p) => p.table === "orgs")?.rows[0] as { primary_domain?: string } | undefined;
  if (orgRow?.primary_domain) {
    const taken = await db.prepare(`SELECT 1 AS yes FROM orgs WHERE lower(primary_domain) = lower(?)`).bind(orgRow.primary_domain).first();
    if (taken) throw new HttpError(409, `Another school uses ${orgRow.primary_domain} now.`);
  }
  await reinsert(snap.parts);
  await db.prepare(`UPDATE trash SET restored_at = ? WHERE id = ?`).bind(now(), t.id).run();
  await storage.deleteMany([snapshotKey(t.id)]);
}

/** Erase what's been in the trash for 30 days. Run by the cron job; each item is idempotent. */
export async function purgeExpired(limit = 20) {
  const due = await db
    .prepare(`SELECT * FROM trash WHERE restored_at IS NULL AND purged_at IS NULL AND purge_after <= ? ORDER BY purge_after LIMIT ?`)
    .bind(now(), limit)
    .all<any>();
  for (const t of due.results ?? []) {
    const obj = await storage.get(snapshotKey(t.id));
    const snap = obj ? (JSON.parse(await obj.text()) as Snapshot) : { parts: [], prefixes: [] };
    for (const prefix of snap.prefixes) {
      const objects = await storage.listAll(prefix);
      await storage.deleteMany(objects.keys.map((o) => o.key));
    }
    // A student's work in class notebooks, left in place while it could come back.
    if (snap.studentWork) {
      const insts = await db
        .prepare(`SELECT id, notebook_id FROM instances WHERE student_id = ?`)
        .bind(snap.studentWork)
        .all<{ id: string; notebook_id: string }>();
      for (const i of insts.results ?? []) {
        const layers = await db.prepare(`SELECT page_id, kind FROM layers WHERE instance_id = ?`).bind(i.id).all<{ page_id: string; kind: string }>();
        await deleteInk((layers.results ?? []).map((l) => inkKey(i.notebook_id, i.id, l.page_id, l.kind)));
        const uploads = await db.prepare(`SELECT asset_key FROM field_values WHERE instance_id = ? AND asset_key IS NOT NULL`).bind(i.id).all<{ asset_key: string }>();
        await storage.deleteMany((uploads.results ?? []).map((u) => u.asset_key));
        await db.batch([
          db.prepare(`DELETE FROM layer_chunks WHERE layer_id IN (SELECT id FROM layers WHERE instance_id = ?)`).bind(i.id),
          db.prepare(`DELETE FROM layers WHERE instance_id = ?`).bind(i.id),
          db.prepare(`DELETE FROM field_values WHERE instance_id = ?`).bind(i.id),
          db.prepare(`DELETE FROM instances WHERE id = ?`).bind(i.id),
        ]);
      }
    }
    await storage.deleteMany([snapshotKey(t.id)]);
    await db.prepare(`UPDATE trash SET purged_at = ? WHERE id = ?`).bind(now(), t.id).run();
  }
  return (due.results ?? []).length;
}
