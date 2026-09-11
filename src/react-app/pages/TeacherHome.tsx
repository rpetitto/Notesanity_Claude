import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Archive, Plus, RotateCcw, Settings2, Users, BookOpen, Import } from "lucide-react";
import { toast } from "sonner";
import Shell, { EmptyState, ErrorNote, Spinner } from "../components/Shell";
import Tour from "../components/Tour";
import { Button, Input, Label, Menu, Modal, type MenuItem } from "../components/ui";
import { api, type ClassSummary } from "../lib/api";
import { hasGoogleClientId, listCourses, listStudents, type ClassroomCourse } from "../lib/google";
import { DEFAULT_ACCENT } from "../lib/utils";

/** `GET /api/classes` rows also carry `emoji` — declared locally since `ClassSummary`
 * (shared with other owners' code) doesn't yet. There's no `hasCover` flag on this
 * endpoint, so cards probe the cover image directly and fall back on error. */
interface ClassRow extends ClassSummary {
  emoji?: string;
  room?: string;
  archived?: number;
}

/** Close a modal on Escape while it's open. */
function useEscapeClose(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onClose]);
}

function ClassCard({ cls, menu }: { cls: ClassRow; menu?: MenuItem[] }) {
  const [coverFailed, setCoverFailed] = useState(false);
  const accent = cls.accent_color || DEFAULT_ACCENT;
  return (
    <Link
      to={`/classes/${cls.id}`}
      className="block overflow-hidden rounded-[22px] border-[3px] border-pine bg-white shadow-[4px_4px_0_0_var(--color-pine)] transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[5px_5px_0_0_var(--color-pine)]"
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
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-pine bg-oat text-[17px]">
              {cls.emoji}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate font-display text-[17px] text-pine">{cls.name}</div>
            <div className="truncate text-[16px] text-pine/70">
              {[cls.section, cls.room].filter(Boolean).join(" · ") || " "}
            </div>
          </div>
          {menu && menu.length > 0 && <Menu items={menu} className="-mr-1" />}
        </div>
        <div className="mt-4 flex items-center gap-4 text-[16px] text-pine/70">
          <span className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" strokeWidth={2.5} />
            {cls.student_count} student{cls.student_count === 1 ? "" : "s"}
          </span>
          <span className="flex items-center gap-1.5">
            <BookOpen className="h-3.5 w-3.5" strokeWidth={2.5} />
            {cls.notebook_count} notebook{cls.notebook_count === 1 ? "" : "s"}
          </span>
        </div>
      </div>
    </Link>
  );
}

function NewClassModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [section, setSection] = useState("");
  useEscapeClose(true, onClose);

  const mutation = useMutation({
    mutationFn: () => api.post("/api/classes", { name: name.trim(), section: section.trim() }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["classes"] });
      toast.success("Class created");
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Modal onClose={onClose} title="New class">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          mutation.mutate();
        }}
        className="space-y-4"
      >
        <div>
          <Label>Class name</Label>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Period 3 Biology"
            className="mt-1.5"
          />
        </div>
        <div>
          <Label>Section (optional)</Label>
          <Input
            value={section}
            onChange={(e) => setSection(e.target.value)}
            placeholder="Room 204"
            className="mt-1.5"
          />
        </div>
        <Button type="submit" variant="primary" disabled={!name.trim() || mutation.isPending} className="w-full">
          {mutation.isPending ? "Creating…" : "Create class"}
        </Button>
      </form>
    </Modal>
  );
}

function ImportClassroomModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [courses, setCourses] = useState<ClassroomCourse[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);
  useEscapeClose(true, onClose);

  useEffect(() => {
    let canceled = false;
    listCourses()
      .then((list) => {
        if (!canceled) setCourses(list);
      })
      .catch((err: Error) => {
        if (!canceled) setError(err.message);
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, []);

  const importCourse = async (course: ClassroomCourse) => {
    setImportingId(course.id);
    try {
      const students = await listStudents(course.id);
      const result = await api.post<{ added: number }>("/api/classes/import-classroom", {
        courseId: course.id,
        name: course.name,
        section: course.section ?? "",
        description: course.description ?? course.descriptionHeading ?? "",
        room: course.room ?? "",
        students: students.map((s) => ({ email: s.email, name: s.name, photoUrl: s.photoUrl })),
      });
      await qc.invalidateQueries({ queryKey: ["classes"] });
      toast.success(`Imported ${result.added} student${result.added === 1 ? "" : "s"}`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImportingId(null);
    }
  };

  return (
    <Modal onClose={onClose} title="Import from Google Classroom">
      {loading && <Spinner label="Loading your courses…" />}
      {!loading && error && <ErrorNote error={new Error(error)} />}
      {!loading && !error && courses && courses.length === 0 && (
        <p className="py-6 text-center text-[16px] text-pine/70">No active courses found in Google Classroom.</p>
      )}
      {!loading && !error && courses && courses.length > 0 && (
        <ul className="space-y-2">
          {courses.map((course) => (
            <li key={course.id}>
              <button
                type="button"
                disabled={importingId !== null}
                onClick={() => importCourse(course)}
                className="flex w-full items-center justify-between rounded-[12px] border-[3px] border-pine px-4 py-3 text-left text-[16px] hover:bg-oat disabled:opacity-60"
              >
                <span>
                  <span className="block font-display text-pine">{course.name}</span>
                  {course.section && <span className="block text-[16px] text-pine/70">{course.section}</span>}
                </span>
                {importingId === course.id && (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-pine/25 border-t-pine" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

export default function TeacherHome() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [showArchived, setShowArchived] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["classes", showArchived ? "archived" : "active"],
    queryFn: () =>
      api.get<{ classes: ClassRow[] }>(`/api/classes${showArchived ? "?archived=1" : ""}`),
  });
  const [newClassOpen, setNewClassOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const setArchived = useMutation({
    mutationFn: ({ classId, archived }: { classId: string; archived: boolean }) =>
      api.patch(`/api/classes/${classId}`, { archived }),
    onSuccess: async (_r, { archived }) => {
      await qc.invalidateQueries({ queryKey: ["classes"] });
      toast.success(archived ? "Class archived" : "Class is back");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * Archiving is offered here; deleting is not.
   *
   * Deleting a class needs its name typed back, and a card in a grid is the
   * wrong place to ask for that — it belongs on the class itself, where the
   * person has already navigated to the thing they mean. The menu points there.
   */
  const classMenu = (cls: ClassRow): MenuItem[] => [
    {
      label: cls.archived ? "Bring the class back" : "Archive class",
      icon: cls.archived
        ? <RotateCcw className="h-5 w-5" strokeWidth={2.5} />
        : <Archive className="h-5 w-5" strokeWidth={2.5} />,
      hint: cls.archived
        ? "Back on everyone's list, and writable again."
        : "Its notebooks and assignments go too. Students keep read-only access.",
      onClick: () => {
        if (cls.archived || window.confirm(
          `Archive "${cls.name}"? Its notebooks and assignments go with it, and you can bring it all back.`,
        )) setArchived.mutate({ classId: cls.id, archived: !cls.archived });
      },
    },
    {
      label: "Open class settings",
      icon: <Settings2 className="h-5 w-5" strokeWidth={2.5} />,
      hint: "Details, cover, and deleting if it comes to that.",
      onClick: () => navigate(`/classes/${cls.id}`),
    },
  ];

  return (
    <Shell>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-[32px] text-pine">
          {showArchived ? "Archived classes" : "Classes"}
        </h1>
        {/* The two actions are wider than a handset once the title is beside
            them, so they drop to their own line rather than push the page. */}
        <div className="flex flex-wrap items-center gap-2">
          {hasGoogleClientId && (
            <Button type="button" variant="secondary" data-tour="import-classroom" onClick={() => setImportOpen(true)}>
              <Import className="h-4 w-4" strokeWidth={2.5} />
              Import from Classroom
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={() => setShowArchived((v) => !v)}>
            <Archive className="h-4 w-4" strokeWidth={2.5} />
            {showArchived ? "Back to my classes" : "Archived"}
          </Button>
          {!showArchived && (
            <Button type="button" variant="primary" data-tour="new-class" onClick={() => setNewClassOpen(true)}>
              <Plus className="h-4 w-4" strokeWidth={2.5} />
              New class
            </Button>
          )}
        </div>
      </div>

      {isLoading && <Spinner />}
      {error && <ErrorNote error={error as Error} />}
      {!isLoading && !error && data && data.classes.length === 0 && (
        showArchived ? (
          <EmptyState
            title="Nothing archived"
            body="Classes you archive end up here, with everything in them kept."
          />
        ) : (
          <EmptyState
            title="No classes yet"
            body="Create your first class to start building notebooks for your students."
            action={
              <Button type="button" variant="primary" onClick={() => setNewClassOpen(true)}>
                <Plus className="h-4 w-4" strokeWidth={2.5} />
                New class
              </Button>
            }
          />
        )
      )}
      {!isLoading && !error && data && data.classes.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.classes.map((cls) => (
            <ClassCard key={cls.id} cls={cls} menu={classMenu(cls)} />
          ))}
        </div>
      )}

      {newClassOpen && <NewClassModal onClose={() => setNewClassOpen(false)} />}
      {importOpen && <ImportClassroomModal onClose={() => setImportOpen(false)} />}

      {/* Only while nothing else is open: a spotlight over a modal would ring
          the form rather than the button the step is talking about. */}
      {!newClassOpen && !importOpen && <Tour place="home" />}
    </Shell>
  );
}
