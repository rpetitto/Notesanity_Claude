import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, CheckCheck, ChevronRight, PanelLeft, Send, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { api, assetUrl, type WorkResponse } from "../lib/api";
import { useNotebookWork } from "../lib/useNotebookWork";
import { parseLayer } from "../lib/ink";
import { useSession } from "../lib/session";
import { useBackTo } from "../lib/useBackTo";
import NotebookSurface, { type LayerMap, type ZoomMode } from "../components/NotebookSurface";
import PageThumb from "../components/PageThumb";
import InkToolbar from "../components/InkToolbar";
import type { ToolState } from "../components/PageCanvas";
import { ErrorNote, Spinner, FlingBadge } from "../components/Shell";
import { Button, Chip, IconButton } from "../components/ui";
import { cn, formatDue, isOverdue } from "../lib/utils";

/** Header controls share one height so a row of them lines up. */
const BUTTON_ROW =
  "inline-flex h-12 items-center gap-2 rounded-full border-[3px] border-pine bg-white px-5 " +
  "font-display text-[17px] font-bold text-pine shadow-[4px_4px_0_0_var(--color-pine)] " +
  "transition-[transform,box-shadow] hover:bg-oat active:translate-x-[3px] active:translate-y-[3px] active:shadow-none";

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
  /**
   * Mirror the server's rule rather than guessing from status: work is frozen
   * from the moment it is handed in and stays frozen after it comes back
   * marked, until a teacher reopens it.
   */
  const locked = Boolean(submission?.locked);
  const marked = Boolean(submission?.returnedAt);
  // Taking work back is only honest while nobody has marked it yet.
  const canUnsubmit = locked && !marked && !submission?.graded;

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

  // Published teacher annotations on the template — read-only for the student.
  const masterLayers = useMemo<LayerMap>(() => {
    const map: LayerMap = {};
    for (const a of (data as any)?.masterAnnotations ?? []) map[a.pageId] = parseLayer(a.data);
    return map;
  }, [data]);

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
        <button onClick={() => navigate(-1)} className="mt-4 text-[16px] font-bold text-pine underline">Go back</button>
      </div>
    );
  }
  if (!data) return null;

  const pageIndex = pages.findIndex((p) => p.id === visiblePage);

  return (
    <div className="flex h-dvh flex-col bg-oat">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b-2 border-pine/12 bg-white px-3 py-2">
        <IconButton label="Back" onClick={goBack}>
          <ArrowLeft className="h-4 w-4" strokeWidth={2.5} />
        </IconButton>
        <button
          type="button"
          onClick={() => setRailOpen((v) => !v)}
          className="hidden h-11 w-11 items-center justify-center rounded-full text-pine hover:bg-pine/8 sm:inline-flex"
          aria-label={railOpen ? "Hide pages" : "Show pages"}
          aria-pressed={railOpen}
        >
          <PanelLeft className="h-4 w-4" strokeWidth={2.5} />
        </button>
        <button
          type="button"
          onClick={() => setMobileRailOpen(true)}
          className={cn(BUTTON_ROW, "sm:hidden")}
          aria-label="Show pages"
        >
          <PanelLeft className="h-4 w-4" strokeWidth={2.5} /> Pages
        </button>
        <div className="min-w-0 flex-1 sm:flex-initial">
          <div className="truncate font-display text-[16px] font-bold text-pine">{data.notebook.title}</div>
          <div className="truncate text-[16px] text-pine/70">
            {assignment ? assignment.title : "Notebook"}
            {pages.length > 0 && ` · Page ${Math.max(1, pageIndex + 1)} of ${pages.length}`}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {assignment && (
            <span className="hidden sm:inline">
              <Chip tone={isOverdue(assignment.dueAt) && !locked ? "warn" : "quiet"}>
                Due {formatDue(assignment.dueAt)}
              </Chip>
            </span>
          )}
          {/* Marked work is finished: show that, don't offer to hand it in again. */}
          {assignment && marked && (
            <Chip tone="mint" icon={<CheckCheck className="h-4 w-4" strokeWidth={2.5} />}>
              Marked and returned
            </Chip>
          )}
          {assignment && !marked && !locked && (
            <Button
              variant="primary"
              onClick={() => {
                if (confirm("Turn in this assignment? These pages lock once you do.")) {
                  submit.mutate();
                }
              }}
              disabled={submit.isPending}
            >
              <Send className="h-4 w-4" strokeWidth={2.5} /> Turn in
            </Button>
          )}
          {assignment && locked && !marked && (
            <>
              <Chip tone="mint" icon={<Check className="h-4 w-4" strokeWidth={2.5} />}>Handed in</Chip>
              {canUnsubmit && (
                <Button variant="secondary" onClick={() => unsubmit.mutate()} disabled={unsubmit.isPending}>
                  <Undo2 className="h-4 w-4" strokeWidth={2.5} /> Take it back
                </Button>
              )}
            </>
          )}
        </div>
      </header>

      {locked && !marked && (
        <div className="flex items-center gap-2 border-b-2 border-[#8a6a1f]/40 bg-[#f7e6bf] px-4 py-2 text-[16px] text-[#5c4611]">
          <Check className="h-4 w-4" strokeWidth={2.5} />
          Handed in{submission?.submittedAt ? ` ${formatDue(submission.submittedAt)}` : ""}
          {canUnsubmit ? " — you can still take it back until it's marked." : " — your teacher is marking it."}
        </div>
      )}
      {marked && (
        <div className="flex items-center gap-2 border-b-2 border-pine/15 bg-mint/25 px-4 py-2 text-[16px] text-pine">
          <CheckCheck className="h-4 w-4" strokeWidth={2.5} />
          This work is marked and back with you. Ask your teacher if you need it reopened.
        </div>
      )}

      {submission?.grade && (
        <div className="border-b-2 border-pine/12 bg-mint/40 px-4 py-2 text-[16px] text-pine">
          <span className="font-display font-bold">Grade: </span>
          {assignment?.grading === "points" && `${submission.grade.points ?? "—"} / ${assignment.pointsMax}`}
          {assignment?.grading === "letter" && (submission.grade.letter ?? "—")}
          {assignment?.grading === "complete" &&
            (submission.grade.complete ? "Complete" : "Incomplete")}
          {submission.grade.feedback && <span className="ml-2 text-pine/80">— {submission.grade.feedback}</span>}
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
            className="absolute inset-0 bg-pine/40"
            onClick={() => setMobileRailOpen(false)}
            aria-hidden
          />
          <aside className="relative flex h-full w-[200px] max-w-[85vw] flex-col overflow-y-auto border-r-2 border-pine/12 bg-white px-2 py-3 shadow-xl">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="label-caps text-pine/70">Pages</span>
              <button
                type="button"
                onClick={() => setMobileRailOpen(false)}
                className="rounded-full p-1.5 text-pine hover:bg-pine/8"
                aria-label="Close pages"
              >
                <ArrowLeft className="h-4 w-4" strokeWidth={2.5} />
              </button>
            </div>
            <div className="flex flex-col gap-3">
              {pages.map((page, i) => (
                <button
                  key={page.id}
                  type="button"
                  onClick={() => goToPage(page.id)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-[12px] border-2 p-1.5 text-left transition-colors",
                    visiblePage === page.id ? "border-pine bg-mint/40" : "border-transparent hover:bg-oat",
                  )}
                >
                  <PageThumb
                    pdfUrl={assetUrl(notebookId, page.asset_key)}
                    sourceIndex={page.source_index}
                    pageWidth={page.width}
                    pageHeight={page.height}
                    width={64}
                  />
                  <span className="w-full truncate text-center text-[16px] text-pine/70">
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
          <aside className="hidden w-[104px] shrink-0 overflow-y-auto border-r-2 border-pine/12 bg-white px-2 py-3 sm:block">
            <div className="flex flex-col gap-3">
              {pages.map((page, i) => (
                <button
                  key={page.id}
                  type="button"
                  onClick={() => goToPage(page.id)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-[12px] border-2 p-1.5 text-left transition-colors",
                    visiblePage === page.id ? "border-pine bg-mint/40" : "border-transparent hover:bg-oat",
                  )}
                >
                  <PageThumb
                    pdfUrl={assetUrl(notebookId, page.asset_key)}
                    sourceIndex={page.source_index}
                    pageWidth={page.width}
                    pageHeight={page.height}
                    width={64}
                  />
                  <span className="w-full truncate text-center text-[16px] text-pine/70">
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
            className="absolute bottom-20 left-3 z-20 hidden items-center gap-1 rounded-full border-[3px] border-pine bg-white px-3 py-2 text-[16px] font-display font-bold text-pine shadow-[3px_3px_0_0_var(--color-pine)] hover:bg-oat sm:flex"
            aria-label="Show pages"
          >
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.5} /> Pages
          </button>
        )}
        <div className="min-w-0 flex-1">
          <NotebookSurface
            notebookId={notebookId}
            pages={pages}
            fields={data.fields}
            studentLayers={work.studentLayers}
            teacherLayers={work.teacherLayers}
          masterLayers={masterLayers}
            fieldValues={work.fieldValues}
            writeTarget={locked ? null : "student"}
            tool={tool}
            fingerDraw={fingerDraw}
            zoom={zoom}
            authorName={user?.name}
            fieldsEditable={!locked}
            onLayerChange={work.setLayer}
            onFieldChange={work.setFieldValue}
          onResponseUploaded={() => workQuery.refetch()}
            onVisiblePageChange={setVisiblePage}
            scrollRef={scrollRef}
          />
        </div>
      </div>
      <FlingBadge />
    </div>
  );
}
