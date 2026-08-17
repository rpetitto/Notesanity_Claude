/**
 * Starting a notebook without a document to import.
 *
 * The same dialogue serves a teacher building a class notebook and a student
 * starting their own, because the choice is identical: pick the paper, or bring
 * a PDF. Only the destination differs, which the caller supplies.
 *
 * Templates are fetched rather than hard-coded — the server already holds the
 * catalogue, and two copies would drift.
 */

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { Button, Input, Modal } from "./ui";
import { Spinner } from "./Shell";
import { api } from "../lib/api";
import { renderPatternToCanvas, type PatternKey } from "../lib/patterns";
import { convertToPdf, needsConversion } from "../lib/google";
import { readPageSizes } from "../lib/pdf";
import { cn } from "../lib/utils";

interface Template {
  key: string;
  label: string;
  description: string;
  pages: number;
  pattern: string;
  color: string;
}

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
  /** Where a new notebook goes: a class, or the signed-in person's own shelf. */
  destination: { kind: "class"; classId: string } | { kind: "personal" };
  onClose: () => void;
  onCreated: (notebookId: string) => void;
}) {
  const [selected, setSelected] = useState<string>("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const templatesQ = useQuery({
    queryKey: ["notebook-templates"],
    queryFn: () => api.get<{ templates: Template[] }>("/api/notebook-templates"),
  });
  const templates = templatesQ.data?.templates ?? [];
  const chosen = templates.find((t) => t.key === selected);

  const createUrl =
    destination.kind === "class"
      ? `/api/classes/${destination.classId}/notebooks/blank`
      : "/api/my/personal-notebooks";

  const create = useMutation({
    mutationFn: () =>
      api.post<{ notebook: { id: string } }>(createUrl, { template: selected, title: title.trim() || undefined }),
    onSuccess: (res) => onCreated(res.notebook.id),
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * Importing a PDF is a three-step dance: the file may need converting, the
   * upload creates the notebook, then the client reads the page sizes and
   * creates the page records. Only the last two apply to a personal notebook.
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
      const { notebook } = await api.upload<{ notebook: { id: string } }>(
        "/api/my/personal-notebooks/upload", form,
      );
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
        placeholder={chosen?.label ?? "My notebook"}
      />

      <label className="label-caps mb-2 mt-5 block text-pine/70">Start from</label>
      {templatesQ.isLoading && <Spinner />}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {templates.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setSelected(t.key)}
            aria-pressed={selected === t.key}
            className={cn(
              "flex flex-col items-center gap-1.5 rounded-[12px] border-2 p-2 text-center transition-colors",
              selected === t.key ? "border-pine bg-mint/25" : "border-pine/20 hover:bg-oat",
            )}
          >
            <span className="overflow-hidden rounded-[3px] border border-pine/25">
              <Sample pattern={t.pattern} color={t.color} />
            </span>
            <span className="text-[15px] font-bold leading-tight text-pine">{t.label}</span>
            <span className="text-[14px] leading-tight text-pine/60">{t.pages} pages</span>
          </button>
        ))}
      </div>

      {destination.kind === "personal" && (
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
          disabled={!selected || create.isPending || !!busy}
          onClick={() => create.mutate()}
        >
          {create.isPending ? "Creating…" : chosen ? `Create ${chosen.pages} pages` : "Create"}
        </Button>
      </div>
    </Modal>
  );
}
