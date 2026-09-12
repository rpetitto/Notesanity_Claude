import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Download, MessageSquare } from "lucide-react";
import Shell, { EmptyState, ErrorNote, Spinner } from "../components/Shell";
import { Chip, IconButton, ButtonLink } from "../components/ui";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { useBackTo } from "../lib/useBackTo";
import { cn, formatDue } from "../lib/utils";

/** Page chrome when standalone; nothing when embedded inside the class tabs. */
function Frame({ embedded, wide, children }: { embedded?: boolean; wide?: boolean; children: React.ReactNode }) {
  return embedded ? <>{children}</> : <Shell wide={wide}>{children}</Shell>;
}

interface GbAssignment {
  id: string;
  title: string;
  grading: "none" | "complete" | "points" | "letter";
  points_max: number;
  due_at: string | null;
}

interface GbStudent {
  id: string;
  name: string;
  email: string;
}

interface GbSubmission {
  assignment_id: string;
  student_id: string;
  status: "not_started" | "in_progress" | "submitted" | "returned";
  grade_points: number | null;
  grade_letter: string | null;
  grade_complete: number | null;
}

interface GradebookResponse {
  assignments: GbAssignment[];
  students: GbStudent[];
  submissions: GbSubmission[];
}

function cellFor(a: GbAssignment, sub: GbSubmission | undefined): { text: string; ungraded: boolean } {
  if (!sub) return { text: "—", ungraded: false };
  const hasGrade = sub.grade_points !== null || sub.grade_letter !== null || sub.grade_complete !== null;
  if (!hasGrade) {
    const submitted = sub.status === "submitted" || sub.status === "returned";
    return { text: submitted ? "Submitted" : "—", ungraded: submitted };
  }
  if (a.grading === "points") return { text: sub.grade_points === null ? "—" : String(sub.grade_points), ungraded: false };
  if (a.grading === "letter") return { text: sub.grade_letter ?? "—", ungraded: false };
  if (a.grading === "complete") {
    return { text: sub.grade_complete === null ? "—" : sub.grade_complete ? "Complete" : "Incomplete", ungraded: false };
  }
  return { text: "—", ungraded: false };
}

// ---------- student "my grades" view ----------

interface MyGradeAssignment {
  id: string;
  title: string;
  notebookId: string;
  dueAt: string | null;
  grading: "none" | "complete" | "points" | "letter";
  pointsMax: number;
  status: "not_started" | "in_progress" | "submitted" | "returned";
  submittedAt: string | null;
  returnedAt: string | null;
  grade: { points: number | null; letter: string | null; complete: number | null; feedback?: string } | null;
}

interface MyGradesResponse {
  className: string;
  accentColor: string;
  assignments: MyGradeAssignment[];
  totals: { earned: number; possible: number; percent: number } | null;
}

const STATUS_LABEL: Record<MyGradeAssignment["status"], string> = {
  not_started: "Not started",
  in_progress: "In progress",
  submitted: "Turned in",
  returned: "Returned",
};

/** "Returned" is the one status that's actually done — it's the only one that gets Mint, and it's paired with the word itself. */
const STATUS_TONE: Record<MyGradeAssignment["status"], "quiet" | "default" | "warn" | "mint"> = {
  not_started: "quiet",
  in_progress: "default",
  submitted: "warn",
  returned: "mint",
};

function gradeText(a: MyGradeAssignment): string {
  if (!a.grade) return "Not returned yet";
  if (a.grading === "points") return `${a.grade.points ?? "—"} / ${a.pointsMax}`;
  if (a.grading === "letter") return a.grade.letter ?? "—";
  if (a.grading === "complete") return a.grade.complete ? "Complete" : "Incomplete";
  return "—";
}

