import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import Shell, { Avatar, EmptyState, ErrorNote, Spinner } from "../components/Shell";
import PageThumb from "../components/PageThumb";
import { ButtonLink, Card, Chip } from "../components/ui";
import { api, pageSource, type PageRec } from "../lib/api";
import { cn, formatDue, formatProgress, isOverdue, DEFAULT_ACCENT, type ProgressUnit } from "../lib/utils";

interface TeachingAssignment {
  id: string;
  title: string;
  classId: string;
  className: string;
  accentColor: string;
  classEmoji?: string;
  notebookId: string;
  notebookTitle: string;
  notebookColor?: string;
  notebookHasCover?: boolean;
  pageCount: number;
  dueAt: string | null;
  releaseAt: string | null;
  grading: "none" | "complete" | "points" | "letter";
  pointsMax: number;
  status: "draft" | "active";
  submitted: number;
  returned: number;
  graded: number;
  total: number;
}

type Filter = "all" | "needs-grading" | "draft";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "needs-grading", label: "Needs grading" },
  { key: "draft", label: "Draft" },
];

// ---------- shared card (also used by ClassView's Assignments tab) ----------

/** Minimal shape a card needs — both /api/my/teaching and /api/classes/:id/assignments satisfy this. */
export interface AssignmentCardData {
  id: string;
  title: string;
  notebookId: string;
  notebookTitle: string;
  /** The notebook's own accent colour — the assignment card's top strip and thumbnail tint borrow it. */
  notebookColor?: string;
  notebookHasCover?: boolean;
  pageCount: number;
  dueAt: string | null;
  status: "draft" | "active";
  submitted?: number;
  returned?: number;
  graded?: number;
  total?: number;
}

interface AssignmentDetailRow {
  student: { id: string; name: string; email: string; picture?: string | null };
  status: "not_started" | "in_progress" | "submitted" | "returned";
  submittedAt: string | null;
  returnedAt: string | null;
  complete: number;
  total: number;
  /** What `total` counts — fields when the teacher placed any, else pages. */
  unit?: ProgressUnit;
  grade: { points: number | null; letter: string | null; complete: number | null };
  feedback: string;
  graded: boolean;
}

interface AssignmentDetailResponse {
  assignment: {
    id: string;
    classId: string;
    notebookId: string;
    title: string;
    pageIds: string[];
    pages: { id: string; seq: number; label: string; number: number }[];
    pageNumbers: number[];
    releaseAt: string | null;
    dueAt: string | null;
    grading: "none" | "complete" | "points" | "letter";
    pointsMax: number;
    status: "draft" | "active";
  };
  isTeacher: boolean;
  rows?: AssignmentDetailRow[];
}

/** Compress a sorted-or-not list of page numbers into "4, 7–9" style ranges. */
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

const STATUS_TONE: Record<string, "quiet" | "warn" | "default" | "mint"> = {
  not_started: "quiet",
  in_progress: "warn",
  submitted: "default",
  returned: "mint",
};
const STATUS_LABELS: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  submitted: "Submitted",
  returned: "Returned",
};

function gradeLabel(
  grading: "none" | "complete" | "points" | "letter",
  pointsMax: number,
  grade: { points: number | null; letter: string | null; complete: number | null },
  graded: boolean,
): string {
  if (!graded) return "—";
  if (grading === "points") return grade.points !== null ? `${grade.points}/${pointsMax}` : "—";
  if (grading === "letter") return grade.letter ?? "—";
  if (grading === "complete") return grade.complete === null ? "—" : grade.complete ? "Complete" : "Incomplete";
  return "—";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="font-display text-[32px] leading-none text-pine">{value}</span>
      <span className="label-caps mt-1.5 text-pine/50">{label}</span>
    </div>
  );
}

