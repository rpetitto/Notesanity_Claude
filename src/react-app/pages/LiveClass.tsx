/**
 * Live class view: every student's page, as they work, on one screen.
 *
 * Each tile is the page a student last wrote on, with their ink and what
 * they've typed, refreshed every few seconds. "Writing now" is anyone who has
 * saved something in the last half minute; a tile that hasn't moved in a while
 * is the student to walk over to. Pinning a page shows everyone on that page
 * instead, for "is everyone done with number three?".
 *
 * Only what changed comes back on each refresh (see routes/live.ts), so a
 * class that's reading rather than writing costs next to nothing to watch.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Pause, Play } from "lucide-react";
import { api, pageSource, type FieldRec, type PageRec } from "../lib/api";
import { parseLayer, type LayerData } from "../lib/ink";
import PageThumb from "../components/PageThumb";
import { Avatar, ErrorNote, Spinner } from "../components/Shell";
import { Select } from "../components/ui";
import { cn, relativeTime } from "../lib/utils";

const POLL_MS = 4000;
/** Saved within this long ago reads as "writing now". */
const ACTIVE_MS = 30_000;

interface LiveStudent { id: string; name: string; picture: string | null }
interface LiveEntry { pageId: string; at: string; layer: LayerData | null; values: Record<string, string>; rev: number }
interface LiveResponse {
  serverTime: string;
  students?: LiveStudent[];
  updates: { studentId: string; pageId: string; at: string; ink: string | null; values: Record<string, string> }[];
}

const SIZES = { small: 170, medium: 240, large: 340 } as const;
type Size = keyof typeof SIZES;
const SIZE_KEY = "notesanity:liveSize";

