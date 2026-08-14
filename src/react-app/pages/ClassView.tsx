import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  BookOpen, ClipboardList, Copy, Eye, GraduationCap, Plus, RefreshCw, Upload, UserPlus, UserX, Users, X,
} from "lucide-react";
import { toast } from "sonner";
import Gradebook from "./Gradebook";
import PageThumb from "../components/PageThumb";
import Shell, { Avatar, EmptyState, ErrorNote, Spinner } from "../components/Shell";
import { AssignmentCard } from "./TeacherAssignments";
import { api, assetUrl, type AssignmentSummary } from "../lib/api";
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
  accent_color?: string;
  has_cover?: number;
  first_asset_key?: string | null;
  first_source_index?: number | null;
  first_width?: number | null;
  first_height?: number | null;
}

interface TeacherRow {
  id: string;
  name: string;
  email: string;
  picture: string | null;
  is_owner: number;
}

interface ClassResponse {
  class: ClassDetail;
  myRole: "teacher" | "student";
  roster: RosterRow[];
  teachers: TeacherRow[];
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

type Tab = "notebooks" | "assignments" | "roster" | "gradebook";

const TABS: { key: Tab; label: string; studentLabel?: string; icon: typeof BookOpen }[] = [
  { key: "notebooks", label: "Notebooks", icon: BookOpen },
  { key: "assignments", label: "Assignments", icon: ClipboardList },
  { key: "roster", label: "Roster", icon: Users },
  { key: "gradebook", label: "Gradebook", studentLabel: "Grades", icon: GraduationCap },
];

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

/** Co-teachers get full control of the class, so the copy says so plainly. */
function CoTeacherModal({ classId, onClose }: { classId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  useEscapeClose(onClose);

  const add = useMutation({
    mutationFn: () =>
      api.post<{ added: number; skipped: { email: string; reason: string }[] }>(
        `/api/classes/${classId}/teachers`,
        { emails: text.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean) },
      ),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["class", classId] });
      if (res.added > 0) toast.success(`Added ${res.added} co-teacher${res.added === 1 ? "" : "s"}`);
      for (const s of res.skipped ?? []) toast.error(`${s.email}: ${s.reason}`);
      if (res.added > 0) onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Add co-teachers</h2>
            <p className="mt-1 text-xs text-slate-500">
              Co-teachers can build notebooks, assign work and grade — the same as you. They can't remove the class owner.
            </p>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="teacher@school.edu, another@school.edu"
          className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="h-10 rounded-full px-4 text-sm text-slate-600 hover:bg-slate-100">Cancel</button>
          <button
            onClick={() => add.mutate()}
            disabled={!text.trim() || add.isPending}
            className="h-10 rounded-full bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {add.isPending ? "Adding…" : "Add"}
          </button>
        </div>
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
    tabParam === "assignments" || tabParam === "roster" || tabParam === "gradebook"
      ? (tabParam as Tab)
      : "notebooks",
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
  const [coTeacherOpen, setCoTeacherOpen] = useState(false);
  const [reviewingStudent, setReviewingStudent] = useState<BackfillStudent | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const removeTeacherMutation = useMutation({
    mutationFn: (userId: string) => api.del(`/api/classes/${id}/teachers/${userId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["class", id] });
      toast.success("Co-teacher removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

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

      <div className="mb-5 flex items-center gap-3 overflow-x-auto">
        <div className="flex gap-1 rounded-full border border-slate-200 bg-white p-1">
          {TABS.filter((t) => t.key !== "roster" || isTeacher).map(({ key, label, studentLabel, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-2 text-sm font-medium transition-colors sm:px-4",
                tab === key ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100",
              )}
            >
              <Icon className="h-4 w-4" />
              {!isTeacher && studentLabel ? studentLabel : label}
            </button>
          ))}
        </div>
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
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {classQ.data.notebooks.map((nb) => {
                const accent = nb.accent_color || "#1A73E8";
                const to = isTeacher ? `/notebooks/${nb.id}/edit` : `/notebooks/${nb.id}`;
                return (
                  <Link
                    key={nb.id}
                    to={to}
                    className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md"
                  >
                    <div className="h-1.5" style={{ background: accent }} />
                    <div className="flex gap-3 p-4">
                      {/* An uploaded cover wins; otherwise the first page stands in. */}
                      <div className="shrink-0">
                        {nb.has_cover ? (
                          <img
                            src={`/api/notebooks/${nb.id}/cover`}
                            alt=""
                            className="h-[74px] w-14 rounded border border-slate-200 object-cover"
                          />
                        ) : nb.first_asset_key ? (
                          <PageThumb
                            pdfUrl={assetUrl(nb.id, nb.first_asset_key)}
                            sourceIndex={nb.first_source_index ?? 0}
                            pageWidth={nb.first_width ?? 612}
                            pageHeight={nb.first_height ?? 792}
                            width={56}
                          />
                        ) : (
                          <div
                            className="h-[74px] w-14 rounded border border-slate-200"
                            style={{ background: `linear-gradient(135deg, ${accent}22, ${accent}55)` }}
                          />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-slate-900">{nb.title}</div>
                        <div className="mt-0.5 text-xs text-slate-500">{nb.page_count} pages</div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
                              nb.status === "published" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600",
                            )}
                          >
                            {nb.status}
                          </span>
                          <span className="text-[11px] text-slate-400">{relativeTime(nb.updated_at)}</span>
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
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

      {tab === "gradebook" && <Gradebook embedded classId={id} />}

      {tab === "roster" && isTeacher && (
        <div>
          <div className="mb-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setCoTeacherOpen(true)}
              className="flex h-10 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <UserPlus className="h-4 w-4" />
              Add co-teacher
            </button>
            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              className="flex h-10 items-center gap-1.5 rounded-full bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              Invite students
            </button>
          </div>

          {/* Teaching team */}
          <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Teaching team</h3>
            <ul className="mt-2 divide-y divide-slate-100">
              {(classQ.data.teachers ?? []).map((t) => (
                <li key={t.id} className="flex items-center gap-3 py-2">
                  <Avatar name={t.name} picture={t.picture} size={30} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">{t.name}</span>
                    <span className="block truncate text-xs text-slate-500">{t.email}</span>
                  </span>
                  {t.is_owner ? (
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">Owner</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Remove ${t.name} as a co-teacher? They keep their account but lose access to this class.`)) {
                          removeTeacherMutation.mutate(t.id);
                        }
                      }}
                      title="Remove co-teacher"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <UserX className="h-4 w-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
          {classQ.data.roster.length === 0 && <EmptyState title="No students yet" body="Share the join code or invite students by email." />}
          {classQ.data.roster.length > 0 && (
            <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white shadow-sm">
              {classQ.data.roster
                .filter((r) => r.role === "student")
                .map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                    <Link
                      to={`/classes/${id}/students/${r.id}`}
                      className="flex min-w-0 flex-1 items-center gap-3"
                      title={`Browse ${r.name}'s notebooks`}
                    >
                      <Avatar name={r.name} picture={r.picture} size={32} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-900">{r.name}</span>
                        <span className="block truncate text-xs text-slate-500">{r.email}</span>
                      </span>
                    </Link>
                    <span className="hidden shrink-0 text-xs text-slate-400 sm:block">Joined {relativeTime(r.joined_at)}</span>
                    <Link
                      to={`/classes/${id}/students/${r.id}`}
                      title="Browse notebooks"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-blue-50 hover:text-blue-600"
                    >
                      <Eye className="h-4 w-4" />
                    </Link>
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
      {coTeacherOpen && <CoTeacherModal classId={id} onClose={() => setCoTeacherOpen(false)} />}
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
