/**
 * Check by question: one question at a time, every student's answer to it.
 *
 * Grading a worksheet student by student means reading question 1 thirty
 * times with twenty-nine other questions in between. This turns it on its
 * side. Identical answers are gathered into one group — "4" from eighteen
 * students is one decision, not eighteen — and a box with an answer key has
 * already been decided before the teacher arrives, so what's left to read is
 * the answers the key didn't expect.
 *
 * Every decision can be overruled, for a group or for one student. A student
 * who wrote their answer with a pen instead of typing it shows up with a crop
 * of the page around the box, so their work is checked too, not marked blank.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ClipboardCheck, KeyRound, RotateCcw, X,
} from "lucide-react";
import { toast } from "sonner";
import { api, assetUrl } from "../lib/api";
import { renderPageToCanvas } from "../lib/pdf";
import { DEFAULT_PATTERN_COLOR, isPattern, renderPatternToCanvas } from "../lib/patterns";
import { drawLayer, parseLayer, type LayerData } from "../lib/ink";
import { normalizeAnswer, parseKey, type AnswerKey } from "../../shared/answers.mjs";
import { Avatar, ErrorNote, Spinner } from "../components/Shell";
import { Button, Chip, Input, Modal, Select, Textarea } from "../components/ui";
import { cn } from "../lib/utils";

interface CheckPage {
  id: string; seq: number; asset_key: string | null; source_index: number;
  width: number; height: number; label: string; pattern: string | null; pattern_color: string | null;
}
interface CheckField {
  id: string; page_id: string; type: "text" | "prompt" | "choice" | "checkbox";
  x: number; y: number; w: number; h: number;
  label: string; options: string; prompt: string | null;
  answer_key: string; points: number; counted: boolean;
}
interface Answer { value: string; auto: boolean | null; mark: boolean | null }
interface CheckStudent {
  student: { id: string; name: string; email: string; picture: string | null };
  answers: Record<string, Answer>;
  score: { earned: number; possible: number; pending: number; answered: number };
  status: string;
  graded: boolean;
  grade: { points: number | null; letter: string | null };
}
export interface CheckResponse {
  assignment: { id: string; title: string; notebookId: string; classId: string; grading: string; pointsMax: number };
  pages: CheckPage[];
  fields: CheckField[];
  students: CheckStudent[];
}

/** What the student's answer comes to: the teacher's mark if there is one, else the key's. */
const resultOf = (a?: Answer) => (a ? a.mark ?? a.auto : null);

function shown(f: CheckField, value: string) {
  if (f.type === "checkbox") return value === "1" ? "Ticked" : "Left blank";
  return value.trim();
}

function questionText(f: CheckField) {
  return (f.prompt || f.label || "").trim();
}

function keySummary(f: CheckField): string | null {
  const k = parseKey(f.type, f.answer_key);
  if (!k) return null;
  if ("checked" in k) return k.checked ? "Ticked" : "Left blank";
  return k.accept.join(" · ");
}

