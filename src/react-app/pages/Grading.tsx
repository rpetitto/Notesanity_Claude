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

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Lock, Pin, PinOff, Send, Users,
} from "lucide-react";
import { toast } from "sonner";
import { api, type WorkResponse } from "../lib/api";
import { useNotebookWork } from "../lib/useNotebookWork";
import { useBackTo } from "../lib/useBackTo";
import NotebookSurface, { type ZoomMode } from "../components/NotebookSurface";
import InkToolbar from "../components/InkToolbar";
import type { ToolState } from "../components/PageCanvas";
import { Avatar, ErrorNote, Spinner } from "../components/Shell";
import { cn, formatDue, relativeTime } from "../lib/utils";

interface GradeRow {
  student: { id: string; name: string; email: string; picture?: string | null };
  status: string;
  submittedAt: string | null;
  returnedAt: string | null;
  complete: number;
  total: number;
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
  const goBack = useBackTo("/assignments");

  const detail = useQuery({
    queryKey: ["assignment", assignmentId],
    queryFn: () => api.get<{ assignment: any; isTeacher: boolean; rows?: GradeRow[] }>(`/api/assignments/${assignmentId}`),
    enabled: !!assignmentId,
  });

  const assignment = detail.data?.assignment;
  const rows = detail.data?.rows ?? [];

  const [studentIdx, setStudentIdx] = useState(0);
  const [pageIdx, setPageIdx] = useState(0);
  const [pageLocked, setPageLocked] = useState(true);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [zoom, setZoom] = useState<ZoomMode>("page");
  const [tool, setTool] = useState<ToolState>({
    kind: "pen", color: "#D93025", width: 2.5, stamp: "✅", fontSize: 14,
  });
  const [fingerDraw, setFingerDraw] = useState(false);

  const current = rows[studentIdx];
  const studentId = current?.student.id;

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

  if (detail.isLoading) return <Spinner label="Loading assignment…" />;
  if (detail.error) return <div className="p-6"><ErrorNote error={detail.error as Error} /></div>;
  if (!assignment) return null;

