import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, CheckCheck, ChevronRight, Download, Eye, PanelLeft, Pencil, Plus, Send, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { api, pageSource, type PageRec, type WorkResponse } from "../lib/api";
import { useNotebookWork } from "../lib/useNotebookWork";
import { parseLayer } from "../lib/ink";
import { useSession } from "../lib/session";
import { useBackTo } from "../lib/useBackTo";
import NotebookSurface, { type LayerMap, type ZoomMode } from "../components/NotebookSurface";
import PageThumb from "../components/PageThumb";
import InkToolbar from "../components/InkToolbar";
import type { ToolState } from "../components/PageCanvas";
import { ErrorNote, Spinner, FlingBadge } from "../components/Shell";
import { Button, Chip, IconButton, Input, Modal } from "../components/ui";
import {
  PATTERNS, PATTERN_COLORS, DEFAULT_PATTERN, DEFAULT_PATTERN_COLOR,
  renderPatternToCanvas, type PatternKey,
} from "../lib/patterns";
import { cn, formatDue, isOverdue } from "../lib/utils";

/** Header controls share one height so a row of them lines up. */
const BUTTON_ROW =
  "inline-flex h-12 items-center gap-2 rounded-full border-[3px] border-pine bg-white px-5 " +
  "font-display text-[17px] font-bold text-pine shadow-[4px_4px_0_0_var(--color-pine)] " +
  "transition-[transform,box-shadow] hover:bg-oat active:translate-x-[3px] active:translate-y-[3px] active:shadow-none";

const FINGER_KEY = "notesanity:fingerDraw";
const RAIL_KEY = "notesanity:studentRail";

/**
 * The student's page rail.
 *
 * Deliberately the same shape as the teacher's page list — thumbnail beside the
 * name, sections as cards — because it is the same notebook, and a student who
 * is told "the practice section, page 3" should be reading the same furniture
 * their teacher is looking at.
 *
 * One component, rendered twice (drawer on small screens, aside on large), so
 * the two can't drift apart.
 */
function PageRail({
  pages, notebookId, visiblePage, assignedIds, onSelect, onEditPage, onRenameSection,
}: {
  pages: PageRec[];
  notebookId: string;
  visiblePage: string;
  /** When browsing the whole notebook, which pages the assignment actually covers. */
  assignedIds?: Set<string>;
  onSelect: (id: string) => void;
  /** Only passed for a notebook the reader owns — theirs to name and arrange. */
  onEditPage?: (page: PageRec) => void;
  onRenameSection?: (name: string, pageIds: string[]) => void;
}) {
  // Consecutive runs, not a group-by: a section is a stretch of the notebook,
  // and the same name appearing twice is two stretches, not one.
  const sections: { name: string; pages: { page: PageRec; number: number }[] }[] = [];
  pages.forEach((page, i) => {
    const name = page.group_name ?? "";
    const last = sections[sections.length - 1];
    if (last && last.name === name) last.pages.push({ page, number: i + 1 });
    else sections.push({ name, pages: [{ page, number: i + 1 }] });
  });

  const row = ({ page, number }: { page: PageRec; number: number }) => {
    // `assignedIds` is only passed while the whole notebook is on show, which is
    // the only time the distinction is worth drawing.
    const scoped = !!assignedIds;
    const assigned = assignedIds?.has(page.id) ?? false;
    const faded = scoped && !assigned;
    const body = (
      <button
        key={page.id}
        type="button"
        onClick={() => onSelect(page.id)}
        className={cn(
          "relative mb-1 flex w-full items-start gap-2 overflow-hidden rounded-lg border-2 p-1.5 pl-2.5 text-left transition-colors",
          visiblePage === page.id ? "border-pine bg-mint/30" : "border-transparent hover:bg-oat",
          // Dimmed rather than hidden: context pages are still readable, just
          // clearly not the thing that was set.
          faded && "opacity-55 hover:opacity-100",
        )}
      >
        {assigned && (
          <span
            aria-hidden
            className="absolute inset-y-1 left-0.5 w-1.5 rounded-full bg-mint"
          />
        )}
        <PageThumb {...pageSource(notebookId, page)} width={52} dimmed={faded} />
        <span className="min-w-0 flex-1 pt-0.5">
          <span className={cn("block truncate text-[16px]", assigned ? "font-bold text-pine" : "font-medium text-pine")}>
            {page.label || `Page ${number}`}
          </span>
          <span className="mt-0.5 block text-[16px] text-pine/55">
            #{number}
            {assigned && <span className="font-bold text-pine"> · assigned</span>}
          </span>
        </span>
      </button>
    );

    // Nested inside a row would put a button inside a button, so the two sit
    // side by side and the row keeps its own hit area.
    if (!onEditPage) return body;
    return (
      <div key={page.id} className="group/row relative">
        {body}
        <button
          type="button"
          onClick={() => onEditPage(page)}
          aria-label={`Rename or file ${page.label || `page ${number}`}`}
          className="absolute right-1 top-1 flex h-9 w-9 items-center justify-center rounded-full text-pine/55 opacity-0 transition-opacity hover:bg-pine/10 hover:text-pine focus:opacity-100 group-hover/row:opacity-100"
        >
          <Pencil className="h-3.5 w-3.5" strokeWidth={2.5} />
        </button>
      </div>
    );
  };

  return (
    <div>
      {sections.map((section, si) =>
        // Ungrouped runs render bare, so the list isn't a wall of cards.
        section.name === "" ? (
          <div key={`plain-${si}`}>{section.pages.map(row)}</div>
        ) : (
          <div key={`${section.name}-${si}`} className="mb-2 rounded-xl border border-pine/20 bg-oat/60 p-1.5">
            <div className="mb-1 flex items-center gap-1 px-1">
              <span className="label-caps min-w-0 flex-1 truncate text-pine/80">{section.name}</span>
              {onRenameSection && (
                <button
                  type="button"
                  onClick={() => onRenameSection(section.name, section.pages.map((p) => p.page.id))}
                  aria-label={`Rename section ${section.name}`}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-pine/55 hover:bg-pine/10 hover:text-pine"
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={2.5} />
                </button>
              )}
              <span className="text-[16px] text-pine/55">{section.pages.length}</span>
            </div>
            {section.pages.map(row)}
          </div>
        ),
      )}
    </div>
  );
}


