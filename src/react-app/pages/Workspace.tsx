import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, ChevronRight, Lock, PanelLeft, Send } from "lucide-react";
import { toast } from "sonner";
import { api, assetUrl, type WorkResponse } from "../lib/api";
import { useNotebookWork } from "../lib/useNotebookWork";
import { useSession } from "../lib/session";
import { useBackTo } from "../lib/useBackTo";
import NotebookSurface, { type ZoomMode } from "../components/NotebookSurface";
import PageThumb from "../components/PageThumb";
import InkToolbar from "../components/InkToolbar";
import type { ToolState } from "../components/PageCanvas";
import { ErrorNote, Spinner, FlingBadge } from "../components/Shell";
import { cn, formatDue, isOverdue } from "../lib/utils";

const FINGER_KEY = "notesanity:fingerDraw";
const RAIL_KEY = "notesanity:studentRail";

export default function Workspace() {
  const { notebookId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const assignmentId = searchParams.get("assignment");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useSession();
  const goBack = useBackTo("/work");

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

  const [railOpen, setRailOpen] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(RAIL_KEY);
      if (saved !== null) return saved === "1";
    } catch { /* ignore */ }
    return typeof window === "undefined" || window.innerWidth >= 640;
  });
  useEffect(() => {
    try { localStorage.setItem(RAIL_KEY, railOpen ? "1" : "0"); } catch { /* ignore */ }
  }, [railOpen]);

  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  useEffect(() => {
    if (!mobileRailOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileRailOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileRailOpen]);

  const goToPage = (id: string) => {
    setVisiblePage(id);
    scrollRef.current?.querySelector(`[data-page-id="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setMobileRailOpen(false);
  };

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
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white px-3 py-2">
        <button
          type="button"
          onClick={goBack}
          className="rounded-full p-2 text-slate-500 hover:bg-slate-100" aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setRailOpen((v) => !v)}
          className="hidden rounded-full p-2 text-slate-500 hover:bg-slate-100 sm:inline-flex"
          aria-label={railOpen ? "Hide pages" : "Show pages"}
          aria-pressed={railOpen}
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setMobileRailOpen(true)}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 sm:hidden"
          aria-label="Show pages"
        >
          <PanelLeft className="h-4 w-4" /> Pages
        </button>
        <div className="min-w-0 flex-1 sm:flex-initial">
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
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-blue-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              <Send className="h-4 w-4" /> Turn in
            </button>
          )}
          {assignment && locked && (
            <button
              onClick={() => unsubmit.mutate()}
              disabled={unsubmit.isPending}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-slate-300 px-3.5 py-2 text-sm hover:bg-slate-50"
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
        <div className="overflow-x-auto">
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
        </div>
      )}

      {mobileRailOpen && (
        <div className="fixed inset-0 z-40 flex sm:hidden">
          <div
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setMobileRailOpen(false)}
            aria-hidden
          />
          <aside className="relative flex h-full w-[200px] max-w-[85vw] flex-col overflow-y-auto border-r border-slate-200 bg-white px-2 py-3 shadow-xl">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-xs font-semibold text-slate-500">Pages</span>
              <button
                type="button"
                onClick={() => setMobileRailOpen(false)}
                className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100"
                aria-label="Close pages"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-col gap-3">
              {pages.map((page, i) => (
                <button
                  key={page.id}
                  type="button"
                  onClick={() => goToPage(page.id)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-lg p-1.5 text-left transition-colors",
                    visiblePage === page.id ? "bg-blue-50 ring-2 ring-blue-500" : "hover:bg-slate-100",
                  )}
                >
                  <PageThumb
                    pdfUrl={assetUrl(notebookId, page.asset_key)}
                    sourceIndex={page.source_index}
                    pageWidth={page.width}
                    pageHeight={page.height}
                    width={64}
                  />
                  <span className="w-full truncate text-center text-[11px] text-slate-600">
                    {i + 1}{page.label ? ` · ${page.label}` : ""}
                  </span>
                </button>
              ))}
            </div>
          </aside>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        {railOpen && (
          <aside className="hidden w-[104px] shrink-0 overflow-y-auto border-r border-slate-200 bg-white px-2 py-3 sm:block">
            <div className="flex flex-col gap-3">
              {pages.map((page, i) => (
                <button
                  key={page.id}
                  type="button"
                  onClick={() => goToPage(page.id)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-lg p-1.5 text-left transition-colors",
                    visiblePage === page.id ? "bg-blue-50 ring-2 ring-blue-500" : "hover:bg-slate-100",
                  )}
                >
                  <PageThumb
                    pdfUrl={assetUrl(notebookId, page.asset_key)}
                    sourceIndex={page.source_index}
                    pageWidth={page.width}
                    pageHeight={page.height}
                    width={64}
                  />
                  <span className="w-full truncate text-center text-[11px] text-slate-600">
                    {i + 1}{page.label ? ` · ${page.label}` : ""}
                  </span>
                </button>
              ))}
            </div>
          </aside>
        )}
        {!railOpen && (
          <button
            type="button"
            onClick={() => setRailOpen(true)}
            className="absolute bottom-20 left-3 z-20 hidden items-center gap-1 rounded-full border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 sm:flex"
            aria-label="Show pages"
          >
            <ChevronRight className="h-3.5 w-3.5" /> Pages
          </button>
        )}
        <div className="min-w-0 flex-1">
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
      </div>
      <FlingBadge />
    </div>
  );
}
