import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Trash2, X } from "lucide-react";
import { api, type PageRec } from "../lib/api";
import Shell, { ErrorNote, Spinner } from "../components/Shell";
import { cn, toIso, toLocalInput } from "../lib/utils";

type Grading = "none" | "complete" | "points" | "letter";

const GRADING_LABELS: Record<string, string> = {
  none: "Ungraded",
  complete: "Complete / Incomplete",
  points: "Points",
  letter: "Letter grade",
};

/** What deleting (or heavily editing) an assignment would actually disturb. */
interface AssignmentImpact {
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
function DeleteAssignmentModal({
  impact, loading, deleting, onCancel, onConfirm,
}: {
  impact: AssignmentImpact | null;
  loading: boolean;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between">
          <h3 className="text-base font-semibold text-slate-900">Delete assignment?</h3>
          <button onClick={onCancel} className="rounded-full p-1 text-slate-400 hover:bg-slate-100" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading || !impact ? (
          <div className="py-8"><Spinner label="Checking impact…" /></div>
        ) : (
          <>
            <div className="mt-3 space-y-1.5 text-sm text-slate-700">
              {impact.submitted > 0 && (
                <p>{impact.submitted} of {impact.total} students have turned this in.</p>
              )}
              {impact.graded > 0 && <p>{impact.graded} have been graded.</p>}
              {impact.submitted === 0 && impact.graded === 0 && (
                <p>No one has turned this in yet.</p>
              )}
            </div>
            <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
              Deleting removes the assignment and all of its grades and submission records.
              It does <strong>not</strong> delete the pages or anything students wrote on them —
              that work stays in the notebook.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={onCancel}
                className="rounded-full px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                disabled={deleting}
                className="inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" /> Delete assignment
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function AssignmentEditor() {
  const { classId: classIdParam, assignmentId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const editing = !!assignmentId;

  const existing = useQuery({
    queryKey: ["assignment", assignmentId],
    queryFn: () => api.get<any>(`/api/assignments/${assignmentId}`),
    enabled: editing,
  });

  const impactQuery = useQuery({
    queryKey: ["assignment-impact", assignmentId],
    queryFn: () => api.get<AssignmentImpact>(`/api/assignments/${assignmentId}/impact`),
    enabled: editing,
  });
  const impact = impactQuery.data;
  const hasImpact = !!impact && (impact.submitted > 0 || impact.graded > 0 || impact.started > 0);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const deleteMutation = useMutation({
    mutationFn: () => api.del(`/api/assignments/${assignmentId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assignments", classId] });
      qc.invalidateQueries({ queryKey: ["class", classId] });
      toast.success("Assignment deleted");
      navigate(`/classes/${classId}?tab=assignments`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const classId = classIdParam ?? existing.data?.assignment?.classId ?? "";

  const classQuery = useQuery({
    queryKey: ["class", classId],
    queryFn: () => api.get<any>(`/api/classes/${classId}`),
    enabled: !!classId,
  });

  // Arriving from the notebook editor's "Create assignment" action carries the
  // page multi-selection straight through, so the teacher doesn't repick pages.
  const handoff = (useLocation().state as { notebookId?: string; pageIds?: string[] } | null) ?? null;

  const [notebookId, setNotebookId] = useState(handoff?.notebookId ?? searchParams.get("notebook") ?? "");
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [pageIds, setPageIds] = useState<string[]>(handoff?.pageIds ?? []);
  const [releaseAt, setReleaseAt] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [grading, setGrading] = useState<Grading>("points");
  const [pointsMax, setPointsMax] = useState(100);

  useEffect(() => {
    const a = existing.data?.assignment;
    if (!a) return;
    setNotebookId(a.notebookId);
    setTitle(a.title);
    setInstructions(a.instructions ?? "");
    setPageIds(a.pageIds ?? []);
    setReleaseAt(toLocalInput(a.releaseAt));
    setDueAt(toLocalInput(a.dueAt));
    setGrading(a.grading);
    setPointsMax(a.pointsMax);
  }, [existing.data]);

  const notebooks = useMemo(
    () => (classQuery.data?.notebooks ?? []).filter((n: any) => n.status === "published" || n.id === notebookId),
    [classQuery.data, notebookId],
  );

  const notebookQuery = useQuery({
    queryKey: ["notebook", notebookId],
    queryFn: () => api.get<{ pages: PageRec[] }>(`/api/notebooks/${notebookId}`),
    enabled: !!notebookId,
  });
  const pages = notebookQuery.data?.pages ?? [];

  const save = useMutation({
    mutationFn: (status: "draft" | "active") => {
      const body = {
        notebookId, title, instructions, pageIds,
        releaseAt: toIso(releaseAt), dueAt: toIso(dueAt),
        grading, pointsMax, status,
      };
      return editing
        ? api.patch(`/api/assignments/${assignmentId}`, body)
        : api.post<{ assignment: { id: string } }>(`/api/classes/${classId}/assignments`, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assignments", classId] });
      qc.invalidateQueries({ queryKey: ["class", classId] });
      toast.success(editing ? "Assignment updated" : "Assignment created");
      navigate(`/classes/${classId}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (editing && existing.isLoading) return <Spinner />;
  if (classQuery.isLoading) return <Spinner />;

  const toggleAll = () => setPageIds(pageIds.length === pages.length ? [] : pages.map((p) => p.id));
  const canSave = !!notebookId && !!title.trim() && pageIds.length > 0;

  const openDeleteModal = () => setShowDeleteModal(true);

  return (
    <Shell>
      <div className="mx-auto max-w-2xl">
        <h1 className="text-xl font-semibold">{editing ? "Edit assignment" : "New assignment"}</h1>
        {classQuery.error && <div className="mt-4"><ErrorNote error={classQuery.error as Error} /></div>}

        {editing && hasImpact && impact && (
          <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="space-y-1.5">
                <p className="font-medium">Students have already started this assignment</p>
                {(impact.submitted > 0 || impact.started > 0) && (
                  <p>
                    Removing pages from the selection below hides that page from the assignment —
                    a student's writing on it is <strong>not</strong> deleted. It stays in the notebook
                    and reappears if the page is added back.
                  </p>
                )}
                {impact.graded > 0 && grading !== impact.grading && (
                  <p>
                    {impact.graded} existing grade{impact.graded === 1 ? "" : "s"} were recorded as{" "}
                    <strong>{GRADING_LABELS[impact.grading] ?? impact.grading}</strong> and won't convert
                    automatically now that you're switching to <strong>{GRADING_LABELS[grading]}</strong>.
                  </p>
                )}
                {impact.returned > 0 && (
                  <p>
                    {impact.returned} student{impact.returned === 1 ? "" : "s"} have already seen their
                    grade — changing points possible will change what their score means.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="mt-6 space-y-5 rounded-2xl border border-slate-200 bg-white p-6">
          <div>
            <label className="block text-sm font-medium text-slate-700">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Unit 3 practice problems"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">Instructions</label>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">Notebook</label>
            <select
              value={notebookId}
              onChange={(e) => { setNotebookId(e.target.value); setPageIds([]); }}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
            >
              <option value="">Choose a notebook…</option>
              {notebooks.map((n: any) => (
                <option key={n.id} value={n.id}>{n.title} ({n.page_count} pages)</option>
              ))}
            </select>
            {notebooks.length === 0 && (
              <p className="mt-1 text-xs text-amber-700">
                No published notebooks yet — publish one first, then create the assignment.
              </p>
            )}
          </div>

          {notebookId && (
            <div>
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-slate-700">
                  Pages ({pageIds.length} selected)
                </label>
                <button type="button" onClick={toggleAll} className="text-xs text-blue-600 hover:underline">
                  {pageIds.length === pages.length ? "Clear all" : "Select all"}
                </button>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">Pages don't have to be next to each other.</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {pages.map((p, i) => {
                  const on = pageIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() =>
                        setPageIds((prev) => (on ? prev.filter((x) => x !== p.id) : [...prev, p.id]))
                      }
                      className={cn(
                        "h-10 min-w-10 rounded-lg border px-2 text-sm transition-colors",
                        on ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50",
                      )}
                      title={p.label || `Page ${i + 1}`}
                    >
                      {i + 1}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-slate-700">Release</label>
              <input
                type="datetime-local"
                value={releaseAt}
                onChange={(e) => setReleaseAt(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
              <p className="mt-1 text-xs text-slate-500">Leave blank to release immediately.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Due</label>
              <input
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-slate-700">Grading</label>
              <select
                value={grading}
                onChange={(e) => setGrading(e.target.value as Grading)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
              >
                <option value="points">Points</option>
                <option value="letter">Letter grade</option>
                <option value="complete">Complete / Incomplete</option>
                <option value="none">Ungraded</option>
              </select>
            </div>
            {grading === "points" && (
              <div>
                <label className="block text-sm font-medium text-slate-700">Points possible</label>
                <input
                  type="number"
                  min={1}
                  value={pointsMax}
                  onChange={(e) => setPointsMax(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                />
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <button
              disabled={!canSave || save.isPending}
              onClick={() => save.mutate("active")}
              className="rounded-full bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {editing ? "Save changes" : "Assign to class"}
            </button>
            <button
              disabled={!canSave || save.isPending}
              onClick={() => save.mutate("draft")}
              className="rounded-full border border-slate-300 px-4 py-2.5 text-sm hover:bg-slate-50 disabled:opacity-50"
            >
              Save as draft
            </button>
            <button
              onClick={() => navigate(`/classes/${classId}`)}
              className="rounded-full px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>

          {editing && (
            <div className="border-t border-slate-200 pt-5">
              <button
                type="button"
                onClick={openDeleteModal}
                className="inline-flex items-center gap-1.5 rounded-full border border-rose-300 px-4 py-2.5 text-sm font-medium text-rose-600 hover:bg-rose-50"
              >
                <Trash2 className="h-4 w-4" /> Delete assignment
              </button>
            </div>
          )}
        </div>
      </div>

      {showDeleteModal && (
        <DeleteAssignmentModal
          impact={impact ?? null}
          loading={impactQuery.isLoading}
          deleting={deleteMutation.isPending}
          onCancel={() => setShowDeleteModal(false)}
          onConfirm={() => deleteMutation.mutate()}
        />
      )}
    </Shell>
  );
}
