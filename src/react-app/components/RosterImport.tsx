/**
 * Roster a school from a spreadsheet: people and their roles, before anyone
 * signs in.
 *
 * The file is read here, in the browser — only the rows go to the server —
 * and nothing changes until the admin has seen, line by line, what would.
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileUp } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { cn } from "../lib/utils";
import { Button, Modal, Textarea } from "./ui";

interface RosterRow { email: string; name: string; role: string }
interface RosterResult {
  applied: boolean;
  summary: { create: number; change: number; same: number; skip: number };
  rows: (RosterRow & { line: number; outcome: "create" | "change" | "same" | "skip"; detail: string })[];
}

/** Fields of one CSV line, honoring quotes ("Smith, Jo") and doubled quotes. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === "," || ch === "\t" || ch === ";") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((f) => f.trim());
}

/**
 * Rows from a spreadsheet export. A header row names the columns (email,
 * name — or first and last name — and role); without one, the columns are
 * read as email, name, role.
 */
export function parseRoster(text: string): RosterRow[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const first = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const hasHeader = first.some((h) => /e-?mail/.test(h)) && !first.some((h) => h.includes("@"));
  const col = (...names: RegExp[]) => first.findIndex((h) => names.some((n) => n.test(h)));
  const at = hasHeader
    ? {
        email: col(/e-?mail/),
        name: col(/^(full )?name$/, /^student name$/, /^teacher name$/),
        first: col(/^first/),
        last: col(/^last/, /^surname/),
        role: col(/^role$/, /^type$/, /^position$/),
      }
    : { email: 0, name: 1, first: -1, last: -1, role: 2 };
  return lines.slice(hasHeader ? 1 : 0).map((line) => {
    const f = splitCsvLine(line);
    const name = at.name >= 0 ? f[at.name] ?? "" : [f[at.first] ?? "", f[at.last] ?? ""].join(" ").trim();
    return { email: f[at.email] ?? "", name, role: at.role >= 0 ? f[at.role] ?? "" : "" };
  });
}

const TEMPLATE = "email,name,role\njordan.lee@yourschool.org,Jordan Lee,teacher\nsam.rivera@yourschool.org,Sam Rivera,student\n";
const OUTCOME_LABEL = { create: "Add", change: "Change", same: "No change", skip: "Skip" } as const;

export function RosterImport({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<RosterResult | null>(null);
  const [filter, setFilter] = useState<"all" | "create" | "change" | "skip">("all");
  const rows = parseRoster(text);

  const check = useMutation({
    mutationFn: () => api.post<RosterResult>("/api/org/roster", { rows, apply: false }),
    onSuccess: (r) => { setPreview(r); setFilter(r.summary.skip ? "skip" : "all"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const apply = useMutation({
    mutationFn: () => api.post<RosterResult>("/api/org/roster", { rows, apply: true }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["org-users"] });
      toast.success(`Added ${r.summary.create}, changed ${r.summary.change}${r.summary.skip ? `, skipped ${r.summary.skip}` : ""}`);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const readFile = async (file: File) => {
    setFileName(file.name);
    setText(await file.text());
    setPreview(null);
  };

  const shown = preview ? preview.rows.filter((r) => filter === "all" || r.outcome === filter) : [];
  const busy = check.isPending || apply.isPending;

  return (
    <Modal onClose={busy ? () => {} : onClose} title="Import people from a spreadsheet" className="sm:max-w-3xl">
      <p className="text-[16px] text-pine/75">
        Add teachers and students before they sign in, or set the role of people already here. Someone
        who's on your roster keeps the role you give them, whichever button they pick when they sign in.
      </p>
      <p className="mt-2 text-[16px] text-pine/75">
        A CSV with columns <b>email</b>, <b>name</b> and <b>role</b> (teacher or student) — export it from
        your SIS or a spreadsheet.{" "}
        <a className="font-bold text-pine underline" download="notesanity-roster.csv"
          href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}>Download a template</a>
      </p>

      {!preview && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full border-[3px] border-pine bg-white px-5 font-display font-bold text-pine shadow-[4px_4px_0_0_var(--color-pine)] hover:bg-oat has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-mint">
              <FileUp className="h-5 w-5" strokeWidth={2.5} /> Choose a CSV file
              <input type="file" accept=".csv,text/csv,text/plain" className="sr-only" aria-label="CSV file"
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void readFile(f); }} />
            </label>
            <span className="text-[16px] text-pine/70">{fileName || "or paste rows below"}</span>
          </div>
          <Textarea aria-label="Roster rows" className="mt-3 font-mono text-[15px]" rows={6} value={text}
            placeholder={TEMPLATE.trim()} onChange={(e) => { setText(e.target.value); setPreview(null); }} />
          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
            {rows.length > 0 && <span className="mr-auto text-[16px] text-pine/70">{rows.length.toLocaleString()} row{rows.length === 1 ? "" : "s"} read</span>}
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!rows.length || busy} onClick={() => check.mutate()}>
              {check.isPending ? "Checking…" : "Check the list"}
            </Button>
          </div>
        </>
      )}

      {preview && (
        <>
          <div className="mt-4 flex flex-wrap gap-2" role="radiogroup" aria-label="Show">
            {([
              ["all", `All ${preview.rows.length}`],
              ["create", `Add ${preview.summary.create}`],
              ["change", `Change ${preview.summary.change}`],
              ["skip", `Skip ${preview.summary.skip}`],
            ] as const).map(([key, label]) => (
              <button key={key} type="button" role="radio" aria-checked={filter === key} onClick={() => setFilter(key)}
                className={cn("min-h-[44px] rounded-full border-2 px-4 font-display text-[16px] font-bold",
                  filter === key ? "border-pine bg-mint/40" : "border-pine/25 hover:bg-oat")}>
                {label}
              </button>
            ))}
            {preview.summary.same > 0 && <span className="self-center text-[16px] text-pine/60">{preview.summary.same} already right</span>}
          </div>
          <div className="mt-3 max-h-[45vh] overflow-auto rounded-[12px] border-2 border-pine/15">
            <table className="w-full text-left text-[16px]" data-testid="roster-preview">
              <thead className="sticky top-0 bg-oat">
                <tr><th className="px-3 py-2">Line</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Role</th><th className="px-3 py-2">What happens</th></tr>
              </thead>
              <tbody>
                {shown.slice(0, 500).map((r) => (
                  <tr key={r.line} className="border-t border-pine/10">
                    <td className="px-3 py-2 text-pine/60">{r.line}</td>
                    <td className="max-w-[16rem] truncate px-3 py-2">{r.email || <span className="text-pine/50">(blank)</span>}</td>
                    <td className="px-3 py-2 capitalize">{r.role || "—"}</td>
                    <td className={cn("px-3 py-2", r.outcome === "skip" && "text-[#7d2716]", r.outcome === "create" && "font-bold")}>
                      {OUTCOME_LABEL[r.outcome]}{r.detail ? ` — ${r.detail}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length === 0 && <p className="px-3 py-6 text-center text-[16px] text-pine/60">Nothing here.</p>}
            {shown.length > 500 && <p className="px-3 py-2 text-[15px] text-pine/60">Showing the first 500.</p>}
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" className="mr-auto" disabled={busy} onClick={() => setPreview(null)}>Back</Button>
            <Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={busy || (preview.summary.create + preview.summary.change === 0)} onClick={() => apply.mutate()}>
              {apply.isPending ? "Importing…" : `Add ${preview.summary.create} and change ${preview.summary.change}`}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
