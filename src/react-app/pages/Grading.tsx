/**
 * Teacher grading view with the two navigation axes from the spec:
 *
 *   Horizontal — hold a page still and move across the roster (S1 → S2 → S3).
 *                This is the "grade question 4 for everyone" pass.
 *   Vertical   — hold a student still and move through their pages.
 *
 * Both axes stay inside the assignment's page scope, so unassigned pages are
 * never in the way. Teacher markup is written to a separate layer, which is why
 * annotating never touches what the student drew.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Check, CheckCheck, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ClipboardCheck,
  History, Lock, Mail, MoreVertical, PanelLeft, Pencil, Pin, PinOff, Send, Trash2, Type as TypeIcon,
  Undo2, Unlock, Upload, Users, X,
} from "lucide-react";
import { toast } from "sonner";
import { api, assetUrl, type PageRec, type WorkResponse } from "../lib/api";
import { useNotebookWork } from "../lib/useNotebookWork";
import { parseLayer } from "../lib/ink";
import { useBackTo } from "../lib/useBackTo";
import NotebookSurface, { type LayerMap, type ZoomMode } from "../components/NotebookSurface";
import PageThumb from "../components/PageThumb";
import InkToolbar from "../components/InkToolbar";
import type { ToolState } from "../components/PageCanvas";
import { Avatar, ErrorNote, Spinner } from "../components/Shell";
import { Button, Chip, IconButton, Modal, Textarea } from "../components/ui";
import { cn, formatDue, formatProgress, relativeTime, type ProgressUnit } from "../lib/utils";

/** Header controls share one height so a row of them lines up. */
const BUTTON_ROW =
  "inline-flex h-12 items-center gap-2 rounded-full border-[3px] border-pine bg-white px-5 " +
  "font-display text-[17px] font-bold text-pine shadow-[4px_4px_0_0_var(--color-pine)] " +
  "transition-[transform,box-shadow] hover:bg-oat active:translate-x-[3px] active:translate-y-[3px] active:shadow-none";

const RAIL_KEY = "notesanity:gradeRail";

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

