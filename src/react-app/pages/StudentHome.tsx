import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { KeyRound, X } from "lucide-react";
import { toast } from "sonner";
import Shell, { EmptyState, ErrorNote, Spinner } from "../components/Shell";
import { api, type ClassSummary } from "../lib/api";
import { cn, formatDue, isOverdue } from "../lib/utils";

/** `GET /api/classes` rows also carry `emoji` — declared locally since `ClassSummary`
 * (shared with other owners' code) doesn't yet. There's no `hasCover` flag on this
 * endpoint, so cards probe the cover image directly and fall back on error. */
interface ClassRow extends ClassSummary {
  emoji?: string;
}

interface MyAssignment {
  id: string;
  title: string;
  classId: string;
  className: string;
  accentColor: string;
  notebookId: string;
  notebookTitle: string;
  dueAt: string | null;
  grading: "none" | "complete" | "points" | "letter";
  pointsMax: number;
  total: number;
  complete: number;
  status: "not_started" | "in_progress" | "submitted" | "returned";
  grade: { points: number | null; letter: string | null; complete: number | null } | null;
}

interface MyNotebook {
  id: string;
  title: string;
  page_count: number;
  updated_at: string;
  class_id: string;
  class_name: string;
  accent_color: string;
}

const STATUS_LABEL: Record<MyAssignment["status"], string> = {
  not_started: "Not started",
  in_progress: "In progress",
  submitted: "Submitted",
  returned: "Returned",
};

const STATUS_CLASS: Record<MyAssignment["status"], string> = {
  not_started: "bg-slate-100 text-slate-600",
  in_progress: "bg-blue-50 text-blue-700",
  submitted: "bg-amber-50 text-amber-700",
  returned: "bg-emerald-50 text-emerald-700",
};

function gradeLabel(a: MyAssignment): string | null {
  if (!a.grade) return null;
  if (a.grading === "points") return a.grade.points === null ? null : `${a.grade.points}/${a.pointsMax}`;
  if (a.grading === "letter") return a.grade.letter ?? null;
  if (a.grading === "complete") return a.grade.complete === null ? null : a.grade.complete ? "Complete" : "Incomplete";
  return null;
}

