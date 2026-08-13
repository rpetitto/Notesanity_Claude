import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type PageRec } from "../lib/api";
import Shell, { ErrorNote, Spinner } from "../components/Shell";
import { cn, toIso, toLocalInput } from "../lib/utils";

type Grading = "none" | "complete" | "points" | "letter";

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

  const classId = classIdParam ?? existing.data?.assignment?.classId ?? "";

  const classQuery = useQuery({
    queryKey: ["class", classId],
    queryFn: () => api.get<any>(`/api/classes/${classId}`),
    enabled: !!classId,
  });

  const [notebookId, setNotebookId] = useState(searchParams.get("notebook") ?? "");
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [pageIds, setPageIds] = useState<string[]>([]);
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

  return (
    <Shell>
      <div className="mx-auto max-w-2xl">
        <h1 className="text-xl font-semibold">{editing ? "Edit assignment" : "New assignment"}</h1>
        {classQuery.error && <div className="mt-4"><ErrorNote error={classQuery.error as Error} /></div>}

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
        </div>
      </div>
    </Shell>
  );
}