export default function LiveClass() {
  const { notebookId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const pinned = searchParams.get("page") || "";
  const [size, setSizeState] = useState<Size>(() => {
    try { const v = localStorage.getItem(SIZE_KEY); if (v && v in SIZES) return v as Size; } catch { /* private mode */ }
    return "medium";
  });
  const setSize = (v: Size) => {
    setSizeState(v);
    try { localStorage.setItem(SIZE_KEY, v); } catch { /* private mode */ }
  };
  const [paused, setPaused] = useState(false);

  const meta = useQuery({
    queryKey: ["notebook", notebookId],
    queryFn: () => api.get<{ notebook: { id: string; title: string; classId: string; kind?: string; status: string }; pages: PageRec[]; fields: FieldRec[]; isTeacher: boolean }>(`/api/notebooks/${notebookId}`),
    enabled: !!notebookId,
  });

  const [students, setStudents] = useState<LiveStudent[]>([]);
  const [entries, setEntries] = useState<Map<string, LiveEntry>>(new Map());
  const [error, setError] = useState<Error | null>(null);
  const [lastAt, setLastAt] = useState<number | null>(null);
  /** Server clock minus ours, so "writing now" doesn't depend on a laptop's clock being right. */
  const skew = useRef(0);
  const since = useRef("");
  const count = useRef(0);

  // A pinned page is a different view: start again from nothing.
  useEffect(() => {
    since.current = "";
    setEntries(new Map());
  }, [pinned, notebookId]);

  useEffect(() => {
    if (paused || !notebookId) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (stop) return;
      if (document.visibilityState === "hidden") { timer = setTimeout(tick, POLL_MS); return; }
      try {
        const q = new URLSearchParams();
        if (since.current) { q.set("since", since.current); q.set("count", String(count.current)); }
        if (pinned) q.set("page", pinned);
        const r = await api.get<LiveResponse>(`/api/notebooks/${notebookId}/live?${q}`);
        if (stop) return;
        skew.current = Date.parse(r.serverTime) - Date.now();
        since.current = r.serverTime;
        if (r.students) { setStudents(r.students); count.current = r.students.length; }
        if (r.updates.length) {
          setEntries((prev) => {
            const next = new Map(prev);
            for (const u of r.updates) {
              next.set(u.studentId, {
                pageId: u.pageId, at: u.at, values: u.values,
                layer: u.ink ? parseLayer(u.ink) : null,
                rev: (prev.get(u.studentId)?.rev ?? 0) + 1,
              });
            }
            return next;
          });
        }
        setError(null);
        setLastAt(Date.now());
      } catch (e) {
        if (!stop) setError(e as Error);
      }
      if (!stop) timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [paused, notebookId, pinned]);

  // Re-render the "x seconds ago" labels between polls.
  const [, setClock] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setClock((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const pages = meta.data?.pages ?? [];
  const pageById = useMemo(() => new Map(pages.map((p, i) => [p.id, { page: p, number: i + 1 }])), [pages]);
  const fieldsByPage = useMemo(() => {
    const m = new Map<string, FieldRec[]>();
    for (const f of meta.data?.fields ?? []) {
      if (!["text", "prompt", "choice", "checkbox"].includes(f.type)) continue;
      const list = m.get(f.page_id) ?? [];
      list.push(f);
      m.set(f.page_id, list);
    }
    return m;
  }, [meta.data?.fields]);

  const serverNow = Date.now() + skew.current;
  const activeNow = (e?: LiveEntry) => !!e && serverNow - Date.parse(e.at) < ACTIVE_MS;
  const writing = students.filter((s) => activeNow(entries.get(s.id))).length;
  const started = students.filter((s) => entries.has(s.id)).length;

  if (meta.isLoading) return <Spinner label="Opening the class…" />;
  if (meta.error) return <div className="p-6"><ErrorNote error={meta.error as Error} /></div>;
  const nb = meta.data!.notebook;
  if (!meta.data!.isTeacher || nb.kind !== "class") {
    return <div className="p-6"><ErrorNote error={new Error("Only a teacher of the class can watch it live.")} /></div>;
  }

  const width = SIZES[size];

  return (
    <div className="flex min-h-dvh flex-col bg-oat">
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b-2 border-pine/12 bg-white px-3 py-2">
        <Link
          to={`/notebooks/${notebookId}/edit`}
          aria-label="Back to the notebook"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border-[3px] border-pine bg-white text-pine hover:bg-oat"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={2.5} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 truncate font-display text-[17px] font-bold text-pine">
            <span className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", paused ? "bg-pine/30" : "bg-[#2f9a6d] motion-safe:animate-pulse")} aria-hidden />
            Live · {nb.title}
          </h1>
          <div className="truncate text-[16px] text-pine/70" aria-live="polite" data-testid="live-summary">
            {students.length === 0 ? "Nobody in the class yet" : `${writing} writing now · ${started} of ${students.length} started`}
            {paused ? " · paused" : lastAt ? ` · updated ${relativeTime(new Date(lastAt).toISOString())}` : ""}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="live-page">Which page</label>
          <Select
            id="live-page"
            value={pinned}
            onChange={(e) => setSearchParams((prev) => { const n = new URLSearchParams(prev); if (e.target.value) n.set("page", e.target.value); else n.delete("page"); return n; }, { replace: true })}
            className="h-11 w-auto text-[16px]"
          >
            <option value="">Each student's latest page</option>
            {pages.map((p, i) => <option key={p.id} value={p.id}>Everyone on page {i + 1}{p.label ? ` — ${p.label}` : ""}</option>)}
          </Select>
          <div className="flex rounded-full border-[3px] border-pine bg-white p-0.5" role="group" aria-label="Tile size">
            {(Object.keys(SIZES) as Size[]).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={size === k}
                onClick={() => setSize(k)}
                className={cn("h-9 rounded-full px-3 text-[16px] font-bold capitalize", size === k ? "bg-pine text-oat" : "text-pine hover:bg-oat")}
              >
                {k[0].toUpperCase()}
                <span className="sr-only">{k.slice(1)}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setPaused((v) => !v)}
            className="inline-flex h-11 items-center gap-1.5 rounded-full border-[3px] border-pine bg-white px-4 font-display text-[16px] font-bold text-pine hover:bg-oat"
          >
            {paused ? <Play className="h-4 w-4" strokeWidth={2.5} /> : <Pause className="h-4 w-4" strokeWidth={2.5} />}
            {paused ? "Resume" : "Pause"}
          </button>
        </div>
      </header>

      {error && <div className="px-4 pt-3"><ErrorNote error={error} /></div>}

      <ul
        className="grid justify-center gap-4 p-4 sm:justify-start"
        // Fixed-width columns: a tile's page is drawn at the tile's width, so
        // a stretched column would leave the page short of its frame.
        style={{ gridTemplateColumns: `repeat(auto-fill, ${width}px)` }}
        aria-label="Students"
      >
        {students.map((s) => {
          const e = entries.get(s.id);
          const shownPage = pinned || e?.pageId || pages[0]?.id;
          const info = shownPage ? pageById.get(shownPage) : undefined;
          return (
            <li key={s.id} data-testid="live-tile" data-student={s.id}>
              <Link
                to={`/classes/${nb.classId}/students/${s.id}/notebooks/${notebookId}${info ? `?page=${info.page.id}` : ""}`}
                className={cn(
                  "block rounded-[22px] border-[3px] bg-white p-2.5 shadow-[4px_4px_0_0_var(--color-pine)] transition-transform hover:-translate-y-0.5",
                  activeNow(e) ? "border-[#2f9a6d]" : "border-pine",
                )}
              >
                <div className="mb-2 flex items-center gap-2">
                  <Avatar name={s.name} picture={s.picture} size={26} />
                  <span className="min-w-0 flex-1 truncate font-display text-[16px] font-bold text-pine">{s.name}</span>
                </div>
                {info ? (
                  <LiveThumb
                    notebookId={notebookId}
                    page={info.page}
                    fields={fieldsByPage.get(info.page.id) ?? []}
                    entry={e && e.pageId === info.page.id ? e : undefined}
                    width={width - 26}
                  />
                ) : (
                  <div className="flex aspect-[3/4] items-center justify-center rounded border border-pine/20 bg-oat text-[15px] text-pine/55">No pages</div>
                )}
                <div className="mt-2 flex items-center justify-between gap-2 text-[15px]">
                  <span className="text-pine/70">{info ? `Page ${info.number}` : ""}</span>
                  {activeNow(e) ? (
                    <span className="font-bold text-[#22704f]">Writing now</span>
                  ) : e ? (
                    <span className="text-pine/60">{relativeTime(e.at)}</span>
                  ) : (
                    <span className="text-pine/50">{pinned ? "Nothing on this page" : "Hasn't started"}</span>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      {students.length === 0 && !error && lastAt && (
        <p className="px-4 text-center text-[16px] text-pine/70">When students join the class, their pages will appear here.</p>
      )}
    </div>
  );
}

/** One student's page: the page itself, their ink, and what they've typed in its boxes. */
function LiveThumb({ notebookId, page, fields, entry, width }: {
  notebookId: string; page: PageRec; fields: FieldRec[]; entry?: LiveEntry; width: number;
}) {
  const src = pageSource(notebookId, page);
  const scale = width / page.width;
  return (
    <div className="relative" style={{ width, height: Math.round(page.height * scale) }}>
      <PageThumb
        {...src}
        width={width}
        overlays={[entry?.layer]}
        revision={entry ? `${entry.pageId}:${entry.rev}` : "none"}
      />
      {entry && fields.map((f) => {
        const v = entry.values[f.id] ?? "";
        if (!v) return null;
        const text = f.type === "checkbox" ? (v === "1" ? "✓" : "") : v;
        if (!text) return null;
        return (
          <div
            key={f.id}
            className="pointer-events-none absolute overflow-hidden whitespace-pre-wrap break-words leading-tight text-[#20302C]"
            style={{
              left: f.x * scale, top: f.y * scale, width: f.w * scale, height: f.h * scale,
              // Legible before faithful: at tile size a box's own type size is a smudge.
              fontSize: Math.max(9, Math.min(14, f.h * scale * 0.8)),
            }}
          >
            {text}
          </div>
        );
      })}
    </div>
  );
}
