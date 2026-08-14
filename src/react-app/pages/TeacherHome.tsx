import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Plus, Users, BookOpen, X, Import } from "lucide-react";
import { toast } from "sonner";
import Shell, { EmptyState, ErrorNote, Spinner } from "../components/Shell";
import { api, type ClassSummary } from "../lib/api";
import { hasGoogleClientId, listCourses, listStudents, type ClassroomCourse } from "../lib/google";

/** `GET /api/classes` rows also carry `emoji` — declared locally since `ClassSummary`
 * (shared with other owners' code) doesn't yet. There's no `hasCover` flag on this
 * endpoint, so cards probe the cover image directly and fall back on error. */
interface ClassRow extends ClassSummary {
  emoji?: string;
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
            <div className="truncate text-xs text-slate-500">{cls.section || " "}</div>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" />
            {cls.student_count} student{cls.student_count === 1 ? "" : "s"}
          </span>
          <span className="flex items-center gap-1.5">
            <BookOpen className="h-3.5 w-3.5" />
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">New class</h2>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            mutation.mutate();
          }}
          className="space-y-3"
        >
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Class name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Period 3 Biology"
              className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Section (optional)</label>
            <input
              value={section}
              onChange={(e) => setSection(e.target.value)}
              placeholder="Room 204"
              className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={!name.trim() || mutation.isPending}
            className="mt-2 h-11 w-full rounded-full bg-blue-600 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {mutation.isPending ? "Creating…" : "Create class"}
          </button>
        </form>
      </div>
    </div>
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
    let cancelled = false;
    listCourses()
      .then((list) => {
        if (!cancelled) setCourses(list);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Import from Google Classroom</h2>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading && <Spinner label="Loading your courses…" />}
        {!loading && error && <ErrorNote error={new Error(error)} />}
        {!loading && !error && courses && courses.length === 0 && (
          <p className="py-6 text-center text-sm text-slate-500">No active courses found in Google Classroom.</p>
        )}
        {!loading && !error && courses && courses.length > 0 && (
          <ul className="space-y-2">
            {courses.map((course) => (
              <li key={course.id}>
                <button
                  type="button"
                  disabled={importingId !== null}
                  onClick={() => importCourse(course)}
                  className="flex w-full items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-left text-sm hover:border-blue-300 hover:bg-blue-50/50 disabled:opacity-60"
                >
                  <span>
                    <span className="block font-medium text-slate-900">{course.name}</span>
                    {course.section && <span className="block text-xs text-slate-500">{course.section}</span>}
                  </span>
                  {importingId === course.id && (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function TeacherHome() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["classes"],
    queryFn: () => api.get<{ classes: ClassRow[] }>("/api/classes"),
  });
  const [newClassOpen, setNewClassOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  return (
    <Shell>
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Classes</h1>
        <div className="flex items-center gap-2">
          {hasGoogleClientId && (
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="flex h-11 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Import className="h-4 w-4" />
              Import from Classroom
            </button>
          )}
          <button
            type="button"
            onClick={() => setNewClassOpen(true)}
            className="flex h-11 items-center gap-1.5 rounded-full bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            New class
          </button>
        </div>
      </div>

      {isLoading && <Spinner />}
      {error && <ErrorNote error={error as Error} />}
      {!isLoading && !error && data && data.classes.length === 0 && (
        <EmptyState
          title="No classes yet"
          body="Create your first class to start building notebooks for your students."
          action={
            <button
              type="button"
              onClick={() => setNewClassOpen(true)}
              className="flex h-11 items-center gap-1.5 rounded-full bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              New class
            </button>
          }
        />
      )}
      {!isLoading && !error && data && data.classes.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.classes.map((cls) => (
            <ClassCard key={cls.id} cls={cls} />
          ))}
        </div>
      )}

      {newClassOpen && <NewClassModal onClose={() => setNewClassOpen(false)} />}
      {importOpen && <ImportClassroomModal onClose={() => setImportOpen(false)} />}
    </Shell>
  );
}
