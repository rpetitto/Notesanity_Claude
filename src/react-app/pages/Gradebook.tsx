import { useMemo } from "react";
import { LETTER_PERCENT, gradeContribution, letterPercent } from "../../shared/grades.mjs";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Download, MessageSquare } from "lucide-react";
import Shell, { EmptyState, ErrorNote, Spinner } from "../components/Shell";
import { Chip, IconButton, ButtonLink } from "../components/ui";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { useBackTo } from "../lib/useBackTo";
import { cn, dueLabel } from "../lib/utils";

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
  created_at?: string | null;
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
  /** This student's own due date, when they have an extension. */
  due_override?: string | null;
}

interface GradebookResponse {
  assignments: GbAssignment[];
  students: GbStudent[];
  submissions: GbSubmission[];
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
              {data.assignments.every((a) => !a.grade) && (
                <p className="rounded-[12px] border-2 border-dashed border-pine/30 bg-white/60 px-4 py-3 text-[16px] text-pine/70">
                  Nothing has been graded yet. Your grades will appear here as your teacher grades your work.
                </p>
              )}
              {data.assignments.map((a) => (
                <Link
                  key={a.id}
                  to={`/notebooks/${a.notebookId}?assignment=${a.id}`}
                  className="block rounded-[22px] border-[3px] border-pine bg-white p-4 transition-colors hover:bg-oat"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-display text-pine">{a.title}</div>
                      <div className="text-[16px] text-pine/70">{dueLabel(a.dueAt)}</div>
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

/** "Thu · Mar 26" — the date over a column. */
function columnDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return "";
  const day = d.toLocaleDateString(undefined, { weekday: "short" });
  return `${day} · ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

/** "Anderson, Mike" from "Mike Anderson", the way a gradebook lists people. */
function surnameFirst(name: string): { sort: string; label: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return { sort: name.toLowerCase(), label: name };
  const last = parts.pop()!;
  return { sort: `${last} ${parts.join(" ")}`.toLowerCase(), label: `${last}, ${parts.join(" ")}` };
}

type CellState = "graded" | "low" | "to-grade" | "missing" | "open";

/** What one student has for one assignment, and how to show it. */
function gradeCell(a: GbAssignment, sub: GbSubmission | undefined): { text: string; state: CellState; score: number | null } {
  const handedIn = sub?.status === "submitted" || sub?.status === "returned";
  const max = a.points_max || 0;
  if (sub && a.grading === "points" && sub.grade_points !== null) {
    const low = max > 0 && sub.grade_points / max < 0.6;
    return { text: String(sub.grade_points), state: low ? "low" : "graded", score: max > 0 ? sub.grade_points / max : null };
  }
  if (sub && a.grading === "letter" && sub.grade_letter) {
    const pct = letterPercent(sub.grade_letter);
    return { text: sub.grade_letter, state: pct !== null && pct < 60 ? "low" : "graded", score: pct === null ? null : pct / 100 };
  }
  if (sub && a.grading === "complete" && sub.grade_complete !== null) {
    return sub.grade_complete
      ? { text: "✓", state: "graded", score: 1 }
      : { text: "✗", state: "low", score: 0 };
  }
  if (handedIn) return a.grading === "none" ? { text: "In", state: "graded", score: null } : { text: "To grade", state: "to-grade", score: null };
  const dueIso = sub?.due_override ?? a.due_at;
  const due = dueIso ? new Date(dueIso.includes("T") ? dueIso : dueIso.replace(" ", "T") + "Z") : null;
  if (due && due.getTime() < Date.now()) return { text: "Missing", state: "missing", score: null };
  return { text: "", state: "open", score: null };
}

const CELL_TONE: Record<CellState, string> = {
  graded: "text-pine",
  low: "font-bold text-[#a3341f]",
  "to-grade": "bg-[#fbe7b5] font-bold text-[#6b4f10]",
  missing: "bg-[#f6d5cc] font-bold text-[#7d2716]",
  open: "text-pine/40",
};

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round1 = (n: number) => Math.round(n * 10) / 10;

function TeacherGradebook({ classId, embedded }: { classId: string; embedded?: boolean }) {
  const goBack = useBackTo("/classes");
  const { data, isLoading, error } = useQuery({
    queryKey: ["gradebook", classId],
    queryFn: () => api.get<GradebookResponse>(`/api/classes/${classId}/gradebook`),
    enabled: !!classId,
  });

  // Newest work on the left, where a teacher's eye starts; people by surname.
  const assignments = useMemo(
    () => [...(data?.assignments ?? [])].sort((a, b) => (b.due_at ?? b.created_at ?? "").localeCompare(a.due_at ?? a.created_at ?? "")),
    [data?.assignments],
  );
  const students = useMemo(
    () => [...(data?.students ?? [])].map((s) => ({ ...s, ...surnameFirst(s.name) })).sort((a, b) => a.sort.localeCompare(b.sort)),
    [data?.students],
  );
  const subs = useMemo(() => {
    const m = new Map<string, GbSubmission>();
    for (const s of data?.submissions ?? []) m.set(`${s.assignment_id}:${s.student_id}`, s);
    return m;
  }, [data?.submissions]);

  const cell = (a: GbAssignment, studentId: string) => gradeCell(a, subs.get(`${a.id}:${studentId}`));

  /**
   * The running grade: points earned over points possible, with letters and
   * ticks turned into points the way shared/grades.mjs says — the same rule
   * the student's own grades page and the CSV use.
   */
  const average = (studentId: string): number | null => {
    let earned = 0;
    let possible = 0;
    for (const a of assignments) {
      const sub = subs.get(`${a.id}:${studentId}`);
      if (!sub) continue;
      const counts = gradeContribution({
        grading: a.grading, pointsMax: a.points_max, points: sub.grade_points, letter: sub.grade_letter, complete: sub.grade_complete,
      });
      if (counts) { earned += counts.earned; possible += counts.possible; }
    }
    return possible ? (earned / possible) * 100 : null;
  };

  /** Per column: points as raw scores; complete/incomplete and letters as percentages. */
  const columnStats = (a: GbAssignment) => {
    const xs: number[] = [];
    for (const st of students) {
      const sub = subs.get(`${a.id}:${st.id}`);
      if (!sub) continue;
      if (a.grading === "points" && sub.grade_points !== null) xs.push(sub.grade_points);
      if (a.grading === "complete" && sub.grade_complete !== null) xs.push(sub.grade_complete ? 100 : 0);
      if (a.grading === "letter") { const pct = letterPercent(sub.grade_letter); if (pct !== null) xs.push(pct); }
    }
    if (!xs.length) return { avg: "", med: "" };
    const suffix = a.grading === "points" ? "" : "%";
    return {
      avg: `${round1(xs.reduce((n, x) => n + x, 0) / xs.length)}${suffix}`,
      med: `${round1(median(xs)!)}${suffix}`,
    };
  };

  const toGrade = assignments.reduce((n, a) => n + students.filter((st) => cell(a, st.id).state === "to-grade").length, 0);
  const missing = assignments.reduce((n, a) => n + students.filter((st) => cell(a, st.id).state === "missing").length, 0);
  const averages = students.map((st) => average(st.id)).filter((x): x is number => x !== null);
  const classAverage = averages.length ? round1(averages.reduce((n, x) => n + x, 0) / averages.length) : null;
  const classMedian = averages.length ? round1(median(averages)!) : null;

  const corner = "sticky left-0 z-30 bg-oat";
  const nameCol = "sticky left-0 z-10 w-[200px] min-w-[200px] max-w-[200px] border-r-2 border-pine/15";
  const avgCol = "w-[92px] min-w-[92px] border-r-2 border-pine/15 text-right";
  const col = "w-[118px] min-w-[118px] max-w-[118px] border-r border-pine/10";

  return (
    <Frame embedded={embedded} wide>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
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

      {!isLoading && !error && data && (assignments.length === 0 || students.length === 0) && (
        <EmptyState
          title={students.length === 0 ? "No students yet" : "No assignments yet"}
          body={students.length === 0
            ? "Once students join the class, they'll be listed here with a column for each assignment."
            : "Assign pages from a notebook and each assignment becomes a column here, with every student's score."}
        />
      )}

      {!isLoading && !error && data && assignments.length > 0 && students.length > 0 && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[16px] text-pine/75" data-testid="gb-summary">
            <span>{students.length} student{students.length === 1 ? "" : "s"} · {assignments.length} assignment{assignments.length === 1 ? "" : "s"}</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-4 w-4 rounded-[4px] bg-[#fbe7b5]" aria-hidden /> {toGrade} to grade</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-4 w-4 rounded-[4px] bg-[#f6d5cc]" aria-hidden /> {missing} missing</span>
            <span className="inline-flex items-center gap-1.5"><span className="font-bold text-[#a3341f]">Red</span> score: under 60%</span>
          </div>

          <div className="max-h-[72vh] w-fit max-w-full overflow-auto rounded-[22px] border-[3px] border-pine bg-white" role="region" aria-label="Gradebook" tabIndex={0}>
            <table className="border-separate border-spacing-0 text-[16px]" data-testid="gradebook">
              <thead>
                <tr>
                  <th scope="col" className={cn(corner, nameCol, "top-0 border-b-2 border-pine/25 px-3 py-2 text-left align-bottom font-display text-pine")}>
                    Student
                  </th>
                  <th scope="col" className={cn(avgCol, "sticky top-0 z-20 border-b-2 border-pine/25 bg-oat px-3 py-2 align-bottom font-display text-pine")}>
                    Average
                  </th>
                  {assignments.map((a) => (
                    <th key={a.id} scope="col" className={cn(col, "sticky top-0 z-20 border-b-2 border-pine/25 bg-oat p-0 text-left align-top")}>
                      <Link
                        to={`/assignments/${a.id}`}
                        title={`${a.title} — open to grade`}
                        className="block h-full px-2.5 py-2 hover:bg-mint/30 focus-visible:bg-mint/30 focus-visible:outline-none"
                      >
                        <span className="block text-[15px] font-bold text-pine/70">{columnDate(a.due_at ?? a.created_at ?? null) || "No date"}</span>
                        <span className="line-clamp-2 block min-h-[2.5em] font-display text-[16px] leading-tight text-pine">{a.title}</span>
                        <span className="mt-1 block text-[15px] text-pine/65">
                          {a.grading === "points" ? `Max: ${a.points_max}` : a.grading === "complete" ? "Complete" : a.grading === "letter" ? "Letter" : "Not graded"}
                        </span>
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {students.map((st, i) => {
                  const avg = average(st.id);
                  return (
                    <tr key={st.id} className="group">
                      <th scope="row" className={cn(nameCol, "border-b border-pine/10 bg-white px-3 py-2 text-left font-normal group-hover:bg-oat")}>
                        <Link to={`/classes/${classId}/students/${st.id}`} title={st.email} className="block truncate text-pine hover:underline">
                          <span className="mr-2 inline-block w-5 text-right text-[15px] text-pine/45">{i + 1}</span>
                          <span className="font-bold">{st.label.split(",")[0]}</span>{st.label.includes(",") ? `,${st.label.split(",").slice(1).join(",")}` : ""}
                        </Link>
                      </th>
                      <td className={cn(avgCol, "border-b border-pine/10 bg-white px-3 py-2 font-bold tabular-nums group-hover:bg-oat", avg !== null && avg < 60 ? "text-[#a3341f]" : "text-pine")}>
                        {avg === null ? <span className="font-normal text-pine/40">—</span> : `${round1(avg)}%`}
                      </td>
                      {assignments.map((a) => {
                        const c = cell(a, st.id);
                        return (
                          <td key={a.id} className={cn(col, "border-b border-pine/10 p-0 text-center tabular-nums group-hover:brightness-[0.97]", CELL_TONE[c.state])}>
                            <Link
                              to={`/assignments/${a.id}?student=${st.id}`}
                              aria-label={`${st.name}, ${a.title}: ${c.text || "not handed in"}`}
                              className="block min-h-[44px] px-2 py-2.5 leading-6 hover:outline hover:outline-2 hover:-outline-offset-2 hover:outline-pine/40 focus-visible:outline focus-visible:outline-[3px] focus-visible:-outline-offset-[3px] focus-visible:outline-mint"
                            >
                              {c.text || "\u00a0"}
                            </Link>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                {([["Class average", "avg", classAverage], ["Class median", "med", classMedian]] as const).map(([label, key, overall]) => (
                  <tr key={key} className="bg-[#fbf5df]">
                    <th scope="row" className={cn(nameCol, "border-t-2 border-pine/20 bg-[#fbf5df] px-3 py-2 text-left font-display text-pine")}>{label}</th>
                    <td className={cn(avgCol, "border-t-2 border-pine/20 px-3 py-2 font-bold tabular-nums text-pine")}>{overall === null ? "" : `${overall}%`}</td>
                    {assignments.map((a) => (
                      <td key={a.id} className={cn(col, "border-t-2 border-pine/20 px-2 py-2 text-center tabular-nums text-pine/80")}>{columnStats(a)[key]}</td>
                    ))}
                  </tr>
                ))}
              </tfoot>
            </table>
          </div>
          <p className="mt-2 text-[15px] text-pine/60">
            Average is points earned out of points possible on graded work. Complete counts as full marks and incomplete as none; letter grades count as {Object.entries(LETTER_PERCENT).map(([l, v]) => `${l} ${v}`).join(", ")}. Click a score to open that student's work.
          </p>
        </>
      )}
    </Frame>
  );
}

/**
 * Rendered two ways: as its own route, and inline as a tab inside ClassView.
 * `embedded` drops the page chrome (Shell + back button) so it sits inside the
 * class tabs without a second header.
 */
export default function Gradebook({
  embedded, classId: classIdProp, classRole,
}: { embedded?: boolean; classId?: string; classRole?: "teacher" | "student" } = {}) {
  const params = useParams<{ classId: string }>();
  const id = classIdProp ?? params.classId ?? "";
  const { user, isLoading } = useSession();

  // Which gradebook you get is decided by your place in *this* class, not by
  // your account: a teacher enrolled in a colleague's class as a student has
  // grades to see here, and the teacher matrix would only refuse them. The
  // class page knows the role and passes it; the standalone route asks.
  const classQ = useQuery({
    queryKey: ["class", id],
    queryFn: () => api.get<{ myRole: "teacher" | "student" }>(`/api/classes/${id}`),
    enabled: !!id && !classRole,
  });
  const role = classRole ?? classQ.data?.myRole ?? (user?.role === "student" ? "student" : undefined);

  if (isLoading || !role) return <Spinner label="Loading…" />;

  return role === "student"
    ? <StudentGrades classId={id} embedded={embedded} />
    : <TeacherGradebook classId={id} embedded={embedded} />;
}
