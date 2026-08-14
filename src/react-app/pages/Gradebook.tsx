import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Download, MessageSquare } from "lucide-react";
import Shell, { EmptyState, ErrorNote, Spinner } from "../components/Shell";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { useBackTo } from "../lib/useBackTo";
import { cn, formatDue } from "../lib/utils";

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

const STATUS_CLASS: Record<MyGradeAssignment["status"], string> = {
  not_started: "bg-slate-100 text-slate-600",
  in_progress: "bg-blue-50 text-blue-700",
  submitted: "bg-amber-50 text-amber-700",
  returned: "bg-emerald-50 text-emerald-700",
};

function gradeText(a: MyGradeAssignment): string {
  if (!a.grade) return "Not returned yet";
  if (a.grading === "points") return `${a.grade.points ?? "—"} / ${a.pointsMax}`;
  if (a.grading === "letter") return a.grade.letter ?? "—";
  if (a.grading === "complete") return a.grade.complete ? "Complete" : "Incomplete";
  return "—";
}

function StudentGrades({ classId }: { classId: string }) {
  const goBack = useBackTo("/work");
  const { data, isLoading, error } = useQuery({
    queryKey: ["my-grades", classId],
    queryFn: () => api.get<MyGradesResponse>(`/api/classes/${classId}/my-grades`),
    enabled: !!classId,
  });

  return (
    <Shell>
      <button
        onClick={goBack}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      {isLoading && <Spinner />}
      {error && <ErrorNote error={error as Error} />}

      {!isLoading && !error && data && (
        <>
          <div
            className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
            style={{ borderTopColor: data.accentColor, borderTopWidth: 4 }}
          >
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-900">{data.className}</h1>
              <p className="text-sm text-slate-500">My grades</p>
            </div>
            {data.totals && (
              <div className="text-right">
                <div className="text-3xl font-semibold tracking-tight text-slate-900">{data.totals.percent}%</div>
                <div className="text-xs text-slate-500">
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
                  className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-slate-300"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-slate-900">{a.title}</div>
                      <div className="text-xs text-slate-500">Due {formatDue(a.dueAt)}</div>
                    </div>
                    <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", STATUS_CLASS[a.status])}>
                      {STATUS_LABEL[a.status]}
                    </span>
                    <div className={cn("text-sm font-medium", a.grade ? "text-slate-900" : "text-slate-400")}>
                      {gradeText(a)}
                    </div>
                  </div>
                  {a.grade?.feedback && (
                    <div className="mt-3 flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm italic text-slate-600">
                      <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span>&ldquo;{a.grade.feedback}&rdquo;</span>
                    </div>
                  )}
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </Shell>
  );
}

// ---------- teacher matrix view ----------

function TeacherGradebook({ classId }: { classId: string }) {
  const goBack = useBackTo("/classes");
  const { data, isLoading, error } = useQuery({
    queryKey: ["gradebook", classId],
    queryFn: () => api.get<GradebookResponse>(`/api/classes/${classId}/gradebook`),
    enabled: !!classId,
  });

  return (
    <Shell wide>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={goBack} className="rounded-full p-2 text-slate-500 hover:bg-slate-100" aria-label="Back">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Gradebook</h1>
        </div>
        <a
          href={`/api/classes/${classId}/gradebook.csv`}
          className="flex h-10 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <Download className="h-4 w-4" />
          Download CSV
        </a>
      </div>

      {isLoading && <Spinner />}
      {error && <ErrorNote error={error as Error} />}

      {!isLoading && !error && data && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="sticky left-0 z-10 min-w-[180px] bg-slate-50 px-4 py-3 text-left font-medium text-slate-600">
                  Student
                </th>
                {data.assignments.map((a) => (
                  <th key={a.id} className="min-w-[130px] whitespace-nowrap px-4 py-3 text-left font-medium text-slate-600">
                    {a.title}
                    {a.grading === "points" && <span className="ml-1 font-normal text-slate-400">/{a.points_max}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.students.map((st) => (
                <tr key={st.id} className="border-b border-slate-100 last:border-0">
                  <td className="sticky left-0 z-10 bg-white px-4 py-3">
                    <div className="font-medium text-slate-900">{st.name}</div>
                    <div className="text-xs text-slate-500">{st.email}</div>
                  </td>
                  {data.assignments.map((a) => {
                    const sub = data.submissions.find((s) => s.assignment_id === a.id && s.student_id === st.id);
                    const { text, ungraded } = cellFor(a, sub);
                    return (
                      <td
                        key={a.id}
                        className={cn("px-4 py-3", ungraded ? "text-amber-600" : "text-slate-700")}
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
            <div className="px-4 py-10 text-center text-sm text-slate-500">No students enrolled yet.</div>
          )}
        </div>
      )}
    </Shell>
  );
}

export default function Gradebook() {
  const { classId } = useParams<{ classId: string }>();
  const id = classId ?? "";
  const { user, isLoading } = useSession();

  if (isLoading) return <Spinner label="Loading…" />;

  return user?.role === "student" ? <StudentGrades classId={id} /> : <TeacherGradebook classId={id} />;
}