function options(f: CheckField): string[] {
  try { const v = JSON.parse(f.options || "[]"); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

interface Group {
  key: string;
  label: string;
  blank: boolean;
  members: CheckStudent[];
  state: "right" | "wrong" | "check" | "mixed";
  anyMarked: boolean;
}

function groupAnswers(f: CheckField, students: CheckStudent[]): Group[] {
  const map = new Map<string, Group>();
  for (const s of students) {
    const value = s.answers[f.id]?.value ?? "";
    const blank = f.type === "checkbox" ? false : !value.trim();
    const key = f.type === "checkbox" ? (value === "1" ? "1" : "") : normalizeAnswer(value);
    let g = map.get(key);
    if (!g) {
      g = { key, label: blank ? "" : shown(f, value), blank, members: [], state: "check", anyMarked: false };
      map.set(key, g);
    }
    g.members.push(s);
  }
  for (const g of map.values()) {
    const results = g.members.map((s) => resultOf(s.answers[f.id]));
    g.anyMarked = g.members.some((s) => s.answers[f.id]?.mark != null);
    g.state = results.every((r) => r === true) ? "right"
      : results.every((r) => r === false) ? "wrong"
      : results.every((r) => r === null) ? "check"
      : "mixed";
  }
  return [...map.values()].sort((a, b) => Number(a.blank) - Number(b.blank) || b.members.length - a.members.length);
}

function tally(f: CheckField, students: CheckStudent[]) {
  let right = 0, wrong = 0, check = 0;
  for (const s of students) {
    const r = resultOf(s.answers[f.id]);
    if (r === true) right++; else if (r === false) wrong++; else check++;
  }
  return { right, wrong, check };
}

// ---------------------------------------------------------------------------
// The page around a box, as one student left it.
// ---------------------------------------------------------------------------

/** Page units to canvas pixels for the background each crop is cut from. */
const BG_SCALE = 3;

interface Rect { x: number; y: number; w: number; h: number }

function cropRect(f: CheckField, page: CheckPage): Rect {
  const padX = Math.max(18, f.w * 0.15);
  const padY = Math.max(16, f.h * 0.6);
  const x = Math.max(0, f.x - padX);
  const y = Math.max(0, f.y - padY);
  const r = Math.min(page.width, f.x + f.w + padX);
  const b = Math.min(page.height, f.y + f.h + padY);
  return { x, y, w: Math.max(1, r - x), h: Math.max(1, b - y) };
}

/** Did they write or type anything on the page inside this rectangle? */
function inkWithin(layer: LayerData | undefined, r: Rect): boolean {
  if (!layer) return false;
  for (const s of layer.s) {
    for (let i = 0; i + 1 < s.p.length; i += 3) {
      const x = s.p[i], y = s.p[i + 1];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return true;
    }
  }
  return layer.x.some((t) => t.v.trim() && t.x < r.x + r.w && t.x + t.w > r.x && t.y < r.y + r.h && t.y + t.s * 1.4 > r.y);
}

/** The page itself, painted once and shared by every crop cut from it. */
function usePageBackground(notebookId: string, page: CheckPage | undefined) {
  const [bg, setBg] = useState<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!page) return;
    const signal = { canceled: false };
    const canvas = document.createElement("canvas");
    setBg(null);
    (async () => {
      try {
        if (isPattern(page.pattern)) {
          renderPatternToCanvas(page.pattern, page.pattern_color || DEFAULT_PATTERN_COLOR, page.width, page.height, canvas, BG_SCALE, 1);
        } else if (page.asset_key) {
          await renderPageToCanvas(assetUrl(notebookId, page.asset_key), page.source_index, canvas, BG_SCALE, 1, signal);
        } else {
          canvas.width = Math.floor(page.width * BG_SCALE);
          canvas.height = Math.floor(page.height * BG_SCALE);
          const ctx = canvas.getContext("2d");
          if (ctx) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
        }
        if (!signal.canceled) setBg(canvas);
      } catch {
        // The crop still shows the ink on white; the page behind it is context, not the answer.
        if (!signal.canceled) setBg(null);
      }
    })();
    return () => { signal.canceled = true; };
    // The page object is rebuilt on every refetch of the sheet; only a different
    // page is worth painting again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId, page?.id]);
  return bg;
}

function Crop({ bg, rect, field, layer, label }: {
  bg: HTMLCanvasElement | null; rect: Rect; field: CheckField; layer?: LayerData; label: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const cssW = Math.min(420, Math.max(220, rect.w * 1.5));
  const zoom = cssW / rect.w;
  const cssH = rect.h * zoom;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(cssW * dpr);
    c.height = Math.round(cssH * dpr);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const px = zoom * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    if (bg) ctx.drawImage(bg, rect.x * BG_SCALE, rect.y * BG_SCALE, rect.w * BG_SCALE, rect.h * BG_SCALE, 0, 0, c.width, c.height);
    // The box itself, faintly, so it's clear which answer this is.
    ctx.setTransform(px, 0, 0, px, -rect.x * px, -rect.y * px);
    ctx.strokeStyle = "rgba(32,48,44,0.35)";
    ctx.lineWidth = 1.5 / px;
    ctx.setLineDash([5 / px, 4 / px]);
    ctx.strokeRect(field.x, field.y, field.w, field.h);
    ctx.setLineDash([]);
    if (layer) {
      for (const t of layer.x) {
        if (!t.v.trim()) continue;
        ctx.fillStyle = t.c;
        ctx.font = `${t.s}px Nunito, system-ui, sans-serif`;
        ctx.textBaseline = "top";
        t.v.split("\n").forEach((line, i) => ctx.fillText(line, t.x + 2, t.y + 2 + i * t.s * 1.3));
      }
      ctx.setTransform(1, 0, 0, 1, -rect.x * px, -rect.y * px);
      drawLayer(ctx, layer, px);
    }
  }, [bg, rect.x, rect.y, rect.w, rect.h, field.x, field.y, field.w, field.h, layer, cssW, cssH, zoom]);
  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={label}
      style={{ width: cssW, height: cssH }}
      className="block max-w-full rounded-[10px] border-2 border-pine/15 bg-white"
    />
  );
}

