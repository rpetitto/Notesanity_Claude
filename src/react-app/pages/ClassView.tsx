import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Copy, Plus, RefreshCw, Upload, UserX, X } from "lucide-react";
import { toast } from "sonner";
import Shell, { Avatar, EmptyState, ErrorNote, Spinner } from "../components/Shell";
import { AssignmentCard } from "./TeacherAssignments";
import { api, type AssignmentSummary } from "../lib/api";
import { cn, formatDue, isOverdue, relativeTime } from "../lib/utils";

interface ClassDetail {
  id: string;
  name: string;
  section: string;
  accent_color: string;
  source: "manual" | "classroom";
  join_code: string;
  joinCode?: string;
  archived: number;
  created_at: string;
  updated_at: string;
}

interface RosterRow {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  role: "teacher" | "student";
  status: string;
  backfill_pending: number;
  joined_at: string;
}

interface ClassNotebook {
  id: string;
  title: string;
  status: "draft" | "published";
  page_count: number;
  updated_at: string;
}

interface ClassResponse {
  class: ClassDetail;
  myRole: "teacher" | "student";
  roster: RosterRow[];
  notebooks: ClassNotebook[];
  me: { id: string };
}

interface BackfillStudent {
  id: string;
  name: string;
  email: string;
  picture: string | null;
  joined_at: string;
}

interface BackfillAssignment {
  id: string;
  title: string;
  due_at: string | null;
  grading: "none" | "complete" | "points" | "letter";
  points_max: number;
}

interface BackfillResponse {
  students: BackfillStudent[];
  assignments: BackfillAssignment[];
}

type Tab = "notebooks" | "assignments" | "roster";