function PageRail({
  pages, pageNumbers, notebookId, pageLocked, activeIndex, activePageId, onSelect,
}: {
  pages: PageRec[];
  pageNumbers?: number[];
  notebookId: string;
  pageLocked: boolean;
  activeIndex: number;
  activePageId: string;
  onSelect: (index: number, pageId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {pages.map((page, i) => {
        const active = pageLocked ? i === activeIndex : page.id === activePageId;
        return (
          <button
            key={page.id}
            type="button"
            onClick={() => onSelect(i, page.id)}
            className={cn(
              "flex flex-col items-center gap-1 rounded-[12px] border-2 p-1.5 text-left transition-colors",
              active ? "border-pine bg-mint/40" : "border-transparent hover:bg-oat",
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
              Page {pageNumbers?.[i] ?? i + 1}
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface GradeRow {
  student: { id: string; name: string; email: string; picture?: string | null };
  status: string;
  submittedAt: string | null;
  returnedAt: string | null;
  complete: number;
  total: number;
  /** What `total` counts — fields when the teacher placed any, else pages. */
  unit?: ProgressUnit;
  grade: { points: number | null; letter: string | null; complete: number | null };
  feedback: string;
  graded: boolean;
}

const LETTERS = ["A", "B", "C", "D", "F"];

/** "Pages 4, 7-9" reads far better than "3 pages" when you're about to grade them. */
export function formatPageNumbers(numbers?: number[]): string {
  if (!numbers?.length) return "No pages";
  const sorted = [...numbers].sort((a, b) => a - b);
  const runs: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const n = sorted[i];
    if (n !== prev + 1) {
      runs.push(start === prev ? `${start}` : `${start}\u2013${prev}`);
      start = n;
    }
    prev = n;
  }
  return `Page${sorted.length === 1 ? "" : "s"} ${runs.join(", ")}`;
}

export default function Grading() {
  const { assignmentId = "" } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const goBack = useBackTo("/assignments");
  const [searchParams, setSearchParams] = useSearchParams();

  const detail = useQuery({
    queryKey: ["assignment", assignmentId],
    queryFn: () => api.get<{ assignment: any; isTeacher: boolean; rows?: GradeRow[] }>(`/api/assignments/${assignmentId}`),
    enabled: !!assignmentId,
  });

  const assignment = detail.data?.assignment;
  const rows = detail.data?.rows ?? [];
  const isTeacher = detail.data?.isTeacher ?? false;

  // Whether there's anything left for "Return all graded" to actually do.
  const anyGraded = rows.some((r) => r.graded);
  const outstanding = rows.some((r) => r.graded && !r.returnedAt);
  const allMarkedAndReturned = anyGraded && rows.every((r) => !r.graded || !!r.returnedAt);

  const [studentIdx, setStudentIdx] = useState(0);
  const [pageIdx, setPageIdx] = useState(0);
  const [pageLocked, setPageLocked] = useState(true);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [zoom, setZoom] = useState<ZoomMode>("page");
  const [tool, setTool] = useState<ToolState>({
    kind: "select", color: "#D93025", width: 2.5, stamp: "✅", fontSize: 14,
  });
  const [fingerDraw, setFingerDraw] = useState(false);

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

  const [railMobileOpen, setRailMobileOpen] = useState(false);
  const [gradeSheetOpen, setGradeSheetOpen] = useState(false);
  useEffect(() => {
    if (!railMobileOpen && !gradeSheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setRailMobileOpen(false); setGradeSheetOpen(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [railMobileOpen, gradeSheetOpen]);

  const [visiblePage, setVisiblePage] = useState<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteImpact, setDeleteImpact] = useState<AssignmentImpact | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [reopenModalOpen, setReopenModalOpen] = useState(false);
  useEffect(() => {
    if (!historyOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setHistoryOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [historyOpen]);

  // Deep-link support: `?student=<id>` opens straight to that row, once.
  const appliedStudentParam = useRef(false);
  useEffect(() => {
    if (appliedStudentParam.current || rows.length === 0) return;
    appliedStudentParam.current = true;
    const sid = searchParams.get("student");
    if (!sid) return;
    const idx = rows.findIndex((r) => r.student.id === sid);
    if (idx >= 0) setStudentIdx(idx);
  }, [rows, searchParams]);

  const current = rows[studentIdx];
  const studentId = current?.student.id;

  // Keep the URL in sync with whichever student is on screen so it's shareable —
  // but only write when it actually differs, to avoid a set/read loop.
  useEffect(() => {
    if (!studentId) return;
    if (searchParams.get("student") === studentId) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("student", studentId);
        return next;
      },
      { replace: true },
    );
  }, [studentId, searchParams, setSearchParams]);

  const deleteMutation = useMutation({
    mutationFn: () => api.del(`/api/assignments/${assignmentId}`),
    onSuccess: () => {
      toast.success("Assignment deleted");
      navigate(`/classes/${assignment.classId}?tab=assignments`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openDeleteModal = async () => {
    setMenuOpen(false);
    setShowDeleteModal(true);
    setImpactLoading(true);
    try {
      const impact = await api.get<AssignmentImpact>(`/api/assignments/${assignmentId}/impact`);
      setDeleteImpact(impact);
    } catch (e) {
      toast.error((e as Error).message);
      setShowDeleteModal(false);
    } finally {
      setImpactLoading(false);
    }
  };

  const work = useQuery({
    queryKey: ["work", assignment?.notebookId, studentId],
    queryFn: () =>
      api.get<WorkResponse>(`/api/notebooks/${assignment.notebookId}/work?student=${encodeURIComponent(studentId!)}`),
    enabled: !!assignment?.notebookId && !!studentId,
  });

  // Warm the next student's pages so horizontal navigation feels instant.
  useEffect(() => {
    const next = rows[studentIdx + 1];
    if (!next || !assignment?.notebookId) return;
    qc.prefetchQuery({
      queryKey: ["work", assignment.notebookId, next.student.id],
      queryFn: () =>
        api.get<WorkResponse>(`/api/notebooks/${assignment.notebookId}/work?student=${encodeURIComponent(next.student.id)}`),
    });
  }, [rows, studentIdx, assignment?.notebookId, qc]);

  const notebookWork = useNotebookWork({
    notebookId: assignment?.notebookId ?? "",
    studentId,
    writeTarget: studentId ? "teacher" : null,
    data: work.data,
  });

  const masterLayers = useMemo<LayerMap>(() => {
    const map: LayerMap = {};
    for (const a of (work.data as any)?.masterAnnotations ?? []) map[a.pageId] = parseLayer(a.data);
    return map;
  }, [work.data]);

  const assignedPages = useMemo(() => {
    const all = work.data?.pages ?? [];
    if (!assignment?.pageIds?.length) return all;
    const allowed = new Set<string>(assignment.pageIds);
    return all.filter((p) => allowed.has(p.id));
  }, [work.data?.pages, assignment]);

  const visiblePages = useMemo(
    () => (pageLocked ? assignedPages.slice(pageIdx, pageIdx + 1) : assignedPages),
    [assignedPages, pageLocked, pageIdx],
  );

  const goStudent = (delta: number) => {
    setStudentIdx((i) => Math.max(0, Math.min(rows.length - 1, i + delta)));
  };
  const goPage = (delta: number) => {
    setPageIdx((i) => Math.max(0, Math.min(Math.max(0, assignedPages.length - 1), i + delta)));
  };

  const goToRailPage = (index: number, pageId: string) => {
    if (pageLocked) {
      setPageIdx(index);
    } else {
      setVisiblePage(pageId);
      scrollRef.current?.querySelector(`[data-page-id="${pageId}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setRailMobileOpen(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); goStudent(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); goStudent(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); goPage(-1); }
      else if (e.key === "ArrowDown") { e.preventDefault(); goPage(1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const grade = useMutation({
    mutationFn: (body: any) => api.post(`/api/assignments/${assignmentId}/grade`, { studentId, ...body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assignment", assignmentId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const returnWork = useMutation({
    mutationFn: (body: { studentId?: string; all?: boolean }) =>
      api.post(`/api/assignments/${assignmentId}/return`, body),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["assignment", assignmentId] });
      toast.success(vars.all ? "Grades returned to the class" : "Returned to student");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reopen = useMutation({
    mutationFn: () => api.post(`/api/assignments/${assignmentId}/reopen`, { studentId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assignment", assignmentId] });
      toast.success("Reopened for the student");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (detail.isLoading) return <Spinner label="Loading assignment…" />;
  if (detail.error) return <div className="p-6"><ErrorNote error={detail.error as Error} /></div>;
  if (!assignment) return null;

  if (rows.length === 0) {
    return (
      <div className="p-6">
        <Link to={`/classes/${assignment.classId}`} className="text-[16px] font-bold text-pine underline">← Back to class</Link>
        <div className="mt-6 rounded-[22px] border-[3px] border-dashed border-pine/40 bg-white p-10 text-center">
          <div className="font-display font-bold text-pine">No students yet</div>
          <p className="mt-1 text-[16px] text-pine/70">Add students to this class and they'll show up here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-oat">
      <header className="flex flex-wrap items-center gap-3 border-b-2 border-pine/12 bg-white px-3 py-2">
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
          onClick={() => setRailMobileOpen(true)}
          className={cn(BUTTON_ROW, "sm:hidden")}
          aria-label="Show pages"
        >
          <PanelLeft className="h-4 w-4" strokeWidth={2.5} /> Pages
        </button>
        <div className="min-w-0 flex-1 sm:flex-initial">
          <div className="truncate font-display text-[16px] font-bold text-pine">{assignment.title}</div>
          <div className="truncate text-[16px] text-pine/70">
            {formatPageNumbers(assignment.pageNumbers)} · Due {formatDue(assignment.dueAt)}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setRosterOpen((v) => !v)}>
            <Users className="h-4 w-4" strokeWidth={2.5} /> Roster
          </Button>
          {outstanding ? (
            <Button variant="primary" onClick={() => returnWork.mutate({ all: true })}>
              <Send className="h-4 w-4" strokeWidth={2.5} /> Return all graded
            </Button>
          ) : allMarkedAndReturned ? (
            <Chip tone="mint" icon={<CheckCheck className="h-3.5 w-3.5" strokeWidth={2.5} />}>
              All marked and returned
            </Chip>
          ) : (
            <Button variant="secondary" disabled>
              <Send className="h-4 w-4" strokeWidth={2.5} /> Nothing to return yet
            </Button>
          )}

          <Button variant="secondary" size="sm" onClick={() => setHistoryOpen(true)}>
            <History className="h-4 w-4" strokeWidth={2.5} /> History
          </Button>

          {isTeacher && (
            <div className="relative">
              <IconButton
                label="Assignment options"
                onClick={() => setMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <MoreVertical className="h-4 w-4" strokeWidth={2.5} />
              </IconButton>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 top-full z-50 mt-1 w-48 overflow-hidden rounded-[12px] border-[3px] border-pine bg-white py-1 shadow-[4px_4px_0_0_var(--color-pine)]">
                    <button
                      onClick={() => { setMenuOpen(false); navigate(`/assignments/${assignmentId}/edit`); }}
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[16px] text-pine hover:bg-oat"
                    >
                      <Pencil className="h-4 w-4" strokeWidth={2.5} /> Edit assignment
                    </button>
                    <button
                      onClick={openDeleteModal}
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[16px] text-[#a3341f] hover:bg-[#a3341f]/8"
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={2.5} /> Delete assignment
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Navigation bar — the two axes */}
      <div className="flex items-center gap-3 overflow-x-auto border-b-2 border-pine/12 bg-oat px-3 py-2">
        <div className="flex shrink-0 items-center gap-1">
          <button onClick={() => setStudentIdx(0)} disabled={studentIdx === 0}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-pine hover:bg-white disabled:opacity-30" title="First student">
            <ChevronsLeft className="h-4 w-4" strokeWidth={2.5} />
          </button>
          <button onClick={() => goStudent(-1)} disabled={studentIdx === 0}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-pine hover:bg-white disabled:opacity-30" title="Previous student (←)">
            <ChevronLeft className="h-4 w-4" strokeWidth={2.5} />
          </button>

          <div className="flex shrink-0 items-center gap-2 rounded-full border-[3px] border-pine bg-white px-3 py-1.5">
            <Avatar name={current?.student.name ?? ""} picture={current?.student.picture} size={24} />
            <div className="min-w-0">
              <div className="max-w-[120px] truncate text-[16px] font-bold text-pine">{current?.student.name}</div>
            </div>
            <span className="ml-1 text-[16px] tabular-nums text-pine/50">{studentIdx + 1}/{rows.length}</span>
          </div>

          <button onClick={() => goStudent(1)} disabled={studentIdx >= rows.length - 1}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-pine hover:bg-white disabled:opacity-30" title="Next student (→)">
            <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
          </button>
          <button onClick={() => setStudentIdx(rows.length - 1)} disabled={studentIdx >= rows.length - 1}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-pine hover:bg-white disabled:opacity-30" title="Last student">
            <ChevronsRight className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => setPageLocked((v) => !v)}
            className={cn(
              "inline-flex min-h-[44px] items-center gap-1.5 rounded-full border-[3px] px-3 py-1.5 text-[16px] font-display font-bold whitespace-nowrap transition-colors",
              pageLocked ? "border-pine bg-mint/40 text-pine" : "border-pine/20 bg-white text-pine/70",
            )}
            title={pageLocked ? "Page is pinned while you move across students" : "Scroll through every assigned page"}
          >
            {pageLocked ? <Pin className="h-3.5 w-3.5" strokeWidth={2.5} /> : <PinOff className="h-3.5 w-3.5" strokeWidth={2.5} />}
            {pageLocked ? "Page pinned" : "All pages"}
          </button>

          {pageLocked && (
            <>
              <button onClick={() => goPage(-1)} disabled={pageIdx === 0}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-pine hover:bg-white disabled:opacity-30" title="Previous page (↑)">
                <ChevronLeft className="h-4 w-4" strokeWidth={2.5} />
              </button>
              <span className="whitespace-nowrap text-[16px] tabular-nums text-pine/70">
                Page {Math.min(pageIdx + 1, assignedPages.length || 1)} of {assignedPages.length || 1}
              </span>
              <button onClick={() => goPage(1)} disabled={pageIdx >= assignedPages.length - 1}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-pine hover:bg-white disabled:opacity-30" title="Next page (↓)">
                <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
              </button>
            </>
          )}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2 text-[16px]">
          <StatusPill row={current} />
        </div>
      </div>

      <div className="overflow-x-auto">
        <InkToolbar
          tool={tool}
          onToolChange={setTool}
          fingerDraw={fingerDraw}
          onFingerDrawChange={setFingerDraw}
          onUndo={() => visiblePages[0] && notebookWork.undo(visiblePages[0].id)}
          onRedo={() => visiblePages[0] && notebookWork.redo(visiblePages[0].id)}
          canUndo={!!visiblePages[0] && notebookWork.canUndo(visiblePages[0].id)}
          canRedo={!!visiblePages[0] && notebookWork.canRedo(visiblePages[0].id)}
          status={notebookWork.status}
          teacherPalette
          allowComments
          zoom={zoom}
          onZoomChange={setZoom}
        />
      </div>

      {/* Mobile page rail drawer */}
      {railMobileOpen && (
        <div className="fixed inset-0 z-40 flex sm:hidden">
          <div className="absolute inset-0 bg-pine/40" onClick={() => setRailMobileOpen(false)} aria-hidden />
          <aside className="relative flex h-full w-[200px] max-w-[85vw] flex-col overflow-y-auto border-r-2 border-pine/12 bg-white px-2 py-3 shadow-xl">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="label-caps text-pine/70">Pages</span>
              <button
                type="button"
                onClick={() => setRailMobileOpen(false)}
                className="rounded-full p-1.5 text-pine hover:bg-pine/8"
                aria-label="Close pages"
              >
                <ArrowLeft className="h-4 w-4" strokeWidth={2.5} />
              </button>
            </div>
            <PageRail
              pages={assignedPages}
              pageNumbers={assignment.pageNumbers}
              notebookId={assignment.notebookId}
              pageLocked={pageLocked}
              activeIndex={pageIdx}
              activePageId={visiblePage}
              onSelect={goToRailPage}
            />
          </aside>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {railOpen && (
          <aside className="hidden w-[104px] shrink-0 overflow-y-auto border-r-2 border-pine/12 bg-white px-2 py-3 sm:block">
            <PageRail
              pages={assignedPages}
              pageNumbers={assignment.pageNumbers}
              notebookId={assignment.notebookId}
              pageLocked={pageLocked}
              activeIndex={pageIdx}
              activePageId={visiblePage}
              onSelect={goToRailPage}
            />
          </aside>
        )}
        {rosterOpen && (
          <aside className="w-64 max-w-[85vw] shrink-0 overflow-y-auto border-r-2 border-pine/12 bg-white">
            {rows.map((r, i) => (
              <button
                key={r.student.id}
                onClick={() => { setStudentIdx(i); setRosterOpen(false); }}
                className={cn(
                  "flex w-full items-center gap-2.5 border-l-[3px] px-3 py-2.5 text-left hover:bg-oat",
                  i === studentIdx ? "border-pine bg-mint/30" : "border-transparent",
                )}
              >
                <Avatar name={r.student.name} picture={r.student.picture} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[16px] font-bold text-pine">{r.student.name}</div>
                  <div className="text-[16px] text-pine/70">
                    {formatProgress(r.complete, r.total, r.unit)} · {r.status.replace("_", " ")}
                  </div>
                </div>
                {r.graded && (
                  <span title="Graded">
                    <Check className="h-4 w-4 text-pine" strokeWidth={2.5} />
                  </span>
                )}
              </button>
            ))}
          </aside>
        )}

        <div className="min-h-0 min-w-0 flex-1">
          {work.isLoading ? (
            <Spinner label="Loading student work…" />
          ) : work.error ? (
            <div className="p-6"><ErrorNote error={work.error as Error} /></div>
          ) : (
            <NotebookSurface
              notebookId={assignment.notebookId}
              pages={visiblePages}
              fields={work.data?.fields ?? []}
              studentLayers={notebookWork.studentLayers}
              studentId={studentId}
              teacherLayers={notebookWork.teacherLayers}
              masterLayers={masterLayers}
              fieldValues={notebookWork.fieldValues}
              writeTarget="teacher"
              tool={tool}
              fingerDraw={fingerDraw}
              zoom={zoom}
              fieldsEditable={false}
              onLayerChange={notebookWork.setLayer}
              onFieldChange={() => {}}
              onVisiblePageChange={setVisiblePage}
              scrollRef={scrollRef}
            />
          )}
        </div>

        <GradePanel
          assignment={assignment}
          row={current}
          onSave={(body) => grade.mutate(body)}
          onReturn={() => returnWork.mutate({ studentId })}
          onReopen={() => setReopenModalOpen(true)}
          saving={grade.isPending}
          mobileOpen={gradeSheetOpen}
          onMobileClose={() => setGradeSheetOpen(false)}
        />
      </div>

      {/* Sticky grade trigger for phones — the grade panel only lives in a
          bottom sheet below lg:, so grading needs an always-reachable entry point. */}
      <button
        type="button"
        onClick={() => setGradeSheetOpen(true)}
        className="fixed bottom-4 right-4 z-30 inline-flex min-h-[52px] items-center gap-2 rounded-full border-[3px] border-pine bg-pine px-5 font-display text-[16px] font-bold text-oat shadow-[4px_4px_0_0_var(--color-pine)] lg:hidden"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      >
        <ClipboardCheck className="h-4 w-4" strokeWidth={2.5} /> Grade
        {current?.graded && <Check className="h-4 w-4 text-mint" strokeWidth={2.5} />}
      </button>

      {showDeleteModal && (
        <DeleteAssignmentModal
          impact={deleteImpact}
          loading={impactLoading}
          deleting={deleteMutation.isPending}
          onCancel={() => setShowDeleteModal(false)}
          onConfirm={() => deleteMutation.mutate()}
        />
      )}

      {reopenModalOpen && current && (
        <Modal onClose={() => setReopenModalOpen(false)}>
          <div className="flex items-start justify-between">
            <h3 className="text-[17px] text-pine">Reopen for {current.student.name}?</h3>
            <button
              onClick={() => setReopenModalOpen(false)}
              className="rounded-full p-1 text-pine/50 hover:bg-pine/8"
              aria-label="Close"
            >
              <X className="h-4 w-4" strokeWidth={2.5} />
            </button>
          </div>
          <p className="mt-3 text-[16px] leading-relaxed text-pine/80">
            This lets {current.student.name} change their work again. The change will be recorded in the history.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setReopenModalOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={reopen.isPending}
              onClick={() => { reopen.mutate(undefined, { onSuccess: () => setReopenModalOpen(false) }); }}
            >
              <Unlock className="h-4 w-4" strokeWidth={2.5} /> Reopen
            </Button>
          </div>
        </Modal>
      )}

      {historyOpen && (
        <HistoryDrawer
          assignmentId={assignmentId}
          studentId={studentId}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </div>
  );
}

const ACTIVITY_ICON: Record<string, typeof Pencil> = {
  edit: Pencil,
  annotate: Pencil,
  answer: TypeIcon,
  upload: Upload,
  submit: Send,
  unsubmit: Undo2,
  grade: CheckCheck,
  return: Mail,
  reopen: Unlock,
};

interface ActivityEvent {
  id: string;
  action: string;
  detail: string;
  at: string;
  pageId: string | null;
  actor: string;
  actorRole: string;
}

/** Right-hand drawer showing one student's full activity history for this assignment. */
function HistoryDrawer({
  assignmentId, studentId, onClose,
}: {
  assignmentId: string;
  studentId?: string;
  onClose: () => void;
}) {
  const activity = useQuery({
    queryKey: ["activity", assignmentId, studentId],
    queryFn: () =>
      api.get<{ events: ActivityEvent[] }>(
        `/api/activity?assignment=${encodeURIComponent(assignmentId)}&student=${encodeURIComponent(studentId!)}`,
      ),
    enabled: !!assignmentId && !!studentId,
  });
  const events = activity.data?.events ?? [];

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-pine/40" onClick={onClose} aria-hidden />
      <aside className="relative flex h-full w-full max-w-sm flex-col border-l-2 border-pine/12 bg-white shadow-xl">
        <div className="flex items-start justify-between border-b-2 border-pine/12 px-4 py-3">
          <div>
            <h3 className="font-display text-[16px] font-bold text-pine">History</h3>
            <p className="mt-0.5 text-[16px] leading-relaxed text-pine/70">
              Everything that's happened to this work. Students see the same list.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-pine/50 hover:bg-pine/8"
            aria-label="Close history"
          >
            <X className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {activity.isLoading ? (
            <Spinner label="Loading history…" />
          ) : events.length === 0 ? (
            <p className="py-8 text-center text-[16px] text-pine/60">Nothing recorded yet.</p>
          ) : (
            <ul className="space-y-3">
              {events.map((ev) => {
                const Icon = ACTIVITY_ICON[ev.action] ?? Pencil;
                return (
                  <li key={ev.id} className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-pine/20 text-pine">
                      <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[16px] leading-snug text-pine">{ev.detail}</p>
                      <p className="mt-0.5 text-[16px] text-pine/60">
                        {ev.actor} · <span title={ev.at}>{relativeTime(ev.at)}</span>
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}

function StatusPill({ row }: { row?: GradeRow }) {
  if (!row) return null;
  const tone: Record<string, "quiet" | "warn" | "default" | "mint"> = {
    not_started: "quiet",
    in_progress: "warn",
    submitted: "default",
    returned: "mint",
  };
  return (
    <Chip
      tone={tone[row.status] ?? "quiet"}
      icon={row.status === "returned" ? <Check className="h-3 w-3" strokeWidth={2.5} /> : undefined}
    >
      {row.status.replace("_", " ")}
      {row.submittedAt && ` · ${relativeTime(row.submittedAt)}`}
      {" · "}
      {formatProgress(row.complete, row.total, row.unit)}
    </Chip>
  );
}

function GradePanel({
  assignment, row, onSave, onReturn, onReopen, saving, mobileOpen, onMobileClose,
}: {
  assignment: any;
  row?: GradeRow;
  onSave: (body: any) => void;
  onReturn: () => void;
  onReopen: () => void;
  saving: boolean;
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  const [points, setPoints] = useState<string>("");
  const [letter, setLetter] = useState<string>("");
  const [complete, setComplete] = useState<boolean | null>(null);
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    setPoints(row?.grade.points === null || row?.grade.points === undefined ? "" : String(row.grade.points));
    setLetter(row?.grade.letter ?? "");
    setComplete(row?.grade.complete === null || row?.grade.complete === undefined ? null : !!row.grade.complete);
    setFeedback(row?.feedback ?? "");
  }, [row?.student.id, row?.grade.points, row?.grade.letter, row?.grade.complete, row?.feedback]);

  if (!row) return null;

  const submit = () =>
    onSave({
      points: assignment.grading === "points" ? (points === "" ? null : Number(points)) : null,
      letter: assignment.grading === "letter" ? letter || null : null,
      complete: assignment.grading === "complete" ? complete : null,
      feedback,
    });

  const fields = (
    <>
      {assignment.grading === "points" && (
        <div className="mt-4">
          <label className="label-caps block text-pine/70">Points</label>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="number"
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              min={0}
              max={assignment.pointsMax}
              className="w-20 rounded-[12px] border-[3px] border-pine px-2 py-1.5 text-[16px] outline-none focus:ring-[3px] focus:ring-mint"
            />
            <span className="text-[16px] text-pine/70">/ {assignment.pointsMax}</span>
          </div>
        </div>
      )}

      {assignment.grading === "letter" && (
        <div className="mt-4">
          <label className="label-caps block text-pine/70">Letter</label>
          <div className="mt-1 flex gap-1">
            {LETTERS.map((l) => (
              <button
                key={l}
                onClick={() => setLetter(l)}
                className={cn(
                  "h-10 flex-1 rounded-[12px] border-[3px] text-[16px] font-bold",
                  letter === l ? "border-pine bg-mint text-pine" : "border-pine/20 text-pine/70 hover:bg-oat",
                )}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      )}

      {assignment.grading === "complete" && (
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => setComplete(true)}
            className={cn("h-10 flex-1 rounded-[12px] border-[3px] text-[16px] font-bold",
              complete === true ? "border-pine bg-mint text-pine" : "border-pine/20 text-pine/70 hover:bg-oat")}
          >
            Complete
          </button>
          <button
            onClick={() => setComplete(false)}
            className={cn("h-10 flex-1 rounded-[12px] border-[3px] text-[16px] font-bold",
              complete === false ? "border-[#a3341f] bg-[#a3341f]/10 text-[#a3341f]" : "border-pine/20 text-pine/70 hover:bg-oat")}
          >
            Incomplete
          </button>
        </div>
      )}

      <label className="label-caps mt-4 block text-pine/70">Comment</label>
      <Textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        rows={4}
        placeholder="Nice work on question 3…"
        className="mt-1 text-[16px]"
      />

      <Button variant="secondary" onClick={submit} disabled={saving} className="mt-3 w-full">
        Save grade
      </Button>
      <Button variant="primary" onClick={() => { submit(); onReturn(); }} className="mt-2 w-full">
        <Send className="h-4 w-4" strokeWidth={2.5} /> Save &amp; return
      </Button>

      {row.returnedAt && (
        <p className="mt-3 flex items-center gap-1.5 text-[16px] text-pine/70">
          <Lock className="h-3 w-3" strokeWidth={2.5} /> Returned {relativeTime(row.returnedAt)}
        </p>
      )}

      {row.submittedAt && (
        <Button variant="secondary" onClick={onReopen} className="mt-3 w-full">
          <Unlock className="h-4 w-4" strokeWidth={2.5} /> Reopen for student
        </Button>
      )}
    </>
  );

  return (
    <>
      <aside className="hidden w-64 shrink-0 flex-col border-l-2 border-pine/12 bg-white p-4 lg:flex">
        <h3 className="font-display text-[16px] font-bold text-pine">Grade</h3>
        <p className="mt-0.5 text-[16px] text-pine/70">Saved privately until you return it.</p>
        {fields}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex items-end lg:hidden">
          <div className="absolute inset-0 bg-pine/40" onClick={onMobileClose} aria-hidden />
          <div
            className="relative flex max-h-[80vh] w-full flex-col overflow-y-auto rounded-t-[22px] border-[3px] border-pine bg-white p-4 shadow-xl"
            style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-display text-[16px] font-bold text-pine">Grade — {row.student.name}</h3>
                <p className="mt-0.5 text-[16px] text-pine/70">Saved privately until you return it.</p>
              </div>
              <button
                onClick={onMobileClose}
                className="rounded-full p-1.5 text-pine/50 hover:bg-pine/8"
                aria-label="Close grade panel"
              >
                <X className="h-4 w-4" strokeWidth={2.5} />
              </button>
            </div>
            {fields}
          </div>
        </div>
      )}
    </>
  );
}
