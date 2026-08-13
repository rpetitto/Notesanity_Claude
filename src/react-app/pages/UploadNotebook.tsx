import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { convertToPdf, hasGoogleClientId, needsConversion } from "../lib/google";
import { readPageSizes } from "../lib/pdf";
import Shell, { ErrorNote } from "../components/Shell";
import { cn } from "../lib/utils";

type Phase = "idle" | "converting" | "uploading" | "reading" | "creating" | "done";

/**
 * Turns an uploaded document into a notebook.
 *
 * Word and PowerPoint files are converted to PDF in the browser via the teacher's
 * own Google Drive; PDFs go straight up. Page records are created from dimensions
 * pdf.js reads client-side, so the server never has to parse a PDF.
 */
export default function UploadNotebook() {
  const { classId = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const incoming = (location.state as { file?: File } | null)?.file;

  const [file, setFile] = useState<File | null>(incoming ?? null);
  const [title, setTitle] = useState(incoming ? incoming.name.replace(/\.[^.]+$/, "") : "");
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<Error | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const started = useRef(false);

  const run = useCallback(async (source: File, notebookTitle: string) => {
    setError(null);
    try {
      let pdf: Blob = source;

      if (needsConversion(source)) {
        if (!hasGoogleClientId) {
          throw new Error(
            "Word and PowerPoint conversion needs Google Drive access, which isn't configured. Export the file to PDF and upload that instead.",
          );
        }
        setPhase("converting");
        pdf = await convertToPdf(source, setMessage);
      }

      setPhase("uploading");
      setMessage("Uploading…");
      const form = new FormData();
      form.append("file", new File([pdf], source.name.replace(/\.[^.]+$/, ".pdf"), { type: "application/pdf" }));
      form.append("title", notebookTitle.trim() || source.name.replace(/\.[^.]+$/, ""));
      const created = await api.upload<{ notebook: { id: string; assetKey: string } }>(
        `/api/classes/${classId}/notebooks`,
        form,
      );

      setPhase("reading");
      setMessage("Reading pages…");
      const sizes = await readPageSizes(pdf);
      if (sizes.length === 0) throw new Error("That PDF has no pages.");

      setPhase("creating");
      setMessage(`Creating ${sizes.length} page${sizes.length === 1 ? "" : "s"}…`);
      await api.post(`/api/notebooks/${created.notebook.id}/pages`, {
        assetKey: created.notebook.assetKey,
        pages: sizes,
      });

      setPhase("done");
      toast.success(`Notebook ready — ${sizes.length} pages`);
      navigate(`/notebooks/${created.notebook.id}/edit`, { replace: true });
    } catch (err) {
      setPhase("idle");
      setError(err as Error);
    }
  }, [classId, navigate]);

  // A file handed over from the class screen starts immediately.
  useEffect(() => {
    if (incoming && !started.current) {
      started.current = true;
      void run(incoming, incoming.name.replace(/\.[^.]+$/, ""));
    }
  }, [incoming, run]);

  const busy = phase !== "idle" && phase !== "done";

  return (
    <Shell>
      <div className="mx-auto max-w-xl">
        <h1 className="text-xl font-semibold">New notebook</h1>
        <p className="mt-1 text-sm text-slate-500">
          Upload a PDF, Word document, or PowerPoint. Notesanity keeps the original layout exactly as it is and
          turns each page into a workspace your students can write on.
        </p>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
          {error && <div className="mb-4"><ErrorNote error={error} /></div>}

          <label className="block text-sm font-medium text-slate-700">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Unit 3 — Cell Structure"
            disabled={busy}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />

          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className={cn(
              "mt-4 flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 transition-colors",
              busy ? "border-slate-200 bg-slate-50" : "border-slate-300 hover:border-blue-400 hover:bg-blue-50/40",
            )}
          >
            {busy ? <Loader2 className="h-7 w-7 animate-spin text-blue-600" /> : <FileUp className="h-7 w-7 text-slate-400" />}
            <span className="text-sm font-medium text-slate-700">
              {busy ? message || "Working…" : file ? file.name : "Choose a file"}
            </span>
            {!busy && <span className="text-xs text-slate-500">PDF, DOCX, or PPTX · up to 25MB</span>}
          </button>

          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,.doc,.pptx,.ppt,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setFile(f);
              if (!title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ""));
            }}
          />

          {needsConversion(file ?? new File([], "x.pdf")) && !busy && (
            <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
              Office files are converted to PDF through your own Google Drive. You'll be asked to grant access once —
              the temporary file is deleted straight after conversion.
            </p>
          )}

          <div className="mt-5 flex gap-2">
            <button
              type="button"
              disabled={!file || busy}
              onClick={() => file && run(file, title)}
              className="flex-1 rounded-full bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? "Working…" : "Create notebook"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => navigate(`/classes/${classId}`)}
              className="rounded-full border border-slate-300 px-4 py-2.5 text-sm hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </Shell>
  );
}