/**
 * Naming a page and filing it under a section, in one dialogue.
 *
 * The two belong together: a section here is just a name shared by a run of
 * consecutive pages, so "put this page in Week 2" and "call this page Cube
 * studies" are the same kind of edit and shouldn't be two separate trips.
 * Existing sections are offered as suggestions rather than a fixed list, so a
 * new one costs no more than typing it.
 */
function PageOptionsModal({
  page, number, sections, busy, onClose, onSave,
}: {
  page: PageRec;
  number: number;
  sections: string[];
  busy: boolean;
  onClose: () => void;
  onSave: (v: { label: string; groupName: string }) => void;
}) {
  const [label, setLabel] = useState(page.label ?? "");
  const [group, setGroup] = useState(page.group_name ?? "");
  return (
    <Modal onClose={onClose} title={`Page ${number}`}>
      <label className="label-caps mb-1 block text-pine/70" htmlFor="pg-label">Name</label>
      <Input
        id="pg-label"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder={`Page ${number}`}
        autoFocus
      />

      <label className="label-caps mb-1 mt-5 block text-pine/70" htmlFor="pg-section">Section</label>
      <Input
        id="pg-section"
        value={group}
        onChange={(e) => setGroup(e.target.value)}
        list="pg-sections"
        placeholder="No section"
      />
      <datalist id="pg-sections">
        {sections.map((sname) => <option key={sname} value={sname} />)}
      </datalist>
      <p className="mt-2 text-[16px] text-pine/65">
        Pages next to each other with the same section name are grouped together. Leave it empty to take this page out of its section.
      </p>

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={() => onSave({ label: label.trim(), groupName: group.trim() })} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </Modal>
  );
}

/** Renaming a whole run of pages at once, so a section isn't retyped per page. */
function SectionRenameModal({
  name, count, busy, onClose, onSave,
}: { name: string; count: number; busy: boolean; onClose: () => void; onSave: (v: string) => void }) {
  const [value, setValue] = useState(name);
  return (
    <Modal onClose={onClose} title="Rename section">
      <p className="mb-3 text-[16px] text-pine/70">
        {count} page{count === 1 ? "" : "s"} are in this section.
      </p>
      <label className="label-caps mb-1 block text-pine/70" htmlFor="sec-name">Name</label>
      <Input id="sec-name" value={value} onChange={(e) => setValue(e.target.value)} autoFocus placeholder="Week 1" />
      <p className="mt-2 text-[16px] text-pine/65">Clearing the name takes these pages out of the section.</p>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={() => onSave(value.trim())} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </Modal>
  );
}

