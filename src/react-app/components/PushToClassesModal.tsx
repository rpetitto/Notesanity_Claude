/**
 * Push one template or several into one class or several.
 *
 * The menu used to list a "Push to …" line per class, which grew with every
 * section a teacher added and could only ever send one template at a time.
 * This is the one place a push happens: tick the classes, and every chosen
 * template goes into every chosen class it isn't already in, as a draft.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { Button, Modal } from "./ui";
import { cn } from "../lib/utils";
import { api, type ClassSummary } from "../lib/api";

export interface PushableTemplate {
  id: string;
  title: string;
  copies?: { classId: string }[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function PushToClassesModal({ templates, onClose, onDone }: {
  templates: PushableTemplate[];
  onClose: () => void;
  /** After at least one push has gone through — the caller clears a selection here. */
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const classes = useQuery({
    queryKey: ["classes", "active"],
    queryFn: () => api.get<{ classes: ClassSummary[] }>("/api/classes"),
  });
  const teachable = (classes.data?.classes ?? []).filter((c) => c.my_role === "teacher");

  /** How many of the chosen templates a class already has a copy of. */
  const alreadyIn = (classId: string) =>
    templates.filter((t) => (t.copies ?? []).some((c) => c.classId === classId)).length;

  const jobs = [...chosen].flatMap((classId) =>
    templates
      .filter((t) => !(t.copies ?? []).some((c) => c.classId === classId))
      .map((t) => ({ templateId: t.id, classId })),
  );

  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const run = async () => {
    setBusy(true);
    const made: string[] = [];
    const failed: string[] = [];
    // One after another rather than all at once: each push checks the plan's
    // notebook allowance, and a burst would race past it.
    for (const job of jobs) {
      try {
        const res = await api.post<{ notebook: { id: string } }>(`/api/templates/${job.templateId}/push`, { classId: job.classId });
        made.push(res.notebook.id);
      } catch (e) {
        failed.push((e as Error).message);
      }
    }
    setBusy(false);
    qc.invalidateQueries({ queryKey: ["teaching-notebooks"] });
    qc.invalidateQueries({ queryKey: ["classes"] });

    if (made.length) {
      const where = chosen.size === 1
        ? teachable.find((c) => chosen.has(c.id))?.name ?? "the class"
        : plural(chosen.size, "class", "classes");
      toast.success(
        made.length === 1
          ? `Now in ${where} as a draft — publish it there when it's ready.`
          : `${plural(made.length, "notebook")} now in ${where} as drafts — publish them there when they're ready.`,
        made.length === 1 ? { action: { label: "Open", onClick: () => navigate(`/notebooks/${made[0]}/edit`) } } : undefined,
      );
      onDone?.();
    }
    if (failed.length) {
      // The same refusal (usually the plan's limit) repeats per push; say it once.
      const reasons = [...new Set(failed)];
      toast.error(`${plural(failed.length, "push", "pushes")} didn't go through: ${reasons.join(" ")}`);
    }
    if (!failed.length) onClose();
  };

  const title = templates.length === 1 ? `Push “${templates[0].title}”` : `Push ${plural(templates.length, "template")}`;

  return (
    <Modal onClose={busy ? () => {} : onClose} title={title}>
      <p className="mb-4 text-[16px] text-pine/70">
        Each class gets its own copy as a draft. Publish it there when it's ready — and anything you add to the
        template later can be sent on with <span className="font-display text-pine">Send updates</span>.
      </p>

      {classes.isLoading && <p className="py-4 text-[16px] text-pine/70">Loading your classes…</p>}
      {!classes.isLoading && teachable.length === 0 && (
        <p className="py-4 text-[16px] text-pine/70">No classes to push to yet. Make a class first, or join one as a teacher.</p>
      )}

      {teachable.length > 0 && (
        <ul className="space-y-2">
          {teachable.map((c) => {
            const have = alreadyIn(c.id);
            const full = have === templates.length;
            const hint = full
              ? templates.length === 1 ? "Already there" : "Already has all of them"
              : have ? `Already has ${have} of ${templates.length} — the rest go in` : null;
            return (
              <li key={c.id}>
                <label
                  className={cn(
                    "flex min-h-[52px] items-center gap-3 rounded-[12px] border-[3px] border-pine px-3 py-2.5 text-[16px]",
                    full ? "cursor-default opacity-60" : "cursor-pointer hover:bg-oat",
                    chosen.has(c.id) && "bg-mint/25 hover:bg-mint/25",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={full || chosen.has(c.id)}
                    disabled={full || busy}
                    onChange={() => toggle(c.id)}
                    className="h-5 w-5 shrink-0 accent-mint"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-pine">
                      {c.name}{c.section ? <span className="text-pine/70"> · {c.section}</span> : null}
                    </span>
                    {hint && <span className="block text-[16px] text-pine/70">{hint}</span>}
                  </span>
                  {full && <Check className="h-5 w-5 shrink-0 text-pine/70" strokeWidth={2.5} aria-hidden />}
                </label>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={() => void run()} disabled={busy || jobs.length === 0}>
          {busy
            ? "Pushing…"
            : chosen.size === 0
              ? "Choose a class"
              : `Push to ${plural(chosen.size, "class", "classes")}`}
        </Button>
      </div>
    </Modal>
  );
}
