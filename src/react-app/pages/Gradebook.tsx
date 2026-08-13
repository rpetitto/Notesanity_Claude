import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { Download } from "lucide-react";
import Shell, { ErrorNote, Spinner } from "../components/Shell";
import { api } from "../lib/api";
import { cn } from "../lib/utils";

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

export default function Gradebook() {
  const { classId } = useParams<{ classId: string }>();
  const id = classId ?? "";

  const { data, isLoading, error } = useQuery({
    queryKey: ["gradebook", id],
    queryFn: () => api.get<GradebookResponse>(`/api/classes/${id}/gradebook`),
    enabled: !!id,
  });

  return (
    <Shell wide>
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Gradebook</h1>
        <a
          href={`/api/classes/${id}/gradebook.csv`}
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
