import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import Shell, { EmptyState, ErrorNote, Spinner } from "../components/Shell";
import { api } from "../lib/api";
import { cn, formatDue, isOverdue } from "../lib/utils";

interface TeachingAssignment {
  id: string;
  title: string;
  classId: string;
  className: string;
  accentColor: string;
  notebookId: string;
  notebookTitle: string;
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

function AssignmentRow({ a }: { a: TeachingAssignment }) {
  const overdue = isOverdue(a.dueAt) && a.submitted < a.total;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm sm:flex-nowrap">
      <div className="min-w-0 flex-1">
        <Link to={`/assignments/${a.id}`} className="block truncate text-sm font-medium text-slate-900 hover:text-blue-700">
          {a.title}
        </Link>
        <div className="truncate text-xs text-slate-500">
          {a.notebookTitle} &middot; {a.pageCount} page{a.pageCount === 1 ? "" : "s"}
        </div>
      </div>
      <div className={cn("shrink-0 text-xs", overdue ? "font-medium text-rose-600" : "text-slate-500")}>
        {formatDue(a.dueAt)}
      </div>
      <span
        className={cn(
          "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium",
          a.status === "draft" ? "bg-slate-100 text-slate-600" : "bg-blue-50 text-blue-700",
        )}
      >
        {a.status === "draft" ? "Draft" : "Active"}
      </span>
      <div className="shrink-0 text-xs text-slate-500">
        {a.submitted}/{a.total} turned in &middot; {a.graded} graded
      </div>
      <Link
        to={`/assignments/${a.id}`}
        className="flex h-10 shrink-0 items-center rounded-full bg-blue-600 px-4 text-xs font-medium text-white hover:bg-blue-700"
      >
        Grade
      </Link>
    </div>
  );
}

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
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Assignments</h1>
      </div>
      <p className="mb-6 text-sm text-slate-500">Every assignment across every class you teach.</p>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={cn(
              "flex h-9 items-center rounded-full px-3.5 text-sm font-medium transition-colors",
              filter === f.key ? "bg-blue-600 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
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
            <Link
              to="/classes"
              className="flex h-10 items-center gap-1.5 rounded-full bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700"
            >
              Go to classes
            </Link>
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
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: g.accentColor || "#1A73E8" }} />
                <h2 className="text-sm font-semibold text-slate-700">{g.className}</h2>
              </div>
              <div className="space-y-2">
                {g.items.map((a) => (
                  <AssignmentRow key={a.id} a={a} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}
