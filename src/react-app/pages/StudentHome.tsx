import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import Shell, { EmptyState, ErrorNote, Spinner } from "../components/Shell";
import { StudentAssignmentCard, type StudentAssignmentData } from "./ClassView";
import { Button, CardLink, Chip, Input, Modal } from "../components/ui";
import { api, type ClassSummary } from "../lib/api";
import { cn } from "../lib/utils";

/** `GET /api/classes` rows also carry `emoji` — declared locally since `ClassSummary`
 * (shared with other owners' code) doesn't yet. There's no `hasCover` flag on this
 * endpoint, so cards probe the cover image directly and fall back on error. */
interface ClassRow extends ClassSummary {
  emoji?: string;
}

/** Raw `/api/my/assignments` row — same information as `StudentAssignmentData`
 * but the notebook's page count comes back as `total`, not `pageCount`. */
interface MyAssignment {
  id: string;
  title: string;
  classId: string;
  className: string;
  accentColor: string;
  notebookId: string;
  notebookTitle: string;
  notebookColor?: string;
  dueAt: string | null;
  grading: "none" | "complete" | "points" | "letter";
  pointsMax: number;
  total: number;
  complete: number;
  status: "not_started" | "in_progress" | "submitted" | "returned";
  grade: { points: number | null; letter: string | null; complete: number | null } | null;
}

function toCardData(a: MyAssignment): StudentAssignmentData {
  return {
    id: a.id,
    title: a.title,
    notebookId: a.notebookId,
    notebookTitle: a.notebookTitle,
    notebookColor: a.notebookColor,
    pageCount: a.total,
    dueAt: a.dueAt,
    grading: a.grading,
    pointsMax: a.pointsMax,
    complete: a.complete,
    status: a.status,
    grade: a.grade,
  };
}

type WorkTab = "todo" | "handed-in" | "marked";

const WORK_TABS: { key: WorkTab; label: string }[] = [
  { key: "todo", label: "To do" },
  { key: "handed-in", label: "Handed in" },
  { key: "marked", label: "Marked" },
];

const WORK_EMPTY: Record<WorkTab, string> = {
  todo: "Nothing due. Enjoy it.",
  "handed-in": "Nothing waiting to be marked.",
  marked: "No marked work yet.",
};

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
  const [joinOpen, setJoinOpen] = useState(false);
  const [workTab, setWorkTab] = useState<WorkTab>("todo");

  const assignments = assignmentsQ.data?.assignments ?? [];
  const buckets = useMemo(() => {
    const todo: MyAssignment[] = [];
    const handedIn: MyAssignment[] = [];
    const marked: MyAssignment[] = [];
    for (const a of assignments) {
      if (a.status === "returned") marked.push(a);
      else if (a.status === "submitted") handedIn.push(a);
      else todo.push(a);
    }
    return { todo, "handed-in": handedIn, marked };
  }, [assignments]);

  const current = buckets[workTab];

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

      <section>
        <h2 className="label-caps mb-3 text-pine/70">Assignments</h2>

        <div className="mb-5 flex items-center gap-3 overflow-x-auto">
          <div className="flex gap-1 rounded-full border-[3px] border-pine bg-white p-1">
            {WORK_TABS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setWorkTab(key)}
                className={cn(
                  "inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-full px-4 font-display text-[17px] transition-colors sm:px-5",
                  workTab === key ? "bg-pine text-oat" : "text-pine hover:bg-pine/8",
                )}
              >
                {label}
                <Chip tone={workTab === key ? "mint" : "quiet"} className="h-6 min-w-6 justify-center px-1.5 text-[14px]">
                  {buckets[key].length}
                </Chip>
              </button>
            ))}
          </div>
        </div>

        {assignmentsQ.isLoading && <Spinner />}
        {assignmentsQ.error && <ErrorNote error={assignmentsQ.error as Error} />}
        {!assignmentsQ.isLoading && !assignmentsQ.error && assignments.length === 0 && (
          <EmptyState title="No assignments yet" body="Join a class to see assignments here." />
        )}
        {!assignmentsQ.isLoading && !assignmentsQ.error && assignments.length > 0 && current.length === 0 && (
          <EmptyState title={WORK_EMPTY[workTab]} />
        )}
        {!assignmentsQ.isLoading && !assignmentsQ.error && current.length > 0 && (
          <div className="space-y-3">
            {current.map((a) => (
              <StudentAssignmentCard key={a.id} a={toCardData(a)} />
            ))}
          </div>
        )}
      </section>

      {joinOpen && <JoinClassModal onClose={() => setJoinOpen(false)} />}
    </Shell>
  );
}
