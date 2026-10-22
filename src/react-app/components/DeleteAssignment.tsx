import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button, Modal } from "./ui";
import { Spinner } from "./Shell";
import { api } from "../lib/api";

/** What deleting (or heavily editing) an assignment would actually disturb. */
export interface AssignmentImpact {
  submitted: number;
  graded: number;
  returned: number;
  total: number;
  started: number;
  grading: string;
  status: string;
}

/**
 * A plain confirm dialog isn't enough for a destructive, hard-to-undo action
 * that affects a whole roster — the teacher needs the real numbers in front of
 * them, and needs to understand that student *work* survives even though the
 * assignment record doesn't.
 */
export function DeleteAssignmentModal({
  impact, loading, deleting, onCancel, onConfirm,
}: {
  impact: AssignmentImpact | null;
  loading: boolean;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal onClose={onCancel}>
      <div className="flex items-start justify-between">
        <h3 className="text-[17px] text-pine">Delete assignment?</h3>
        <button onClick={onCancel} className="rounded-full p-1 text-pine/50 hover:bg-pine/8" aria-label="Close">
          <X className="h-4 w-4" strokeWidth={2.5} />
        </button>
      </div>

      {loading || !impact ? (
        <div className="py-8"><Spinner label="Checking impact…" /></div>
      ) : (
        <>
          <div className="mt-3 space-y-1.5 text-[16px] text-pine/80">
            {impact.submitted > 0 && (
              <p>{impact.submitted} of {impact.total} students have turned this in.</p>
            )}
            {impact.graded > 0 && <p>{impact.graded} have been graded.</p>}
            {impact.submitted === 0 && impact.graded === 0 && (
              <p>No one has turned this in yet.</p>
            )}
          </div>
          <p className="mt-3 rounded-[12px] border-[3px] border-pine/20 bg-oat p-3 text-[16px] leading-relaxed text-pine/70">
            Deleting removes the assignment and all of its grades and submission records.
            It does <strong>not</strong> delete the pages or anything students wrote on them —
            that work stays in the notebook.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="danger" onClick={onConfirm} disabled={deleting}>
              <Trash2 className="h-4 w-4" strokeWidth={2.5} /> Delete assignment
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

/**
 * The whole delete flow for one assignment, from anywhere: fetch what it would
 * disturb, show the numbers, delete on confirm. The grading screen and the
 * assignment cards both open this, so the warning is the same wherever a
 * teacher starts from.
 */
export function DeleteAssignmentDialog({
  assignmentId, onClose, onDeleted,
}: {
  assignmentId: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [impact, setImpact] = useState<AssignmentImpact | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    api.get<AssignmentImpact>(`/api/assignments/${assignmentId}/impact`)
      .then((r) => { if (live) setImpact(r); })
      .catch((e: Error) => { toast.error(e.message); onClose(); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId]);
  const remove = useMutation({
    mutationFn: () => api.del(`/api/assignments/${assignmentId}`),
    onSuccess: () => { toast.success("Assignment deleted"); onDeleted(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <DeleteAssignmentModal
      impact={impact}
      loading={loading}
      deleting={remove.isPending}
      onCancel={onClose}
      onConfirm={() => remove.mutate()}
    />
  );
}