function StudentRows({
  assignmentId,
  rows,
  grading,
  pointsMax,
}: {
  assignmentId: string;
  rows: AssignmentDetailRow[];
  grading: "none" | "complete" | "points" | "letter";
  pointsMax: number;
}) {
  if (rows.length === 0) return <p className="py-3 text-[16px] text-pine/70">No students enrolled.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-[16px]">
        <tbody className="divide-y divide-pine/10">
          {rows.map((r) => (
            <tr key={r.student.id} className="group">
              <td className="p-0">
                <Link
                  to={`/assignments/${assignmentId}?student=${encodeURIComponent(r.student.id)}`}
                  className="flex min-w-0 items-center gap-2 py-2 pr-3 group-hover:underline"
                >
                  <Avatar name={r.student.name} picture={r.student.picture} size={24} />
                  <span className="truncate text-pine">{r.student.name}</span>
                </Link>
              </td>
              <td className="py-2 pr-3">
                <Chip tone={STATUS_TONE[r.status] ?? "quiet"} className="text-[16px]">
                  {STATUS_LABELS[r.status] ?? r.status}
                </Chip>
              </td>
              <td className="whitespace-nowrap py-2 pr-3 text-[16px] text-pine/70">
                {formatProgress(r.complete, r.total, r.unit)}
              </td>
              <td className="whitespace-nowrap py-2 text-right font-display text-pine">
                {gradeLabel(grading, pointsMax, r.grade, r.graded)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A tall, information-dense assignment card: thumbnail stack, scorecard, and an expandable student roster. */
export function AssignmentCard({ a }: { a: AssignmentCardData }) {
  const [expanded, setExpanded] = useState(false);

  const notebookQ = useQuery({
    queryKey: ["notebook", a.notebookId],
    queryFn: () => api.get<{ pages: PageRec[] }>(`/api/notebooks/${a.notebookId}`),
  });

  // Needed both to render "Pages 4, 7–9" and to back the expandable student table —
  // react-query dedupes this across the two uses (and across cards that share a notebook).
  const detailQ = useQuery({
    queryKey: ["assignment", a.id],
    queryFn: () => api.get<AssignmentDetailResponse>(`/api/assignments/${a.id}`),
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

  const total = a.total ?? 0;
  const submitted = a.submitted ?? 0;
  const returned = a.returned ?? 0;
  const graded = a.graded;
  const overdue = isOverdue(a.dueAt) && submitted < total;
  const pct = total > 0 ? Math.round((submitted / total) * 100) : 0;

  const stackPages = assignedPages.slice(0, 4);
  const extra = Math.max(0, assignedPages.length - stackPages.length);
  const accent = a.notebookColor || DEFAULT_ACCENT;

  return (
    <Card>
      <div className="h-2" style={{ backgroundColor: accent }} />
      <div className="p-4">
        <div className="flex gap-4">
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
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <Link to={`/assignments/${a.id}`} className="block truncate font-display text-[17px] text-pine hover:underline">
                  {a.title}
                </Link>
                <div className="mt-0.5 truncate text-[16px] text-pine/70">
                  {a.notebookTitle} &middot; {pageNumbersLabel}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Chip tone={a.status === "draft" ? "quiet" : "default"}>
                    {a.status === "draft" ? "Draft" : "Active"}
                  </Chip>
                  <span className={cn("text-[16px]", overdue ? "font-display text-[#a3341f]" : "text-pine/70")}>
                    Due {formatDue(a.dueAt)}
                  </span>
                </div>
              </div>

              <ButtonLink to={`/assignments/${a.id}`} variant="secondary" size="sm">
                Grade
              </ButtonLink>
            </div>

            <div className="mt-3 flex flex-wrap items-end gap-6 sm:mt-4">
              <Stat label="Turned in" value={`${submitted}/${total}`} />
              {graded !== undefined && <Stat label="Graded" value={String(graded)} />}
              <Stat label="Returned" value={String(returned)} />
            </div>
            <div className="mt-2 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-oat">
              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: accent }} />
            </div>

            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-3 flex h-9 items-center gap-1 rounded-full px-2 font-display text-[16px] text-pine/70 hover:bg-pine/8"
            >
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} strokeWidth={2.5} />
              {expanded ? "Hide students" : "Show students"}
            </button>
          </div>
        </div>

        {expanded && (
          <div className="mt-3 border-t border-pine/15 pt-3">
            {detailQ.isLoading && <Spinner label="Loading students…" />}
            {detailQ.error && <ErrorNote error={detailQ.error as Error} />}
            {detailQ.data?.rows && (
              <StudentRows
                assignmentId={a.id}
                rows={detailQ.data.rows}
                grading={detailQ.data.assignment.grading}
                pointsMax={detailQ.data.assignment.pointsMax}
              />
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------- page ----------

export default function TeacherAssignments() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["my-teaching"],
    queryFn: () => api.get<{ assignments: TeachingAssignment[] }>("/api/my/teaching"),
  });
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(() => {
    const all = data?.assignments ?? [];
    if (filter === "needs-grading") return all.filter((a) => a.submitted > a.returned);
    if (filter === "draft") return all.filter((a) => a.status === "draft");
    return all;
  }, [data, filter]);

  const groups = useMemo(() => {
    const map = new Map<string, { className: string; accentColor: string; items: TeachingAssignment[] }>();
    for (const a of filtered) {
      const g = map.get(a.classId) ?? { className: a.className, accentColor: a.accentColor, items: [] };
      g.items.push(a);
      map.set(a.classId, g);
    }
    return Array.from(map.values());
  }, [filtered]);

  return (
    <Shell>
      <div className="mb-1 flex items-center justify-between gap-3">
        <h1 className="font-display text-[32px] text-pine">Assignments</h1>
      </div>
      <p className="mb-6 text-[16px] text-pine/70">Every assignment across every class you teach.</p>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={cn(
              "flex h-9 items-center rounded-full border-2 px-3.5 font-display text-[16px] transition-colors",
              filter === f.key ? "border-pine bg-pine text-oat" : "border-pine/25 bg-white text-pine hover:bg-oat",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading && <Spinner />}
      {error && <ErrorNote error={error as Error} />}
      {!isLoading && !error && data && data.assignments.length === 0 && (
        <EmptyState
          title="No assignments yet"
          body="Create a class and publish a notebook assignment to see it here."
          action={
            <ButtonLink to="/classes" variant="primary">
              Go to classes
            </ButtonLink>
          }
        />
      )}
      {!isLoading && !error && data && data.assignments.length > 0 && groups.length === 0 && (
        <EmptyState title="Nothing matches this filter" body="Try a different filter above." />
      )}
      {!isLoading && !error && groups.length > 0 && (
        <div className="space-y-8">
          {groups.map((g) => (
            <div key={g.className}>
              <div className="mb-3 flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: g.accentColor || DEFAULT_ACCENT }} />
                <h2 className="font-display text-[16px] text-pine">{g.className}</h2>
              </div>
              <div className="space-y-3">
                {g.items.map((a) => (
                  <AssignmentCard key={a.id} a={a} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}
