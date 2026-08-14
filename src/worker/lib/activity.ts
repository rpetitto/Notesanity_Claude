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

import { db } from "flingit";
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

export async function logActivity(input: LogInput): Promise<void> {
  try {
    // Fold a run of edits by the same person on the same page into one entry.
    if (input.action === "edit" || input.action === "answer" || input.action === "annotate") {
      const cutoff = new Date(Date.now() - COALESCE_MINUTES * 60_000).toISOString();
      const recent = await db
        .prepare(
          `SELECT id FROM activity
            WHERE actor_id = ? AND action = ? AND created_at > ?
              AND IFNULL(instance_id,'') = IFNULL(?,'') AND IFNULL(page_id,'') = IFNULL(?,'')
            ORDER BY created_at DESC LIMIT 1`,
        )
        .bind(input.actorId, input.action, cutoff, input.instanceId ?? null, input.pageId ?? null)
        .first<{ id: string }>();
      if (recent) {
        await db.prepare(`UPDATE activity SET created_at = ?, detail = ? WHERE id = ?`)
          .bind(now(), input.detail ?? "", recent.id)
          .run();
        return;
      }
    }

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

/**
 * Is this page frozen for the student, and why?
 *
 * A page is locked while it belongs to a submission that has been handed in and
 * not deliberately reopened. Returning graded work does not unlock it: that
 * window is exactly where a page could be edited after marking.
 */
export async function pageLock(studentId: string, notebookId: string, pageId: string) {
  const row = await db
    .prepare(
      `SELECT s.id, s.status, s.submitted_at, s.returned_at, s.locked, a.id AS assignment_id, a.title
         FROM submissions s
         JOIN assignments a ON a.id = s.assignment_id
        WHERE s.student_id = ? AND a.notebook_id = ? AND a.page_ids LIKE ?
          AND s.locked = 1
        ORDER BY s.submitted_at DESC LIMIT 1`,
    )
    .bind(studentId, notebookId, `%"${pageId}"%`)
    .first<any>();
  if (!row) return null;
  return {
    assignmentId: row.assignment_id,
    title: row.title,
    returned: !!row.returned_at,
    submittedAt: row.submitted_at,
  };
}
