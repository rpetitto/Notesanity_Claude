/**
 * Design a page with AI: describe it, look at it, change it, add it.
 *
 * The server designs; this dialog previews the design with its answer boxes
 * outlined, sends plain-words changes back, and on "Add to notebook" turns the
 * design into a PDF and adds it through the same routes an upload uses — the
 * page lands as an ordinary page the teacher can edit like any other.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw, Sparkles, Upload } from "lucide-react";
import { api, ApiError, type PageRec } from "../lib/api";
import { cn } from "../lib/utils";
import { renderPageToCanvas } from "../lib/pdf";
import { isPattern } from "../lib/patterns";
import { designToPdf, previewOf, sourceFileFor, sourceFromCanvas, type AiDesign } from "../lib/aiPages";
import { Button, Input, Modal, Textarea } from "./ui";
import { AI_PAGES_PAID } from "../../shared/plans.mjs";

interface Allowance {
  used: number; limit: number; remaining: number; paid: boolean; available: boolean; grade: string; subject: string;
}

const KINDS = [
  { key: "exit", label: "Exit ticket", example: "Adding fractions with unlike denominators, 4 problems" },
  { key: "reading", label: "Reading + questions", example: "A short passage on the water cycle with 5 questions" },
  { key: "vocabulary", label: "Vocabulary", example: "8 terms from the cell unit: definition, sentence, sketch" },
  { key: "organizer", label: "Graphic organizer", example: "Venn diagram comparing plant and animal cells" },
  { key: "math", label: "Math practice", example: "10 two-step equations, room to show work" },
  { key: "lab", label: "Lab sheet", example: "Density of household liquids, with a data table" },
  { key: "custom", label: "Something else", example: "Describe the page you want" },
] as const;
type Kind = (typeof KINDS)[number]["key"];
type SourceMode = "none" | "text" | "file" | "page";

export function AiPageDesigner({
  notebookId, insertAfterPageId, page, pdfUrl, onClose, onAdded,
}: {
  notebookId: string;
  /** Where the Add page menu said new pages go: after this page, or null for the end. */
  insertAfterPageId: string | null;
  /** The page on screen, offered as source material when it's a document. */
  page: PageRec | null;
  pdfUrl: string | null;
  onClose: () => void;
  onAdded: (pageIds: string[]) => void;
}) {
  const allowance = useQuery({
    queryKey: ["ai-allowance", notebookId],
    queryFn: () => api.get<Allowance>(`/api/ai/allowance?notebookId=${encodeURIComponent(notebookId)}`),
  });
  const a = allowance.data;

  const [kind, setKind] = useState<Kind>("exit");
  const [description, setDescription] = useState("");
  const [grade, setGrade] = useState("");
  const [subject, setSubject] = useState("");
  const [pageCount, setPageCount] = useState(1);
  const [sourceMode, setSourceMode] = useState<SourceMode>("none");
  const [sourceText, setSourceText] = useState("");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // The class's grade and subject, once, without overwriting what's been typed.
  const prefilled = useRef(false);
  useEffect(() => {
    if (!a || prefilled.current) return;
    prefilled.current = true;
    setGrade((g) => g || a.grade);
    setSubject((s) => s || a.subject);
  }, [a]);

  const [design, setDesign] = useState<{ id: string; design: AiDesign; refinementsLeft: number } | null>(null);
  const [busy, setBusy] = useState<"" | "design" | "refine" | "retry" | "add">("");
  const [error, setError] = useState<{ message: string; limit?: boolean } | null>(null);
  const [change, setChange] = useState("");
  const [showBoxes, setShowBoxes] = useState(true);

  const pageIsDocument = !!page && !!pdfUrl && !isPattern(page.pattern);
  const example = KINDS.find((k) => k.key === kind)!.example;

  /** The source material as the server wants it. Sent again on each change; never stored. */
  const source = async () => {
    if (sourceMode === "text" && sourceText.trim()) return { sourceText: sourceText.trim() };
    if (sourceMode === "file" && sourceFile) return { sourceFile: await sourceFileFor(sourceFile) };
    if (sourceMode === "page" && page && pdfUrl && pageIsDocument) {
      const canvas = document.createElement("canvas");
      const scale = Math.min(2, 1400 / Math.max(page.width, page.height));
      await renderPageToCanvas(pdfUrl, page.source_index, canvas, scale, 1);
      return { sourceFile: sourceFromCanvas(canvas) };
    }
    return {};
  };

  const fail = (e: unknown) => {
    const limit = e instanceof ApiError && e.body?.code === "ai_limit";
    setError({ message: (e as Error).message, limit });
    if (limit) void allowance.refetch();
  };

  const start = async () => {
    setError(null);
    setBusy("design");
    try {
      const res = await api.post<{ id: string; design: AiDesign; refinementsLeft: number }>("/api/ai/designs", {
        notebookId, insertAfterPageId, kind, description, grade, subject, pageCount, ...(await source()),
      });
      setDesign(res);
      setChange("");
      void allowance.refetch();
    } catch (e) {
      fail(e);
    } finally {
      setBusy("");
    }
  };

  const refine = async (instruction: string) => {
    if (!design) return;
    setError(null);
    setBusy(instruction ? "refine" : "retry");
    try {
      const res = await api.post<{ id: string; design: AiDesign; refinementsLeft: number }>(
        `/api/ai/designs/${design.id}/refine`, { instruction, ...(await source()) },
      );
      setDesign(res);
      setChange("");
    } catch (e) {
      fail(e);
    } finally {
      setBusy("");
    }
  };

  const add = async () => {
    if (!design) return;
    setError(null);
    setBusy("add");
    try {
      const { pdf, sizes } = await designToPdf(design.design);
      const form = new FormData();
      form.append("file", new File([pdf], "ai-page.pdf", { type: "application/pdf" }));
      const { assetKey } = await api.upload<{ assetKey: string }>(`/api/notebooks/${notebookId}/assets`, form);
      const { created } = await api.post<{ created: string[] }>(`/api/notebooks/${notebookId}/pages`, {
        assetKey,
        pages: sizes.map((s, i) => ({ sourceIndex: i, width: s.width, height: s.height })),
        insertAfterPageId,
      });
      for (let i = 0; i < created.length; i++) {
        const answers = design.design.pages[i]?.answers ?? [];
        if (!answers.length) continue;
        await api.post(`/api/notebooks/${notebookId}/fields/bulk`, {
          pageId: created[i],
          fields: answers.map((x) => ({ type: x.kind, x: x.x, y: x.y, w: x.w, h: x.h, label: x.label })),
        });
      }
      onAdded(created);
    } catch (e) {
      fail(e);
      setBusy("");
    }
  };

  const working = !!busy;
  const tooMany = !!a && pageCount > a.remaining;
  const canStart = !!a?.available && !!description.trim() && !tooMany && !working
    && !(sourceMode === "text" && !sourceText.trim()) && !(sourceMode === "file" && !sourceFile);

  return (
    <Modal onClose={working ? () => {} : onClose} title="Design a page with AI" className="sm:max-w-3xl">
      {a && (
        <p className="-mt-1 mb-4 text-[16px] text-pine/70" data-testid="ai-allowance">
          {a.remaining} of {a.limit} AI page{a.limit === 1 ? "" : "s"} left this month
          {!a.paid && <> · <Link to="/pricing" className="font-bold text-pine underline">Pro gets {AI_PAGES_PAID}</Link></>}
        </p>
      )}

      {a && !a.available && (
        <p role="status" className="mb-4 rounded-[12px] border-2 border-pine/20 bg-oat px-4 py-3 text-[16px]">
          Designing pages with AI isn't switched on yet.
        </p>
      )}

      {a && a.available && a.remaining === 0 && !design && !error && (
        <div className="-mt-4 mb-5">
          <ErrorNote error={{
            message: a.paid ? "You've used this month's AI pages. They come back on the 1st." : "You've used your free AI page this month.",
            limit: !a.paid,
          }} />
        </div>
      )}

      {!design ? (
        <form
          onSubmit={(e) => { e.preventDefault(); if (canStart) void start(); }}
          aria-busy={working}
        >
          <fieldset>
            <legend className="label-caps mb-2 text-pine/70">Kind of page</legend>
            <div className="flex flex-wrap gap-2">
              {KINDS.map((k) => (
                <label key={k.key}
                  className={cn(
                    "inline-flex min-h-[44px] cursor-pointer items-center rounded-full border-2 px-4 font-display text-[16px] font-bold",
                    "has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-mint",
                    kind === k.key ? "border-pine bg-mint/40" : "border-pine/25 hover:bg-oat",
                  )}>
                  <input type="radio" name="ai-kind" value={k.key} checked={kind === k.key} onChange={() => setKind(k.key)} className="sr-only" />
                  {k.label}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="label-caps mb-1 mt-5 block text-pine/70" htmlFor="ai-description">What should it include?</label>
          <Textarea id="ai-description" rows={3} value={description} maxLength={2000}
            placeholder={example} onChange={(e) => setDescription(e.target.value)} />

          <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_1fr_auto]">
            <div>
              <label className="label-caps mb-1 block text-pine/70" htmlFor="ai-grade">Grade</label>
              <Input id="ai-grade" value={grade} maxLength={40} placeholder="e.g. 5th" onChange={(e) => setGrade(e.target.value)} />
            </div>
            <div>
              <label className="label-caps mb-1 block text-pine/70" htmlFor="ai-subject">Subject</label>
              <Input id="ai-subject" value={subject} maxLength={60} placeholder="e.g. Math" onChange={(e) => setSubject(e.target.value)} />
            </div>
            <fieldset>
              <legend className="label-caps mb-1 text-pine/70">Pages</legend>
              <div className="flex gap-1.5">
                {[1, 2, 3].map((n) => (
                  <label key={n} className={cn(
                    "inline-flex h-12 w-12 cursor-pointer items-center justify-center rounded-[12px] border-[3px] font-display text-[17px] font-bold",
                    "has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-mint",
                    pageCount === n ? "border-pine bg-mint/40" : "border-pine/25 hover:bg-oat",
                  )}>
                    <input type="radio" name="ai-pages" value={n} checked={pageCount === n} onChange={() => setPageCount(n)} className="sr-only" />
                    {n}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <fieldset className="mt-5">
            <legend className="label-caps mb-2 text-pine/70">Build it from</legend>
            <div className="flex flex-wrap gap-2">
              {([
                ["none", "Just the description"],
                ["text", "Text I paste"],
                ["file", "A PDF or photo"],
                ...(pageIsDocument ? [["page", "This page"]] : []),
              ] as [SourceMode, string][]).map(([key, label]) => (
                <label key={key} className={cn(
                  "inline-flex min-h-[44px] cursor-pointer items-center rounded-full border-2 px-4 text-[16px] font-bold",
                  "has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-mint",
                  sourceMode === key ? "border-pine bg-mint/40" : "border-pine/25 hover:bg-oat",
                )}>
                  <input type="radio" name="ai-source" value={key} checked={sourceMode === key} onChange={() => setSourceMode(key)} className="sr-only" />
                  {label}
                </label>
              ))}
            </div>
            {sourceMode === "text" && (
              <Textarea aria-label="Source text" className="mt-3" rows={5} maxLength={30000} value={sourceText}
                placeholder="Paste a passage, notes or a list of terms" onChange={(e) => setSourceText(e.target.value)} />
            )}
            {sourceMode === "file" && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button type="button" onClick={() => fileRef.current?.click()}><Upload className="h-5 w-5" /> Choose a file</Button>
                <span className="text-[16px] text-pine/70">{sourceFile ? sourceFile.name : "PDF, PNG or JPEG, up to 10MB"}</span>
                <input ref={fileRef} type="file" hidden accept="application/pdf,image/png,image/jpeg,image/webp,image/gif"
                  aria-label="Source file" data-testid="ai-source-file"
                  onChange={(e) => { setSourceFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
              </div>
            )}
            {sourceMode !== "none" && (
              <p className="mt-2 text-[15px] text-pine/60">Only what you add here and the description are sent to the AI. Nothing about your students is.</p>
            )}
          </fieldset>

          {error && <ErrorNote error={error} />}

          <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
            {tooMany && a && a.remaining > 0 && <span className="mr-auto text-[16px] text-pine/70">You have {a.remaining} left — ask for fewer pages.</span>}
            <Button type="button" variant="secondary" onClick={onClose} disabled={working}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={!canStart}>
              {busy === "design" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
              {busy === "design" ? "Designing…" : pageCount === 1 ? "Design it" : `Design ${pageCount} pages`}
            </Button>
          </div>
          {busy === "design" && (
            <p role="status" className="mt-3 text-right text-[16px] text-pine/70">This takes about a minute.</p>
          )}
        </form>
      ) : (
        <Preview
          design={design.design}
          showBoxes={showBoxes}
          setShowBoxes={setShowBoxes}
          dim={busy === "refine" || busy === "retry"}
        >
          <form className="mt-4" onSubmit={(e) => { e.preventDefault(); if (change.trim() && !working) void refine(change.trim()); }}>
            <label className="label-caps mb-1 block text-pine/70" htmlFor="ai-change">Change something</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input id="ai-change" value={change} maxLength={1000} placeholder="e.g. Make the last one a word problem"
                onChange={(e) => setChange(e.target.value)} disabled={working || design.refinementsLeft <= 0} />
              <Button type="submit" disabled={!change.trim() || working || design.refinementsLeft <= 0} className="shrink-0">
                {busy === "refine" ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
                {busy === "refine" ? "Changing…" : "Change it"}
              </Button>
            </div>
            <p className="mt-1.5 text-[15px] text-pine/60">
              Changes and tries don't use your AI pages · {design.refinementsLeft} left for this design
            </p>
          </form>

          {error && <ErrorNote error={error} />}
          {(busy === "refine" || busy === "retry") && <p role="status" className="mt-3 text-[16px] text-pine/70">Redrawing… about a minute.</p>}

          <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="ghost" className="mr-auto" disabled={working}
              onClick={() => { setDesign(null); setError(null); }}>Start over</Button>
            <Button type="button" disabled={working || design.refinementsLeft <= 0} onClick={() => void refine("")}>
              <RefreshCw className={cn("h-5 w-5", busy === "retry" && "animate-spin")} /> Try again
            </Button>
            <Button type="button" variant="primary" disabled={working} onClick={() => void add()}>
              {busy === "add" ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
              {busy === "add" ? "Adding…" : "Add to notebook"}
            </Button>
          </div>
        </Preview>
      )}
    </Modal>
  );
}

function ErrorNote({ error }: { error: { message: string; limit?: boolean } }) {
  return (
    <div role="alert" className="mt-4 rounded-[12px] border-2 border-[#a3341f] bg-[#a3341f]/5 px-4 py-3 text-[16px] text-[#7d2716]">
      {error.message}
      {error.limit && (
        <> <Link to="/pricing" className="font-bold text-pine underline">Upgrade to Pro for more</Link></>
      )}
    </div>
  );
}

function Preview({
  design, showBoxes, setShowBoxes, dim, children,
}: { design: AiDesign; showBoxes: boolean; setShowBoxes: (v: boolean) => void; dim: boolean; children: React.ReactNode }) {
  const pages = useMemo(() => design.pages.map((p) => {
    try {
      return { ...previewOf(p.svg), answers: p.answers, error: "" };
    } catch (e) {
      return { url: "", width: 612, height: 792, answers: p.answers, error: (e as Error).message };
    }
  }), [design]);
  const boxes = design.pages.reduce((n, p) => n + p.answers.length, 0);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h3 className="mr-auto font-display text-[18px] font-bold">{design.title}</h3>
        <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 text-[16px]">
          <input type="checkbox" checked={showBoxes} onChange={(e) => setShowBoxes(e.target.checked)} className="h-5 w-5 accent-[#20302C]" />
          Show answer boxes ({boxes})
        </label>
      </div>
      <div className={cn("flex max-h-[50vh] flex-col items-center gap-4 overflow-y-auto rounded-[16px] bg-oat p-3 transition-opacity", dim && "opacity-50")}>
        {pages.map((p, i) => (
          <div key={i} className="relative w-full max-w-[520px] border-2 border-pine/20 bg-white shadow-sm" data-testid="ai-preview-page"
            style={{ aspectRatio: `${p.width} / ${p.height}` }}>
            {p.error ? (
              <p className="p-4 text-[16px] text-[#7d2716]">{p.error}</p>
            ) : (
              <img src={p.url} alt={`${design.title}, page ${i + 1}`} className="absolute inset-0 h-full w-full" />
            )}
            {showBoxes && p.answers.map((x, k) => (
              <div key={k} data-testid="ai-answer-box" title={x.label}
                className="pointer-events-none absolute rounded-[3px] border-2 border-dashed border-[#2f9a6d] bg-mint/20"
                style={{
                  left: `${(x.x / p.width) * 100}%`, top: `${(x.y / p.height) * 100}%`,
                  width: `${(x.w / p.width) * 100}%`, height: `${(x.h / p.height) * 100}%`,
                }} />
            ))}
          </div>
        ))}
      </div>
      {children}
    </div>
  );
}