  if (rows.length === 0) {
    return (
      <div className="p-6">
        <Link to={`/classes/${assignment.classId}`} className="text-sm text-blue-600 hover:underline">← Back to class</Link>
        <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <div className="font-medium">No students yet</div>
          <p className="mt-1 text-sm text-slate-500">Add students to this class and they'll show up here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-3 py-2">
        <button type="button" onClick={goBack} className="rounded-full p-2 text-slate-500 hover:bg-slate-100" aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{assignment.title}</div>
          <div className="truncate text-xs text-slate-500">
            {formatPageNumbers(assignment.pageNumbers)} · Due {formatDue(assignment.dueAt)}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setRosterOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            <Users className="h-4 w-4" /> Roster
          </button>
          <button
            onClick={() => returnWork.mutate({ all: true })}
            className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Send className="h-4 w-4" /> Return all graded
          </button>
        </div>
      </header>

      {/* Navigation bar — the two axes */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div className="flex items-center gap-1">
          <button onClick={() => setStudentIdx(0)} disabled={studentIdx === 0}
            className="rounded-full p-1.5 text-slate-500 hover:bg-white disabled:opacity-30" title="First student">
            <ChevronsLeft className="h-4 w-4" />
          </button>
          <button onClick={() => goStudent(-1)} disabled={studentIdx === 0}
            className="rounded-full p-1.5 text-slate-500 hover:bg-white disabled:opacity-30" title="Previous student (←)">
            <ChevronLeft className="h-4 w-4" />
          </button>

          <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5">
            <Avatar name={current?.student.name ?? ""} picture={current?.student.picture} size={24} />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{current?.student.name}</div>
            </div>
            <span className="ml-1 text-xs tabular-nums text-slate-400">{studentIdx + 1}/{rows.length}</span>
          </div>

          <button onClick={() => goStudent(1)} disabled={studentIdx >= rows.length - 1}
            className="rounded-full p-1.5 text-slate-500 hover:bg-white disabled:opacity-30" title="Next student (→)">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button onClick={() => setStudentIdx(rows.length - 1)} disabled={studentIdx >= rows.length - 1}
            className="rounded-full p-1.5 text-slate-500 hover:bg-white disabled:opacity-30" title="Last student">
            <ChevronsRight className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setPageLocked((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors",
              pageLocked ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600",
            )}
            title={pageLocked ? "Page is pinned while you move across students" : "Scroll through every assigned page"}
          >
            {pageLocked ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
            {pageLocked ? "Page pinned" : "All pages"}
          </button>

          {pageLocked && (
            <>
              <button onClick={() => goPage(-1)} disabled={pageIdx === 0}
                className="rounded-full p-1.5 text-slate-500 hover:bg-white disabled:opacity-30" title="Previous page (↑)">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs tabular-nums text-slate-600">
                Page {Math.min(pageIdx + 1, assignedPages.length || 1)} of {assignedPages.length || 1}
              </span>
              <button onClick={() => goPage(1)} disabled={pageIdx >= assignedPages.length - 1}
                className="rounded-full p-1.5 text-slate-500 hover:bg-white disabled:opacity-30" title="Next page (↓)">
                <ChevronRight className="h-4 w-4" />
              </button>
            </>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2 text-xs">
          <StatusPill row={current} />
        </div>
      </div>

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

      <div className="flex min-h-0 flex-1">
        {rosterOpen && (
          <aside className="w-64 shrink-0 overflow-y-auto border-r border-slate-200 bg-white">
            {rows.map((r, i) => (
              <button
                key={r.student.id}
                onClick={() => { setStudentIdx(i); setRosterOpen(false); }}
                className={cn(
                  "flex w-full items-center gap-2.5 border-l-2 px-3 py-2.5 text-left hover:bg-slate-50",
                  i === studentIdx ? "border-blue-600 bg-blue-50" : "border-transparent",
                )}
              >
                <Avatar name={r.student.name} picture={r.student.picture} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.student.name}</div>
                  <div className="text-[11px] text-slate-500">
                    {r.complete}/{r.total} pages · {r.status.replace("_", " ")}
                  </div>
                </div>
                {r.graded && <span className="h-2 w-2 rounded-full bg-emerald-500" title="Graded" />}
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
              teacherLayers={notebookWork.teacherLayers}
              fieldValues={notebookWork.fieldValues}
              writeTarget="teacher"
              tool={tool}
              fingerDraw={fingerDraw}
              zoom={zoom}
              fieldsEditable={false}
              onLayerChange={notebookWork.setLayer}
              onFieldChange={() => {}}
            />
          )}
        </div>

        <GradePanel
          assignment={assignment}
          row={current}
          onSave={(body) => grade.mutate(body)}
          onReturn={() => returnWork.mutate({ studentId })}
          saving={grade.isPending}
        />
      </div>
    </div>
  );
}

function StatusPill({ row }: { row?: GradeRow }) {
  if (!row) return null;
  const map: Record<string, string> = {
    not_started: "bg-slate-100 text-slate-600",
    in_progress: "bg-amber-50 text-amber-700",
    submitted: "bg-blue-50 text-blue-700",
    returned: "bg-emerald-50 text-emerald-700",
  };
  return (
    <span className={cn("rounded-full px-2.5 py-1", map[row.status] ?? map.not_started)}>
      {row.status.replace("_", " ")}
      {row.submittedAt && ` · ${relativeTime(row.submittedAt)}`}
      {" · "}
      {row.complete}/{row.total} pages
    </span>
  );
}

function GradePanel({
  assignment, row, onSave, onReturn, saving,
}: {
  assignment: any;
  row?: GradeRow;
  onSave: (body: any) => void;
  onReturn: () => void;
  saving: boolean;
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

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-l border-slate-200 bg-white p-4 lg:flex">
      <h3 className="text-sm font-semibold">Grade</h3>
      <p className="mt-0.5 text-xs text-slate-500">Saved privately until you return it.</p>

      {assignment.grading === "points" && (
        <div className="mt-4">
          <label className="block text-xs font-medium text-slate-600">Points</label>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="number"
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              min={0}
              max={assignment.pointsMax}
              className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
            />
            <span className="text-sm text-slate-500">/ {assignment.pointsMax}</span>
          </div>
        </div>
      )}

      {assignment.grading === "letter" && (
        <div className="mt-4">
          <label className="block text-xs font-medium text-slate-600">Letter</label>
          <div className="mt-1 flex gap-1">
            {LETTERS.map((l) => (
              <button
                key={l}
                onClick={() => setLetter(l)}
                className={cn(
                  "h-9 flex-1 rounded-lg border text-sm",
                  letter === l ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 hover:bg-slate-50",
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
            className={cn("h-9 flex-1 rounded-lg border text-sm",
              complete === true ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 hover:bg-slate-50")}
          >
            Complete
          </button>
          <button
            onClick={() => setComplete(false)}
            className={cn("h-9 flex-1 rounded-lg border text-sm",
              complete === false ? "border-rose-400 bg-rose-50 text-rose-700" : "border-slate-200 hover:bg-slate-50")}
          >
            Incomplete
          </button>
        </div>
      )}

      <label className="mt-4 block text-xs font-medium text-slate-600">Comment</label>
      <textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        rows={4}
        placeholder="Nice work on question 3…"
        className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
      />

      <button
        onClick={submit}
        disabled={saving}
        className="mt-3 rounded-full bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        Save grade
      </button>
      <button
        onClick={() => { submit(); onReturn(); }}
        className="mt-2 inline-flex items-center justify-center gap-1.5 rounded-full border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-700 hover:bg-blue-100"
      >
        <Send className="h-4 w-4" /> Save &amp; return
      </button>

      {row.returnedAt && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-emerald-700">
          <Lock className="h-3 w-3" /> Returned {relativeTime(row.returnedAt)}
        </p>
      )}
    </aside>
  );
}
