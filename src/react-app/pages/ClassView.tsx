import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  BookOpen, Check, ClipboardList, Copy, Eye, GraduationCap, Palette, Plus, RefreshCw, Upload, UserPlus, UserX, Users,
} from "lucide-react";
import { toast } from "sonner";
import Gradebook from "./Gradebook";
import PageThumb from "../components/PageThumb";
import StudentAssignmentNav, {
  WORK_EMPTY, bucketAssignments, type WorkTab,
} from "../components/StudentAssignmentNav";
import Shell, { Avatar, EmptyState, ErrorNote, Spinner } from "../components/Shell";
import { AssignmentCard, type AssignmentCardData } from "./TeacherAssignments";
import { Button, ButtonLink, Card, CardLink, Chip, IconButton, Input, Label, Modal, Textarea } from "../components/ui";
import { api, assetUrl, pageSource, type AssignmentSummary, type PageRec } from "../lib/api";
import { cn, formatDue, isOverdue, relativeTime, DEFAULT_ACCENT } from "../lib/utils";

const QUICK_EMOJI = ["📚", "🔬", "🧮", "🎨", "🎵", "🌍", "⚗️", "📐", "🏛️", "💻", "✍️", "🧪", "📊", "🎭", "⚽", "🌱"];
const SWATCHES = [
  "#2E7D6B", "#20302C", "#3F6C9E", "#7A5C8E", "#C4703F",
  "#D9A441", "#A3341F", "#4F7A3A",
];

/** Local view of an assignment row that also carries the notebook's colour, since
 * `AssignmentSummary` (shared with other owners' code) doesn't declare it. */
type ClassAssignmentRow = AssignmentSummary & Partial<AssignmentCardData>;

interface ClassDetail {
  id: string;
  name: string;
  section: string;
  accent_color: string;
  emoji?: string;
  hasCover?: boolean;
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
  first_pattern?: string | null;
  first_pattern_color?: string | null;
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
    <Modal onClose={onClose} title="Backfill assignments">
      <p className="mb-4 text-[16px] text-pine/70">
        Choose which assignments <span className="font-display text-pine">{student.name}</span> should be held to.
      </p>

      {assignments.length === 0 && <p className="py-4 text-[16px] text-pine/70">No active assignments in this class.</p>}
      {assignments.length > 0 && (
        <ul className="space-y-2">
          {assignments.map((a) => (
            <li key={a.id}>
              <label className="flex items-center gap-3 rounded-[12px] border-[3px] border-pine px-3 py-2.5 text-[16px] hover:bg-oat">
                <input
                  type="checkbox"
                  checked={checked.has(a.id)}
                  onChange={() => toggle(a.id)}
                  className="h-4 w-4 accent-mint"
                />
                <span className="flex-1">
                  <span className="block font-display text-pine">{a.title}</span>
                  <span className="block text-[16px] text-pine/70">{formatDue(a.due_at)}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <Button type="button" variant="primary" disabled={mutation.isPending} onClick={() => mutation.mutate()} className="mt-5 w-full">
        {mutation.isPending ? "Saving…" : "Confirm"}
      </Button>
    </Modal>
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
    <Modal onClose={onClose} title="Invite by email">
      <Label>Emails (comma or newline separated)</Label>
      <Textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder="ada@school.edu, grace@school.edu"
        className="mt-1.5"
      />
      <Button
        type="button"
        variant="primary"
        disabled={!text.trim() || mutation.isPending}
        onClick={() => mutation.mutate()}
        className="mt-4 w-full"
      >
        {mutation.isPending ? "Inviting…" : "Send invites"}
      </Button>
    </Modal>
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
    <Modal onClose={onClose} title="Add co-teachers">
      <p className="text-[16px] text-pine/70">
        Co-teachers can build notebooks, assign work and grade — the same as you. They can't remove the class owner.
      </p>
      <Textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder="teacher@school.edu, another@school.edu"
        className="mt-4"
      />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => add.mutate()} disabled={!text.trim() || add.isPending}>
          {add.isPending ? "Adding…" : "Add"}
        </Button>
      </div>
    </Modal>
  );
}

/** Emoji, accent colour and a featured banner image for the class header and tiles everywhere. */
function CustomizeModal({
  classId,
  cls,
  coverVersion,
  bumpCover,
  onClose,
}: {
  classId: string;
  cls: ClassDetail;
  coverVersion: number;
  bumpCover: () => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [emoji, setEmoji] = useState(cls.emoji ?? "");
  const [color, setColor] = useState(cls.accent_color || DEFAULT_ACCENT);
  const fileRef = useRef<HTMLInputElement | null>(null);
  useEscapeClose(onClose);

  const invalidate = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["class", classId] }),
      qc.invalidateQueries({ queryKey: ["classes"] }),
    ]);

