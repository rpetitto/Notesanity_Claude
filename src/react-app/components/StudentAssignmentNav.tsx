/**
 * The student's assignment filter.
 *
 * Shared by "My work" and a class's Assignments tab so the two can't drift into
 * different shapes for the same idea. A student sees the same three buckets
 * whether they're looking across every class or inside one.
 */

import { cn } from "../lib/utils";

export type WorkTab = "todo" | "handed-in" | "marked";

export const WORK_TABS: { key: WorkTab; label: string }[] = [
  { key: "todo", label: "To do" },
  { key: "handed-in", label: "Handed in" },
  { key: "marked", label: "Marked" },
];

/** Empty copy per bucket, in the brand's voice — say it and get out of the way. */
export const WORK_EMPTY: Record<WorkTab, string> = {
  todo: "Nothing due. Enjoy it.",
  "handed-in": "Nothing waiting to be marked.",
  marked: "No marked work yet.",
};

type Status = "not_started" | "in_progress" | "submitted" | "returned";

/** Split a list of assignments into the three buckets the nav offers. */
export function bucketAssignments<T extends { status?: string; myStatus?: string }>(
  items: T[],
): Record<WorkTab, T[]> {
  const out: Record<WorkTab, T[]> = { todo: [], "handed-in": [], marked: [] };
  for (const item of items) {
    // `/api/my/assignments` calls it `status`; a class's list calls it
    // `myStatus`, because there `status` means the assignment's own state.
    const status = (item.myStatus ?? item.status ?? "not_started") as Status;
    if (status === "returned") out.marked.push(item);
    else if (status === "submitted") out["handed-in"].push(item);
    else out.todo.push(item);
  }
  return out;
}

export default function StudentAssignmentNav({
  value, onChange, counts, className,
}: {
  value: WorkTab;
  onChange: (tab: WorkTab) => void;
  counts: Record<WorkTab, number>;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-1 overflow-x-auto rounded-full border-[3px] border-pine bg-white p-1", className)}>
      {WORK_TABS.map(({ key, label }) => {
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            aria-pressed={active}
            className={cn(
              "inline-flex h-11 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-full px-4",
              "font-display text-[17px] font-bold transition-colors",
              active ? "bg-pine text-oat" : "text-pine hover:bg-pine/8",
            )}
          >
            {label}
            <span
              className={cn(
                "inline-flex h-6 min-w-6 items-center justify-center rounded-full border-2 px-1.5 text-[15px]",
                active ? "border-oat/40 text-oat" : "border-pine/25 text-pine/75",
              )}
            >
              {counts[key]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
