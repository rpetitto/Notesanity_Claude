import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, KeyRound, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import Shell, { EmptyState, ErrorNote, Spinner } from "../components/Shell";
import { StudentAssignmentCard, type StudentAssignmentData } from "./ClassView";
import StudentAssignmentNav, {
  WORK_EMPTY, bucketAssignments, type WorkTab,
} from "../components/StudentAssignmentNav";
import {Button, CardLink, Input, Modal } from "../components/ui";
import { api, assetUrl, type ClassSummary } from "../lib/api";
import PageThumb from "../components/PageThumb";
import NewNotebookModal from "../components/NewNotebookModal";
import { relativeTime } from "../lib/utils";
import { useNavigate } from "react-router-dom";

/** `GET /api/classes` rows also carry `emoji` — declared locally since `ClassSummary`
 * (shared with other owners' code) doesn't yet. There's no `hasCover` flag on this
 * endpoint, so cards probe the cover image directly and fall back on error. */
interface PersonalNotebook {
  id: string;
  title: string;
  page_count: number;
  updated_at: string;
  first_asset_key: string | null;
  first_source_index: number | null;
  first_width: number | null;
  first_height: number | null;
  first_pattern: string | null;
  first_pattern_color: string | null;
}

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
    status: a.status,
    grade: a.grade,
  };
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

/**
 * The student's own notebooks.
 *
 * Deliberately separate from anything a class hands them: these are private,
 * can't be shared or assigned, and no teacher can open them. They live here
 * because this is where a student already starts their day.
 */
function MyNotebooks() {
  const qc = useQueryClient();
  const [newOpen, setNewOpen] = useState(false);
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ["personal-notebooks"],
    queryFn: () => api.get<{ notebooks: PersonalNotebook[] }>("/api/my/personal-notebooks"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/my/personal-notebooks/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["personal-notebooks"] }); toast.success("Notebook deleted"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const notebooks = data?.notebooks ?? [];

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="label-caps text-pine/70">My notebooks</h2>
        <Button variant="secondary" onClick={() => setNewOpen(true)}>
          <Plus className="h-4 w-4" strokeWidth={2.5} /> New notebook
        </Button>
      </div>
      <p className="mb-3 text-[16px] text-pine/70">
        Your own notes — private to you, and separate from anything a class sets.
      </p>

      {isLoading && <Spinner />}
      {error && <ErrorNote error={error as Error} />}
      {!isLoading && !error && notebooks.length === 0 && (
        <EmptyState
          title="No notebooks of your own yet"
          body="Start from lined paper, a planner or graph paper — or bring in a PDF to write on."
          action={<Button variant="primary" onClick={() => setNewOpen(true)}>
            <Plus className="h-4 w-4" strokeWidth={2.5} /> New notebook
          </Button>}
        />
      )}
      {notebooks.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {notebooks.map((nb) => (
            <div key={nb.id} className="group relative">
              <CardLink to={`/notebooks/${nb.id}`}>
                <div className="flex h-32 items-center justify-center overflow-hidden bg-oat">
                  {(nb.first_asset_key || nb.first_pattern) && nb.first_width ? (
                    <PageThumb
                      pdfUrl={assetUrl(nb.id, nb.first_asset_key ?? undefined)}
                      sourceIndex={nb.first_source_index ?? 0}
                      pageWidth={nb.first_width}
                      pageHeight={nb.first_height ?? 792}
                      pattern={nb.first_pattern ?? undefined}
                      patternColor={nb.first_pattern_color ?? undefined}
                      width={92}
                    />
                  ) : (
                    <BookOpen className="h-6 w-6 text-pine/40" strokeWidth={2.5} />
                  )}
                </div>
                <div className="p-3">
                  <div className="truncate font-display text-[16px] font-bold text-pine">{nb.title}</div>
                  <div className="mt-0.5 text-[16px] text-pine/70">
                    {nb.page_count} page{nb.page_count === 1 ? "" : "s"} · {relativeTime(nb.updated_at)}
                  </div>
                </div>
              </CardLink>
              <button
                type="button"
                aria-label={`Delete ${nb.title}`}
                onClick={() => {
                  if (window.confirm(`Delete "${nb.title}" and everything in it? This can't be undone.`)) {
                    remove.mutate(nb.id);
                  }
                }}
                className="absolute right-2 top-2 hidden h-9 w-9 items-center justify-center rounded-full border-2 border-pine bg-white text-[#a3341f] group-hover:flex hover:bg-[#a3341f]/10"
              >
                <Trash2 className="h-4 w-4" strokeWidth={2.5} />
              </button>
            </div>
          ))}
        </div>
      )}

      {newOpen && (
        <NewNotebookModal
          destination={{ kind: "personal" }}
          onClose={() => setNewOpen(false)}
          onCreated={(id) => { setNewOpen(false); navigate(`/notebooks/${id}`); }}
        />
      )}
    </section>
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
  const buckets = useMemo(() => bucketAssignments<MyAssignment>(assignments), [assignments]);

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

      <MyNotebooks />

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

        <StudentAssignmentNav
          className="mb-5"
          value={workTab}
          onChange={setWorkTab}
          counts={{
            todo: buckets.todo.length,
            "handed-in": buckets["handed-in"].length,
            marked: buckets.marked.length,
          }}
        />

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