  const saveEmoji = useMutation({
    mutationFn: (value: string) => api.patch(`/api/classes/${classId}`, { emoji: value }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });
  const saveColor = useMutation({
    mutationFn: (value: string) => api.patch(`/api/classes/${classId}`, { accentColor: value }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });
  const uploadCover = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api.upload(`/api/classes/${classId}/cover`, form);
    },
    onSuccess: async () => {
      await invalidate();
      bumpCover();
      toast.success("Featured image updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const clearCover = useMutation({
    mutationFn: () => api.patch(`/api/classes/${classId}`, { clearCover: true }),
    onSuccess: async () => {
      await invalidate();
      bumpCover();
      toast.success("Featured image removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pickEmoji = (value: string) => {
    setEmoji(value);
    saveEmoji.mutate(value);
  };
  const pickColor = (value: string) => {
    setColor(value);
    saveColor.mutate(value);
  };
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadCover.mutate(file);
    e.target.value = "";
  };

  return (
    <Modal onClose={onClose} title="Customize class">
      <div className="mb-5">
        <Label>Emoji</Label>
        <Input
          value={emoji}
          onChange={(e) => setEmoji(Array.from(e.target.value).slice(0, 2).join(""))}
          onBlur={() => saveEmoji.mutate(emoji)}
          placeholder="📚"
          className="mt-1.5 w-20 text-center text-xl"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {QUICK_EMOJI.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => pickEmoji(e)}
              className={cn(
                "flex h-11 w-11 items-center justify-center rounded-xl border-[3px] text-xl hover:bg-oat",
                emoji === e ? "border-pine bg-mint/30" : "border-pine/20",
              )}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-5">
        <Label>Colour</Label>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              title={c}
              onClick={() => pickColor(c)}
              className={cn(
                "h-9 w-9 shrink-0 rounded-full border-2 border-pine",
                color.toLowerCase() === c.toLowerCase() ? "ring-[3px] ring-pine ring-offset-2" : "",
              )}
              style={{ backgroundColor: c }}
            />
          ))}
          <label
            title="Custom colour"
            className="relative flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-pine/40 text-pine/60 hover:bg-oat"
          >
            <Palette className="h-4 w-4" strokeWidth={2.5} />
            <input
              type="color"
              value={color}
              onChange={(e) => pickColor(e.target.value)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>
        </div>
      </div>

      <div>
        <Label>Featured image</Label>
        {cls.hasCover ? (
          <div className="mt-1.5 space-y-2">
            <img
              src={`/api/classes/${classId}/cover?v=${coverVersion}`}
              alt=""
              className="h-28 w-full rounded-xl border-[3px] border-pine object-cover"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => fileRef.current?.click()}
                disabled={uploadCover.isPending}
                className="flex-1"
              >
                <Upload className="h-4 w-4" strokeWidth={2.5} />
                {uploadCover.isPending ? "Uploading…" : "Replace"}
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => clearCover.mutate()}
                disabled={clearCover.isPending}
                className="flex-1"
              >
                Remove image
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploadCover.isPending}
            className="mt-1.5 flex h-24 w-full items-center justify-center gap-2 rounded-xl border-[3px] border-dashed border-pine/40 text-[16px] text-pine/60 hover:bg-oat disabled:opacity-60"
          >
            <Upload className="h-4 w-4" strokeWidth={2.5} />
            {uploadCover.isPending ? "Uploading…" : "Upload an image"}
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={onFile}
        />
      </div>
    </Modal>
  );
}

// ---------- student assignment card (also used by StudentHome's "My work" list) ----------

/** Minimal shape a student-facing assignment card needs — both `/api/my/assignments`
 * and the student view of `/api/classes/:id/assignments` satisfy this. */
export interface StudentAssignmentData {
  id: string;
  title: string;
  notebookId: string;
  notebookTitle: string;
  notebookColor?: string;
  pageCount: number;
  dueAt: string | null;
  grading: "none" | "complete" | "points" | "letter";
  pointsMax: number;
  status: "not_started" | "in_progress" | "submitted" | "returned";
  grade: { points: number | null; letter: string | null; complete: number | null } | null;
}