function ClassCard({ cls }: { cls: ClassRow }) {
  const [coverFailed, setCoverFailed] = useState(false);
  const accent = cls.accent_color || "#1A73E8";
  return (
    <Link
      to={`/classes/${cls.id}`}
      className="block overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="relative h-20 w-full overflow-hidden">
        <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${accent}, ${accent}99)` }} />
        {!coverFailed && (
          <img
            src={`/api/classes/${cls.id}/cover`}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            onError={() => setCoverFailed(true)}
          />
        )}
      </div>
      <div className="p-4">
        <div className="flex items-center gap-2.5">
          {cls.emoji && (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-base">
              {cls.emoji}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-slate-900">{cls.name}</div>
            <div className="truncate text-xs text-slate-500">{cls.section || " "}</div>
          </div>
        </div>
        <div className="mt-3 text-xs text-slate-500">
          {cls.notebook_count} notebook{cls.notebook_count === 1 ? "" : "s"}
        </div>
      </div>
    </Link>
  );
}

function AssignmentRow({ a }: { a: MyAssignment }) {
  const navigate = useNavigate();
  const submitted = a.status === "submitted" || a.status === "returned";
  const overdue = isOverdue(a.dueAt) && !submitted;
  const grade = gradeLabel(a);

  return (
    <button
      type="button"
      onClick={() => navigate(`/notebooks/${a.notebookId}?assignment=${a.id}`)}
      className="flex w-full items-center gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-left shadow-sm transition-shadow hover:shadow-md"
    >
      <span className="mt-0.5 h-9 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: a.accentColor || "#1A73E8" }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-900">{a.title}</span>
        <span className="block truncate text-xs text-slate-500">
          {a.className} &middot; {a.notebookTitle}
        </span>
      </span>
      <span className="hidden shrink-0 text-xs text-slate-500 sm:block">
        {a.complete}/{a.total} pages
      </span>
      <span className={cn("shrink-0 text-xs", overdue ? "font-medium text-rose-600" : "text-slate-500")}>
        {formatDue(a.dueAt)}
      </span>
      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_CLASS[a.status])}>
        {STATUS_LABEL[a.status]}
      </span>
      {grade && (
        <span className="shrink-0 rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-medium text-white">{grade}</span>
      )}
    </button>
  );
}

function JoinClassModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [code, setCode] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const mutation = useMutation({
    mutationFn: () => api.post<{ class: { id: string; name: string } }>("/api/classes/join", { code }),
    onSuccess: async (res) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["my-assignments"] }),
        qc.invalidateQueries({ queryKey: ["my-notebooks"] }),
        qc.invalidateQueries({ queryKey: ["classes"] }),
      ]);
      toast.success(`Joined ${res.class.name}`);
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-2xl bg-white p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Join a class</h2>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (code.length !== 6) return;
            mutation.mutate();
          }}
        >
          <label className="mb-1 block text-xs font-medium text-slate-600">Class code</label>
          <input
            autoFocus
            value={code}
            maxLength={6}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            placeholder="ABC123"
            className="h-14 w-full rounded-lg border border-slate-300 text-center font-mono text-2xl tracking-[0.5em] focus:border-blue-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={code.length !== 6 || mutation.isPending}
            className="mt-4 h-11 w-full rounded-full bg-blue-600 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {mutation.isPending ? "Joining…" : "Join class"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function StudentHome() {
  const classesQ = useQuery({
    queryKey: ["classes"],
    queryFn: () => api.get<{ classes: ClassRow[] }>("/api/classes"),
  });
  const assignmentsQ = useQuery({
    queryKey: ["my-assignments"],
    queryFn: () => api.get<{ assignments: MyAssignment[] }>("/api/my/assignments"),
  });
  const notebooksQ = useQuery({
    queryKey: ["my-notebooks"],
    queryFn: () => api.get<{ notebooks: MyNotebook[] }>("/api/my/notebooks"),
  });
  const [joinOpen, setJoinOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <Shell>
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">My work</h1>
        <button
          type="button"
          onClick={() => setJoinOpen(true)}
          className="flex h-11 items-center gap-1.5 rounded-full bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700"
        >
          <KeyRound className="h-4 w-4" />
          Join a class
        </button>
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">My classes</h2>
        {classesQ.isLoading && <Spinner />}
        {classesQ.error && <ErrorNote error={classesQ.error as Error} />}
        {!classesQ.isLoading && !classesQ.error && classesQ.data && classesQ.data.classes.length === 0 && (
          <EmptyState
            title="You haven't joined a class yet"
            body="Ask your teacher for a class code, then use Join a class above to get started."
            action={
              <button
                type="button"
                onClick={() => setJoinOpen(true)}
                className="flex h-11 items-center gap-1.5 rounded-full bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700"
              >
                <KeyRound className="h-4 w-4" />
                Join a class
              </button>
            }
          />
        )}
        {!classesQ.isLoading && !classesQ.error && classesQ.data && classesQ.data.classes.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {classesQ.data.classes.map((cls) => (
              <ClassCard key={cls.id} cls={cls} />
            ))}
          </div>
        )}
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Assignments</h2>
        {assignmentsQ.isLoading && <Spinner />}
        {assignmentsQ.error && <ErrorNote error={assignmentsQ.error as Error} />}
        {!assignmentsQ.isLoading && !assignmentsQ.error && assignmentsQ.data && assignmentsQ.data.assignments.length === 0 && (
          <EmptyState title="No assignments yet" body="Join a class to see assignments here." />
        )}
        {!assignmentsQ.isLoading && !assignmentsQ.error && assignmentsQ.data && assignmentsQ.data.assignments.length > 0 && (
          <div className="space-y-2">
            {assignmentsQ.data.assignments.map((a) => (
              <AssignmentRow key={a.id} a={a} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">My notebooks</h2>
        {notebooksQ.isLoading && <Spinner />}
        {notebooksQ.error && <ErrorNote error={notebooksQ.error as Error} />}
        {!notebooksQ.isLoading && !notebooksQ.error && notebooksQ.data && notebooksQ.data.notebooks.length === 0 && (
          <EmptyState title="No notebooks yet" body="Notebooks your teachers publish will show up here." />
        )}
        {!notebooksQ.isLoading && !notebooksQ.error && notebooksQ.data && notebooksQ.data.notebooks.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {notebooksQ.data.notebooks.map((nb) => (
              <button
                key={nb.id}
                type="button"
                onClick={() => navigate(`/notebooks/${nb.id}`)}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="h-1.5 w-full" style={{ backgroundColor: nb.accent_color || "#1A73E8" }} />
                <div className="p-4">
                  <div className="truncate text-sm font-semibold text-slate-900">{nb.title}</div>
                  <div className="truncate text-xs text-slate-500">{nb.class_name}</div>
                  <div className="mt-3 text-xs text-slate-500">{nb.page_count} pages</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {joinOpen && <JoinClassModal onClose={() => setJoinOpen(false)} />}
    </Shell>
  );
}
