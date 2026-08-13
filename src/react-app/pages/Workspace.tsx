import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Lock, Send } from "lucide-react";
import { toast } from "sonner";
import { api, type WorkResponse } from "../lib/api";
import { useNotebookWork } from "../lib/useNotebookWork";
import { useSession } from "../lib/session";
import NotebookSurface, { type ZoomMode } from "../components/NotebookSurface";
import InkToolbar from "../components/InkToolbar";
import type { ToolState } from "../components/PageCanvas";
import { ErrorNote, Spinner, FlingBadge } from "../components/Shell";
import { cn, formatDue, isOverdue } from "../lib/utils";

const FINGER_KEY = "notesanity:fingerDraw";

export default function Workspace() {
  const { notebookId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const assignmentId = searchParams.get("assignment");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useSession();

  // A teacher has no student instance of their own notebook, so opening the
  // student workspace directly would dead-end. Send them to the editor instead.
  useEffect(() => {
    if (user?.role === "teacher" && notebookId) {
      navigate(`/notebooks/${notebookId}/edit`, { replace: true });
    }
  }, [user?.role, notebookId, navigate]);

  const workQuery = useQuery({
    queryKey: ["work", notebookId],
    queryFn: () => api.get<WorkResponse>(`/api/notebooks/${notebookId}/work`),
    enabled: !!notebookId && user?.role !== "teacher",
  });

  const assignmentQuery = useQuery({
    queryKey: ["assignment", assignmentId],
    queryFn: () => api.get<any>(`/api/assignments/${assignmentId}`),
    enabled: !!assignmentId,
  });

  const data = workQuery.data;
  const assignment = assignmentQuery.data?.assignment;
  const submission = assignmentQuery.data?.submission;
  const locked = submission?.status === "submitted";

  const work = useNotebookWork({
    notebookId,
    writeTarget: locked ? null : "student",
    data,
  });

  const [tool, setTool] = useState<ToolState>({
    kind: "pen", color: "#202124", width: 2.5, stamp: "⭐", fontSize: 14,
  });
  const [fingerDraw, setFingerDraw] = useState<boolean>(() => {
    try { return localStorage.getItem(FINGER_KEY) === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(FINGER_KEY, fingerDraw ? "1" : "0"); } catch { /* ignore */ }
  }, [fingerDraw]);

  const [zoom, setZoom] = useState<ZoomMode>("page");
  const [visiblePage, setVisiblePage] = useState<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // When opened from an assignment, show only the pages that assignment covers.
  const pages = useMemo(() => {
    const all = data?.pages ?? [];
    if (!assignment?.pageIds?.length) return all;
    const allowed = new Set<string>(assignment.pageIds);
    return all.filter((p) => allowed.has(p.id));
  }, [data?.pages, assignment]);

  useEffect(() => {
    if (!visiblePage && pages[0]) setVisiblePage(pages[0].id);
  }, [pages, visiblePage]);

  const submit = useMutation({
    mutationFn: async () => {
      await work.flush();
      return api.post(`/api/assignments/${assignmentId}/submit`);
    },
    onSuccess: () => {
      toast.success("Turned in — these pages are now locked.");
      qc.invalidateQueries({ queryKey: ["assignment", assignmentId] });
      qc.invalidateQueries({ queryKey: ["my-assignments"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const unsubmit = useMutation({
    mutationFn: () => api.post(`/api/assignments/${assignmentId}/unsubmit`),
    onSuccess: () => {
      toast.success("Unsubmitted — you can keep working.");
      qc.invalidateQueries({ queryKey: ["assignment", assignmentId] });
      qc.invalidateQueries({ queryKey: ["my-assignments"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Keyboard: undo/redo on the page currently in view.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) work.redo(visiblePage);
        else work.undo(visiblePage);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [work, visiblePage]);

  if (workQuery.isLoading) return <Spinner label="Opening notebook…" />;
  if (workQuery.error) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <ErrorNote error={workQuery.error as Error} />
        <button onClick={() => navigate(-1)} className="mt-4 text-sm text-blue-600 hover:underline">Go back</button>
      </div>
    );
  }
  if (!data) return null;

  const pageIndex = pages.findIndex((p) => p.id === visiblePage);

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-3 py-2">
        <Link to={user?.role === "teacher" ? `/classes/${data.notebook.classId}` : "/work"}
          className="rounded-full p-2 text-slate-500 hover:bg-slate-100" aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{data.notebook.title}</div>
          <div className="truncate text-xs text-slate-500">
            {assignment ? assignment.title : "Notebook"}
            {pages.length > 0 && ` · Page ${Math.max(1, pageIndex + 1)} of ${pages.length}`}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {assignment && (
            <span className={cn(
              "hidden rounded-full px-2.5 py-1 text-xs sm:inline",
              isOverdue(assignment.dueAt) && !locked ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-600",
            )}>
              Due {formatDue(assignment.dueAt)}
            </span>
          )}
          {assignment && !locked && (
            <button
              onClick={() => {
                if (confirm("Turn in this assignment? These pages will lock until your teacher returns them.")) {
                  submit.mutate();
                }
              }}
              disabled={submit.isPending}
              className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              <Send className="h-4 w-4" /> Turn in
            </button>
          )}
          {assignment && locked && (
            <button
              onClick={() => unsubmit.mutate()}
              disabled={unsubmit.isPending}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 px-3.5 py-2 text-sm hover:bg-slate-50"
            >
              <Lock className="h-4 w-4" /> Unsubmit
            </button>
          )}
        </div>
      </header>

      {locked && (
        <div className="flex items-center gap-2 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <CheckCircle2 className="h-4 w-4" />
          Turned in{submission?.submittedAt ? ` ${formatDue(submission.submittedAt)}` : ""} — locked until your teacher returns it.
        </div>
      )}

      {submission?.grade && (
        <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">
          <span className="font-medium">Grade: </span>
          {assignment?.grading === "points" && `${submission.grade.points ?? "—"} / ${assignment.pointsMax}`}
          {assignment?.grading === "letter" && (submission.grade.letter ?? "—")}
          {assignment?.grading === "complete" &&
            (submission.grade.complete ? "Complete" : "Incomplete")}
          {submission.grade.feedback && <span className="ml-2 text-emerald-800">— {submission.grade.feedback}</span>}
        </div>
      )}

      {!locked && (
        <InkToolbar
          tool={tool}
          onToolChange={setTool}
          fingerDraw={fingerDraw}
          onFingerDrawChange={setFingerDraw}
          onUndo={() => work.undo(visiblePage)}
          onRedo={() => work.redo(visiblePage)}
          canUndo={work.canUndo(visiblePage)}
          canRedo={work.canRedo(visiblePage)}
          status={work.status}
          zoom={zoom}
          onZoomChange={setZoom}
        />
      )}

      <div className="min-h-0 flex-1">
        <NotebookSurface
          notebookId={notebookId}
          pages={pages}
          fields={data.fields}
          studentLayers={work.studentLayers}
          teacherLayers={work.teacherLayers}
          fieldValues={work.fieldValues}
          writeTarget={locked ? null : "student"}
          tool={tool}
          fingerDraw={fingerDraw}
          zoom={zoom}
          authorName={user?.name}
          fieldsEditable={!locked}
          onLayerChange={work.setLayer}
          onFieldChange={work.setFieldValue}
          onVisiblePageChange={setVisiblePage}
          scrollRef={scrollRef}
        />
      </div>
      <FlingBadge />
    </div>
  );
}
