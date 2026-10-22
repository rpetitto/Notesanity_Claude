import { db } from "../platform";
import { HttpError, now, uid } from "./session";

/**
 * Families: a parent or guardian linked to a child by a code the school issued.
 *
 * The code is the whole of the proof. A person can't say they're someone's
 * parent; they can only turn up with the code a teacher or admin sent home, so
 * the school decides who sees a child's work — the same shape as Seesaw's home
 * learning codes or Canvas's pairing codes.
 */

// No 0/O, 1/I/L: a code is read off paper and typed by someone else.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** "k7pq-2mxd", "K7PQ 2MXD" and "K7PQ2MXD" are the same code. */
export function normalizeCode(raw: string | undefined | null): string {
  return String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Shown in the dashed form; stored without the dash. */
export function formatCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export interface CodeHolder {
  studentId: string;
  studentName: string;
  orgId: string;
  familyAccess: boolean;
}

/** Who a code belongs to, or null when it isn't a current code. */
export async function lookupCode(raw: string | undefined | null): Promise<CodeHolder | null> {
  const code = normalizeCode(raw);
  if (code.length !== 8) return null;
  const row = await db
    .prepare(
      `SELECT f.student_id, u.name, f.org_id, o.family_access
         FROM family_codes f
         JOIN users u ON u.id = f.student_id AND u.role = 'student'
         JOIN orgs o ON o.id = f.org_id
        WHERE f.code = ?`,
    )
    .bind(code)
    .first<{ student_id: string; name: string; org_id: string; family_access: number }>();
  if (!row) return null;
  return { studentId: row.student_id, studentName: row.name, orgId: row.org_id, familyAccess: !!row.family_access };
}

export const NO_CODE_MESSAGE =
  "Families sign in with the code from their child's teacher. Ask the teacher for one, then enter it here.";

/** A usable code, or the reason it isn't. */
export async function requireCode(raw: string | undefined | null): Promise<CodeHolder> {
  const holder = await lookupCode(raw);
  if (!holder) throw new HttpError(403, "That family code isn't right, or it has been replaced. Check it with your child's teacher.");
  if (!holder.familyAccess) throw new HttpError(403, "Your child's school hasn't turned on family access yet.");
  return holder;
}

/** Link someone to a child. Linking twice is harmless. */
export async function linkGuardian(guardianId: string, holder: CodeHolder, via: "code" | "invite" = "code") {
  if (guardianId === holder.studentId) throw new HttpError(400, "That's your own code — it's for your family to use.");
  await db
    .prepare(
      `INSERT OR IGNORE INTO guardian_links (id, org_id, guardian_id, student_id, via, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(uid(), holder.orgId, guardianId, holder.studentId, via, now())
    .run();
}

/** A student's current code, made on first ask. `fresh` retires the old one. */
export async function codeFor(studentId: string, orgId: string, createdBy: string, fresh = false): Promise<string> {
  if (!fresh) {
    const row = await db.prepare(`SELECT code FROM family_codes WHERE student_id = ?`).bind(studentId).first<{ code: string }>();
    if (row) return row.code;
  }
  // A collision in 31^8 is vanishingly rare, but the UNIQUE index is the judge.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    try {
      await db
        .prepare(
          `INSERT INTO family_codes (student_id, org_id, code, created_by, created_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(student_id) DO UPDATE SET code = excluded.code, created_by = excluded.created_by, created_at = excluded.created_at`,
        )
        .bind(studentId, orgId, code, createdBy, now())
        .run();
      return code;
    } catch (e) {
      if (!String((e as Error).message).includes("UNIQUE")) throw e;
    }
  }
  throw new HttpError(500, "Couldn't make a family code — try again.");
}

/** Codes for several students at once, making any that are missing. */
export async function codesFor(students: { id: string; orgId: string }[], createdBy: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!students.length) return out;
  const ids = students.map((s) => s.id);
  const rows = await db
    .prepare(`SELECT student_id, code FROM family_codes WHERE student_id IN (${ids.map(() => "?").join(",")})`)
    .bind(...ids)
    .all<{ student_id: string; code: string }>();
  for (const r of rows.results ?? []) out.set(r.student_id, r.code);
  for (const s of students) if (!out.has(s.id)) out.set(s.id, await codeFor(s.id, s.orgId, createdBy));
  return out;
}

/** Is this person linked to this child? */
export async function isGuardianOf(userId: string, studentId: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS yes FROM guardian_links WHERE guardian_id = ? AND student_id = ?`)
    .bind(userId, studentId)
    .first();
  return !!row;
}

/**
 * Which of this person's children are active students in a class — what lets
 * a family open that class's notebooks, read-only. Empty for everyone else.
 */
export async function childrenInClass(userId: string, classId: string): Promise<string[]> {
  const rows = await db
    .prepare(
      `SELECT g.student_id FROM guardian_links g
         JOIN enrollments e ON e.user_id = g.student_id AND e.class_id = ? AND e.role = 'student' AND e.status = 'active'
         JOIN orgs o ON o.id = g.org_id AND o.family_access = 1
        WHERE g.guardian_id = ?`,
    )
    .bind(classId, userId)
    .all<{ student_id: string }>();
  return (rows.results ?? []).map((r) => r.student_id);
}