/**
 * Switches the rail (and the pages on screen) between the assignment and the
 * whole notebook.
 *
 * No counts on the pills: at the 16px interface floor the two labels plus two
 * numbers overflow a rail this narrow, and the numbers are already visible —
 * the list is right underneath, and each section carries its own count.
 */
function ScopeToggle({
  showAll, onChange,
}: { showAll: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="mb-3 flex gap-1 overflow-hidden rounded-full border-2 border-pine bg-white p-1">
      {[
        { all: false, label: "Assignment" },
        { all: true, label: "All pages" },
      ].map((opt) => (
        <button
          key={opt.label}
          type="button"
          onClick={() => onChange(opt.all)}
          aria-pressed={showAll === opt.all}
          className={cn(
            "inline-flex h-9 min-w-0 flex-1 items-center justify-center truncate rounded-full px-2",
            "font-display text-[16px] font-bold transition-colors",
            showAll === opt.all ? "bg-pine text-oat" : "text-pine hover:bg-pine/8",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/** Adding paper to your own notebook: which ruling, what colour, how many. */
function AddPagesModal({
  busy, onClose, onAdd,
}: { busy: boolean; onClose: () => void; onAdd: (b: { pattern: string; color: string; count: number }) => void }) {
  const [pattern, setPattern] = useState<PatternKey>(DEFAULT_PATTERN);
  const [color, setColor] = useState(DEFAULT_PATTERN_COLOR);
  const [count, setCount] = useState(1);
  return (
    <Modal onClose={onClose} title="Add pages" className="sm:max-w-2xl">
      <label className="label-caps mb-2 block text-pine/70">Paper</label>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {PATTERNS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPattern(p.key)}
            aria-pressed={pattern === p.key}
            className={cn(
              "flex flex-col items-center gap-1.5 rounded-[12px] border-2 p-2 transition-colors",
              pattern === p.key ? "border-pine bg-mint/25" : "border-pine/20 hover:bg-oat",
            )}
          >
            <span className="overflow-hidden rounded-[3px] border border-pine/25">
              <PaperSample pattern={p.key} color={color} />
            </span>
            <span className="text-center text-[14px] font-bold leading-tight text-pine">{p.label}</span>
          </button>
        ))}
      </div>

      <label className="label-caps mb-2 mt-5 block text-pine/70">Rule colour</label>
      <div className="flex flex-wrap gap-2">
        {PATTERN_COLORS.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setColor(c.value)}
            aria-pressed={color === c.value}
            title={c.label}
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-full border-2",
              color === c.value ? "border-pine scale-105" : "border-pine/25 hover:border-pine/50",
            )}
          >
            <span className="h-7 w-7 rounded-full border border-pine/20" style={{ background: c.value }} />
          </button>
        ))}
      </div>

      <label className="label-caps mb-1 mt-5 block text-pine/70" htmlFor="add-count">How many</label>
      <Input
        id="add-count"
        type="number"
        min={1}
        max={50}
        value={count}
        onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
      />

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" disabled={busy} onClick={() => onAdd({ pattern, color, count })}>
          {busy ? "Adding…" : `Add ${count} page${count === 1 ? "" : "s"}`}
        </Button>
      </div>
    </Modal>
  );
}

/** A sample of the paper, drawn by the same code that paints the page. */
function PaperSample({ pattern, color }: { pattern: PatternKey; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) renderPatternToCanvas(pattern, color, 612, 792, ref.current, 52 / 612, 2);
  }, [pattern, color]);
  return <canvas ref={ref} style={{ width: 52, height: Math.round((52 * 792) / 612) }} className="block" />;
}

