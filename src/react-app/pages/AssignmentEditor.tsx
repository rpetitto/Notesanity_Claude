import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Check, Trash2 } from "lucide-react";
import { api, assetUrl, type PageRec } from "../lib/api";
import Shell, { ErrorNote, Spinner } from "../components/Shell";
import PageThumb from "../components/PageThumb";
import { Button, Card, Input, Label, Modal, Select, Textarea } from "../components/ui";
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
    <Modal onClose={onCancel} title="Delete assignment?">
      {loading || !impact ? (
        <div className="py-8"><Spinner label="Checking impact…" /></div>
      ) : (
        <>
          <div className="mt-1 space-y-1.5 text-[16px] text-pine/80">
            {impact.submitted > 0 && (
              <p>{impact.submitted} of {impact.total} students have turned this in.</p>
            )}
            {impact.graded > 0 && <p>{impact.graded} have been graded.</p>}
            {impact.submitted === 0 && impact.graded === 0 && (
              <p>No one has turned this in yet.</p>
            )}
          </div>
          <p className="mt-3 rounded-[12px] bg-oat p-3 text-[16px] leading-relaxed text-pine/80">
            Deleting removes the assignment and all of its grades and submission records.
            It does <strong>not</strong> delete the pages or anything students wrote on them —
            that work stays in the notebook.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={onCancel}>Cancel</Button>
            <Button variant="danger" onClick={onConfirm} disabled={deleting}>
              <Trash2 className="h-4 w-4" strokeWidth={2.5} /> Delete assignment
            </Button>
          </div>
        </>
      )}
    </Modal>
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
        <h1 className="font-display text-[32px] text-pine">{editing ? "Edit assignment" : "New assignment"}</h1>
        {classQuery.error && <div className="mt-4"><ErrorNote error={classQuery.error as Error} /></div>}

        {editing && hasImpact && impact && (
          <div className="mt-4 rounded-[12px] border-[3px] border-[#8a6a1f] bg-[#f7e6bf] p-4 text-[16px] text-[#5c4611]">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} />
              <div className="space-y-1.5">
                <p className="font-display">Students have already started this assignment</p>
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

        <Card className="mt-6 space-y-5 p-6">
          <div>
            <Label>Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Unit 3 practice problems"
              className="mt-1.5"
            />
          </div>

          <div>
            <Label>Instructions</Label>
            <Textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={3}
              className="mt-1.5"
            />
          </div>

          <div>
            <Label>Notebook</Label>
            <Select
              value={notebookId}
              onChange={(e) => { setNotebookId(e.target.value); setPageIds([]); }}
              className="mt-1.5"
            >
              <option value="">Choose a notebook…</option>
              {notebooks.map((n: any) => (
                <option key={n.id} value={n.id}>{n.title} ({n.page_count} pages)</option>
              ))}
            </Select>
            {notebooks.length === 0 && (
              <p className="mt-1.5 text-[16px] text-[#8a6a1f]">
                No published notebooks yet — publish one first, then create the assignment.
              </p>
            )}
          </div>

          {notebookId && (
            <div>
              <div className="flex items-center justify-between">
                <Label>Pages ({pageIds.length} selected)</Label>
                <button type="button" onClick={toggleAll} className="font-display text-[16px] text-pine hover:underline">
                  {pageIds.length === pages.length ? "Clear all" : "Select all"}
                </button>
              </div>
              <p className="mt-0.5 text-[16px] text-pine/70">Pages don't have to be next to each other.</p>
              <div className="mt-2 grid grid-cols-3 gap-2.5 sm:grid-cols-5 lg:grid-cols-7">
                {pages.map((p, i) => {
                  const on = pageIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() =>
                        setPageIds((prev) => (on ? prev.filter((x) => x !== p.id) : [...prev, p.id]))
                      }
                      title={p.label || `Page ${i + 1}`}
                      className={cn(
                        "relative flex flex-col items-center rounded-[12px] p-1.5 transition-colors",
                        on ? "ring-[3px] ring-pine bg-oat" : "border-2 border-pine/20 hover:bg-oat",
                      )}
                    >
                      <PageThumb
                        pdfUrl={assetUrl(notebookId, p.asset_key)}
                        sourceIndex={p.source_index}
                        pageWidth={p.width}
                        pageHeight={p.height}
                        width={72}
                      />
                      <span className="absolute bottom-1.5 left-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-pine bg-white px-1 font-display text-[16px] text-pine">
                        {i + 1}
                      </span>
                      {on && (
                        <span className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-pine bg-mint text-pine">
                          <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Release</Label>
              <Input
                type="datetime-local"
                value={releaseAt}
                onChange={(e) => setReleaseAt(e.target.value)}
                className="mt-1.5"
              />
              <p className="mt-1 text-[16px] text-pine/70">Leave blank to release immediately.</p>
            </div>
            <div>
              <Label>Due</Label>
              <Input
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className="mt-1.5"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Grading</Label>
              <Select value={grading} onChange={(e) => setGrading(e.target.value as Grading)} className="mt-1.5">
                <option value="points">Points</option>
                <option value="letter">Letter grade</option>
                <option value="complete">Complete / Incomplete</option>
                <option value="none">Ungraded</option>
              </Select>
            </div>
            {grading === "points" && (
              <div>
                <Label>Points possible</Label>
                <Input
                  type="number"
                  min={1}
                  value={pointsMax}
                  onChange={(e) => setPointsMax(Number(e.target.value))}
                  className="mt-1.5"
                />
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button variant="primary" disabled={!canSave || save.isPending} onClick={() => save.mutate("active")}>
              {editing ? "Save changes" : "Assign to class"}
            </Button>
            <Button variant="secondary" disabled={!canSave || save.isPending} onClick={() => save.mutate("draft")}>
              Save as draft
            </Button>
            <Button variant="ghost" onClick={() => navigate(`/classes/${classId}`)}>
              Cancel
            </Button>
          </div>

          {editing && (
            <div className="border-t-[3px] border-pine/15 pt-5">
              <Button type="button" variant="danger" onClick={openDeleteModal}>
                <Trash2 className="h-4 w-4" strokeWidth={2.5} /> Delete assignment
              </Button>
            </div>
          )}
        </Card>
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