/** Compress a sorted-or-not list of page numbers into "4, 7–9" style ranges.
 * `TeacherAssignments` has an identical private helper — not exported there,
 * and that file is out of scope here, so this is a small deliberate duplicate. */
function formatPageNumbers(numbers: number[]): string {
  const sorted = Array.from(new Set(numbers)).sort((a, b) => a - b);
  if (sorted.length === 0) return "";
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const n = sorted[i];
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}–${prev}`);
    if (i < sorted.length) {
      start = n;
      prev = n;
    }
  }
  return parts.join(", ");
}

function studentGradeLabel(
  grading: "none" | "complete" | "points" | "letter",
  pointsMax: number,
  grade: { points: number | null; letter: string | null; complete: number | null } | null,
): string | null {
  if (!grade) return null;
  if (grading === "points") return grade.points === null ? null : `${grade.points}/${pointsMax}`;
  if (grading === "letter") return grade.letter ?? null;
  if (grading === "complete") return grade.complete === null ? null : grade.complete ? "Complete" : "Incomplete";
  return null;
}

const STUDENT_STATUS_TONE: Record<StudentAssignmentData["status"], "quiet" | "default" | "mint"> = {
  not_started: "quiet",
  in_progress: "default",
  submitted: "mint",
  returned: "mint",
};
const STUDENT_STATUS_LABEL: Record<StudentAssignmentData["status"], string> = {
  not_started: "Not started",
  in_progress: "In progress",
  submitted: "Submitted",
  returned: "Returned",
};

/** A compact, student-facing sibling of `AssignmentCard` — thumbnail stack and
 * status, but none of the teacher-only scorecard or roster. The whole card is
 * the action: it opens straight into the student's workspace. */
export function StudentAssignmentCard({ a }: { a: StudentAssignmentData }) {
  const notebookQ = useQuery({
    queryKey: ["notebook", a.notebookId],
    queryFn: () => api.get<{ pages: PageRec[] }>(`/api/notebooks/${a.notebookId}`),
  });
  const detailQ = useQuery({
    queryKey: ["assignment", a.id],
    queryFn: () => api.get<{ assignment: { pageIds: string[]; pageNumbers: number[] } }>(`/api/assignments/${a.id}`),
  });

  const assignedPages = useMemo(() => {
    const pageIds = detailQ.data?.assignment.pageIds;
    const pages = notebookQ.data?.pages;
    if (!pageIds || !pages) return [];
    const set = new Set(pageIds);
    return pages.filter((p) => set.has(p.id));
  }, [detailQ.data, notebookQ.data]);

  const pageNumbersLabel = useMemo(() => {
    const nums = detailQ.data?.assignment.pageNumbers;
    if (!nums || nums.length === 0) return `${a.pageCount} page${a.pageCount === 1 ? "" : "s"}`;
    return `Page${nums.length === 1 ? "" : "s"} ${formatPageNumbers(nums)}`;
  }, [detailQ.data, a.pageCount]);

  const submitted = a.status === "submitted" || a.status === "returned";
  const overdue = isOverdue(a.dueAt) && !submitted;
  const accent = a.notebookColor || DEFAULT_ACCENT;
  const stackPages = assignedPages.slice(0, 4);
  const extra = Math.max(0, assignedPages.length - stackPages.length);
  const grade = a.status === "returned" ? studentGradeLabel(a.grading, a.pointsMax, a.grade) : null;

  return (
    <CardLink to={`/notebooks/${a.notebookId}?assignment=${a.id}`} accent={accent}>
      <div className="flex gap-4 p-4">
        <div
          className="relative hidden h-[92px] w-[76px] shrink-0 rounded-lg sm:block"
          style={{ backgroundColor: `${accent}14` }}
        >
          {stackPages.length === 0 && <div className="h-full w-full animate-pulse rounded-lg bg-oat" />}
          {stackPages.map((p, i) => (
            <div
              key={p.id}
              className="absolute rounded shadow"
              style={{
                top: i * 7,
                left: i * 9,
                transform: `rotate(${(i - (stackPages.length - 1) / 2) * 7}deg)`,
                zIndex: stackPages.length - i,
              }}
            >
              <PageThumb
                {...pageSource(a.notebookId, p)}
                width={56}
              />
            </div>
          ))}
          {extra > 0 && (
            <span className="absolute -bottom-1 -right-1 z-20 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-pine px-1 font-display text-[16px] text-oat">
              +{extra}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-[17px] text-pine">{a.title}</div>
          <div className="mt-0.5 truncate text-[16px] text-pine/70">
            {a.notebookTitle} &middot; {pageNumbersLabel}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Chip
              tone={STUDENT_STATUS_TONE[a.status]}
              icon={submitted ? <Check className="h-3 w-3" strokeWidth={2.5} /> : undefined}
            >
              {STUDENT_STATUS_LABEL[a.status]}
            </Chip>
            <span className={cn("text-[16px]", overdue ? "font-display text-[#a3341f]" : "text-pine/70")}>
              Due {formatDue(a.dueAt)}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[16px] text-pine/70">
            {grade && (
              <Chip tone="mint" icon={<Check className="h-3 w-3" strokeWidth={2.5} />}>
                {grade}
              </Chip>
            )}
          </div>
        </div>
      </div>
    </CardLink>
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
  const [workTab, setWorkTab] = useState<WorkTab>("todo");
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [coverVersion, setCoverVersion] = useState(0);
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

  // Fetched unconditionally (not gated on `tab === "assignments"`) — the nav's
  // to-do badge needs a count before the tab is ever opened.
  const assignmentsQ = useQuery({
    queryKey: ["assignments", id],
    queryFn: () => api.get<{ assignments: ClassAssignmentRow[]; isTeacher: boolean }>(`/api/classes/${id}/assignments`),
    enabled: !!id,
  });

  // Students see this class's assignments split into the same buckets as
  // "My work"; teachers see the full list unfiltered.
  const studentBuckets = useMemo(
    () => bucketAssignments(assignmentsQ.data?.assignments ?? []),
    [assignmentsQ.data],
  );

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
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-[22px] border-[3px] border-[#8a6a1f] bg-[#f7e6bf] px-4 py-3">
          <div className="text-[16px] text-[#5c4611]">
            <span className="font-display">
              {pendingStudents.length === 1
                ? `${pendingStudents[0].name} joined recently`
                : `${pendingStudents.length} students joined recently`}
            </span>{" "}
            — choose which assignments to backfill.
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={() => setReviewingStudent(pendingStudents[0])} className="shrink-0">
            Review
          </Button>
        </div>
      )}

      <Card className="mb-6">
        <div className="relative h-28 sm:h-36">
          {cls.hasCover ? (
            <img
              src={`/api/classes/${id}/cover?v=${coverVersion}`}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div
              className="absolute inset-0"
              style={{ background: `linear-gradient(135deg, ${cls.accent_color || DEFAULT_ACCENT}, ${cls.accent_color || DEFAULT_ACCENT}99)` }}
            />
          )}
          <div
            className="absolute inset-0"
            style={{ background: "linear-gradient(to top, rgba(32,48,44,.6), rgba(32,48,44,0) 65%)" }}
          />
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 p-4">
            {cls.emoji && (
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-pine bg-white/90 text-2xl">
                {cls.emoji}
              </span>
            )}
            <h1 className="truncate font-display text-[24px] text-oat">{cls.name}</h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div className="min-w-0">
            {cls.section && <p className="truncate text-[16px] text-pine/70">{cls.section}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isTeacher && (
              <Button type="button" variant="secondary" onClick={() => setCustomizeOpen(true)}>
                <Palette className="h-4 w-4" strokeWidth={2.5} />
                Customize
              </Button>
            )}
            {isTeacher && joinCode && (
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-2 rounded-full border-[3px] border-pine bg-oat px-4 py-2 font-display text-[17px] tracking-[0.3em] text-pine">
                  {joinCode}
                </span>
                <IconButton label="Copy code" variant="secondary" onClick={() => copyCode(joinCode)}>
                  <Copy className="h-4 w-4" strokeWidth={2.5} />
                </IconButton>
                <IconButton
                  label="Generate new code"
                  variant="secondary"
                  onClick={() => rotateCodeMutation.mutate()}
                  disabled={rotateCodeMutation.isPending}
                >
                  <RefreshCw className={cn("h-4 w-4", rotateCodeMutation.isPending && "animate-spin")} strokeWidth={2.5} />
                </IconButton>
              </div>
            )}
          </div>
        </div>
      </Card>

      <div className="mb-5 flex items-center gap-3 overflow-x-auto">
        <div className="flex gap-1 rounded-full border-[3px] border-pine bg-white p-1">
          {TABS.filter((t) => t.key !== "roster" || isTeacher).map(({ key, label, studentLabel, icon: Icon }) => {
            const todoCount = key === "assignments" && !isTeacher ? studentBuckets.todo.length : 0;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  "inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-full px-4 font-display text-[17px] transition-colors sm:px-5",
                  tab === key ? "bg-pine text-oat" : "text-pine hover:bg-pine/8",
                )}
              >
                <Icon className="h-4 w-4" strokeWidth={2.5} />
                {!isTeacher && studentLabel ? studentLabel : label}
                {todoCount > 0 && (
                  <span
                    className={cn(
                      "inline-flex h-6 min-w-6 items-center justify-center rounded-full border-2 px-1.5 text-[15px]",
                      tab === key ? "border-oat/40 text-oat" : "border-pine/25 text-pine/75",
                    )}
                  >
                    {todoCount}
                  </span>
                )}
              </button>
            );
          })}
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
              <Button type="button" variant="primary" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4" strokeWidth={2.5} />
                Upload notebook
              </Button>
            </div>
          )}
          {classQ.data.notebooks.length === 0 && (
            <EmptyState title="No notebooks yet" body="Upload a PDF, Word, or PowerPoint file to build your first notebook." />
          )}
          {classQ.data.notebooks.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {classQ.data.notebooks.map((nb) => {
                const accent = nb.accent_color || DEFAULT_ACCENT;
                const to = isTeacher ? `/notebooks/${nb.id}/edit` : `/notebooks/${nb.id}`;
                return (
                  <Link
                    key={nb.id}
                    to={to}
                    className="group overflow-hidden rounded-[22px] border-[3px] border-pine bg-white shadow-[4px_4px_0_0_var(--color-pine)] transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[5px_5px_0_0_var(--color-pine)]"
                  >
                    <div className="h-2" style={{ background: accent }} />
                    <div className="flex gap-3 p-4">
                      {/* An uploaded cover wins; otherwise the first page stands in. */}
                      <div className="shrink-0">
                        {nb.has_cover ? (
                          <img
                            src={`/api/notebooks/${nb.id}/cover`}
                            alt=""
                            className="h-[74px] w-14 rounded border-2 border-pine object-cover"
                          />
                        ) : nb.first_asset_key || nb.first_pattern ? (
                          <PageThumb
                            pdfUrl={assetUrl(nb.id, nb.first_asset_key ?? undefined)}
                            sourceIndex={nb.first_source_index ?? 0}
                            pageWidth={nb.first_width ?? 612}
                            pageHeight={nb.first_height ?? 792}
                            pattern={nb.first_pattern ?? undefined}
                            patternColor={nb.first_pattern_color ?? undefined}
                            width={56}
                          />
                        ) : (
                          <div
                            className="h-[74px] w-14 rounded border-2 border-pine"
                            style={{ background: `linear-gradient(135deg, ${accent}22, ${accent}55)` }}
                          />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-display text-[17px] text-pine">{nb.title}</div>
                        <div className="mt-0.5 text-[16px] text-pine/70">{nb.page_count} pages</div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <Chip tone={nb.status === "published" ? "mint" : "quiet"} className="capitalize">
                            {nb.status}
                          </Chip>
                          <span className="text-[16px] text-pine/50">{relativeTime(nb.updated_at)}</span>
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
              <ButtonLink to={`/classes/${id}/assignments/new`} variant="primary">
                <Plus className="h-4 w-4" strokeWidth={2.5} />
                New assignment
              </ButtonLink>
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
            <div>
              {/* The same three buckets a student sees on "My work", so the idea
                  looks identical whether they're in one class or across all. */}
              <StudentAssignmentNav
                className="mb-5"
                value={workTab}
                onChange={setWorkTab}
                counts={{
                  todo: studentBuckets.todo.length,
                  "handed-in": studentBuckets["handed-in"].length,
                  marked: studentBuckets.marked.length,
                }}
              />
              {studentBuckets[workTab].length === 0 ? (
                <EmptyState title={WORK_EMPTY[workTab]} />
              ) : (
                <div className="space-y-3">
                  {studentBuckets[workTab].map((a) => (
                    <StudentAssignmentCard
                      key={a.id}
                      a={{
                        id: a.id,
                        title: a.title,
                        notebookId: a.notebookId,
                        notebookTitle: a.notebookTitle,
                        notebookColor: a.notebookColor,
                        pageCount: a.pageCount,
                        dueAt: a.dueAt,
                        grading: a.grading,
                        pointsMax: a.pointsMax,
                        status: (a.myStatus as StudentAssignmentData["status"]) ?? "not_started",
                        grade: a.grade ?? null,
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "gradebook" && <Gradebook embedded classId={id} />}

      {tab === "roster" && isTeacher && (
        <div>
          <div className="mb-4 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setCoTeacherOpen(true)}>
              <UserPlus className="h-4 w-4" strokeWidth={2.5} />
              Add co-teacher
            </Button>
            <Button type="button" variant="primary" onClick={() => setInviteOpen(true)}>
              <Plus className="h-4 w-4" strokeWidth={2.5} />
              Invite students
            </Button>
          </div>

          {/* Teaching team */}
          <Card className="mb-5 p-4">
            <h3 className="label-caps text-pine/60">Teaching team</h3>
            <ul className="mt-2 divide-y divide-pine/10">
              {(classQ.data.teachers ?? []).map((t) => (
                <li key={t.id} className="flex items-center gap-3 py-2">
                  <Avatar name={t.name} picture={t.picture} size={30} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-pine">{t.name}</span>
                    <span className="block truncate text-[16px] text-pine/70">{t.email}</span>
                  </span>
                  {t.is_owner ? (
                    <Chip tone="quiet" className="shrink-0">Owner</Chip>
                  ) : (
                    <IconButton
                      label="Remove co-teacher"
                      variant="ghost"
                      className="h-8 w-8 hover:bg-[#a3341f]/10 hover:text-[#a3341f]"
                      onClick={() => {
                        if (confirm(`Remove ${t.name} as a co-teacher? They keep their account but lose access to this class.`)) {
                          removeTeacherMutation.mutate(t.id);
                        }
                      }}
                    >
                      <UserX className="h-4 w-4" strokeWidth={2.5} />
                    </IconButton>
                  )}
                </li>
              ))}
            </ul>
          </Card>
          {classQ.data.roster.length === 0 && <EmptyState title="No students yet" body="Share the join code or invite students by email." />}
          {classQ.data.roster.length > 0 && (
            <ul className="divide-y divide-pine/15 rounded-[22px] border-[3px] border-pine bg-white">
              {classQ.data.roster
                .filter((r) => r.role === "student")
                .map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-5 py-3 hover:bg-oat">
                    <Link
                      to={`/classes/${id}/students/${r.id}`}
                      className="flex min-w-0 flex-1 items-center gap-3"
                      title={`Browse ${r.name}'s notebooks`}
                    >
                      <Avatar name={r.name} picture={r.picture} size={32} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-display text-pine">{r.name}</span>
                        <span className="block truncate text-[16px] text-pine/70">{r.email}</span>
                      </span>
                    </Link>
                    <span className="hidden shrink-0 text-[16px] text-pine/50 sm:block">Joined {relativeTime(r.joined_at)}</span>
                    <Link
                      to={`/classes/${id}/students/${r.id}`}
                      title="Browse notebooks"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-pine/50 hover:bg-mint/30 hover:text-pine"
                    >
                      <Eye className="h-4 w-4" strokeWidth={2.5} />
                    </Link>
                    <button
                      type="button"
                      onClick={() => removeStudentMutation.mutate(r.id)}
                      disabled={removeStudentMutation.isPending}
                      title="Remove student"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-pine/50 hover:bg-[#a3341f]/10 hover:text-[#a3341f] disabled:opacity-60"
                    >
                      <UserX className="h-4 w-4" strokeWidth={2.5} />
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}

      {inviteOpen && <InviteModal classId={id} onClose={() => setInviteOpen(false)} />}
      {coTeacherOpen && <CoTeacherModal classId={id} onClose={() => setCoTeacherOpen(false)} />}
      {customizeOpen && (
        <CustomizeModal
          classId={id}
          cls={cls}
          coverVersion={coverVersion}
          bumpCover={() => setCoverVersion((v) => v + 1)}
          onClose={() => setCustomizeOpen(false)}
        />
      )}
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