function StudentGrades({ classId, embedded }: { classId: string; embedded?: boolean }) {
  const goBack = useBackTo("/work");
  const { data, isLoading, error } = useQuery({
    queryKey: ["my-grades", classId],
    queryFn: () => api.get<MyGradesResponse>(`/api/classes/${classId}/my-grades`),
    enabled: !!classId,
  });

  return (
    <Frame embedded={embedded}>
      {!embedded && (
        <button onClick={goBack} className="mb-4 inline-flex items-center gap-1.5 text-[16px] text-pine/70 hover:text-pine">
          <ArrowLeft className="h-4 w-4" strokeWidth={2.5} /> Back
        </button>
      )}

      {isLoading && <Spinner />}
      {error && <ErrorNote error={error as Error} />}

      {!isLoading && !error && data && (
        <>
          <div
            className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-[22px] border-[3px] border-pine bg-white p-6"
          >
            <div>
              <h1 className="font-display text-[22px] text-pine">{data.className}</h1>
              <p className="text-[16px] text-pine/70">My grades</p>
            </div>
            {data.totals && (
              <div className="text-right">
                <div className="font-display text-[32px] leading-none text-pine">{data.totals.percent}%</div>
                <div className="mt-1 text-[16px] text-pine/70">
                  {data.totals.earned} / {data.totals.possible} points
                </div>
              </div>
            )}
          </div>

          {data.assignments.length === 0 ? (
            <EmptyState title="No assignments yet" body="Grades will show up here once your teacher assigns work." />
          ) : (
            <div className="flex flex-col gap-3">
              {data.assignments.map((a) => (
                <Link
                  key={a.id}
                  to={`/notebooks/${a.notebookId}?assignment=${a.id}`}
                  className="block rounded-[22px] border-[3px] border-pine bg-white p-4 transition-colors hover:bg-oat"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-display text-pine">{a.title}</div>
                      <div className="text-[16px] text-pine/70">Due {formatDue(a.dueAt)}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Chip tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Chip>
                      <div className={cn("text-[16px] font-display", a.grade ? "text-pine" : "text-pine/45")}>
                        {gradeText(a)}
                      </div>
                    </div>
                  </div>
                  {a.grade?.feedback && (
                    <div className="mt-3 flex items-start gap-2 rounded-[12px] bg-oat px-3 py-2 text-[16px] italic text-pine/80">
                      <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pine/50" strokeWidth={2.5} />
                      <span>&ldquo;{a.grade.feedback}&rdquo;</span>
                    </div>
                  )}
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </Frame>
  );
}

// ---------- teacher matrix view ----------

function TeacherGradebook({ classId, embedded }: { classId: string; embedded?: boolean }) {
  const goBack = useBackTo("/classes");
  const { data, isLoading, error } = useQuery({
    queryKey: ["gradebook", classId],
    queryFn: () => api.get<GradebookResponse>(`/api/classes/${classId}/gradebook`),
    enabled: !!classId,
  });

  return (
    <Frame embedded={embedded} wide>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {!embedded && (
            <IconButton label="Back" onClick={goBack}>
              <ArrowLeft className="h-4 w-4" strokeWidth={2.5} />
            </IconButton>
          )}
          <h1 className="font-display text-[32px] text-pine">Gradebook</h1>
        </div>
        <ButtonLink href={`/api/classes/${classId}/gradebook.csv`} variant="secondary" size="sm">
          <Download className="h-4 w-4" strokeWidth={2.5} />
          Download CSV
        </ButtonLink>
      </div>

      {isLoading && <Spinner />}
      {error && <ErrorNote error={error as Error} />}

      {!isLoading && !error && data && (
        <div className="overflow-x-auto rounded-[22px] border-[3px] border-pine bg-white">
          <table className="w-full border-collapse text-[16px]">
            <thead>
              <tr className="border-b-2 border-pine/12 bg-oat">
                <th className="sticky left-0 z-10 min-w-[180px] bg-oat px-4 py-3 text-left font-display text-pine">
                  Student
                </th>
                {data.assignments.map((a) => (
                  <th key={a.id} className="min-w-[130px] whitespace-nowrap px-4 py-3 text-left font-display text-pine">
                    {a.title}
                    {a.grading === "points" && <span className="ml-1 font-sans font-normal text-pine/50">/{a.points_max}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.students.map((st) => (
                <tr key={st.id} className="border-b border-pine/15 last:border-0">
                  <td className="sticky left-0 z-10 bg-white px-4 py-3">
                    <div className="font-display text-pine">{st.name}</div>
                    <div className="text-[16px] text-pine/70">{st.email}</div>
                  </td>
                  {data.assignments.map((a) => {
                    const sub = data.submissions.find((s) => s.assignment_id === a.id && s.student_id === st.id);
                    const { text, ungraded } = cellFor(a, sub);
                    return (
                      <td
                        key={a.id}
                        className={cn("px-4 py-3", ungraded ? "font-display text-[#8a6a1f]" : "text-pine/80")}
                      >
                        {text}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {data.students.length === 0 && (
            <div className="px-4 py-10 text-center text-[16px] text-pine/70">No students enrolled yet.</div>
          )}
        </div>
      )}
    </Frame>
  );
}

/**
 * Rendered two ways: as its own route, and inline as a tab inside ClassView.
 * `embedded` drops the page chrome (Shell + back button) so it sits inside the
 * class tabs without a second header.
 */
export default function Gradebook({ embedded, classId: classIdProp }: { embedded?: boolean; classId?: string } = {}) {
  const params = useParams<{ classId: string }>();
  const id = classIdProp ?? params.classId ?? "";
  const { user, isLoading } = useSession();

  if (isLoading) return <Spinner label="Loading…" />;

  return user?.role === "student"
    ? <StudentGrades classId={id} embedded={embedded} />
    : <TeacherGradebook classId={id} embedded={embedded} />;
}