function useEscapeClose(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

function BackfillModal({
  classId,
  student,
  assignments,
  onClose,
}: {
  classId: string;
  student: BackfillStudent;
  assignments: BackfillAssignment[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [checked, setChecked] = useState<Set<string>>(new Set(assignments.map((a) => a.id)));
  useEscapeClose(onClose);

  const mutation = useMutation({
    mutationFn: () =>
      api.post("/api/classes/" + classId + "/backfill", {
        studentId: student.id,
        assignmentIds: Array.from(checked),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["backfill", classId] });
      toast.success(`Updated assignments for ${student.name}`);
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4" onClick={onClose}>
      <div className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Backfill assignments</h2>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-4 text-sm text-slate-500">
          Choose which assignments <span className="font-medium text-slate-700">{student.name}</span> should be held to.
        </p>

        {assignments.length === 0 && <p className="py-4 text-sm text-slate-500">No active assignments in this class.</p>}
        {assignments.length > 0 && (
          <ul className="space-y-2">
            {assignments.map((a) => (
              <li key={a.id}>
                <label className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-sm hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={checked.has(a.id)}
                    onChange={() => toggle(a.id)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="flex-1">
                    <span className="block font-medium text-slate-800">{a.title}</span>
                    <span className="block text-xs text-slate-500">{formatDue(a.due_at)}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
          className="mt-5 h-10 w-full rounded-full bg-blue-600 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {mutation.isPending ? "Saving…" : "Confirm"}
        </button>
      </div>
    </div>
  );
}

function InviteModal({ classId, onClose }: { classId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  useEscapeClose(onClose);

  const mutation = useMutation({
    mutationFn: () => {
      const emails = text.split(/[,\n]/).map((e) => e.trim()).filter(Boolean);
      return api.post<{ added: number }>("/api/classes/" + classId + "/invite", { emails });
    },
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ["class", classId] });
      toast.success(`Invited ${res.added} student${res.added === 1 ? "" : "s"}`);
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Invite by email</h2>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Emails (comma or newline separated)</label>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder="ada@school.edu, grace@school.edu"
          className="w-full rounded-lg border border-slate-300 p-3 text-sm focus:border-blue-500 focus:outline-none"
        />
        <button
          type="button"
          disabled={!text.trim() || mutation.isPending}
          onClick={() => mutation.mutate()}
          className="mt-4 h-10 w-full rounded-full bg-blue-600 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {mutation.isPending ? "Inviting…" : "Send invites"}
        </button>
      </div>
    </div>
  );
}

export default function ClassView() {
  const { classId } = useParams<{ classId: string }>();
  const id = classId ?? "";
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [tab, setTabState] = useState<Tab>(
    tabParam === "assignments" || tabParam === "roster" ? tabParam : "notebooks",
  );
  const setTab = (t: Tab) => {
    setTabState(t);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", t);
        return next;
      },
      { replace: true },
    );
  };
  const [inviteOpen, setInviteOpen] = useState(false);
  const [reviewingStudent, setReviewingStudent] = useState<BackfillStudent | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const classQ = useQuery({
    queryKey: ["class", id],
    queryFn: () => api.get<ClassResponse>(`/api/classes/${id}`),
    enabled: !!id,
  });

  const isTeacher = classQ.data?.myRole === "teacher";

  const assignmentsQ = useQuery({
    queryKey: ["assignments", id],
    queryFn: () => api.get<{ assignments: AssignmentSummary[]; isTeacher: boolean }>(`/api/classes/${id}/assignments`),
    enabled: !!id && tab === "assignments",
  });

  const backfillQ = useQuery({
    queryKey: ["backfill", id],
    queryFn: () => api.get<BackfillResponse>(`/api/classes/${id}/backfill`),
    enabled: !!id && isTeacher,
  });

  const rotateCodeMutation = useMutation({
    mutationFn: () => api.post<{ joinCode: string }>(`/api/classes/${id}/rotate-code`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["class", id] });
      toast.success("New join code generated");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const removeStudentMutation = useMutation({
    mutationFn: (userId: string) => api.del(`/api/classes/${id}/students/${userId}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["class", id] });
      toast.success("Student removed");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success("Join code copied");
    } catch {
      toast.error("Couldn't copy — copy it manually");
    }
  };

  const onFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) navigate(`/classes/${id}/upload`, { state: { file } });
    e.target.value = "";
  };

  if (classQ.isLoading) {
    return (
      <Shell>
        <Spinner />
      </Shell>
    );
  }
  if (classQ.error || !classQ.data) {
    return (
      <Shell>
        <ErrorNote error={(classQ.error as Error) ?? new Error("Class not found")} />
      </Shell>
    );
  }

  const cls = classQ.data.class;
  const joinCode = cls.joinCode ?? cls.join_code;
  const pendingStudents = backfillQ.data?.students ?? [];

  return (
    <Shell>
      {isTeacher && pendingStudents.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3">
          <div className="text-sm text-amber-900">
            <span className="font-medium">
              {pendingStudents.length === 1
                ? `${pendingStudents[0].name} joined recently`
                : `${pendingStudents.length} students joined recently`}
            </span>{" "}
            — choose which assignments to backfill.
          </div>
          <button
            type="button"
            onClick={() => setReviewingStudent(pendingStudents[0])}
            className="h-9 shrink-0 rounded-full bg-amber-600 px-4 text-sm font-medium text-white hover:bg-amber-700"
          >
            Review
          </button>
        </div>
      )}

      <div className="mb-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="h-2.5 w-full" style={{ backgroundColor: cls.accent_color || "#1A73E8" }} />
        <div className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{cls.name}</h1>
            {cls.section && <p className="text-sm text-slate-500">{cls.section}</p>}
          </div>
          {isTeacher && joinCode && (
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 font-mono text-lg tracking-[0.3em] text-slate-800">
                {joinCode}
              </span>
              <button
                type="button"
                onClick={() => copyCode(joinCode)}
                title="Copy code"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-300 text-slate-600 hover:bg-slate-50"
              >
                <Copy className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => rotateCodeMutation.mutate()}
                disabled={rotateCodeMutation.isPending}
                title="Generate new code"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              >
                <RefreshCw className={cn("h-4 w-4", rotateCodeMutation.isPending && "animate-spin")} />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex gap-1 rounded-full border border-slate-200 bg-white p-1">
          {(["notebooks", "assignments", "roster"] as Tab[])
            .filter((t) => t !== "roster" || isTeacher)
            .map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cn(
                  "rounded-full px-4 py-1.5 text-sm font-medium capitalize transition-colors",
                  tab === t ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100",
                )}
              >
                {t}
              </button>
            ))}
        </div>
        <Link
          to={`/classes/${id}/gradebook`}
          className="h-9 shrink-0 rounded-full border border-slate-300 bg-white px-4 text-sm font-medium leading-9 text-slate-700 hover:bg-slate-50"
        >
          Gradebook
        </Link>
      </div>

      {tab === "notebooks" && (
        <div>
          {isTeacher && (
            <div className="mb-4 flex justify-end">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.pptx,application/pdf"
                className="hidden"
                onChange={onFileChosen}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-10 items-center gap-1.5 rounded-full bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700"
              >
                <Upload className="h-4 w-4" />
                Upload notebook
              </button>
            </div>
          )}
          {classQ.data.notebooks.length === 0 && (
            <EmptyState title="No notebooks yet" body="Upload a PDF, Word, or PowerPoint file to build your first notebook." />
          )}
          {classQ.data.notebooks.length > 0 && (
            <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white shadow-sm">
              {classQ.data.notebooks.map((nb) => {
                const row = (
                  <div className="flex items-center justify-between gap-3 px-5 py-3.5">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{nb.title}</span>
                    <span className="shrink-0 text-xs text-slate-500">{nb.page_count} pages</span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium capitalize",
                        nb.status === "published" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600",
                      )}
                    >
                      {nb.status}
                    </span>
                    <span className="hidden shrink-0 text-xs text-slate-400 sm:block">{relativeTime(nb.updated_at)}</span>
                  </div>
                );
                return (
                  <li key={nb.id}>
                    {isTeacher ? (
                      <Link to={`/notebooks/${nb.id}/edit`} className="block hover:bg-slate-50">
                        {row}
                      </Link>
                    ) : (
                      row
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {tab === "assignments" && (
        <div>
          {isTeacher && (
            <div className="mb-4 flex justify-end">
              <Link
                to={`/classes/${id}/assignments/new`}
                className="flex h-10 items-center gap-1.5 rounded-full bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700"
              >
                <Plus className="h-4 w-4" />
                New assignment
              </Link>
            </div>
          )}
          {assignmentsQ.isLoading && <Spinner />}
          {assignmentsQ.error && <ErrorNote error={assignmentsQ.error as Error} />}
          {!assignmentsQ.isLoading && !assignmentsQ.error && assignmentsQ.data && assignmentsQ.data.assignments.length === 0 && (
            <EmptyState title="No assignments yet" body="Create an assignment from a published notebook." />
          )}
          {!assignmentsQ.isLoading && !assignmentsQ.error && assignmentsQ.data && assignmentsQ.data.assignments.length > 0 && isTeacher && (
            <div className="space-y-3">
              {assignmentsQ.data.assignments.map((a) => (
                <AssignmentCard key={a.id} a={a} />
              ))}
            </div>
          )}
          {!assignmentsQ.isLoading && !assignmentsQ.error && assignmentsQ.data && assignmentsQ.data.assignments.length > 0 && !isTeacher && (
            <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white shadow-sm">
              {assignmentsQ.data.assignments.map((a) => (
                <li key={a.id}>
                  <Link to={`/assignments/${a.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3.5 hover:bg-slate-50">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{a.title}</span>
                    <span className="shrink-0 text-xs text-slate-500">{a.pageCount} pages</span>
                    <span
                      className={cn(
                        "shrink-0 text-xs",
                        isOverdue(a.dueAt) ? "font-medium text-rose-600" : "text-slate-500",
                      )}
                    >
                      {formatDue(a.dueAt)}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium capitalize",
                        a.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600",
                      )}
                    >
                      {a.status}
                    </span>
                    <span className="shrink-0 text-xs text-slate-500">
                      {a.complete ?? 0}/{a.pageCount} pages
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "roster" && isTeacher && (
        <div>
          <div className="mb-4 flex justify-end">
            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              className="flex h-10 items-center gap-1.5 rounded-full bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              Invite by email
            </button>
          </div>
          {classQ.data.roster.length === 0 && <EmptyState title="No students yet" body="Share the join code or invite students by email." />}
          {classQ.data.roster.length > 0 && (
            <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white shadow-sm">
              {classQ.data.roster
                .filter((r) => r.role === "student")
                .map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-5 py-3">
                    <Avatar name={r.name} picture={r.picture} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">{r.name}</span>
                      <span className="block truncate text-xs text-slate-500">{r.email}</span>
                    </span>
                    <span className="hidden shrink-0 text-xs text-slate-400 sm:block">Joined {relativeTime(r.joined_at)}</span>
                    <button
                      type="button"
                      onClick={() => removeStudentMutation.mutate(r.id)}
                      disabled={removeStudentMutation.isPending}
                      title="Remove student"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-60"
                    >
                      <UserX className="h-4 w-4" />
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}

      {inviteOpen && <InviteModal classId={id} onClose={() => setInviteOpen(false)} />}
      {reviewingStudent && (
        <BackfillModal
          classId={id}
          student={reviewingStudent}
          assignments={backfillQ.data?.assignments ?? []}
          onClose={() => setReviewingStudent(null)}
        />
      )}
    </Shell>
  );
}
