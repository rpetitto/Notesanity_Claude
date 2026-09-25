/**
 * Activity logging.
 *
 * The log answers "who changed what, and when" for a piece of student work. It
 * is written on the server rather than trusted from the client, and it is
 * readable by both the student and their teachers — the same record, not two
 * versions of it.
 *
 * Writes are coalesced: continuous drawing would otherwise produce an entry
 * every autosave. Repeated edits by the same person, on the same page, within a
 * few minutes fold into one entry whose timestamp moves forward, so the history
 * reads as "worked on page 3, 14:02–14:19" rather than sixty identical lines.
 */

import { db } from "../platform";
import { now, uid } from "./session";

const COALESCE_MINUTES = 5;

export type ActivityAction =
  | "edit"          // ink, text, stamps on a page
  | "answer"        // typed into a field
  | "upload"        // image or audio response
  | "submit"
  | "unsubmit"
  | "grade"
  | "return"
  | "reopen"
  | "annotate"      // teacher markup on a student's page
  | "template";     // teacher changed the notebook itself

export interface LogInput {
  actorId: string;
  actorRole: "teacher" | "student";
  action: ActivityAction;
  detail?: string;
  notebookId?: string | null;
  instanceId?: string | null;
  pageId?: string | null;
  assignmentId?: string | null;
  studentId?: string | null;
}

const COALESCED: ActivityAction[] = ["edit", "answer", "annotate"];

/**
 * The statement that folds this entry into the same person's last one on the
 * same page, or null for actions that always get their own row. One UPDATE
 * that finds its own target, so the common case — the tenth autosave in a
 * minute — is a single round trip, and callers that already write can send it
 * in the same batch. `meta.changes` says whether it found one.
 */
export function coalesceStatement(input: LogInput): D1PreparedStatement | null {
  if (!COALESCED.includes(input.action)) return null;
  const cutoff = new Date(Date.now() - COALESCE_MINUTES * 60_000).toISOString();
  return db
    .prepare(
      `UPDATE activity SET created_at = ?, detail = ?
        WHERE id = (SELECT id FROM activity
                     WHERE actor_id = ? AND action = ? AND created_at > ?
                       AND IFNULL(instance_id,'') = IFNULL(?,'') AND IFNULL(page_id,'') = IFNULL(?,'')
                     ORDER BY created_at DESC LIMIT 1)`,
    )
    .bind(now(), input.detail ?? "", input.actorId, input.action, cutoff, input.instanceId ?? null, input.pageId ?? null);
}

/** A new row for this entry. */
export async function insertActivity(input: LogInput): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO activity
           (id, notebook_id, instance_id, page_id, assignment_id, student_id, actor_id, actor_role, action, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        uid(), input.notebookId ?? null, input.instanceId ?? null, input.pageId ?? null,
        input.assignmentId ?? null, input.studentId ?? null,
        input.actorId, input.actorRole, input.action, input.detail ?? "", now(),
      )
      .run();
  } catch (err) {
    // A failed log entry must never fail the action it was describing.
    console.error("activity log failed", err);
  }
}

export async function logActivity(input: LogInput): Promise<void> {
  try {
    // Fold a run of edits by the same person on the same page into one entry.
    const fold = coalesceStatement(input);
    if (fold && ((await fold.run()).meta?.changes ?? 0) > 0) return;
  } catch (err) {
    console.error("activity log failed", err);
    return;
  }
  await insertActivity(input);
}

/** The statement behind `pageLock`, for callers that batch it with their own reads. */
export function pageLockStatement(studentId: string, notebookId: string, pageId: string): D1PreparedStatement {
  return db
    .prepare(
      `SELECT s.id, s.status, s.submitted_at, s.returned_at, s.locked, a.id AS assignment_id, a.title
         FROM submissions s
         JOIN assignments a ON a.id = s.assignment_id
        WHERE s.student_id = ? AND a.notebook_id = ? AND a.page_ids LIKE ?
          AND s.locked = 1
        ORDER BY s.submitted_at DESC LIMIT 1`,
    )
    .bind(studentId, notebookId, `%"${pageId}"%`);
}

/** Read `pageLockStatement`'s row as a lock, or null when the page is open. */
export function lockFrom(row: any) {
  if (!row) return null;
  return {
    assignmentId: row.assignment_id,
    title: row.title,
    returned: !!row.returned_at,
    submittedAt: row.submitted_at,
  };
}

export async function pageLock(studentId: string, notebookId: string, pageId: string) {
  return lockFrom(await pageLockStatement(studentId, notebookId, pageId).first<any>());
}