export default function Workspace() {
  const { notebookId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const assignmentId = searchParams.get("assignment");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useSession();
  const goBack = useBackTo("/work");

  /**
   * Which kind of notebook this is decides where a teacher belongs.
   *
   * A teacher has no instance of their own class notebook, so opening the
   * student workspace on one would dead-end — they go to the editor. A
   * student's own notebook is the opposite case: there is nothing for them to
   * edit, and the workspace is exactly the right place to read it.
   */
  const isTeacherRole = user?.role === "teacher";
  const metaQuery = useQuery({
    queryKey: ["notebook-meta", notebookId],
    queryFn: () => api.get<{ notebook: { kind?: string } }>(`/api/notebooks/${notebookId}`),
    enabled: !!notebookId && isTeacherRole,
  });
  const studentOwned = metaQuery.data?.notebook.kind === "student";

  useEffect(() => {
    if (isTeacherRole && notebookId && metaQuery.data && !studentOwned) {
      navigate(`/notebooks/${notebookId}/edit`, { replace: true });
    }
  }, [isTeacherRole, studentOwned, metaQuery.data, notebookId, navigate]);

  const workQuery = useQuery({
    queryKey: ["work", notebookId],
    queryFn: () => api.get<WorkResponse>(`/api/notebooks/${notebookId}/work`),
    enabled: !!notebookId && (!isTeacherRole || studentOwned),
  });

  const assignmentQuery = useQuery({
    queryKey: ["assignment", assignmentId],
    queryFn: () => api.get<any>(`/api/assignments/${assignmentId}`),
    enabled: !!assignmentId,
  });

  const data = workQuery.data;
  const assignment = assignmentQuery.data?.assignment;
  const submission = assignmentQuery.data?.submission;
  /**
   * Mirror the server's rule rather than guessing from status: work is frozen
   * from the moment it is handed in and stays frozen after it comes back
   * marked, until a teacher reopens it.
   */
  const locked = Boolean(submission?.locked);
  // A teacher reading a student's own notebook. Not "locked" — nothing was
  // handed in — just not theirs to write in.
  const readOnly = Boolean(data?.readOnly);

  /**
   * Naming and sectioning belongs to whoever owns the notebook. That is the
   * student in their own book, and nobody in a notebook the teacher built —
   * there the pages are the teacher's, and the server refuses anyway.
   */
  const ownsNotebook =
    !readOnly && (data?.notebook.kind === "personal" || data?.notebook.kind === "student");

  const [editingPage, setEditingPage] = useState<PageRec | null>(null);
  const [editingSection, setEditingSection] = useState<{ name: string; pageIds: string[] } | null>(null);


  const savePage = useMutation({
    mutationFn: (v: { label: string; groupName: string }) =>
      api.patch(`/api/notebooks/${notebookId}/pages/${editingPage!.id}`, v),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["work", notebookId] });
      setEditingPage(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveSection = useMutation({
    mutationFn: (name: string) =>
      api.post(`/api/notebooks/${notebookId}/pages/bulk`, {
        pageIds: editingSection!.pageIds,
        action: name ? "group" : "ungroup",
        groupName: name,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["work", notebookId] });
      setEditingSection(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const marked = Boolean(submission?.returnedAt);
  // Taking work back is only honest while nobody has marked it yet.
  const canUnsubmit = locked && !marked && !submission?.graded;

  const work = useNotebookWork({
    notebookId,
    writeTarget: locked || readOnly ? null : "student",
    data,
  });

  const [tool, setTool] = useState<ToolState>({
    kind: "select", color: "#202124", width: 2.5, stamp: "⭐", fontSize: 14, erase: "quick",
  });
  const [fingerDraw, setFingerDraw] = useState<boolean>(() => {
    try { return localStorage.getItem(FINGER_KEY) === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(FINGER_KEY, fingerDraw ? "1" : "0"); } catch { /* ignore */ }
  }, [fingerDraw]);

  // Published teacher annotations on the template — read-only for the student.
  const masterLayers = useMemo<LayerMap>(() => {
    const map: LayerMap = {};
    for (const a of (data as any)?.masterAnnotations ?? []) map[a.pageId] = parseLayer(a.data);
    return map;
  }, [data]);

  const [zoom, setZoom] = useState<ZoomMode>("page");
  const [visiblePage, setVisiblePage] = useState<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const [railOpen, setRailOpen] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(RAIL_KEY);
      if (saved !== null) return saved === "1";
    } catch { /* ignore */ }
    return typeof window === "undefined" || window.innerWidth >= 640;
  });
  useEffect(() => {
    try { localStorage.setItem(RAIL_KEY, railOpen ? "1" : "0"); } catch { /* ignore */ }
  }, [railOpen]);

  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  useEffect(() => {
    if (!mobileRailOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileRailOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileRailOpen]);

  const goToPage = (id: string) => {
    setVisiblePage(id);
    scrollRef.current?.querySelector(`[data-page-id="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setMobileRailOpen(false);
  };

  /**
   * An assignment scopes the notebook down to its own pages, which is the right
   * default — but the rest of the notebook is where the notes and worked
   * examples are, so the student can widen the scope rather than being sent
   * somewhere else to read them.
   */
  const [showAllPages, setShowAllPages] = useState(false);
  const assignedIds = useMemo(
    () => new Set<string>(assignment?.pageIds ?? []),
    [assignment?.pageIds],
  );
  const pages = useMemo(() => {
    const all = data?.pages ?? [];
    if (!assignedIds.size || showAllPages) return all;
    return all.filter((p) => assignedIds.has(p.id));
  }, [data?.pages, assignedIds, showAllPages]);

  const sectionNames = useMemo(
    () => Array.from(new Set(pages.map((p) => p.group_name ?? "").filter(Boolean))),
    [pages],
  );

  useEffect(() => {
    if (!visiblePage && pages[0]) setVisiblePage(pages[0].id);
  }, [pages, visiblePage]);

  const submit = useMutation({
    mutationFn: async () => {
      await work.flush();
      return api.post(`/api/assignments/${assignmentId}/submit`);
    },
    onSuccess: () => {
      toast.success("Turned in — these pages are now locked.");
      qc.invalidateQueries({ queryKey: ["assignment", assignmentId] });
      qc.invalidateQueries({ queryKey: ["my-assignments"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const unsubmit = useMutation({
    mutationFn: () => api.post(`/api/assignments/${assignmentId}/unsubmit`),
    onSuccess: () => {
      toast.success("Unsubmitted — you can keep working.");
      qc.invalidateQueries({ queryKey: ["assignment", assignmentId] });
      qc.invalidateQueries({ queryKey: ["my-assignments"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * A personal notebook is the student's own: they own the paper as well as the
   * writing, so they can extend it and take it away as a PDF. Neither applies
   * to a class notebook, which belongs to the teacher who published it.
   */
  const isPersonal = (data as any)?.notebook?.kind === "personal";
  const [blankOpen, setBlankOpen] = useState(false);
  const [exporting, setExporting] = useState("");

  const addPages = useMutation({
    mutationFn: (body: { pattern: string; color: string; count: number }) =>
      api.post(`/api/notebooks/${notebookId}/pages/blank`, { ...body, insertAfterPageId: null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["work", notebookId] });
      setBlankOpen(false);
      toast.success("Pages added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const exportPdf = async () => {
    if (!data) return;
    try {
      setExporting("Preparing…");
      const { exportNotebookPdf, layersForPage } = await import("../lib/exportPdf");
      await exportNotebookPdf(
        notebookId,
        data.notebook.title,
        pages.map((page) => ({ page, layers: layersForPage(page.id, data.layers as any) })),
        (done, total) => setExporting(`Page ${done} of ${total}…`),
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting("");
    }
  };

  // Keyboard: undo/redo on the page currently in view.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) work.redo(visiblePage);
        else work.undo(visiblePage);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [work, visiblePage]);

  if (workQuery.isLoading) return <Spinner label="Opening notebook…" />;
  if (workQuery.error) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <ErrorNote error={workQuery.error as Error} />
        <button onClick={() => navigate(-1)} className="mt-4 text-[16px] font-bold text-pine underline">Go back</button>
      </div>
    );
  }
  if (!data) return null;

  const pageIndex = pages.findIndex((p) => p.id === visiblePage);

  return (
    <div className="flex h-dvh flex-col bg-oat">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b-2 border-pine/12 bg-white px-3 py-2">
        <IconButton label="Back" onClick={goBack}>
          <ArrowLeft className="h-4 w-4" strokeWidth={2.5} />
        </IconButton>
        <button
          type="button"
          onClick={() => setRailOpen((v) => !v)}
          className="hidden h-11 w-11 items-center justify-center rounded-full text-pine hover:bg-pine/8 sm:inline-flex"
          aria-label={railOpen ? "Hide pages" : "Show pages"}
          aria-pressed={railOpen}
        >
          <PanelLeft className="h-4 w-4" strokeWidth={2.5} />
        </button>
        <button
          type="button"
          onClick={() => setMobileRailOpen(true)}
          className={cn(BUTTON_ROW, "sm:hidden")}
          aria-label="Show pages"
        >
          <PanelLeft className="h-4 w-4" strokeWidth={2.5} /> Pages
        </button>
        <div className="min-w-0 flex-1 sm:flex-initial">
          <div className="truncate font-display text-[16px] font-bold text-pine">{data.notebook.title}</div>
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[16px] text-pine/70">
              {assignment ? assignment.title : "Notebook"}
              {pages.length > 0 && ` · Page ${Math.max(1, pageIndex + 1)} of ${pages.length}`}
            </span>
            {assignment && (
              <span
                className={cn(
                  "shrink-0 whitespace-nowrap text-[16px]",
                  isOverdue(assignment.dueAt) && !locked ? "font-display font-bold text-[#a3341f]" : "text-pine/60",
                )}
              >
                Due {formatDue(assignment.dueAt)}
              </span>
            )}
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {isPersonal && (
            <>
              <Button variant="secondary" onClick={() => setBlankOpen(true)}>
                <Plus className="h-4 w-4" strokeWidth={2.5} /> Add pages
              </Button>
              <Button variant="secondary" onClick={() => void exportPdf()} disabled={!!exporting}>
                <Download className="h-4 w-4" strokeWidth={2.5} /> {exporting || "Export PDF"}
              </Button>
            </>
          )}
          {/* Marked work is finished: show that, don't offer to hand it in again. */}
          {assignment && marked && (
            <Chip tone="mint" icon={<CheckCheck className="h-4 w-4" strokeWidth={2.5} />}>
              Marked and returned
            </Chip>
          )}
          {assignment && !marked && !locked && (
            <Button
              variant="primary"
              onClick={() => {
                if (confirm("Turn in this assignment? These pages lock once you do.")) {
                  submit.mutate();
                }
              }}
              disabled={submit.isPending}
            >
              <Send className="h-4 w-4" strokeWidth={2.5} /> Turn in
            </Button>
          )}
          {assignment && locked && !marked && (
            <>
              <Chip tone="mint" icon={<Check className="h-4 w-4" strokeWidth={2.5} />}>Handed in</Chip>
              {canUnsubmit && (
                <Button variant="secondary" onClick={() => unsubmit.mutate()} disabled={unsubmit.isPending}>
                  <Undo2 className="h-4 w-4" strokeWidth={2.5} /> Take it back
                </Button>
              )}
            </>
          )}
        </div>
      </header>

      {editingPage && (
        <PageOptionsModal
          page={editingPage}
          number={pages.findIndex((p) => p.id === editingPage.id) + 1}
          sections={sectionNames}
          busy={savePage.isPending}
          onClose={() => setEditingPage(null)}
          onSave={(v) => savePage.mutate(v)}
        />
      )}

      {editingSection && (
        <SectionRenameModal
          name={editingSection.name}
          count={editingSection.pageIds.length}
          busy={saveSection.isPending}
          onClose={() => setEditingSection(null)}
          onSave={(v) => saveSection.mutate(v)}
        />
      )}

      {readOnly && (
        <div className="flex items-center gap-2 border-b-2 border-pine/15 bg-oat px-4 py-2 text-[16px] text-pine/80">
          <Eye className="h-4 w-4" strokeWidth={2.5} />
          {data.student?.name ? `${data.student.name}'s own notebook` : "A student's own notebook"} — you can read it, but it isn't yours to write in or assign.
        </div>
      )}
      {locked && !marked && (
        <div className="flex items-center gap-2 border-b-2 border-[#8a6a1f]/40 bg-[#f7e6bf] px-4 py-2 text-[16px] text-[#5c4611]">
          <Check className="h-4 w-4" strokeWidth={2.5} />
          Handed in{submission?.submittedAt ? ` ${formatDue(submission.submittedAt)}` : ""}
          {canUnsubmit ? " — you can still take it back until it's marked." : " — your teacher is marking it."}
        </div>
      )}
      {marked && (
        <div className="flex items-center gap-2 border-b-2 border-pine/15 bg-mint/25 px-4 py-2 text-[16px] text-pine">
          <CheckCheck className="h-4 w-4" strokeWidth={2.5} />
          This work is marked and back with you. Ask your teacher if you need it reopened.
        </div>
      )}

      {submission?.grade && (
        <div className="border-b-2 border-pine/12 bg-mint/40 px-4 py-2 text-[16px] text-pine">
          <span className="font-display font-bold">Grade: </span>
          {assignment?.grading === "points" && `${submission.grade.points ?? "—"} / ${assignment.pointsMax}`}
          {assignment?.grading === "letter" && (submission.grade.letter ?? "—")}
          {assignment?.grading === "complete" &&
            (submission.grade.complete ? "Complete" : "Incomplete")}
          {submission.grade.feedback && <span className="ml-2 text-pine/80">— {submission.grade.feedback}</span>}
        </div>
      )}

      {/* No pen where there is nothing to write on: handed-in work, or someone
          else's notebook. Offering a tool that silently does nothing is worse
          than not offering it. */}
      {!locked && !readOnly && (
        <div className="overflow-x-auto">
          <InkToolbar
            tool={tool}
            onToolChange={setTool}
            fingerDraw={fingerDraw}
            onFingerDrawChange={setFingerDraw}
            onUndo={() => work.undo(visiblePage)}
            onRedo={() => work.redo(visiblePage)}
            canUndo={work.canUndo(visiblePage)}
            canRedo={work.canRedo(visiblePage)}
            status={work.status}
            zoom={zoom}
            onZoomChange={setZoom}
          />
        </div>
      )}

      {blankOpen && (

        <AddPagesModal

          busy={addPages.isPending}

          onClose={() => setBlankOpen(false)}

          onAdd={(body) => addPages.mutate(body)}

        />

      )}


      {mobileRailOpen && (
        <div className="fixed inset-0 z-40 flex sm:hidden">
          <div
            className="absolute inset-0 bg-pine/40"
            onClick={() => setMobileRailOpen(false)}
            aria-hidden
          />
          <aside className="relative flex h-full w-[248px] max-w-[85vw] flex-col overflow-y-auto border-r-2 border-pine/12 bg-white px-2 py-3 shadow-xl">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="label-caps text-pine/70">Pages</span>
              <button
                type="button"
                onClick={() => setMobileRailOpen(false)}
                className="rounded-full p-1.5 text-pine hover:bg-pine/8"
                aria-label="Close pages"
              >
                <ArrowLeft className="h-4 w-4" strokeWidth={2.5} />
              </button>
            </div>
            {assignedIds.size > 0 && (
              <ScopeToggle showAll={showAllPages} onChange={setShowAllPages} />
            )}
            <PageRail
              pages={pages}
              notebookId={notebookId}
              visiblePage={visiblePage}
              assignedIds={showAllPages ? assignedIds : undefined}
              onSelect={goToPage}
              onEditPage={ownsNotebook ? setEditingPage : undefined}
              onRenameSection={ownsNotebook ? (name, pageIds) => setEditingSection({ name, pageIds }) : undefined}
            />
          </aside>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        {railOpen && (
          <aside className="hidden w-[244px] shrink-0 overflow-y-auto border-r-2 border-pine/12 bg-white px-2 py-3 sm:block">
            {assignedIds.size > 0 && (
              <ScopeToggle showAll={showAllPages} onChange={setShowAllPages} />
            )}
            <PageRail
              pages={pages}
              notebookId={notebookId}
              visiblePage={visiblePage}
              assignedIds={showAllPages ? assignedIds : undefined}
              onSelect={goToPage}
              onEditPage={ownsNotebook ? setEditingPage : undefined}
              onRenameSection={ownsNotebook ? (name, pageIds) => setEditingSection({ name, pageIds }) : undefined}
            />
          </aside>
        )}
        {!railOpen && (
          <button
            type="button"
            onClick={() => setRailOpen(true)}
            className="absolute bottom-20 left-3 z-20 hidden items-center gap-1 rounded-full border-[3px] border-pine bg-white px-3 py-2 text-[16px] font-display font-bold text-pine shadow-[3px_3px_0_0_var(--color-pine)] hover:bg-oat sm:flex"
            aria-label="Show pages"
          >
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.5} /> Pages
          </button>
        )}
        <div className="min-w-0 flex-1">
          <NotebookSurface
            notebookId={notebookId}
            pages={pages}
            fields={data.fields}
            studentLayers={work.studentLayers}
            teacherLayers={work.teacherLayers}
          masterLayers={masterLayers}
            fieldValues={work.fieldValues}
            writeTarget={locked || readOnly ? null : "student"}
            tool={tool}
            fingerDraw={fingerDraw}
            zoom={zoom}
            authorName={user?.name}
            fieldsEditable={!locked}
            onLayerChange={work.setLayer}
            onFieldChange={work.setFieldValue}
          onResponseUploaded={() => workQuery.refetch()}
            onVisiblePageChange={setVisiblePage}
            scrollRef={scrollRef}
          />
        </div>
      </div>
      <FlingBadge />
    </div>
  );
}
