/**
 * Print or download pages: the one dialog every notebook view opens.
 *
 * Which pages (this one, the selected ones, all of them, or a typed range),
 * whether to include what's been written on them, and where they go — the
 * printer, a PDF on this machine, or Drive. The rendering is the same for all
 * three; see lib/exportPdf.ts.
 */

import { useState } from "react";
import { Download, Loader2, Printer } from "lucide-react";
import { toast } from "sonner";
import type { PageRec } from "../lib/api";
import type { LayerData } from "../lib/ink";
import { hasGoogleClientId } from "../lib/google";
import { cn } from "../lib/utils";
import { exportNotebookPdf, parsePageRange, pdfFileName, printNotebookPages, renderNotebookPdf, type ExportContent } from "../lib/exportPdf";
import GoogleIcon from "./GoogleIcon";
import { Button, Input, Modal } from "./ui";

type Which = "current" | "selected" | "all" | "range";

export function ExportPagesDialog({
  notebookId, title, pages, currentPageId, selectedIds = [], layersFor, content, includeLabel, onClose,
}: {
  notebookId: string;
  title: string;
  /** In the order they're shown, so "page 3" means what the reader sees as page 3. */
  pages: PageRec[];
  currentPageId?: string | null;
  selectedIds?: string[];
  /** The ink for a page, with the writing switched on. */
  layersFor: (pageId: string) => LayerData[];
  content: ExportContent;
  /** What "Include …" covers here, mid-sentence: "your writing and answers", "Sam's writing and answers". */
  includeLabel: string;
  onClose: () => void;
}) {
  const selected = pages.filter((p) => selectedIds.includes(p.id));
  const currentIdx = Math.max(0, pages.findIndex((p) => p.id === currentPageId));
  const [which, setWhich] = useState<Which>(selected.length > 1 ? "selected" : "current");
  const [range, setRange] = useState("");
  const [include, setInclude] = useState(true);
  const [busy, setBusy] = useState<"" | "print" | "download" | "drive">("");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  const chosen = (): PageRec[] => {
    if (which === "current") return pages[currentIdx] ? [pages[currentIdx]] : [];
    if (which === "selected") return selected;
    if (which === "all") return pages;
    return parsePageRange(range, pages.length).map((i) => pages[i]);
  };

  const go = async (dest: "print" | "download" | "drive") => {
    setError("");
    let list: PageRec[];
    try {
      list = chosen();
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    if (!list.length) { setError("Choose at least one page."); return; }
    setBusy(dest);
    setProgress("Preparing…");
    try {
      const exportPages = list.map((page) => ({ page, layers: include ? layersFor(page.id) : [] }));
      const what = include ? content : { ...content, values: {} };
      const onProgress = (done: number, total: number) => setProgress(`Page ${done} of ${total}…`);
      const name = list.length === pages.length ? title : `${title} - ${list.length === 1 ? `page ${pages.indexOf(list[0]) + 1}` : `${list.length} pages`}`;
      if (dest === "print") {
        await printNotebookPages(notebookId, exportPages, onProgress, what);
        onClose();
        return;
      }
      if (dest === "download") {
        await exportNotebookPdf(notebookId, name, exportPages, onProgress, what);
        toast.success("Downloaded");
        onClose();
        return;
      }
      const blob = await renderNotebookPdf(notebookId, exportPages, onProgress, what);
      setProgress("Saving to Drive…");
      const { uploadPdfToDrive } = await import("../lib/google");
      const file = await uploadPdfToDrive(blob, pdfFileName(name));
      toast.success("Saved to your Google Drive", {
        duration: 8000,
        action: { label: "Open", onClick: () => window.open(file.link, "_blank", "noopener") },
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
      setProgress("");
    }
  };

  const option = (key: Which, label: string, extra?: React.ReactNode) => (
    <label className={cn(
      "flex min-h-[48px] cursor-pointer items-center gap-3 rounded-[12px] border-2 px-3.5 py-2 text-[16px]",
      which === key ? "border-pine bg-mint/25" : "border-pine/20 hover:bg-oat",
    )}>
      <input type="radio" name="export-which" checked={which === key} onChange={() => setWhich(key)} className="h-5 w-5 accent-[#20302C]" />
      <span className="font-bold">{label}</span>
      {extra}
    </label>
  );

  const count = (() => { try { return chosen().length; } catch { return 0; } })();
  const working = !!busy;

  return (
    <Modal onClose={working ? () => {} : onClose} title="Print or download">
      <fieldset aria-busy={working}>
        <legend className="label-caps mb-2 text-pine/70">Pages</legend>
        <div className="grid gap-2">
          {option("current", `This page (page ${currentIdx + 1})`)}
          {selected.length > 0 && option("selected", `Selected pages (${selected.length})`)}
          {option("all", `All pages (${pages.length})`)}
          {option("range", "Pages", (
            <Input
              aria-label="Page numbers"
              value={range}
              placeholder={pages.length > 2 ? `e.g. 1-3, ${pages.length}` : "e.g. 1-2"}
              className="ml-auto h-11 max-w-[11rem]"
              onFocus={() => setWhich("range")}
              onChange={(e) => { setRange(e.target.value); setWhich("range"); }}
            />
          ))}
        </div>
      </fieldset>

      <label className="mt-4 flex min-h-[44px] cursor-pointer items-center gap-3 text-[16px]">
        <input type="checkbox" checked={include} onChange={(e) => setInclude(e.target.checked)} className="h-5 w-5 accent-[#20302C]" />
        <span>
          <span className="font-bold">Include {includeLabel}</span>
          <span className="block text-[15px] text-pine/60">Off prints the pages as they were handed out.</span>
        </span>
      </label>

      {error && (
        <p role="alert" className="mt-4 rounded-[12px] border-2 border-[#a3341f] bg-[#a3341f]/5 px-4 py-3 text-[16px] text-[#7d2716]">{error}</p>
      )}
      {progress && <p role="status" className="mt-4 text-[16px] text-pine/70">{progress}</p>}

      <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="ghost" className="mr-auto" onClick={onClose} disabled={working}>Cancel</Button>
        {hasGoogleClientId && (
          <Button type="button" onClick={() => void go("drive")} disabled={working} aria-label="Save to Google Drive">
            {busy === "drive" ? <Loader2 className="h-5 w-5 animate-spin" /> : <GoogleIcon product="drive" />}
            <span className="hidden sm:inline">Drive</span>
          </Button>
        )}
        <Button type="button" onClick={() => void go("download")} disabled={working}>
          {busy === "download" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" strokeWidth={2.5} />}
          Download PDF
        </Button>
        <Button type="button" variant="primary" onClick={() => void go("print")} disabled={working}>
          {busy === "print" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Printer className="h-5 w-5" strokeWidth={2.5} />}
          Print{which !== "range" && count > 1 ? ` ${count} pages` : ""}
        </Button>
      </div>
    </Modal>
  );
}
