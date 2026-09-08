/**
 * Starting a notebook without a document to import.
 *
 * The same dialogue serves a teacher building a class notebook and a student
 * starting their own, because the choice is identical: pick the paper and say
 * how much of it, or bring a PDF. Only the destination differs, which the
 * caller supplies.
 *
 * Paper and length are chosen separately rather than bundled into fixed
 * templates. A ruling and a page count are independent decisions, and pairing
 * them meant "lined" only ever came as a hundred pages and "music" only ever as
 * thirty — a teacher wanting eight pages of staves had no way to say so.
 */

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { Button, Input, Modal } from "./ui";
import { api } from "../lib/api";
import {
  PATTERNS, PATTERN_COLORS, DEFAULT_PATTERN, DEFAULT_PATTERN_COLOR,
  renderPatternToCanvas, type PatternKey,
} from "../lib/patterns";
import { convertToPdf, needsConversion } from "../lib/google";
import { readPageSizes } from "../lib/pdf";
import { cn } from "../lib/utils";

/** The most pages one new notebook may start with. Mirrored on the server. */
const MAX_PAGES = 100;
const DEFAULT_PAGES = 50;

/** A sample of the paper, drawn with the code that paints the real page. */
function Sample({ pattern, color, width = 58 }: { pattern: string; color: string; width?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const height = Math.round((width * 792) / 612);
  useEffect(() => {
    if (ref.current) renderPatternToCanvas(pattern as PatternKey, color, 612, 792, ref.current, width / 612, 2);
  }, [pattern, color, width]);
  return <canvas ref={ref} style={{ width, height }} className="block rounded-[3px]" />;
}

export default function NewNotebookModal({
  destination, onClose, onCreated,
}: {
  /**
   * Where a new notebook goes: a class (the teacher's), the signed-in person's
   * own shelf, or a student's own notebook kept inside a class.
   */
  destination:
    | { kind: "class"; classId: string }
    | { kind: "personal" }
    | { kind: "student"; classId: string };
  onClose: () => void;
  onCreated: (notebookId: string) => void;
}) {
  const [pattern, setPattern] = useState<PatternKey>(DEFAULT_PATTERN);
  const [color, setColor] = useState(DEFAULT_PATTERN_COLOR);
  // Held as text so the field can be empty while being retyped, rather than
  // snapping back to a number under the cursor.
  const [pages, setPages] = useState(String(DEFAULT_PAGES));
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const count = Math.floor(Number(pages));
  const countValid = Number.isFinite(count) && count >= 1 && count <= MAX_PAGES;

  const createUrl =
    destination.kind === "class" ? `/api/classes/${destination.classId}/notebooks/blank`
    : destination.kind === "student" ? `/api/classes/${destination.classId}/my-notebooks`
    : "/api/my/personal-notebooks";

  // A teacher's class notebook is uploaded from the class page itself, so only
  // the two personal cases bring their own file in here.
  const uploadUrl =
    destination.kind === "student"
      ? `/api/classes/${destination.classId}/my-notebooks/upload`
      : "/api/my/personal-notebooks/upload";
  const canImport = destination.kind !== "class";

  const create = useMutation({
    mutationFn: () =>
      api.post<{ notebook: { id: string } }>(createUrl, {
        title: title.trim() || undefined,
        pattern,
        color,
        pages: count,
      }),
    onSuccess: (res) => onCreated(res.notebook.id),
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * Importing a PDF is a three-step dance: the file may need converting, the
   * upload creates the notebook, then the client reads the page sizes and
   * creates the page records.
   */
  const importPdf = async (file: File) => {
    try {
      let pdf: Blob = file;
      if (needsConversion(file)) {
        setBusy("Converting…");
        pdf = await convertToPdf(file, setBusy);
      }
      setBusy("Uploading…");
      const form = new FormData();
      form.append("file", new File([pdf], file.name.replace(/\.[^.]+$/, "") + ".pdf", { type: "application/pdf" }));
      if (title.trim()) form.append("title", title.trim());
      const { notebook } = await api.upload<{ notebook: { id: string } }>(uploadUrl, form);
      setBusy("Reading pages…");
      const sizes = await readPageSizes(pdf);
      await api.post(`/api/notebooks/${notebook.id}/pages`, { pages: sizes });
      onCreated(notebook.id);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  return (
    <Modal onClose={onClose} title="New notebook" className="sm:max-w-2xl">
      <label className="label-caps mb-1 block text-pine/70" htmlFor="nb-title">Name</label>
      <Input
        id="nb-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="My notebook"
      />

      <label className="label-caps mb-2 mt-5 block text-pine/70">Paper</label>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {PATTERNS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPattern(p.key)}
            aria-pressed={pattern === p.key}
            className={cn(
              "flex flex-col items-center gap-1.5 rounded-[12px] border-2 p-2 text-center transition-colors",
              pattern === p.key ? "border-pine bg-mint/25" : "border-pine/20 hover:bg-oat",
            )}
          >
            <span className="overflow-hidden rounded-[3px] border border-pine/25">
              <Sample pattern={p.key} color={color} />
            </span>
            <span className="text-[15px] font-bold leading-tight text-pine">{p.label}</span>
            <span className="text-[14px] leading-tight text-pine/60">{p.hint}</span>
          </button>
        ))}
      </div>

      <label className="label-caps mb-2 mt-5 block text-pine/70">Rule color</label>
      <div className="flex flex-wrap gap-2">
        {PATTERN_COLORS.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setColor(c.value)}
            aria-label={c.label}
            aria-pressed={color === c.value}
            title={c.label}
            className={cn(
              "h-11 w-11 rounded-full border-2 transition-transform",
              color === c.value ? "scale-110 border-pine" : "border-pine/25 hover:scale-105",
            )}
            style={{ background: c.value }}
          />
        ))}
      </div>

      <label className="label-caps mb-2 mt-5 block text-pine/70" htmlFor="nb-pages">Pages</label>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          id="nb-pages"
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_PAGES}
          value={pages}
          onChange={(e) => setPages(e.target.value)}
          className="w-28"
          aria-describedby="nb-pages-hint"
        />
        <span id="nb-pages-hint" className={cn("text-[16px]", countValid ? "text-pine/65" : "text-[#a3341f]")}>
          {countValid ? `1 to ${MAX_PAGES} — you can add more later.` : `Enter a number from 1 to ${MAX_PAGES}.`}
        </span>
      </div>

      {canImport && (
        <>
          <label className="label-caps mb-2 mt-5 block text-pine/70">Or bring your own</label>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,.doc,.pptx,.ppt,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void importPdf(f);
            }}
          />
          <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={!!busy}>
            <Upload className="h-4 w-4" strokeWidth={2.5} /> {busy || "Import a PDF"}
          </Button>
        </>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={create.isPending || !!busy}>Cancel</Button>
        <Button
          variant="primary"
          disabled={!countValid || create.isPending || !!busy}
          onClick={() => create.mutate()}
        >
          {create.isPending ? "Creating…" : `Create ${countValid ? count : ""} page${count === 1 ? "" : "s"}`}
        </Button>
      </div>
    </Modal>
  );
}
