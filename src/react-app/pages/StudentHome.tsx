import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Check, KeyRound } from "lucide-react";
import { toast } from "sonner";
import Shell, { EmptyState, ErrorNote, Spinner } from "../components/Shell";
import { Button, Card, CardLink, Chip, Input, Modal } from "../components/ui";
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

const STATUS_TONE: Record<MyAssignment["status"], "quiet" | "default" | "warn" | "mint"> = {
  not_started: "quiet",
  in_progress: "default",
  submitted: "warn",
  returned: "mint",
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
  const accent = cls.accent_color || "#20302C";
  return (
    <CardLink to={`/classes/${cls.id}`}>
      <div className="relative h-20 w-full overflow-hidden border-b-2 border-pine/12">
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
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-pine bg-oat text-[17px]">
              {cls.emoji}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate font-display text-[16px] font-bold text-pine">{cls.name}</div>
            <div className="truncate text-[16px] text-pine/70">{cls.section || " "}</div>
          </div>
        </div>
        <div className="mt-3 text-[16px] text-pine/70">
          {cls.notebook_count} notebook{cls.notebook_count === 1 ? "" : "s"}
        </div>
      </div>
    </CardLink>
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
      className="flex w-full items-center gap-4 rounded-[22px] border-[3px] border-pine bg-white px-4 py-3.5 text-left transition-[transform,box-shadow] hover:-translate-y-0.5"
    >
      <span className="mt-0.5 h-9 w-1.5 shrink-0 rounded-full border border-pine/30" style={{ backgroundColor: a.accentColor || "#20302C" }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] font-bold text-pine">{a.title}</span>
        <span className="block truncate text-[16px] text-pine/70">
          {a.className} &middot; {a.notebookTitle}
        </span>
      </span>
      <span className="hidden shrink-0 text-[16px] text-pine/70 sm:block">
        {a.complete}/{a.total} pages
      </span>
      <span className={cn("shrink-0 text-[16px]", overdue ? "font-bold text-[#a3341f]" : "text-pine/70")}>
        {formatDue(a.dueAt)}
      </span>
      <Chip tone={STATUS_TONE[a.status]} icon={a.status === "returned" ? <Check className="h-3 w-3" strokeWidth={2.5} /> : undefined}>
        {STATUS_LABEL[a.status]}
      </Chip>
      {grade && (
        <Chip tone="mint" icon={<Check className="h-3 w-3" strokeWidth={2.5} />}>{grade}</Chip>
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
    <Modal onClose={onClose} title="Join a class">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (code.length !== 6) return;
          mutation.mutate();
        }}
      >
        <label className="label-caps mb-1 block text-pine/70">Class code</label>
        <Input
          autoFocus
          value={code}
          maxLength={6}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
          placeholder="ABC123"
          className="h-14 text-center font-mono text-2xl tracking-[0.5em]"
        />
        <Button type="submit" variant="primary" disabled={code.length !== 6 || mutation.isPending} className="mt-4 w-full">
          {mutation.isPending ? "Joining…" : "Join class"}
        </Button>
      </form>
    </Modal>
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
        <h1 className="text-2xl text-pine">My work</h1>
        <Button variant="primary" onClick={() => setJoinOpen(true)}>
          <KeyRound className="h-4 w-4" strokeWidth={2.5} />
          Join a class
        </Button>
      </div>

      <section className="mb-8">
        <h2 className="label-caps mb-3 text-pine/70">My classes</h2>
        {classesQ.isLoading && <Spinner />}
        {classesQ.error && <ErrorNote error={classesQ.error as Error} />}
        {!classesQ.isLoading && !classesQ.error && classesQ.data && classesQ.data.classes.length === 0 && (
          <EmptyState
            title="You haven't joined a class yet"
            body="Ask your teacher for a class code, then use Join a class above to get started."
            action={
              <Button variant="primary" onClick={() => setJoinOpen(true)}>
                <KeyRound className="h-4 w-4" strokeWidth={2.5} />
                Join a class
              </Button>
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
        <h2 className="label-caps mb-3 text-pine/70">Assignments</h2>
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
        <h2 className="label-caps mb-3 text-pine/70">My notebooks</h2>
        {notebooksQ.isLoading && <Spinner />}
        {notebooksQ.error && <ErrorNote error={notebooksQ.error as Error} />}
        {!notebooksQ.isLoading && !notebooksQ.error && notebooksQ.data && notebooksQ.data.notebooks.length === 0 && (
          <EmptyState title="No notebooks yet" body="Notebooks your teachers publish will show up here." />
        )}
        {!notebooksQ.isLoading && !notebooksQ.error && notebooksQ.data && notebooksQ.data.notebooks.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {notebooksQ.data.notebooks.map((nb) => (
              <Card key={nb.id} pressable className="cursor-pointer" onClick={() => navigate(`/notebooks/${nb.id}`)}>
                <div className="h-1.5 w-full border-b-2 border-pine/12" style={{ backgroundColor: nb.accent_color || "#20302C" }} />
                <div className="p-4 text-left">
                  <div className="truncate font-display text-[16px] font-bold text-pine">{nb.title}</div>
                  <div className="truncate text-[16px] text-pine/70">{nb.class_name}</div>
                  <div className="mt-3 text-[16px] text-pine/70">{nb.page_count} pages</div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {joinOpen && <JoinClassModal onClose={() => setJoinOpen(false)} />}
    </Shell>
  );
}