// ---------------------------------------------------------------------------

function ResultChip({ state }: { state: Group["state"] | "right" | "wrong" | "check" }) {
  if (state === "right") return <Chip tone="mint" icon={<Check className="h-4 w-4" strokeWidth={3} />}>Right</Chip>;
  if (state === "wrong") {
    return (
      <span className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border-2 border-[#a3341f] bg-[#a3341f]/8 px-3.5 font-display text-[16px] font-bold text-[#a3341f]">
        <X className="h-4 w-4" strokeWidth={3} /> Wrong
      </span>
    );
  }
  if (state === "mixed") return <Chip tone="quiet">Mixed</Chip>;
  return <Chip tone="warn">To check</Chip>;
}

/** Right / Wrong as a pair of pressed-state buttons. */
function MarkButtons({ value, onMark, busy, size = "md", who }: {
  value: boolean | null; onMark: (v: boolean) => void; busy?: boolean; size?: "sm" | "md"; who: string;
}) {
  const h = size === "sm" ? "h-11 px-3" : "h-11 px-4";
  return (
    <div className="flex gap-1.5" role="group" aria-label={`Mark ${who}`}>
      <button
        type="button"
        aria-pressed={value === true}
        disabled={busy}
        onClick={() => onMark(true)}
        className={cn(
          h, "inline-flex items-center gap-1.5 rounded-full border-[3px] font-display text-[16px] font-bold disabled:opacity-50",
          value === true ? "border-pine bg-mint text-pine" : "border-pine/25 bg-white text-pine/75 hover:border-pine",
        )}
      >
        <Check className="h-4 w-4" strokeWidth={3} /> Right
      </button>
      <button
        type="button"
        aria-pressed={value === false}
        disabled={busy}
        onClick={() => onMark(false)}
        className={cn(
          h, "inline-flex items-center gap-1.5 rounded-full border-[3px] font-display text-[16px] font-bold disabled:opacity-50",
          value === false ? "border-[#a3341f] bg-[#a3341f]/10 text-[#a3341f]" : "border-pine/25 bg-white text-pine/75 hover:border-[#a3341f]",
        )}
      >
        <X className="h-4 w-4" strokeWidth={3} /> Wrong
      </button>
    </div>
  );
}

export default function CheckByQuestion() {
  const { assignmentId = "" } = useParams();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryKey = ["check", assignmentId];

  const sheet = useQuery({
    queryKey,
    queryFn: () => api.get<CheckResponse>(`/api/assignments/${assignmentId}/check`),
    enabled: !!assignmentId,
  });
  const data = sheet.data;
  const fields = data?.fields ?? [];
  const students = data?.students ?? [];
  const pages = data?.pages ?? [];
  const pageNumber = useMemo(() => new Map(pages.map((p, i) => [p.id, i + 1])), [pages]);

  const qParam = searchParams.get("q");
  const fieldIdx = Math.max(0, fields.findIndex((f) => f.id === qParam));
  const field = fields[fieldIdx];
  const page = pages.find((p) => p.id === field?.page_id);
  const goQuestion = (i: number) => {
    const f = fields[Math.max(0, Math.min(fields.length - 1, i))];
    if (!f) return;
    setSearchParams((prev) => { const n = new URLSearchParams(prev); n.set("q", f.id); return n; }, { replace: true });
  };

  const [applyOpen, setApplyOpen] = useState(false);

  /** Marks show at once and settle when the server answers. */
  const mark = useMutation({
    mutationFn: (b: { fieldId: string; studentIds: string[]; correct: boolean | null }) =>
      api.post(`/api/assignments/${assignmentId}/marks`, b),
    onMutate: async (b) => {
      await qc.cancelQueries({ queryKey });
      const before = qc.getQueryData<CheckResponse>(queryKey);
      if (before) {
        const ids = new Set(b.studentIds);
        qc.setQueryData<CheckResponse>(queryKey, {
          ...before,
          students: before.students.map((s) => ids.has(s.student.id)
            ? { ...s, answers: { ...s.answers, [b.fieldId]: { ...(s.answers[b.fieldId] ?? { value: "", auto: null }), mark: b.correct } } }
            : s),
        });
      }
      return { before };
    },
    onError: (e: Error, _b, ctx) => {
      if (ctx?.before) qc.setQueryData(queryKey, ctx.before);
      toast.error(e.message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey }),
  });

  const saveKey = useMutation({
    mutationFn: (b: { field: CheckField; answerKey?: AnswerKey | null; points?: number }) =>
      api.patch(`/api/notebooks/${data!.assignment.notebookId}/fields/${b.field.id}`, {
        ...(b.answerKey !== undefined ? { answerKey: b.answerKey } : {}),
        ...(b.points !== undefined ? { points: b.points } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["notebook", data?.assignment.notebookId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const back = `/assignments/${assignmentId}`;

  if (sheet.isLoading) return <Spinner label="Reading every answer…" />;
  if (sheet.error) return <div className="p-6"><ErrorNote error={sheet.error as Error} /></div>;
  if (!data) return null;

  return (
    <div className="flex h-dvh flex-col bg-oat">
      <header className="flex flex-wrap items-center gap-3 border-b-2 border-pine/12 bg-white px-3 py-2">
        <Link
          to={back}
          aria-label="Back to grading"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border-[3px] border-pine bg-white text-pine hover:bg-oat"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={2.5} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-[17px] font-bold text-pine">Check by question</h1>
          <div className="truncate text-[16px] text-pine/70">{data.assignment.title}</div>
        </div>
        {(data.assignment.grading === "points" || data.assignment.grading === "letter") && fields.length > 0 && (
          <Button variant="primary" onClick={() => setApplyOpen(true)}>
            <ClipboardCheck className="h-4 w-4" strokeWidth={2.5} /> Make grades from scores
          </Button>
        )}
      </header>

      {fields.length === 0 ? (
        <div className="mx-auto mt-10 max-w-lg px-4 text-center">
          <KeyRound className="mx-auto h-8 w-8 text-pine/50" strokeWidth={2} />
          <h2 className="mt-3 font-display text-[19px] font-bold text-pine">Nothing here to check by question</h2>
          <p className="mt-2 text-[16px] leading-relaxed text-pine/70">
            Checking by question works on answer boxes — typed answers, dropdowns and checkboxes. This
            assignment's pages don't have any. Add some in the notebook editor, give them an answer key,
            and their answers will gather here.
          </p>
          <Link to={`/notebooks/${data.assignment.notebookId}/edit`} className="mt-4 inline-block font-bold text-pine underline decoration-mint decoration-2 underline-offset-2">
            Open the notebook editor
          </Link>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-72 shrink-0 flex-col border-r-2 border-pine/12 bg-white sm:flex">
            <div className="border-b-2 border-pine/12 px-3 py-2 label-caps text-pine/70">Questions</div>
            <ol className="min-h-0 flex-1 overflow-y-auto p-2">
              {fields.map((f, i) => {
                const t = tally(f, students);
                const on = i === fieldIdx;
                return (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => goQuestion(i)}
                      aria-current={on || undefined}
                      className={cn(
                        "mb-1 w-full rounded-[14px] border-2 px-3 py-2 text-left",
                        on ? "border-pine bg-mint/25" : "border-transparent hover:bg-oat",
                      )}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-display text-[16px] font-bold text-pine">Question {i + 1}</span>
                        <span className="text-[14px] text-pine/55">p. {pageNumber.get(f.page_id)}</span>
                      </div>
                      {questionText(f) && <div className="truncate text-[15px] text-pine/70">{questionText(f)}</div>}
                      <div className="mt-0.5 text-[14px] text-pine/60">
                        {f.answer_key ? "" : "No key · "}
                        {t.right} right · {t.wrong} wrong{t.check ? ` · ${t.check} to check` : ""}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ol>
          </aside>

          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6">
            <div className="mx-auto max-w-3xl">
              <div className="mb-3 sm:hidden">
                <label className="label-caps block text-pine/70" htmlFor="question-picker">Question</label>
                <Select id="question-picker" value={field?.id} onChange={(e) => goQuestion(fields.findIndex((f) => f.id === e.target.value))} className="mt-1">
                  {fields.map((f, i) => (
                    <option key={f.id} value={f.id}>Question {i + 1}{questionText(f) ? ` — ${questionText(f).slice(0, 40)}` : ""}</option>
                  ))}
                </Select>
              </div>

              {field && page && (
                <QuestionPanel
                  key={field.id}
                  notebookId={data.assignment.notebookId}
                  assignmentId={assignmentId}
                  field={field}
                  page={page}
                  index={fieldIdx}
                  count={fields.length}
                  pageNumber={pageNumber.get(field.page_id) ?? 0}
                  students={students}
                  onPrev={() => goQuestion(fieldIdx - 1)}
                  onNext={() => goQuestion(fieldIdx + 1)}
                  onMark={(studentIds, correct) => mark.mutate({ fieldId: field.id, studentIds, correct })}
                  onSaveKey={(answerKey, points) => saveKey.mutate({ field, answerKey, points })}
                  savingKey={saveKey.isPending}
                />
              )}
            </div>
          </main>
        </div>
      )}

      {applyOpen && (
        <ApplyScores
          data={data}
          onClose={() => setApplyOpen(false)}
          onDone={() => {
            qc.invalidateQueries({ queryKey });
            qc.invalidateQueries({ queryKey: ["assignment", assignmentId] });
          }}
        />
      )}
    </div>
  );
}

function QuestionPanel({
  notebookId, assignmentId, field, page, index, count, pageNumber, students,
  onPrev, onNext, onMark, onSaveKey, savingKey,
}: {
  notebookId: string;
  assignmentId: string;
  field: CheckField;
  page: CheckPage;
  index: number;
  count: number;
  pageNumber: number;
  students: CheckStudent[];
  onPrev: () => void;
  onNext: () => void;
  onMark: (studentIds: string[], correct: boolean | null) => void;
  onSaveKey: (answerKey: AnswerKey | null | undefined, points?: number) => void;
  savingKey: boolean;
}) {
  const groups = useMemo(() => groupAnswers(field, students), [field, students]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(groups.filter((g) => g.blank).map((g) => g.key)));
  const [editingKey, setEditingKey] = useState(false);
  const t = tally(field, students);
  const key = keySummary(field);
  const rect = useMemo(() => cropRect(field, page), [field, page]);

  // Crops are only fetched once a group that shows them is open.
  const wantInk = open.size > 0;
  const ink = useQuery({
    queryKey: ["page-ink", assignmentId, page.id],
    queryFn: () => api.get<{ ink: Record<string, string> }>(`/api/assignments/${assignmentId}/page-ink?pageId=${encodeURIComponent(page.id)}`),
    enabled: wantInk,
    staleTime: 30_000,
  });
  const layers = useMemo(() => {
    const m = new Map<string, LayerData>();
    for (const [sid, raw] of Object.entries(ink.data?.ink ?? {})) m.set(sid, parseLayer(raw));
    return m;
  }, [ink.data]);
  const bg = usePageBackground(notebookId, wantInk ? page : undefined);

  const toggle = (k: string) => setOpen((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const acceptGroup = (g: Group) => {
    const current = parseKey(field.type, field.answer_key);
    if (field.type === "checkbox") return onSaveKey({ checked: g.key === "1" });
    if (field.type === "choice") return onSaveKey({ accept: [g.label] });
    const accept = current && "accept" in current ? current.accept : [];
    onSaveKey({ accept: [...accept, g.label] });
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="label-caps text-pine/60">Question {index + 1} of {count} · page {pageNumber} · worth {plural(field.points, "point")}</div>
          <h2 className="mt-1 font-display text-[21px] font-bold leading-snug text-pine">
            {questionText(field) || (field.type === "checkbox" ? "A checkbox" : field.type === "choice" ? "A dropdown" : "An answer box")}
          </h2>
        </div>
        <div className="flex gap-1.5">
          <button type="button" onClick={onPrev} disabled={index === 0} aria-label="Previous question"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border-[3px] border-pine bg-white text-pine hover:bg-oat disabled:opacity-30">
            <ChevronLeft className="h-4 w-4" strokeWidth={2.5} />
          </button>
          <button type="button" onClick={onNext} disabled={index >= count - 1} aria-label="Next question"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border-[3px] border-pine bg-white text-pine hover:bg-oat disabled:opacity-30">
            <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </div>
      </div>

      <div className="mt-3 rounded-[18px] border-[3px] border-pine bg-white p-3" data-testid="question-key">
        {editingKey ? (
          <KeyForm
            field={field}
            saving={savingKey}
            onCancel={() => setEditingKey(false)}
            onSave={(k, pts) => { onSaveKey(k, pts); setEditingKey(false); }}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <KeyRound className="h-4 w-4 text-pine/60" strokeWidth={2.5} />
            {key ? (
              <span className="text-[16px] text-pine"><span className="font-bold">Answer key:</span> {key}</span>
            ) : (
              <span className="text-[16px] text-pine/70">No answer key yet. Mark the answers below, or accept one as the key.</span>
            )}
            <button type="button" onClick={() => setEditingKey(true)} className="ml-auto inline-flex min-h-[44px] items-center px-2 font-bold text-pine underline decoration-mint decoration-2 underline-offset-2">
              {key ? "Change" : "Set the key"}
            </button>
          </div>
        )}
        <p className="mt-1 text-[15px] text-pine/60">
          {t.right} right · {t.wrong} wrong{t.check ? ` · ${t.check} still to check` : ""}
        </p>
      </div>

      <ul className="mt-4 space-y-3" aria-label="Answers">
        {groups.map((g) => {
          const ids = g.members.map((s) => s.student.id);
          const isOpen = open.has(g.key);
          const groupValue = g.state === "right" ? true : g.state === "wrong" ? false : null;
          const canAccept = !g.blank && g.state !== "right" && (field.type === "text" || field.type === "prompt" || field.type === "choice" || field.type === "checkbox");
          return (
            <li key={g.key || "(blank)"} className="rounded-[22px] border-[3px] border-pine bg-white p-3 shadow-[4px_4px_0_0_var(--color-pine)]" data-testid="answer-group">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className={cn("break-words font-display text-[19px] font-bold", g.blank ? "text-pine/55" : "text-pine")}>
                    {g.blank ? (field.type === "text" || field.type === "prompt" ? "Nothing typed" : "No choice made") : `“${g.label}”`}
                  </div>
                  <div className="mt-0.5 text-[16px] text-pine/70">
                    {plural(g.members.length, "student")}
                    {g.blank && (field.type === "text" || field.type === "prompt") ? " — anything they wrote by hand is shown below" : ""}
                  </div>
                </div>
                <ResultChip state={g.state} />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <MarkButtons
                  value={groupValue}
                  who={g.blank ? "everyone who left it blank" : `everyone who answered ${g.label}`}
                  onMark={(v) => onMark(ids, v)}
                />
                {canAccept && (
                  <Button variant="secondary" size="sm" onClick={() => acceptGroup(g)} disabled={savingKey}>
                    <KeyRound className="h-4 w-4" strokeWidth={2.5} />
                    {field.type === "choice" || field.type === "checkbox" ? "Make this the key" : key ? "Accept this answer too" : "Make this the key"}
                  </Button>
                )}
                {g.anyMarked && (
                  <button type="button" onClick={() => onMark(ids, null)} className="inline-flex min-h-[44px] items-center gap-1.5 px-2 text-[16px] font-bold text-pine/70 hover:text-pine">
                    <RotateCcw className="h-4 w-4" strokeWidth={2.5} /> Back to the key
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => toggle(g.key)}
                  aria-expanded={isOpen}
                  className="ml-auto inline-flex min-h-[44px] items-center gap-1 px-2 text-[16px] font-bold text-pine"
                >
                  {isOpen ? "Hide students" : "Show students"}
                  {isOpen ? <ChevronUp className="h-4 w-4" strokeWidth={2.5} /> : <ChevronDown className="h-4 w-4" strokeWidth={2.5} />}
                </button>
              </div>

              {isOpen && (
                <ul className="mt-3 divide-y-2 divide-pine/8 border-t-2 border-pine/8">
                  {g.members.map((s) => {
                    const a = s.answers[field.id];
                    const layer = layers.get(s.student.id);
                    const wrote = inkWithin(layer, rect);
                    return (
                      <li key={s.student.id} className="py-3" data-testid="answer-student">
                        <div className="flex flex-wrap items-center gap-2">
                          <Avatar name={s.student.name} picture={s.student.picture} size={28} />
                          <span className="min-w-0 flex-1 truncate text-[16px] font-bold text-pine">{s.student.name}</span>
                          {a?.mark != null && <span className="text-[14px] text-pine/55">marked by you</span>}
                          <MarkButtons
                            size="sm"
                            value={resultOf(a)}
                            who={s.student.name}
                            onMark={(v) => onMark([s.student.id], v)}
                          />
                          {a?.mark != null && (
                            <button type="button" onClick={() => onMark([s.student.id], null)} aria-label={`Back to the key for ${s.student.name}`}
                              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-pine/60 hover:bg-oat hover:text-pine">
                              <RotateCcw className="h-4 w-4" strokeWidth={2.5} />
                            </button>
                          )}
                        </div>
                        {ink.isLoading ? (
                          <p className="mt-2 text-[15px] text-pine/55">Loading what they wrote…</p>
                        ) : wrote ? (
                          <div className="mt-2">
                            <Crop bg={bg} rect={rect} field={field} layer={layer} label={`What ${s.student.name} wrote around this box`} />
                          </div>
                        ) : g.blank ? (
                          <p className="mt-2 text-[15px] text-pine/55">Nothing written here either.</p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Set or change a box's key from the check view — the same key the editor sets. */
function KeyForm({ field, saving, onSave, onCancel }: {
  field: CheckField;
  saving: boolean;
  onSave: (key: AnswerKey | null, points: number) => void;
  onCancel: () => void;
}) {
  const k = parseKey(field.type, field.answer_key);
  const [text, setText] = useState(() =>
    !k ? "" : "checked" in k ? (k.checked ? "checked" : "blank") : field.type === "choice" ? k.accept[0] ?? "" : k.accept.join("\n"));
  const [points, setPoints] = useState(String(field.points ?? 1));
  const pts = Number(points);
  const ptsOk = points.trim() !== "" && Number.isFinite(pts) && pts >= 0 && pts <= 1000;
  const build = (): AnswerKey | null => {
    if (field.type === "checkbox") return text === "checked" ? { checked: true } : text === "blank" ? { checked: false } : null;
    const accept = (field.type === "choice" ? [text] : text.split("\n")).map((v) => v.trim()).filter(Boolean);
    return accept.length ? { accept } : null;
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (ptsOk) onSave(build(), pts); }}>
      {field.type === "choice" ? (
        <>
          <label className="label-caps block text-pine/70" htmlFor="key-choice">Right option</label>
          <Select id="key-choice" value={text} onChange={(e) => setText(e.target.value)} className="mt-1 h-11 text-[16px]">
            <option value="">No answer key</option>
            {options(field).map((o) => <option key={o} value={o}>{o}</option>)}
          </Select>
        </>
      ) : field.type === "checkbox" ? (
        <>
          <label className="label-caps block text-pine/70" htmlFor="key-check">Right when</label>
          <Select id="key-check" value={text} onChange={(e) => setText(e.target.value)} className="mt-1 h-11 text-[16px]">
            <option value="">No answer key</option>
            <option value="checked">It's ticked</option>
            <option value="blank">It's left blank</option>
          </Select>
        </>
      ) : (
        <>
          <label className="label-caps block text-pine/70" htmlFor="key-text">Accepted answers</label>
          <Textarea id="key-text" value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="One per line — any of them counts" className="mt-1 text-[16px]" />
        </>
      )}
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <div>
          <label className="label-caps block text-pine/70" htmlFor="key-points">Worth</label>
          <Input id="key-points" type="number" inputMode="decimal" min={0} max={1000} step="any" value={points}
            onChange={(e) => setPoints(e.target.value)} aria-invalid={!ptsOk || undefined} className="mt-1 h-11 w-24 text-[16px]" />
        </div>
        <span className="pb-3 text-[16px] text-pine/70">points</span>
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving || !ptsOk}>Save key</Button>
        </div>
      </div>
    </form>
  );
}

function ApplyScores({ data, onClose, onDone }: { data: CheckResponse; onClose: () => void; onDone: () => void }) {
  const [overwrite, setOverwrite] = useState(false);
  const letter = data.assignment.grading === "letter";
  const counts = useMemo(() => {
    let ready = 0, returned = 0, graded = 0, pending = 0, blank = 0;
    for (const s of data.students) {
      if (s.status === "returned") returned++;
      else if (s.graded && !overwrite) graded++;
      else if (s.score.answered === 0) blank++;
      else if (s.score.pending > 0) pending++;
      else if (s.score.possible > 0) ready++;
      else blank++;
    }
    return { ready, returned, graded, pending, blank };
  }, [data, overwrite]);
  const anyGraded = data.students.some((s) => s.graded && s.status !== "returned");

  const apply = useMutation({
    mutationFn: () => api.post<{ applied: number }>(`/api/assignments/${data.assignment.id}/apply-scores`, { overwrite }),
    onSuccess: (r) => {
      toast.success(r.applied ? `Graded ${plural(r.applied, "student")} from their scores — nothing is returned until you return it` : "Nobody was ready to grade");
      onDone();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Modal onClose={onClose} title="Make grades from scores">
      <p className="text-[16px] leading-relaxed text-pine/80">
        Each student's score becomes their grade —{" "}
        {letter ? "as a letter (90% is an A, 80% a B, and so on)" : `out of ${data.assignment.pointsMax} points`}.
        Grades stay private until you return them, and comments are left as they are.
      </p>
      <ul className="mt-3 space-y-1 text-[16px] text-pine">
        <li><span className="font-bold">{plural(counts.ready, "student")}</span> ready to grade</li>
        {counts.pending > 0 && <li className="text-pine/70">{plural(counts.pending, "student")} with answers still to check — left for now</li>}
        {counts.blank > 0 && <li className="text-pine/70">{plural(counts.blank, "student")} who answered nothing — left for you to call missing</li>}
        {counts.graded > 0 && <li className="text-pine/70">{plural(counts.graded, "student")} you've already graded — kept</li>}
        {counts.returned > 0 && <li className="text-pine/70">{plural(counts.returned, "student")} whose work is returned — kept</li>}
      </ul>
      {anyGraded && (
        <label className="mt-3 flex min-h-[44px] cursor-pointer items-center gap-2.5 text-[16px] text-pine">
          <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} className="h-5 w-5 accent-[#20302C]" />
          Replace grades I've already given
        </label>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => apply.mutate()} disabled={apply.isPending || counts.ready === 0}>
          {apply.isPending ? "Grading…" : `Grade ${plural(counts.ready, "student")}`}
        </Button>
      </div>
    </Modal>
  );
}
