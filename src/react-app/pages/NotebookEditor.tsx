import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive, ArrowLeft, Check, CheckSquare, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, EyeOff,
  CopyPlus, FolderPlus, Image as ImageIcon, ImageOff, ImagePlus, ListChecks, Loader2, Mic, MessageSquareText, Palette,
  Pencil, PenLine, RotateCcw, Rows3, Send, Trash2, Type as TypeIcon, Undo2, Upload, X, PanelLeft,
  FolderOpen, LibraryBig, Wand2, Eye, ChevronUp, PanelLeftClose, PanelLeftOpen, Presentation, Rows2, GalleryVertical, RefreshCw,
  Link2 as LinkIcon, ExternalLink, Unlink2, Copy, MoreHorizontal, FilePlus2, SquarePlus,
} from "lucide-react";
import { type ContextEntry, MOD, isEditableTarget, longPressJustFired, openContextMenu, pointFor, watchLongPress } from "../components/ContextMenu";
import { toast } from "sonner";
import { api, assetUrl, pageSource, type FieldRec, type PageRec } from "../lib/api";
import { loadPdf, readPageLinks, readPageSizes, type PdfLink } from "../lib/pdf";
import { linkHost, normalizeLink } from "../../shared/links.mjs";
import { convertToPdf, driveFileAsPdf, hasDrivePicker, needsConversion, pickDriveFile } from "../lib/google";
import {
  PATTERNS, PATTERN_COLORS, DEFAULT_PATTERN, DEFAULT_PATTERN_COLOR,
  isPattern, renderPatternToCanvas, type PatternKey,
} from "../lib/patterns";
import PageCanvas, { type FieldValue, type ToolState } from "../components/PageCanvas";
import NotebookSurface, { type ZoomMode } from "../components/NotebookSurface";
import NotebookPageList, { type ArrangeEntry } from "../components/NotebookPageList";
import InkToolbar, { ZoomSelect } from "../components/InkToolbar";
import { usePersistedBool } from "../lib/usePersisted";
import Tour from "../components/Tour";
import PageLibraryModal from "../components/PageLibraryModal";
import { emptyLayer, markRefAt, parseLayer, PEN_COLORS, serializeLayer, TEACHER_COLORS, type LayerData, type MarkRef } from "../lib/ink";
import { usePinchZoom } from "../lib/usePinchZoom";
import { detectFieldsOnPage, type FieldCandidate } from "../lib/formFields";
import type { SaveStatus } from "../lib/autosave";
import Shell, { ErrorNote, Spinner } from "../components/Shell";
import { Button, Chip, ConfirmModal, IconButton, Input, Label, Menu, Modal, Select, Textarea, buttonClass, type MenuItem } from "../components/ui";
import PushToClassesModal from "../components/PushToClassesModal";
import { useBackTo } from "../lib/useBackTo";
import { cn, formatDue, DEFAULT_ACCENT } from "../lib/utils";

/** Header controls share one height so a row of them lines up. */
/** The header's three actions: a size that fits three across a phone, the full size from `sm`. */
const COMPACT = "h-11 px-2.5 text-[16px] sm:h-12 sm:px-5 sm:text-[17px]";

type FieldTool = "none" | "text" | "checkbox" | "choice" | "prompt" | "image" | "audio" | "richtext" | "figure" | "link";

/** Alias kept for readability at the call sites below — `FieldRec` already
 * covers the new prompt/image/audio types and the `prompt`/`has_media` columns. */
type FieldRow = FieldRec;

interface EditorPage extends PageRec {
  group_name?: string;
}

interface NotebookResponse {
  notebook: {
    id: string; classId: string; title: string; status: string;
    pageCount: number; assetKey: string; lastPublishedAt: string | null;
    accentColor: string; hasCover: boolean;
    /** Put away for the class: hidden from students, still here for the teacher. */
    archived?: boolean;
    /** 'class', 'template', 'personal' or 'student' — a template has no class and is pushed into them. */
    kind?: string;
    templateId?: string | null;
  };
  pages: EditorPage[];
  fields: FieldRow[];
  isTeacher: boolean;
}

interface AnnotationRow {
  pageId: string;
  data: string;
  publishedData: string;
  rev: number;
  unpublished: boolean;
}

const ACCENT_SWATCHES = [
  "#2E7D6B", "#20302C", "#3F6C9E", "#7A5C8E", "#C4703F",
  "#D9A441", "#A3341F", "#4F7A3A",
];

interface NotebookAssignment {
  id: string;
  title: string;
  pageIds: string[];
  pageCount: number;
  dueAt: string | null;
  status: string;
  grading: string;
  pointsMax: number;
  submitted: number;
  returned: number;
  total: number;
}

/** What each field type is called in the interface, where the raw name reads badly. */
const FIELD_TYPE_LABEL: Record<string, string> = {
  text: "Text box",
  checkbox: "Checkbox",
  choice: "Dropdown",
  prompt: "Prompt",
  image: "Image upload",
  audio: "Audio recording",
  richtext: "Rich text",
  figure: "Picture",
  link: "Link",
};
const fieldTypeLabel = (t: string) => FIELD_TYPE_LABEL[t] ?? t;

/** What "edit" means for each kind of box, in the menu. */
const FIELD_EDIT_LABEL: Record<string, string> = {
  richtext: "Edit text…",
  figure: "Change picture…",
  link: "Edit link…",
};

/** What a field's box says on the page in the editor: its type, and what tells it apart. */
function fieldChip(f: FieldRow): string {
  if (f.type === "link") {
    const href = normalizeLink(f.content ?? "");
    return `Link · ${f.label || (href ? linkHost(href) : "no address yet")}`;
  }
  return `${fieldTypeLabel(f.type)}${f.label ? ` · ${f.label}` : ""}`;
}

interface FieldDraft { label: string; options: string; prompt: string; content: string }

/** Only the parts this field type actually shows — an omitted key means "leave it". */
function fieldPatch(f: FieldRow, d: FieldDraft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!["image", "audio", "richtext", "figure"].includes(f.type)) out.label = d.label;
  if (f.type === "choice") out.options = d.options.split("\n").map((v) => v.trim()).filter(Boolean);
  if (f.type === "prompt") out.prompt = d.prompt;
  if (f.type === "richtext") out.content = d.content;
  // A link's address, as typed: the server stores its checked form, and the
  // inspector refuses Save on anything that wouldn't pass.
  if (f.type === "link") out.content = d.content.trim();
  return out;
}

function fieldIsDirty(f: FieldRow, d: FieldDraft): boolean {
  const p = fieldPatch(f, d);
  // A link is compared as the server will store it — the address checked and
  // completed, the words on one line — or "khanacademy.org" would still read
  // as unsaved after saving as "https://khanacademy.org/".
  const isLink = f.type === "link";
  const label = isLink ? d.label.replace(/\s+/g, " ").trim() : d.label;
  const content = isLink ? normalizeLink(d.content) ?? d.content.trim() : d.content;
  if ("label" in p && label !== (f.label ?? "")) return true;
  if ("options" in p && JSON.stringify(p.options) !== JSON.stringify(safeOptions(f.options))) return true;
  if ("prompt" in p && d.prompt !== (f.prompt ?? "")) return true;
  if ("content" in p && content !== (f.content ?? "")) return true;
  return false;
}

/** Options are stored as a JSON array; treat anything unparseable as empty. */
function safeOptions(raw?: string): string[] {
  try { const v = JSON.parse(raw || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}

const MIN_FIELD = 8;

/** Sensible default size when a teacher taps rather than drags to place a field. */
const DEFAULT_FIELD_SIZE: Record<Exclude<FieldTool, "none">, { w: number; h: number }> = {
  text: { w: 160, h: 28 },
  checkbox: { w: 18, h: 18 },
  choice: { w: 160, h: 28 },
  prompt: { w: 260, h: 120 },
  image: { w: 180, h: 140 },
  audio: { w: 220, h: 56 },
  richtext: { w: 300, h: 110 },
  figure: { w: 220, h: 165 },
  // About one line of body text — the commonest thing to link.
  link: { w: 160, h: 22 },
};

export default function NotebookEditor() {
  const { notebookId = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["notebook", notebookId],
    queryFn: () => api.get<NotebookResponse>(`/api/notebooks/${notebookId}?archived=1`),
    enabled: !!notebookId,
  });
  const isTemplate = query.data?.notebook.kind === "template";
  const goBack = useBackTo(isTemplate ? "/notebooks" : "/classes");


  const assignmentsQuery = useQuery({
    queryKey: ["notebook-assignments", notebookId],
    queryFn: () => api.get<{ assignments: NotebookAssignment[] }>(`/api/notebooks/${notebookId}/assignments`),
    enabled: !!notebookId,
  });

  const annotationsQuery = useQuery({
    queryKey: ["annotations", notebookId],
    queryFn: () => api.get<{ annotations: AnnotationRow[] }>(`/api/notebooks/${notebookId}/annotations`),
    enabled: !!notebookId,
  });

  const [pageIdx, setPageIdx] = useState(0);
  const [tool, setTool] = useState<FieldTool>("none");
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [searchParams, setSearchParams] = useSearchParams();
  const sidePanel = (searchParams.get("panel") === "assignments" ? "assignments" : "pages") as
    | "pages"
    | "assignments";
  const setSidePanel = (tab: "pages" | "assignments") => {
    const next = new URLSearchParams(searchParams);
    next.set("panel", tab);
    setSearchParams(next, { replace: true });
  };
  const [zoom, setZoom] = useState<ZoomMode>(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const addPagesRef = useRef<HTMLInputElement>(null);
  const [blankOpen, setBlankOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [busyMessage, setBusyMessage] = useState("");
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [coverBump, setCoverBump] = useState(0);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [pagesDrawerOpen, setPagesDrawerOpen] = useState(false);
  useEffect(() => {
    if (!pagesDrawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPagesDrawerOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pagesDrawerOpen]);

  // ---- master-page annotation mode ----
  /**
   * Moving your own annotations with Select. Select otherwise means arranging
   * boxes; pressing one of your marks switches to moving marks, and a press on
   * bare paper switches back. See `annotateMode` below.
   */
  const [editingMarks, setEditingMarks] = useState(false);
  /** Where "Add page" puts new pages: after the page on screen, or at the end. */
  const [addAt, setAddAt] = useState<"after" | "end">("after");
  /** Which Add menu is open, for its button's aria-expanded. */
  const [addMenu, setAddMenu] = useState<null | "page" | "element">(null);
  /** The toolbar can be tucked away to give the page the height. */
  const [ribbonOpen, setRibbonOpen] = usePersistedBool("notesanity:nbRibbon", true);
  /** The page list beside the page, likewise. */
  const [railOpen, setRailOpen] = usePersistedBool("notesanity:nbRail", true);
  /**
   * Presenting: the page and nothing else, full screen, for a projector.
   * `pages` steps one page at a time with arrows; `scroll` is the whole
   * notebook as one long sheet.
   */
  const [presenting, setPresenting] = useState<null | { mode: "pages" | "scroll"; idx: number }>(null);
  const [presentZoom, setPresentZoom] = useState<ZoomMode>("page");
  /**
   * The mark a press outside annotate mode landed on, handed to the editor that
   * opens because of it. Reaching for an annotation *is* asking to work on it,
   * so the alternative — a press that appears to do nothing until you find the
   * Annotate button yourself — is just a worse way of saying yes.
   */
  const [pendingMark, setPendingMark] = useState<MarkRef | null>(null);
  const [inkTool, setInkTool] = useState<ToolState>({
    // Select first: a notebook is built before it's written on.
    kind: "select", color: TEACHER_COLORS[0], width: 2.5, stamp: "⭐", fontSize: 14, erase: "quick",
  });
  const [inkFingerDraw, setInkFingerDraw] = useState(false);
  const [annotationLayer, setAnnotationLayer] = useState<LayerData>(emptyLayer());
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedAnnotationPage = useRef<string | null>(null);
  /**
   * Undo history for the teacher's own ink, kept per page so switching pages
   * and coming back doesn't lose either page's stack. Small and local — this
   * is drawing on a template, not the append-only save `useNotebookWork` does
   * for student work, so a plain past/future pair is all it needs.
   */
  const annotationHistory = useRef<Record<string, { past: LayerData[]; future: LayerData[] }>>({});
  const [annotationHistoryTick, setAnnotationHistoryTick] = useState(0);

  const saveAnnotation = useMutation({
    mutationFn: ({ pageId, data }: { pageId: string; data: string }) =>
      api.put(`/api/notebooks/${notebookId}/annotations/${pageId}`, { data }),
    onSuccess: () => {
      setSaveStatus("saved");
      qc.invalidateQueries({ queryKey: ["annotations", notebookId] });
    },
    onError: (e: Error) => {
      setSaveStatus("idle");
      toast.error(e.message);
    },
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => { setContainerWidth(el.clientWidth); setContainerHeight(el.clientHeight); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [query.data]);

  const allPages = query.data?.pages ?? [];
  const livePages = useMemo(() => allPages.filter((p) => !p.archived), [allPages]);

  /**
   * There are no tabs: the tool in hand is the mode. Any writing tool means
   * writing on the page (the teacher's annotation layer); Select means
   * arranging boxes — or, after a press on one of your marks, moving marks.
   */
  const annotateMode = inkTool.kind !== "select" || editingMarks;
  /** Picking a writing tool puts down whatever box was about to be placed. */
  const changeInkTool = (next: ToolState) => {
    setInkTool(next);
    if (next.kind !== "select") { setTool("none"); setSelectedField(null); }
    else if (next.kind !== inkTool.kind) setEditingMarks(false);
    setPendingMark(null);
  };
  /** Add element → something to place: back to Select, arranging boxes, with that box armed. */
  const armField = (k: Exclude<FieldTool, "none">) => {
    setInkTool((t) => ({ ...t, kind: "select" }));
    setEditingMarks(false);
    setPendingMark(null);
    setSelectedField(null);
    setTool(k);
  };
  // Escape puts down a box that was about to be placed, from anywhere but a text field.
  useEffect(() => {
    if (tool === "none") return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !isEditableTarget(e.target)) setTool("none"); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool]);
  const page = livePages[Math.min(pageIdx, Math.max(0, livePages.length - 1))];
  const fields = useMemo(
    () => (query.data?.fields ?? []).filter((f) => page && f.page_id === page.id),
    [query.data?.fields, page],
  );

  const annotationRows = annotationsQuery.data?.annotations ?? [];
  const hasUnpublishedAnnotations = annotationRows.some((a) => a.unpublished);

  /**
   * Every page's markup, for the rail's previews.
   *
   * The page being edited comes from local state rather than the query, so a
   * stroke shows up in its own thumbnail as it's drawn instead of waiting for
   * the autosave to land and the query to refetch.
   */
  const railAnnotations = useMemo(() => {
    const map: Record<string, LayerData> = {};
    for (const row of annotationRows) if (row.data) map[row.pageId] = parseLayer(row.data);
    if (page) map[page.id] = annotationLayer;
    return map;
  }, [annotationRows, page, annotationLayer]);

  // Load the current page's draft annotation into local state whenever the
  // page changes (or the query first resolves) — but never while the teacher
  // is actively mid-edit, so a background refetch can't clobber their strokes.
  useEffect(() => {
    if (!page) return;
    const key = `${page.id}:${annotationsQuery.dataUpdatedAt}`;
    if (loadedAnnotationPage.current === key) return;
    const row = annotationRows.find((a) => a.pageId === page.id);
    setAnnotationLayer(parseLayer(row?.data));
    setSaveStatus("idle");
    loadedAnnotationPage.current = key;
  }, [page, annotationRows, annotationsQuery.dataUpdatedAt]);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const handleAnnotationChange = (layer: LayerData, recordHistory = true) => {
    if (recordHistory && page) {
      const entry = (annotationHistory.current[page.id] ??= { past: [], future: [] });
      entry.past.push(annotationLayer);
      if (entry.past.length > 40) entry.past.shift();
      entry.future = [];
      setAnnotationHistoryTick((t) => t + 1);
    }
    setAnnotationLayer(layer);
    if (!page) return;
    setSaveStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const pageId = page.id;
    saveTimer.current = setTimeout(() => {
      saveAnnotation.mutate({ pageId, data: serializeLayer(layer) });
    }, 1000);
  };

  /**
   * Wipe the teacher's own ink off the master page in view.
   *
   * Only the annotation layer: the answer boxes on the page are fields, not
   * marks, and a student's work isn't here at all — this is the template, not
   * anybody's copy. Goes through the same handler as drawing, so it saves the
   * way any other change does.
   */
  const undoAnnotation = () => {
    if (!page) return;
    const entry = annotationHistory.current[page.id];
    if (!entry?.past.length) return;
    entry.future.push(annotationLayer);
    const previous = entry.past.pop()!;
    handleAnnotationChange(previous, false);
    setAnnotationHistoryTick((t) => t + 1);
  };
  const redoAnnotation = () => {
    if (!page) return;
    const entry = annotationHistory.current[page.id];
    if (!entry?.future.length) return;
    entry.past.push(annotationLayer);
    const next = entry.future.pop()!;
    handleAnnotationChange(next, false);
    setAnnotationHistoryTick((t) => t + 1);
  };
  const canUndoAnnotation = !!page && (annotationHistory.current[page.id]?.past.length ?? 0) > 0;
  const canRedoAnnotation = !!page && (annotationHistory.current[page.id]?.future.length ?? 0) > 0;
  // Referenced so the linter (and a future reader) can see why this exists —
  // it exists purely to force the undo/redo buttons to re-render, since the
  // history itself lives in a ref that changing doesn't re-render on its own.
  void annotationHistoryTick;

  const clearAnnotationPage = () => {
    if (!page) return;
    const empty = !annotationLayer.s.length && !annotationLayer.x.length
      && !annotationLayer.e.length && !annotationLayer.c.length;
    if (empty) {
      toast.success("Nothing on this page to clear");
      return;
    }
    setClearingPage(true);
  };

  // How many assignments reference each page — surfaced as a badge on the
  // thumbnail, since a page can legitimately be assigned more than once.
  const assignmentCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of assignmentsQuery.data?.assignments ?? []) {
      for (const pid of a.pageIds ?? []) counts[pid] = (counts[pid] ?? 0) + 1;
    }
    return counts;
  }, [assignmentsQuery.data]);

  // The same menu as the annotation toolbar, so the same arithmetic: the
  // presets are multiples of fit-width, and Fit page is whatever fits.
  const fitWidth = useMemo(() => {
    if (!page) return 1;
    const usable = Math.max(280, containerWidth - 48);
    return Math.min(1.8, usable / page.width);
  }, [page, containerWidth]);
  const scale = useMemo(() => {
    if (!page) return 1;
    if (zoom === "width") return fitWidth;
    if (zoom === "page") return Math.max(0.15, Math.min(fitWidth, Math.max(240, containerHeight - 76) / page.height));
    return fitWidth * zoom;
  }, [page, containerHeight, zoom, fitWidth]);
  usePinchZoom(containerRef, scale / fitWidth, setZoom);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["notebook", notebookId] });
    qc.invalidateQueries({ queryKey: ["notebook-assignments", notebookId] });
  };

  const createField = useMutation({
    mutationFn: (body: any) => api.post<{ field: { id: string } }>(`/api/notebooks/${notebookId}/fields`, body),
    // Select what was just placed. A rich text block or a picture is empty
    // until its inspector is open, so dropping one and being handed nothing to
    // type into is a dead end.
    onSuccess: (res) => { invalidate(); setSelectedField(res.field.id); },
    onError: (e: Error) => toast.error(e.message),
  });
  const addBlankPages = useMutation({
    mutationFn: (body: { pattern: string; color: string; count: number; insertAfterPageId: string | null }) =>
      api.post<{ created: string[] }>(`/api/notebooks/${notebookId}/pages/blank`, body),
    onSuccess: (res) => {
      const n = res.created.length;
      toast.success(`Added ${n} blank page${n === 1 ? "" : "s"}`);
      setBlankOpen(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const insertLibraryPage = useMutation({
    mutationFn: (body: { entryId: string; insertAfterPageId: string | null }) =>
      api.post<{ page: { id: string } }>(`/api/notebooks/${notebookId}/pages/from-library`, body),
    onSuccess: () => {
      toast.success("Page added from your library");
      setLibraryOpen(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  /**
   * Saving is sequential rather than parallel: each one may copy a source PDF
   * into the library, and a handful of 25 MB round trips at once is a worse
   * experience than waiting a moment longer.
   */
  const saveToLibrary = useMutation({
    mutationFn: async (pageIds: string[]) => {
      let last = "";
      for (const pageId of pageIds) {
        last = (await api.post<{ title: string }>("/api/my/page-library", { notebookId, pageId })).title;
      }
      return { count: pageIds.length, last };
    },
    onSuccess: ({ count, last }) => {
      setSelection(new Set());
      // The library is read by the insert modal and by /library, both of which
      // can be opened a second later — a saved page that isn't there yet reads
      // as a save that didn't happen.
      void qc.invalidateQueries({ queryKey: ["page-library"] });
      toast.success(count === 1 ? `"${last}" saved to your library` : `${count} pages saved to your library`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  /**
   * Blanks found on this page, awaiting a yes.
   *
   * Held here rather than in `FieldLayer`, which carries `key={page.id}` and
   * remounts on every page change — a review that vanished when you glanced at
   * the next page would be worse than no review.
   */
  const [candidates, setCandidates] = useState<FieldCandidate[] | null>(null);
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  const [finding, setFinding] = useState(false);

  /**
   * The notebook as a student will get it.
   *
   * Everything a student would be shown is already loaded here — the pages,
   * every page's fields, and the annotations from `railAnnotations`, which
   * holds the *draft* markup including strokes not yet published. So the
   * preview needs no request at all, which is the point: `GET /work` looks
   * like a read but creates a work instance for whoever calls it, and a
   * preview that fabricated a student's notebook would be worse than none.
   * Everything typed or drawn in here lives in these two pieces of state and
   * is dropped on the way out.
   */
  const [previewing, setPreviewing] = useState(false);
  const [previewLayers, setPreviewLayers] = useState<Record<string, LayerData>>({});
  const [previewValues, setPreviewValues] = useState<Record<string, FieldValue>>({});
  const [previewZoom, setPreviewZoom] = useState<ZoomMode>("page");
  const [previewFinger, setPreviewFinger] = useState(false);
  const [previewTool, setPreviewTool] = useState<ToolState>({
    kind: "pen", color: PEN_COLORS[0], width: 2.5, stamp: "⭐", fontSize: 14, erase: "quick",
  });
  const openPreview = () => {
    setPreviewLayers({});
    setPreviewValues({});
    setPreviewing(true);
  };
  // Found for *this* page; turning the page throws them away rather than
  // leaving boxes hovering over a document they don't describe.
  useEffect(() => { setCandidates(null); setDropped(new Set()); }, [page?.id]);

  const findFields = async () => {
    if (!page || isPattern(page.pattern)) return;
    setFinding(true);
    try {
      const doc = await loadPdf(assetUrl(notebookId, page.asset_key));
      const pdfPage = await doc.getPage(page.source_index + 1);
      const found = await detectFieldsOnPage(pdfPage, fields);
      setDropped(new Set());
      setCandidates(found);
      if (!found.length) {
        toast("Nothing to fill in found on this page", {
          description: "It looks for lines to write on, empty table cells and rows of underscores. If the page has none of those, draw the boxes where you want them.",
        });
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setFinding(false);
    }
  };

  const addFound = useMutation({
    mutationFn: (picked: FieldCandidate[]) =>
      api.post<{ ids: string[] }>(`/api/notebooks/${notebookId}/fields/bulk`, {
        pageId: page!.id,
        fields: picked.map(({ type, x, y, w, h }) => ({ type, x, y, w, h })),
      }),
    onSuccess: (_res, picked) => {
      setCandidates(null);
      setDropped(new Set());
      invalidate();
      toast.success(`Added ${picked.length} field${picked.length === 1 ? "" : "s"}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * Links the page's own file has that aren't on the page yet.
   *
   * A file uploaded now brings its links in as its pages are read. Pages that
   * arrived before links were kept have them only in the file, so picking the
   * Link tool looks — the moment a teacher is thinking about links — and
   * offers to bring them across. Nothing is added without the press, which
   * also means a link deleted on purpose (a publisher's store, an answer key)
   * only comes back if asked for.
   */
  const [fileLinks, setFileLinks] = useState<PdfLink[] | null>(null);
  useEffect(() => {
    setFileLinks(null);
    if (tool !== "link" || !page || isPattern(page.pattern) || !page.asset_key) return;
    let live = true;
    const onPage = fields.filter((f) => f.type === "link");
    const near = (a: number, b: number) => Math.abs(a - b) < 3;
    readPageLinks(assetUrl(notebookId, page.asset_key), page.source_index)
      .then((found) => {
        if (!live) return;
        setFileLinks(found.filter((l) => !onPage.some((f) => f.content === l.url && near(f.x, l.x) && near(f.y, l.y))));
      })
      .catch(() => { if (live) setFileLinks([]); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, page?.id, fields]);

  const addFileLinks = useMutation({
    mutationFn: (links: PdfLink[]) => {
      const pw = page!.width;
      const ph = page!.height;
      return api.post<{ ids: string[] }>(`/api/notebooks/${notebookId}/fields/bulk`, {
        pageId: page!.id,
        // Clamped to the page: a file's link boxes can overhang its edge by a
        // point, and the bulk route refuses anything off the page.
        fields: links.map((l) => {
          const x = Math.max(0, l.x);
          const y = Math.max(0, l.y);
          return { type: "link", x, y, w: Math.min(pw, l.x + l.w) - x, h: Math.min(ph, l.y + l.h) - y, label: l.label, content: l.url };
        }).filter((f) => f.w > 1 && f.h > 1),
      });
    },
    onSuccess: (_res, links) => {
      invalidate();
      toast.success(`Added ${links.length} link${links.length === 1 ? "" : "s"} from the file`);
      setTool("none");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateField = useMutation({
    mutationFn: ({ id, ...body }: any) => api.patch(`/api/notebooks/${notebookId}/fields/${id}`, body),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });
  const restoreField = useMutation({
    mutationFn: (id: string) => api.patch(`/api/notebooks/${notebookId}/fields/${id}`, { archived: false }),
    onSuccess: (_r, id) => { invalidate(); setSelectedField(id); },
    onError: (e: Error) => toast.error(e.message),
  });
  /**
   * Deleting hides the box rather than erasing it — students' answers stay
   * attached to it — so Undo is exact: the box comes back with every answer.
   * That is why there's no "are you sure": the undo is the safety, and a
   * dialog on every delete is a tax on tidying a page.
   */
  const deleteField = useMutation({
    mutationFn: (id: string) => api.del(`/api/notebooks/${notebookId}/fields/${id}`),
    onSuccess: (_r, id) => {
      const f = (query.data?.fields ?? []).find((x) => x.id === id);
      setSelectedField(null);
      invalidate();
      toast(`${f ? fieldTypeLabel(f.type) : "Box"} deleted`, {
        action: { label: "Undo", onClick: () => restoreField.mutate(id) },
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const duplicateField = useMutation({
    mutationFn: (id: string) => api.post<{ field: { id: string } }>(`/api/notebooks/${notebookId}/fields/${id}/duplicate`, {}),
    onSuccess: (res) => { invalidate(); setSelectedField(res.field.id); },
    onError: (e: Error) => toast.error(e.message),
  });

  /** The right-click / long-press / "…" menu for one box. Every item is also in the side panel or on a key. */
  const openFieldMenu = (f: FieldRow, x: number, y: number) => {
    const href = f.type === "link" ? normalizeLink(f.content ?? "") : null;
    const entries: ContextEntry[] = [];
    if (href) entries.push({ label: "Open link", icon: <ExternalLink />, onSelect: () => window.open(href, "_blank", "noopener,noreferrer") });
    entries.push({ label: FIELD_EDIT_LABEL[f.type] ?? "Edit box…", icon: <Pencil />, onSelect: () => setSelectedField(f.id) });
    if (href) entries.push({ label: "Copy address", icon: <Copy />, onSelect: () => { void navigator.clipboard?.writeText(href); } });
    entries.push(
      { label: "Duplicate", icon: <CopyPlus />, shortcut: `${MOD}D`, onSelect: () => duplicateField.mutate(f.id) },
      { kind: "separator" },
      { label: "Delete", icon: <Trash2 />, danger: true, shortcut: "⌫", onSelect: () => deleteField.mutate(f.id) },
    );
    openContextMenu({ x, y, title: fieldChip(f), entries });
  };

  // Delete, duplicate and the menu key act on the selected box — never while
  // something is being typed, in the side panel or anywhere else.
  useEffect(() => {
    if (!selectedField) return;
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const f = (query.data?.fields ?? []).find((x) => x.id === selectedField);
      if (!f) return;
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteField.mutate(f.id); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") { e.preventDefault(); duplicateField.mutate(f.id); }
      else if ((e.shiftKey && e.key === "F10") || e.key === "ContextMenu") {
        e.preventDefault();
        const at = pointFor(document.querySelector(`[data-field-box="${f.id}"]`));
        openFieldMenu(f, at.x, at.y);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const patchPage = useMutation({
    mutationFn: ({ id, ...body }: any) => api.patch(`/api/notebooks/${notebookId}/pages/${id}`, body),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });
  const bulkPages = useMutation({
    mutationFn: (body: { pageIds: string[]; action: string; groupName?: string }) =>
      api.post(`/api/notebooks/${notebookId}/pages/bulk`, body),
    onSuccess: () => { invalidate(); setSelection(new Set()); },
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * Reordering, applied to the list before the server hears about it.
   *
   * A drop is a direct manipulation: the page has to be where it was dropped
   * the instant it lands, or the list reads as broken however fast the request
   * is. The entries already carry the whole new order, so the cache can be
   * rewritten from them and the refetch afterwards only confirms it. On a
   * failure the previous order is put back and the error is shown, rather than
   * leaving a lie on screen.
   */
  /**
   * Duplicate one or more pages.
   *
   * Sequential rather than parallel on purpose: each copy is slotted in behind
   * its original, and two copies racing for the same gap in `seq` would land in
   * an order nobody asked for.
   */
  const duplicatePages = useMutation({
    mutationFn: async (pageIds: string[]) => {
      for (const pageId of pageIds) {
        await api.post(`/api/notebooks/${notebookId}/pages/${pageId}/duplicate`);
      }
      return pageIds.length;
    },
    onSuccess: (count) => {
      invalidate();
      setSelection(new Set());
      toast.success(count === 1 ? "Page duplicated" : `${count} pages duplicated`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const arrangePages = useMutation({
    mutationFn: (entries: ArrangeEntry[]) =>
      api.post(`/api/notebooks/${notebookId}/pages/arrange`, { pages: entries }),
    onMutate: async (entries: ArrangeEntry[]) => {
      await qc.cancelQueries({ queryKey: ["notebook", notebookId] });
      const previous = qc.getQueryData<NotebookResponse>(["notebook", notebookId]);
      qc.setQueryData<NotebookResponse>(["notebook", notebookId], (old) => {
        if (!old) return old;
        const byId = new Map(old.pages.map((p) => [p.id, p]));
        const moved = entries
          .map((e, i) => {
            const page = byId.get(e.id);
            return page && { ...page, seq: i + 1, group_name: e.groupName ?? page.group_name };
          })
          .filter(Boolean) as typeof old.pages;
        // Archived pages aren't in the drag list and mustn't be dropped from
        // the cache by reordering the ones that are.
        const untouched = old.pages.filter((p) => !entries.some((e) => e.id === p.id));
        return { ...old, pages: [...moved, ...untouched] };
      });
      return { previous };
    },
    onError: (e: Error, _entries, context) => {
      if (context?.previous) qc.setQueryData(["notebook", notebookId], context.previous);
      toast.error(e.message);
    },
    onSettled: () => invalidate(),
  });

  const deletePages = useMutation({
    mutationFn: (pageIds: string[]) =>
      pageIds.length === 1
        ? api.del(`/api/notebooks/${notebookId}/pages/${pageIds[0]}`)
        : api.post(`/api/notebooks/${notebookId}/pages/bulk`, { pageIds, action: "delete" }),
    onSuccess: () => {
      invalidate();
      setSelection(new Set());
      setPageIdx(0);
      toast.success("Page deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const patchNotebook = useMutation({
    mutationFn: (body: { title?: string; accentColor?: string; clearCover?: boolean; archived?: boolean }) =>
      api.patch(`/api/notebooks/${notebookId}`, body),
    onSuccess: () => {
      invalidate();
      setCoverBump((n) => n + 1);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const uploadCover = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api.upload(`/api/notebooks/${notebookId}/cover`, form);
    },
    onSuccess: () => {
      invalidate();
      setCoverBump((n) => n + 1);
      toast.success("Cover updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const publish = useMutation({
    mutationFn: () =>
      api.post<{ provisioned: number; summary: any; annotationsPublished: number }>(
        `/api/notebooks/${notebookId}/publish`,
      ),
    onSuccess: (res) => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["annotations", notebookId] });
      const s = res.summary;
      const annotated = res.annotationsPublished > 0
        ? ` …and ${res.annotationsPublished} annotated page${res.annotationsPublished === 1 ? "" : "s"}.`
        : "";
      toast.success(
        (s
          ? `Students updated — ${s.pagesAdded} page(s) added, ${s.fieldsChanged} field(s) changed. Existing work untouched.`
          : `Published to ${res.provisioned} student${res.provisioned === 1 ? "" : "s"}.`) + annotated,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Deleting destroys student work, so spell out the consequence first. */
  const confirmDelete = (pageIds: string[]) => {
    const assigned = pageIds.filter((id) => (assignmentCounts[id] ?? 0) > 0).length;
    const lines = [
      pageIds.length === 1
        ? "Delete this page permanently?"
        : `Delete ${pageIds.length} pages permanently?`,
      "",
      "Every student's writing on it will be deleted too. This can't be undone.",
    ];
    if (assigned > 0) {
      lines.push("", `${assigned} of them ${assigned === 1 ? "is" : "are"} part of an assignment and will be removed from it.`);
    }
    lines.push("", "To hide a page from students but keep their work, use Archive instead.");
    if (window.confirm(lines.join("\n"))) deletePages.mutate(pageIds);
  };

  const addPages = async (file: File) => {
    try {
      let pdf: Blob = file;
      if (needsConversion(file)) {
        setBusyMessage("Converting…");
        pdf = await convertToPdf(file, setBusyMessage);
      }
      setBusyMessage("Uploading…");
      const form = new FormData();
      form.append("file", new File([pdf], "append.pdf", { type: "application/pdf" }));
      const { assetKey } = await api.upload<{ assetKey: string }>(`/api/notebooks/${notebookId}/assets`, form);
      setBusyMessage("Reading pages…");
      const sizes = await readPageSizes(pdf);
      await api.post(`/api/notebooks/${notebookId}/pages`, {
        assetKey, pages: sizes, insertAfterPageId: addAt === "after" && page ? page.id : null,
      });
      toast.success(`Added ${sizes.length} page${sizes.length === 1 ? "" : "s"}`);
      invalidate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyMessage("");
    }
  };

  /**
   * Add pages from a file already in the teacher's Drive.
   *
   * Ends in the same `addPages` as a file off the disk — the picker hands back
   * a PDF, and from there there is nothing different about it. Worth having
   * because the document a worksheet lives in is usually in Drive and not on
   * the machine the teacher is holding.
   */
  const addPagesFromDrive = async () => {
    try {
      setBusyMessage("Opening Drive…");
      const picked = await pickDriveFile();
      if (!picked) return;
      setBusyMessage("Fetching…");
      const blob = await driveFileAsPdf(picked);
      const base = picked.name.replace(/\.[^.]+$/, "");
      await addPages(new File([blob], `${base}.pdf`, { type: "application/pdf" }));
    } catch (e) {
      const m = (e as Error).message;
      // Same likeliest cause as everywhere else the picker is opened: the
      // school's Google project doesn't have the Picker API turned on.
      toast.error(
        /picker|api key|developer key|403/i.test(m)
          ? "Couldn't open Google Drive. Notesanity's Google project needs the Picker API enabled (and an API key set)."
          : m,
      );
    } finally {
      setBusyMessage("");
    }
  };

  const createAssignmentFromSelection = () => {
    const ids = allPages.filter((p) => selection.has(p.id) && !p.archived).map((p) => p.id);
    if (ids.length === 0) {
      toast.error("Those pages are archived — restore them first.");
      return;
    }
    navigate(`/classes/${query.data!.notebook.classId}/assignments/new`, {
      state: { notebookId, pageIds: ids },
    });
  };

  const [renameOpen, setRenameOpen] = useState(false);
  /** Which confirmation is on screen, if any. */
  const [confirming, setConfirming] = useState<null | "archive" | "unarchive" | "delete" | "discard">(null);
  const [clearingPage, setClearingPage] = useState(false);

  const setArchived = useMutation({
    mutationFn: (archived: boolean) => api.patch(`/api/notebooks/${notebookId}`, { archived }),
    onSuccess: (_r, archived) => {
      invalidate();
      toast.success(archived ? "Archived — students no longer see it" : "Back with the class");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteNotebook = useMutation({
    mutationFn: () => api.del(isTemplate ? `/api/templates/${notebookId}` : `/api/notebooks/${notebookId}`),
    onSuccess: () => {
      toast.success("Notebook deleted");
      navigate(query.data ? `/classes/${query.data.notebook.classId}` : "/classes");
    },
    // The refusal names archiving as the thing they probably wanted, so it
    // gets long enough on screen to be read rather than glimpsed.
    onError: (e: Error) => toast.error(e.message, { duration: 8000 }),
  });

  /**
   * Throw away the teacher's own unsent ink, back to what's already published.
   *
   * The only thing this can discard is annotations — pages and fields reach
   * students the moment they're made, so there's nothing else pending. Clears
   * the local undo history too: after a discard there is nothing left for
   * "undo" to mean on any page.
   */
  const discardDrafts = useMutation({
    mutationFn: () => api.post(`/api/notebooks/${notebookId}/discard-drafts`),
    onSuccess: () => {
      annotationHistory.current = {};
      loadedAnnotationPage.current = null;
      invalidate();
      qc.invalidateQueries({ queryKey: ["annotations", notebookId] });
      toast.success("Unsent writing discarded");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const groupSelection = () => {
    const name = window.prompt("Group name (leave blank to ungroup)")?.trim();
    if (name === undefined) return;
    bulkPages.mutate({
      pageIds: Array.from(selection),
      action: name ? "group" : "ungroup",
      groupName: name,
    });
  };

  if (query.isLoading) return <Spinner label="Loading notebook…" />;
  if (query.error) return <Shell><ErrorNote error={query.error as Error} /></Shell>;
  if (!query.data) return null;

  /*
   * Authoring rights come from the class, not from the account.
   *
   * Being a teacher is not the same as teaching *this* class: an account
   * enrolled here as a student — a teacher keeping a test student, say — holds
   * student rights over these notebooks however their own role reads. The
   * server has always said so in `isTeacher` and this screen used to ignore it,
   * so it offered page actions, the field palette and Publish to someone every
   * one of those calls would refuse. Send them to the working view, which is
   * the thing they can actually use.
   */
  if (!query.data.isTeacher) return <Navigate to={`/notebooks/${notebookId}`} replace />;

  const { notebook } = query.data;
  /**
   * Nothing left to send: it's published, and no page has ink the students
   * haven't got. Adding a page or a field doesn't count — those are live the
   * moment they're made, so calling the notebook out of date for them would be
   * asking the teacher to press a button that changes nothing.
   */
  const upToDate = notebook.status === "published" && !hasUnpublishedAnnotations;
  const archivedCount = allPages.filter((p) => p.archived).length;
  const assignments = assignmentsQuery.data?.assignments ?? [];

  /** Shared Pages/Assignments panel content — rendered both in the desktop
   * aside and the mobile drawer, so the two never drift out of sync. */
  const sidePanelBody = (isMobile: boolean) => (
    <>
      <div className="flex border-b-2 border-pine/12">
        {!isMobile && (
          <button
            type="button"
            onClick={() => setRailOpen(false)}
            title="Hide the page list"
            aria-label="Hide the page list"
            className="flex h-12 w-10 shrink-0 items-center justify-center text-pine/60 hover:bg-oat hover:text-pine"
          >
            <PanelLeftClose className="h-4 w-4" strokeWidth={2.5} />
          </button>
        )}
        {(isTemplate ? (["pages"] as const) : (["pages", "assignments"] as const)).map((tab) => (
          <button
            key={tab}
            type="button"
            aria-pressed={sidePanel === tab}
            onClick={() => setSidePanel(tab)}
            className={cn(
              "flex h-12 flex-1 items-center justify-center gap-1.5 px-3 font-display text-[17px] font-bold capitalize transition-colors",
              sidePanel === tab ? "border-b-[3px] -mb-[3px] border-pine text-pine" : "text-pine/50 hover:bg-oat",
            )}
          >
            {tab}
            {tab === "assignments" && assignments.length > 0 && (
              <span className="ml-1 rounded-full border-2 border-pine/20 bg-oat px-1.5 py-0.5 text-[16px] text-pine/70">
                {assignments.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {sidePanel === "pages" ? (
        <NotebookPageList
          notebookId={notebookId}
          pages={allPages}
          assignmentCounts={assignmentCounts}
          currentPageId={page?.id}
          selection={selection}
          onSelectionChange={setSelection}
          onOpenPage={(id) => {
            const i = livePages.findIndex((lp) => lp.id === id);
            if (i >= 0) setPageIdx(i);
            if (isMobile) setPagesDrawerOpen(false);
          }}
          onRename={(id, label) => patchPage.mutate({ id, label })}
          onArchiveToggle={(id, archived) => patchPage.mutate({ id, archived })}
          onDelete={(id) => confirmDelete([id])}
          onDuplicate={(id) => duplicatePages.mutate([id])}
          onSaveToLibrary={(id) => saveToLibrary.mutate([id])}
          annotations={railAnnotations}
          onArrange={(entries) => arrangePages.mutate(entries)}
          onRenameGroup={(from, to) => {
            const ids = allPages.filter((p) => (p.group_name ?? "") === from).map((p) => p.id);
            if (ids.length) bulkPages.mutate({ pageIds: ids, action: "group", groupName: to });
          }}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <button
            type="button"
            onClick={() => {
              if (isMobile) setPagesDrawerOpen(false);
              // Starts on the page in view; the form's page grid adds the rest.
              navigate(`/classes/${query.data!.notebook.classId}/assignments/new`, {
                state: { notebookId, pageIds: page && !page.archived ? [page.id] : [] },
              });
            }}
            className="mb-2 flex h-11 w-full items-center justify-center gap-2 rounded-full border-[3px] border-pine bg-mint font-display text-[16px] font-bold text-pine shadow-[4px_4px_0_0_var(--color-pine)] hover:bg-mint/80 active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_var(--color-pine)]"
          >
            <ClipboardList className="h-4 w-4" strokeWidth={2.5} /> New assignment
          </button>
          {assignments.length === 0 ? (
            <p className="px-2 py-4 text-center text-[16px] text-pine/60">
              No assignments use this notebook yet. You can also select pages in the page list and choose “Create assignment”.
            </p>
          ) : (
            assignments.map((a) => (
              <Link
                key={a.id}
                to={`/assignments/${a.id}`}
                onClick={() => { if (isMobile) setPagesDrawerOpen(false); }}
                className="mb-1.5 block rounded-[12px] border-2 border-pine/20 p-2 hover:border-pine hover:bg-oat"
              >
                <div className="flex items-start gap-1.5">
                  <ClipboardList className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pine/50" strokeWidth={2.5} />
                  <div className="min-w-0">
                    <div className="truncate text-[16px] font-bold text-pine">{a.title}</div>
                    <div className="mt-0.5 text-[16px] text-pine/70">
                      {a.pageCount} page{a.pageCount === 1 ? "" : "s"} · {formatDue(a.dueAt)}
                    </div>
                    <div className="mt-1 flex items-center gap-1">
                      <Chip tone={a.status === "active" ? "mint" : "quiet"} className="px-1.5 py-0.5 text-[16px]">
                        {a.status === "active" ? "Active" : "Draft"}
                      </Chip>
                      <span className="text-[16px] text-pine/70">{a.submitted}/{a.total} in</span>
                    </div>
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      )}
    </>
  );

  // ---- Add page / Add element ----
  const isStudentBook = notebook.kind === "student" || notebook.kind === "personal";

  const openAddPage = (btn: HTMLElement) => {
    setAddMenu("page");
    const busy = !!busyMessage;
    const entries: ContextEntry[] = [
      { kind: "heading", text: "Put new pages" },
      { kind: "radio", group: "at", label: "After this page", checked: addAt === "after", onSelect: () => setAddAt("after") },
      { kind: "radio", group: "at", label: "At the end", checked: addAt === "end", onSelect: () => setAddAt("end") },
      { kind: "separator" },
      { label: "Blank paper…", icon: <Rows3 />, hint: "Lined, graph, dot grid, music staves…", disabled: busy, onSelect: () => setBlankOpen(true) },
      { label: "From a file…", icon: <Upload />, hint: "PDF, Word or PowerPoint", disabled: busy, onSelect: () => addPagesRef.current?.click() },
    ];
    if (hasDrivePicker) entries.push({ label: "From Google Drive…", icon: <FolderOpen />, disabled: busy, onSelect: () => void addPagesFromDrive() });
    entries.push(
      { label: "From your library…", icon: <LibraryBig />, hint: "A page you saved", disabled: busy, onSelect: () => setLibraryOpen(true) },
      { label: "Copy of this page", icon: <CopyPlus />, hint: "With its boxes, not students' work", disabled: busy || !page, onSelect: () => { if (page) duplicatePages.mutate([page.id]); } },
    );
    openContextMenu({ ...pointFor(btn), title: "Add page", onClose: () => setAddMenu(null), entries });
  };

  const openAddElement = (btn: HTMLElement) => {
    setAddMenu("element");
    const place = (k: Exclude<FieldTool, "none">) => () => armField(k);
    const paper = !page || isPattern(page.pattern);
    const entries: ContextEntry[] = [
      { kind: "heading", text: isStudentBook ? "Add to the page" : "Yours" },
      { label: "Text", icon: <PenLine />, hint: "A heading, instructions, a passage", onSelect: place("richtext") },
      { label: "Picture", icon: <ImageIcon />, hint: "An image of your own", onSelect: place("figure") },
      { label: "Link", icon: <LinkIcon />, hint: "Words or a picture that opens a website", onSelect: place("link") },
    ];
    if (!isStudentBook) {
      entries.push(
        { kind: "heading", text: "Students fill in" },
        { label: "Text box", icon: <TypeIcon />, hint: "They type an answer", onSelect: place("text") },
        { label: "Checkbox", icon: <CheckSquare />, hint: "They tick it", onSelect: place("checkbox") },
        { label: "Dropdown", icon: <ListChecks />, hint: "They pick one of your choices", onSelect: place("choice") },
        { label: "Prompt", icon: <MessageSquareText />, hint: "A question with room to answer", onSelect: place("prompt") },
        { label: "Image upload", icon: <ImagePlus />, hint: "They add a photo", onSelect: place("image") },
        { label: "Audio", icon: <Mic />, hint: "They record themselves", onSelect: place("audio") },
        { kind: "separator" },
        {
          label: finding ? "Looking…" : "Find blanks on this page", icon: <Wand2 />,
          hint: paper ? "Works on an uploaded worksheet, not blank paper" : "A box for every line, empty cell and row of underscores",
          disabled: finding || paper, onSelect: () => void findFields(),
        },
      );
    }
    openContextMenu({ ...pointFor(btn), title: isStudentBook ? "Add" : "Add element", onClose: () => setAddMenu(null), entries });
  };

  /** A menu button: Enter, Space or ↓ opens it and puts focus on its first item. */
  const addButton = (which: "page" | "element", inToolbar: boolean) => {
    const open = which === "page" ? openAddPage : openAddElement;
    const full = which === "page" ? "Add page" : isStudentBook ? "Add" : "Add element";
    return (
      <button
        type="button"
        {...(inToolbar ? { "data-tb": "", "data-tour": which === "page" ? "nb-add-pages" : "nb-fields" } : {})}
        aria-label={full}
        aria-haspopup="menu"
        aria-expanded={addMenu === which}
        onClick={(e) => open(e.currentTarget)}
        onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); open(e.currentTarget); } }}
        className={cn(
          "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border-[3px] border-pine pl-2.5 pr-2 font-display text-[16px] font-bold text-pine outline-none",
          "shadow-[3px_3px_0_0_var(--color-pine)] transition-colors focus-visible:ring-[3px] focus-visible:ring-mint",
          addMenu === which ? "bg-mint" : "bg-white hover:bg-oat",
        )}
      >
        {which === "page"
          ? <FilePlus2 className="h-[18px] w-[18px]" strokeWidth={2.5} aria-hidden />
          : <SquarePlus className="h-[18px] w-[18px]" strokeWidth={2.5} aria-hidden />}
        {/* Short words where they fit, the full name on a laptop; the accessible
            name is always the full one. Between tablet and laptop widths the
            row can't spare the words, so the icon and ▾ carry it. */}
        <span className={inToolbar ? "hidden lg:inline xl:hidden" : "hidden min-[440px]:inline"}>{which === "page" ? "Page" : isStudentBook ? "Add" : "Element"}</span>
        {inToolbar && <span className="hidden xl:inline">{full}</span>}
        <ChevronDown className="h-4 w-4 opacity-70" strokeWidth={2.5} aria-hidden />
      </button>
    );
  };

  const presentButton = (
    <button
      type="button"
      onClick={() => setPresenting({ mode: "pages", idx: pageIdx })}
      disabled={livePages.length === 0}
      title="Full screen, just the pages — for a projector or a screen share"
      className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border-2 border-pine/25 px-3.5 font-display text-[16px] font-bold text-pine hover:bg-oat disabled:opacity-40"
    >
      <Presentation className="h-4 w-4" strokeWidth={2.5} />
      <span className="hidden md:inline">Present</span>
    </button>
  );
  const ribbonToggle = (
    <button
      type="button"
      onClick={() => setRibbonOpen(!ribbonOpen)}
      aria-pressed={!ribbonOpen}
      title={ribbonOpen ? "Hide the tools — the tabs stay, and bring them back" : "Show the tools"}
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-pine/25 text-pine hover:bg-oat"
    >
      {ribbonOpen ? <ChevronUp className="h-4 w-4" strokeWidth={2.5} /> : <ChevronDown className="h-4 w-4" strokeWidth={2.5} />}
      <span className="sr-only">{ribbonOpen ? "Hide tools" : "Show tools"}</span>
    </button>
  );
  const zoomSelect = <ZoomSelect zoom={zoom} onZoomChange={setZoom} className="hidden sm:block" />;

  return (
    <div className="flex h-dvh flex-col bg-oat">
      <div className="h-1 shrink-0" style={{ backgroundColor: notebook.accentColor || "#20302C" }} />
      {/* One row from md up: Back · title · "…" · Publish. On a phone, Publish
          and the Add menus get a second row, because the toolbar below has no
          room for the Add menus there. */}
      <header className="relative flex flex-wrap items-center gap-2 border-b-2 border-pine/12 bg-white px-3 py-2 sm:gap-3">
        <IconButton label="Back" onClick={goBack}>
          <ArrowLeft className="h-4 w-4" strokeWidth={2.5} />
        </IconButton>
        {/* Icon only: the word cost a third of the row on a phone. */}
        <IconButton
          label="Pages"
          variant="secondary"
          data-tour="nb-pages-button"
          onClick={() => setPagesDrawerOpen(true)}
          className="sm:hidden"
        >
          <PanelLeft className="h-4 w-4" strokeWidth={2.5} />
        </IconButton>
        <div className="min-w-0 flex-1 xl:flex-initial">
          <div className="truncate font-display text-[16px] font-bold text-pine">{notebook.title}</div>
          {/* The status belongs to the notebook, not to the row of things you
              can do to it — so it sits under the title with the page count,
              where you read what this notebook *is*. */}
          <div className="flex min-w-0 items-center gap-2 text-[16px] text-pine/70">
            <span className="truncate">
              {livePages.length} page{livePages.length === 1 ? "" : "s"}
              {archivedCount > 0 && ` · ${archivedCount} archived`}
              {assignments.length > 0 && ` · ${assignments.length} assignment${assignments.length === 1 ? "" : "s"}`}
            </span>
            <Chip
              tone={notebook.status === "published" ? "mint" : "quiet"}
              className="h-7 shrink-0 px-2.5"
              icon={notebook.status === "published" ? <Check className="h-3 w-3" strokeWidth={2.5} /> : undefined}
            >
              {notebook.status === "published" ? "Published" : "Draft"}
            </Chip>
          </div>
        </div>

        {/* On a phone a second row: the Add menus (the toolbar has no room for
            them there) and Publish. From md up, Publish joins the title row
            and the Add menus lead the toolbar. */}
        <div className="order-4 flex w-full items-center gap-2 md:ml-auto md:w-auto xl:order-7">
          <div className="flex items-center gap-2 md:hidden">{addButton("page", false)}{addButton("element", false)}</div>
          <span className="flex-1 md:hidden" />
          {/* The button is the status.
              A separate chip saying "your writing isn't sent yet" sat beside a
              button saying "Update student notebooks", which is two controls
              telling you the same thing and neither of them telling you when
              there is nothing to do. Now the button itself answers: it offers
              the update when there is one to send, and says everything is out
              there when there isn't. Pages and fields reach students the moment
              they're made — annotations are the only thing publishing holds
              back — so "Up to date" means exactly what it says. */}
          {isTemplate ? (
            <TemplateClassesMenu templateId={notebookId} title={notebook.title} className={cn(COMPACT, "xl:order-7")} />
          ) : (
          <Button
            variant={upToDate ? "secondary" : "primary"}
            data-tour="nb-publish"
            onClick={() => publish.mutate()}
            disabled={publish.isPending || upToDate}
            title={upToDate ? "Everything you've written is with your students" : undefined}
            className={cn(COMPACT, "xl:order-7")}
          >
            {upToDate
              ? <><Check className="h-5 w-5" strokeWidth={2.5} /> Up to date</>
              : <><Send className="h-5 w-5" strokeWidth={2.5} />
                  {/* The verb alone on a phone; who it goes to is obvious there. */}
                  <span className="sm:hidden">{notebook.status === "published" ? "Update" : "Publish"}</span>
                  <span className="hidden sm:inline">{notebook.status === "published" ? "Update student notebooks" : "Publish to students"}</span></>}
          </Button>
          )}
        </div>
        {/* A direct child of the header, not of the actions row: its `order`
            is what puts it in the title row on a phone, and order only works
            among siblings. */}
        {/* Everything you do *to* the notebook rather than *in* it, on every
            width. Appearance keeps its own button at xl where there's room;
            here it's listed too, so the menu is a complete answer to "what
            can I do with this notebook" rather than a leftovers drawer. */}
        <Menu
          tour="nb-more"
          label="Notebook actions"
          className="order-3 xl:order-6"
          items={[
            {
              label: "Preview as a student",
              icon: <Eye className="h-5 w-5" strokeWidth={2.5} />,
              hint: "See this notebook the way your class will, including writing you haven't sent yet.",
              onClick: openPreview,
            },
            {
              label: "Rename",
              icon: <Pencil className="h-5 w-5" strokeWidth={2.5} />,
              hint: "What it's called for you and your students.",
              onClick: () => setRenameOpen(true),
            },
            {
              label: "Appearance",
              icon: <Palette className="h-5 w-5" strokeWidth={2.5} />,
              hint: "Cover image and the color on its tile.",
              onClick: () => setAppearanceOpen(true),
            },
            {
              label: notebook.archived ? "Bring back to the class" : "Archive",
              icon: notebook.archived
                ? <RotateCcw className="h-5 w-5" strokeWidth={2.5} />
                : <Archive className="h-5 w-5" strokeWidth={2.5} />,
              hint: notebook.archived
                ? "Students see it again, with their work as they left it."
                : "Puts it away for the class. No work is lost, and you can bring it back.",
              onClick: () => setConfirming(notebook.archived ? "unarchive" : "archive"),
            },
            ...(notebook.status === "published" ? [{
              label: "Discard unsent writing",
              icon: <Undo2 className="h-5 w-5" strokeWidth={2.5} />,
              danger: true,
              disabled: !hasUnpublishedAnnotations,
              hint: hasUnpublishedAnnotations
                ? "Throws away your ink on this notebook since the last update. Nothing sent is touched."
                : "Nothing unsent right now — everything you've written is already with your students.",
              onClick: () => setConfirming("discard"),
            }] : []),
            {
              label: "Delete notebook",
              icon: <Trash2 className="h-5 w-5" strokeWidth={2.5} />,
              danger: true,
              disabled: notebook.status === "published",
              hint: notebook.status === "published"
                ? "Not while students have copies — archive it instead."
                : "Gone for good. Only possible before it's published.",
              onClick: () => setConfirming("delete"),
            },
          ]}
        />
        <input
          ref={addPagesRef}
          type="file"
          accept=".pdf,.docx,.doc,.pptx,.ppt,application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void addPages(f);
          }}
        />

        {appearanceOpen && (
          <AppearancePopover
            notebookId={notebookId}
            accentColor={notebook.accentColor || DEFAULT_ACCENT}
            hasCover={notebook.hasCover}
            coverBump={coverBump}
            coverInputRef={coverInputRef}
            onSetAccent={(color) => patchNotebook.mutate({ accentColor: color })}
            onClearCover={() => patchNotebook.mutate({ clearCover: true })}
            onUploadCover={(file) => uploadCover.mutate(file)}
            uploading={uploadCover.isPending}
            onClose={() => setAppearanceOpen(false)}
          />
        )}
      </header>

      {clearingPage && page && (
        <ConfirmModal
          title="Clear this page?"
          confirmLabel="Clear it"
          tone="danger"
          onClose={() => setClearingPage(false)}
          onConfirm={() => {
            handleAnnotationChange(emptyLayer());
            setClearingPage(false);
            toast.success("Page cleared");
          }}
          body={
            <>
              This removes everything you've written on{" "}
              <span className="font-bold">{page.label || `page ${pageIdx + 1}`}</span> — ink,
              highlighter, typed notes and stamps.
              <div className="mt-2">
                The answer boxes on the page stay, and so does anything students have already
                written in their own copies.
              </div>
            </>
          }
        />
      )}

      {confirming === "archive" && (
        <ConfirmModal
          title="Archive this notebook?"
          confirmLabel="Archive it"
          busy={setArchived.isPending}
          onClose={() => setConfirming(null)}
          onConfirm={() => setArchived.mutate(true, { onSettled: () => setConfirming(null) })}
          body={
            <>
              <span className="font-bold">{notebook.title}</span> leaves the class. Your students
              stop seeing it and can't open it, and it stays here for you — with every page and
              everything written on it kept exactly as it is.
              <div className="mt-2">You can bring it back whenever you like.</div>
            </>
          }
        />
      )}

      {confirming === "unarchive" && (
        <ConfirmModal
          title="Bring this back to the class?"
          confirmLabel="Bring it back"
          busy={setArchived.isPending}
          onClose={() => setConfirming(null)}
          onConfirm={() => setArchived.mutate(false, { onSettled: () => setConfirming(null) })}
          body={
            <>
              <span className="font-bold">{notebook.title}</span> goes back on the class's list.
              Everyone who had a copy gets it back with their work as they left it.
            </>
          }
        />
      )}

      {confirming === "delete" && (
        <ConfirmModal
          title="Delete this notebook?"
          confirmLabel="Delete for good"
          tone="danger"
          busy={deleteNotebook.isPending}
          onClose={() => setConfirming(null)}
          onConfirm={() => deleteNotebook.mutate()}
          body={
            <>
              This deletes <span className="font-bold">{notebook.title}</span> and all
              {" "}{livePages.length} page{livePages.length === 1 ? "" : "s"} in it. It cannot be
              undone.
              <div className="mt-2">
                It hasn't been published, so no student has a copy to lose — but if you only want
                it off the list, <span className="font-bold">archive it instead</span>.
              </div>
            </>
          }
        />
      )}

      {confirming === "discard" && (
        <ConfirmModal
          title="Discard your unsent writing?"
          confirmLabel="Discard it"
          tone="danger"
          busy={discardDrafts.isPending}
          onClose={() => setConfirming(null)}
          onConfirm={() => discardDrafts.mutate(undefined, { onSettled: () => setConfirming(null) })}
          body={
            <>
              This throws away everything you've written on <span className="font-bold">{notebook.title}</span>'s
              pages since the last update — every page goes back to exactly what students already have.
              <div className="mt-2">
                Nothing already with students is touched, and pages, fields and answer boxes aren't
                affected — this only ever holds your own ink.
              </div>
            </>
          }
        />
      )}

      {renameOpen && (
        <RenameNotebookModal
          title={notebook.title}
          busy={patchNotebook.isPending}
          onClose={() => setRenameOpen(false)}
          onSave={(title) => {
            patchNotebook.mutate({ title }, { onSuccess: () => setRenameOpen(false) });
          }}
        />
      )}

      {blankOpen && (
        <BlankPagesModal
          pages={allPages}
          initialAfter={addAt === "after" && page ? page.id : ""}
          busy={addBlankPages.isPending}
          onClose={() => setBlankOpen(false)}
          onInsert={(body) => addBlankPages.mutate(body)}
        />
      )}

      {libraryOpen && (
        <PageLibraryModal
          pages={allPages}
          currentPageId={addAt === "after" ? page?.id : null}
          busy={insertLibraryPage.isPending}
          onClose={() => setLibraryOpen(false)}
          onInsert={(body) => insertLibraryPage.mutate(body)}
        />
      )}

      {/* One row for everything: Add page and Add element, then the writing
          tools, Undo, and View. The tool in hand is the mode — see annotateMode. */}
      {ribbonOpen && (
        <InkToolbar
          tool={inkTool}
          onToolChange={changeInkTool}
          fingerDraw={inkFingerDraw}
          onFingerDrawChange={setInkFingerDraw}
          onUndo={undoAnnotation}
          onRedo={redoAnnotation}
          canUndo={canUndoAnnotation}
          canRedo={canRedoAnnotation}
          status={saveStatus}
          teacherPalette={!isStudentBook}
          allowComments={!isStudentBook}
          zoom={zoom}
          onZoomChange={setZoom}
          onClearPage={clearAnnotationPage}
          leading={<>{addButton("page", true)}{addButton("element", true)}</>}
          viewItems={[
            { label: "Preview as a student", icon: <Eye />, onSelect: openPreview },
            { label: "Present", icon: <Presentation />, disabled: livePages.length === 0, onSelect: () => setPresenting({ mode: "pages", idx: pageIdx }) },
            { label: "Hide toolbar", icon: <ChevronUp />, onSelect: () => setRibbonOpen(false) },
          ]}
        />
      )}

      {/* What placing a box takes, while one is about to be placed. Tapping is
          enough — dragging only sizes it (WCAG 2.5.7) — and Escape cancels. */}
      {tool !== "none" && (
        <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b-2 border-pine/12 bg-mint/20 px-3 py-1.5 text-[16px] text-pine">
          <span>
            <b className="font-display">{fieldTypeLabel(tool)}.</b>{" "}
            {tool === "link"
              ? "Drag over the words or picture that should open the link."
              : "Tap the page to place it, or drag to give it a size."}
          </span>
          {tool === "link" && !!fileLinks?.length && (
            <button
              type="button"
              disabled={addFileLinks.isPending}
              onClick={() => addFileLinks.mutate(fileLinks)}
              title="This page's original file has links that aren't on the page yet — put them back where they were"
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border-2 border-pine bg-white px-3 font-display font-bold hover:bg-oat disabled:opacity-50"
            >
              <Wand2 className="h-4 w-4" strokeWidth={2.5} />
              {addFileLinks.isPending ? "Adding…" : `Add ${fileLinks.length} link${fileLinks.length === 1 ? "" : "s"} from the file`}
            </button>
          )}
          <button
            type="button"
            onClick={() => setTool("none")}
            className="ml-auto inline-flex min-h-[44px] items-center rounded-full px-3 font-display font-bold hover:bg-white/70"
          >
            Cancel <span className="ml-1.5 hidden text-pine/55 sm:inline">Esc</span>
          </button>
        </div>
      )}
      {/* Tucked away: a slim strip that keeps the three controls reachable. */}
      {!ribbonOpen && (
        <div className="flex items-center border-b-2 border-pine/12 bg-white px-3 py-1">
          <span className="text-[16px] text-pine/50">Tools hidden</span>
          <div className="ml-auto flex items-center gap-2">{presentButton}{zoomSelect}{ribbonToggle}</div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {railOpen ? (
          <aside data-tour="nb-rail" className="hidden w-64 shrink-0 flex-col border-r-2 border-pine/12 bg-white sm:flex">
            {sidePanelBody(false)}
          </aside>
        ) : (
          <aside data-tour="nb-rail" className="hidden w-11 shrink-0 flex-col items-center border-r-2 border-pine/12 bg-white pt-1 sm:flex">
            <button
              type="button"
              onClick={() => setRailOpen(true)}
              title="Show the page list"
              aria-label="Show the page list"
              className="flex h-10 w-10 items-center justify-center rounded-full text-pine/70 hover:bg-oat hover:text-pine"
            >
              <PanelLeftOpen className="h-4 w-4" strokeWidth={2.5} />
            </button>
          </aside>
        )}

        {pagesDrawerOpen && (
          <div className="fixed inset-0 z-40 flex sm:hidden">
            <div className="absolute inset-0 bg-pine/40" onClick={() => setPagesDrawerOpen(false)} aria-hidden />
            <div className="relative flex h-full w-[85vw] max-w-xs flex-col border-r-2 border-pine/12 bg-white shadow-xl">
              <div className="flex items-center justify-between border-b-2 border-pine/12 px-3 py-2">
                <span className="label-caps text-pine/70">Notebook</span>
                <button
                  type="button"
                  onClick={() => setPagesDrawerOpen(false)}
                  className="rounded-full p-1.5 text-pine hover:bg-pine/8"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" strokeWidth={2.5} />
                </button>
              </div>
              {sidePanelBody(true)}
            </div>
          </div>
        )}

        <div ref={containerRef} className="relative min-w-0 flex-1 overflow-auto bg-oat p-2 sm:p-4">
          {!page ? (
            <div className="py-20 text-center text-[16px] text-pine/70">
              Every page is archived. Restore one from the list to keep editing.
            </div>
          ) : (
            <div className="mx-auto" style={{ width: page.width * scale }}>
              <div className="mb-2 flex items-center justify-between">
                <button
                  onClick={() => setPageIdx((i) => Math.max(0, i - 1))}
                  disabled={pageIdx === 0}
                  className="rounded-full p-1.5 text-pine hover:bg-white disabled:opacity-30"
                >
                  <ChevronLeft className="h-4 w-4" strokeWidth={2.5} />
                </button>
                <span className="text-[16px] text-pine/70">
                  {page.label || `Page ${pageIdx + 1}`} · {pageIdx + 1} of {livePages.length}
                </span>
                <button
                  onClick={() => setPageIdx((i) => Math.min(livePages.length - 1, i + 1))}
                  disabled={pageIdx >= livePages.length - 1}
                  className="rounded-full p-1.5 text-pine hover:bg-white disabled:opacity-30"
                >
                  <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
                </button>
              </div>

              <div className="relative">
                {annotateMode ? (
                  <PageCanvas
                    key={page.id}
                    {...pageSource(notebookId, page)}
                    notebookId={notebookId}
                    scale={scale}
                    fields={[]}
                    fieldValues={{}}
                    studentLayer={emptyLayer()}
                    teacherLayer={annotationLayer}
                    onLayerChange={handleAnnotationChange}
                    writeTarget="teacher"
                    tool={inkTool}
                    fingerDraw={inkFingerDraw}
                    fieldsEditable={false}
                    initialSelection={pendingMark}
                    onPressPaper={() => { if (inkTool.kind === "select") { setEditingMarks(false); setPendingMark(null); } }}
                  />
                ) : (
                  <>
                    <PageCanvas
                      {...pageSource(notebookId, page)}
                      notebookId={notebookId}
                      scale={scale}
                      fields={[]}
                      fieldValues={{}}
                      studentLayer={emptyLayer()}
                      teacherLayer={annotationLayer}
                      writeTarget={null}
                      tool={{ kind: "select", color: "#000", width: 2, stamp: "", fontSize: 14 }}
                      fingerDraw={false}
                      fieldsEditable={false}
                    />
                    <FieldLayer
                      key={page.id}
                      pageWidth={page.width}
                      pageHeight={page.height}
                      scale={scale}
                      fields={fields}
                      tool={tool}
                      selected={selectedField}
                      onSelect={setSelectedField}
                      onCreate={(rect) => {
                        const defaultSize = tool === "none" ? DEFAULT_FIELD_SIZE.text : DEFAULT_FIELD_SIZE[tool];
                        const size = rect.w < MIN_FIELD || rect.h < MIN_FIELD
                          ? { w: defaultSize.w, h: defaultSize.h }
                          : { w: rect.w, h: rect.h };
                        createField.mutate({
                          pageId: page.id,
                          type: tool === "none" ? "text" : tool,
                          x: rect.x,
                          y: rect.y,
                          ...size,
                          label: "",
                          prompt: "",
                          options: tool === "choice" ? ["Option A", "Option B"] : [],
                        });
                        setTool("none");
                      }}
                      onCommit={(id, rect) => updateField.mutate({ id, ...rect })}
                      onMenu={openFieldMenu}
                      onEmptyPress={({ x, y }) => {
                        const ref = markRefAt(annotationLayer, x, y, 6 / scale);
                        if (!ref) return false;
                        setSelectedField(null);
                        setInkTool((t) => ({ ...t, kind: "select" }));
                        setPendingMark(ref);
                        setEditingMarks(true);
                        return true;
                      }}
                    />
                    {/* What "Find fields" turned up, in the same dashed draft
                        look a teacher gets dragging a field out by hand.
                        Nothing here exists yet — tapping one drops it. */}
                    {candidates && (
                      <div className="absolute inset-0">
                        {candidates.map((c) => {
                          const off = dropped.has(c.id);
                          return (
                            <button
                              key={c.id}
                              type="button"
                              aria-pressed={!off}
                              title={off ? "Skipped — tap to put it back" : "Tap to skip this one"}
                              onClick={() => setDropped((d) => {
                                const next = new Set(d);
                                if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                                return next;
                              })}
                              className={cn(
                                "absolute rounded border-2 border-dashed transition-colors",
                                off ? "border-pine/25" : "border-pine bg-mint/20",
                              )}
                              style={{ left: c.x * scale, top: c.y * scale, width: c.w * scale, height: c.h * scale }}
                            />
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {candidates && candidates.length > 0 && (() => {
            const kept = candidates.filter((c) => !dropped.has(c.id));
            return (
              <div className="sticky bottom-4 z-20 mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-2 rounded-full border-[3px] border-pine bg-white px-3 py-2 shadow-[4px_4px_0_0_var(--color-pine)]">
                <span className="px-1 font-display text-[16px] font-bold text-pine">
                  {kept.length
                    ? `Found ${kept.length} place${kept.length === 1 ? "" : "s"} to fill in`
                    : "None selected"}
                </span>
                <Button variant="secondary" onClick={() => setCandidates(null)}>Cancel</Button>
                <Button
                  variant="primary"
                  disabled={!kept.length || addFound.isPending}
                  onClick={() => addFound.mutate(kept)}
                >
                  {addFound.isPending ? "Adding…" : "Add them"}
                </Button>
              </div>
            );
          })()}

          {/* Floating action bar for the current page multi-selection. */}
          {selection.size > 0 && (
            <div className="sticky bottom-4 z-20 mx-auto flex w-fit max-w-full flex-wrap items-center gap-2 rounded-full border-[3px] border-pine bg-white px-3 py-2 shadow-[4px_4px_0_0_var(--color-pine)]">
              <span className="whitespace-nowrap text-[16px] font-bold text-pine">
                {selection.size} page{selection.size === 1 ? "" : "s"} selected
              </span>
              <button
                onClick={createAssignmentFromSelection}
                className="inline-flex h-11 items-center gap-2 rounded-full border-2 border-pine bg-white px-4 font-display text-[16px] font-bold text-pine hover:bg-oat"
              >
                <ClipboardList className="h-3.5 w-3.5" strokeWidth={2.5} /> Create assignment
              </button>
              <button
                onClick={groupSelection}
                className="inline-flex items-center gap-1.5 rounded-full border-2 border-pine/20 px-3 py-1.5 text-[16px] font-bold text-pine hover:bg-oat"
              >
                <FolderPlus className="h-3.5 w-3.5" strokeWidth={2.5} /> Group
              </button>
              <button
                onClick={() => duplicatePages.mutate(Array.from(selection))}
                disabled={duplicatePages.isPending}
                title="Copy each page, with its boxes, in behind the original"
                className="inline-flex items-center gap-1.5 rounded-full border-2 border-pine/20 px-3 py-1.5 text-[16px] font-bold text-pine hover:bg-oat disabled:opacity-50"
              >
                <CopyPlus className="h-3.5 w-3.5" strokeWidth={2.5} /> Duplicate
              </button>
              <button
                onClick={() => saveToLibrary.mutate(Array.from(selection))}
                disabled={saveToLibrary.isPending}
                title="Keep a copy in your page library, to reuse in any notebook"
                className="inline-flex items-center gap-1.5 rounded-full border-2 border-pine/20 px-3 py-1.5 text-[16px] font-bold text-pine hover:bg-oat disabled:opacity-50"
              >
                <LibraryBig className="h-3.5 w-3.5" strokeWidth={2.5} />
                {saveToLibrary.isPending ? "Saving…" : "Save to library"}
              </button>
              <button
                onClick={() => bulkPages.mutate({ pageIds: Array.from(selection), action: "archive" })}
                title="Hide from students but keep their work"
                className="inline-flex items-center gap-1.5 rounded-full border-2 border-pine/20 px-3 py-1.5 text-[16px] font-bold text-pine hover:bg-oat"
              >
                <EyeOff className="h-3.5 w-3.5" strokeWidth={2.5} /> Archive
              </button>
              <button
                onClick={() => confirmDelete(Array.from(selection))}
                title="Delete permanently, including student work"
                className="inline-flex items-center gap-1.5 rounded-full border-2 border-[#a3341f] px-3 py-1.5 text-[16px] font-bold text-[#a3341f] hover:bg-[#a3341f]/8"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={2.5} /> Delete
              </button>
              <button
                onClick={() => bulkPages.mutate({ pageIds: Array.from(selection), action: "restore" })}
                className="inline-flex items-center gap-1.5 rounded-full border-2 border-pine/20 px-3 py-1.5 text-[16px] font-bold text-pine hover:bg-oat"
              >
                <RotateCcw className="h-3.5 w-3.5" strokeWidth={2.5} /> Restore
              </button>
              <button
                onClick={() => setSelection(new Set())}
                className="rounded-full p-1.5 text-pine/50 hover:bg-pine/8"
                aria-label="Clear selection"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2.5} />
              </button>
            </div>
          )}
        </div>

        {selectedField && (
          <FieldInspector
            field={(query.data.fields ?? []).find((f) => f.id === selectedField)}
            notebookId={notebookId}
            onClose={() => setSelectedField(null)}
            onSave={(patch, fieldId) => updateField.mutate({ id: fieldId ?? selectedField, ...patch })}
            saving={updateField.isPending}
            onDelete={() => deleteField.mutate(selectedField)}
            onInvalidate={invalidate}
          />
        )}
      </div>

      {previewing && (
        <div className="fixed inset-0 z-50 flex flex-col bg-oat">
          {/* The same amber as the impersonation banner: this is the app
              telling you it is not behaving normally. */}
          <div className="flex flex-wrap items-center gap-3 border-b-2 border-[#8a6a1f] bg-[#fdf1cf] px-4 py-2 text-[16px] text-[#5c4713]">
            <Eye className="h-4 w-4 shrink-0" />
            <span>
              Previewing as a student — including writing you haven't sent yet.
              Nothing you do here is saved.
            </span>
            <Button variant="secondary" className="ml-auto shrink-0" onClick={() => setPreviewing(false)}>
              Exit preview
            </Button>
          </div>
          <div className="overflow-x-auto">
            <InkToolbar
              tool={previewTool}
              onToolChange={setPreviewTool}
              fingerDraw={previewFinger}
              onFingerDrawChange={setPreviewFinger}
              zoom={previewZoom}
              onZoomChange={setPreviewZoom}
            />
          </div>
          <div className="min-h-0 flex-1">
            <NotebookSurface
              notebookId={notebookId}
              pages={livePages}
              fields={query.data?.fields ?? []}
              studentLayers={previewLayers}
              teacherLayers={{}}
              masterLayers={railAnnotations}
              fieldValues={previewValues}
              writeTarget="student"
              tool={previewTool}
              fingerDraw={previewFinger}
              zoom={previewZoom}
              onZoomChange={setPreviewZoom}
              fieldsEditable
              preview
              onLayerChange={(pageId, layer) => setPreviewLayers((m) => ({ ...m, [pageId]: layer }))}
              onFieldChange={(fieldId, value) => setPreviewValues((m) => ({ ...m, [fieldId]: value }))}
            />
          </div>
        </div>
      )}

      {/* Held back until nothing is layered over the editor: a spotlight cut
          through a drawer or an inspector would ring the wrong thing. */}
      {presenting && (
        <PresentMode
          notebookId={notebookId}
          pages={livePages}
          fields={query.data?.fields ?? []}
          masterLayers={railAnnotations}
          state={presenting}
          onChange={setPresenting}
          zoom={presentZoom}
          onZoomChange={setPresentZoom}
          onExit={() => { setPageIdx(presenting.idx); setPresenting(null); }}
        />
      )}

      {!blankOpen && !libraryOpen && !pagesDrawerOpen && !appearanceOpen && !selectedField && !candidates && !previewing && !presenting && (
        <Tour place="notebook" />
      )}
    </div>
  );
}

/** Renaming the notebook, which is the one detail students see on their copy. */
function RenameNotebookModal({
  title, busy, onClose, onSave,
}: { title: string; busy: boolean; onClose: () => void; onSave: (title: string) => void }) {
  const [value, setValue] = useState(title);
  const trimmed = value.trim();
  return (
    <Modal onClose={onClose} title="Rename notebook">
      <Label htmlFor="nb-title">Name</Label>
      <Input
        id="nb-title"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Untitled notebook"
        autoFocus
        onKeyDown={(e) => { if (e.key === "Enter" && trimmed) onSave(trimmed); }}
      />
      <p className="mt-2 text-[16px] text-pine/65">
        Students see this name on their own copy, so it changes for them too.
      </p>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" disabled={!trimmed || trimmed === title || busy} onClick={() => onSave(trimmed)}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </Modal>
  );
}

/** Small popover for customizing the accent color and cover image shown on the notebook's tile. */
/** A live sample of one ruling, drawn with the same code that paints the page. */
function PatternPreview({
  pattern, color, width = 64, ratio = 792 / 612,
}: { pattern: PatternKey; color: string; width?: number; ratio?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const height = Math.round(width * ratio);
  useEffect(() => {
    if (ref.current) {
      // Previewed at 2x so the fine rulings don't alias away at thumbnail size.
      renderPatternToCanvas(pattern, color, 612, 612 * ratio, ref.current, width / 612, 2);
    }
  }, [pattern, color, width, ratio]);
  return <canvas ref={ref} style={{ width, height }} className="block rounded-[4px]" />;
}

/**
 * Insert blank pages.
 *
 * The pages are generated rather than uploaded, so the only choices are the
 * ruling, its color, how many, and where they go. Size isn't offered: an
 * inserted sheet always takes the dimensions of the notebook it joins, which
 * is the only thing that keeps a notebook printable.
 */
function BlankPagesModal({
  pages, busy, onClose, onInsert, initialAfter = "",
}: {
  /** Where the Add page menu said new pages go: a page id, or "" for the end. */
  initialAfter?: string;
  pages: PageRec[];
  busy: boolean;
  onClose: () => void;
  onInsert: (body: { pattern: PatternKey; color: string; count: number; insertAfterPageId: string | null }) => void;
}) {
  const [pattern, setPattern] = useState<PatternKey>(DEFAULT_PATTERN);
  const [color, setColor] = useState(DEFAULT_PATTERN_COLOR);
  const [count, setCount] = useState(1);
  const [after, setAfter] = useState<string>(initialAfter);

  const live = pages.filter((p) => !p.archived);
  // Preview at the notebook's own proportions, so what's shown is the shape
  // the teacher will actually get.
  const ratio = live[0] ? live[0].height / live[0].width : 792 / 612;

  return (
    <Modal onClose={onClose} title="Add blank pages" className="sm:max-w-2xl">
      <label className="label-caps mb-2 block text-pine/70">Pattern</label>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {PATTERNS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPattern(p.key)}
            aria-pressed={pattern === p.key}
            title={p.hint}
            className={cn(
              "flex flex-col items-center gap-1.5 rounded-[12px] border-2 p-2 transition-colors",
              pattern === p.key ? "border-pine bg-mint/25" : "border-pine/20 hover:bg-oat",
            )}
          >
            <span className="overflow-hidden rounded-[4px] border border-pine/25">
              <PatternPreview pattern={p.key} color={color} width={52} ratio={ratio} />
            </span>
            <span className="text-center text-[14px] font-bold leading-tight text-pine">{p.label}</span>
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
            aria-pressed={color === c.value}
            title={c.label}
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-full border-2 transition-transform",
              color === c.value ? "border-pine scale-105" : "border-pine/25 hover:border-pine/50",
            )}
          >
            <span className="h-7 w-7 rounded-full border border-pine/20" style={{ background: c.value }} />
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label-caps mb-1 block text-pine/70" htmlFor="blank-count">How many</label>
          <Input
            id="blank-count"
            type="number"
            min={1}
            max={50}
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
          />
        </div>
        <div>
          <label className="label-caps mb-1 block text-pine/70" htmlFor="blank-after">Where</label>
          <Select id="blank-after" value={after} onChange={(e) => setAfter(e.target.value)}>
            <option value="">At the end</option>
            {live.map((p, i) => (
              <option key={p.id} value={p.id}>
                After page {i + 1}{p.label ? ` — ${p.label}` : ""}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => onInsert({ pattern, color, count, insertAfterPageId: after || null })}
        >
          {busy ? "Adding…" : `Add ${count} page${count === 1 ? "" : "s"}`}
        </Button>
      </div>
    </Modal>
  );
}

function AppearancePopover({
  notebookId, accentColor, hasCover, coverBump, coverInputRef,
  onSetAccent, onClearCover, onUploadCover, uploading, onClose,
}: {
  notebookId: string;
  accentColor: string;
  hasCover: boolean;
  coverBump: number;
  coverInputRef: React.RefObject<HTMLInputElement | null>;
  onSetAccent: (color: string) => void;
  onClearCover: () => void;
  onUploadCover: (file: File) => void;
  uploading: boolean;
  onClose: () => void;
}) {
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  // Local color for instant preview while dragging the OS picker; committed
  // to the server debounced so a drag doesn't fire a burst of racing PATCHes.
  const [localColor, setLocalColor] = useState(accentColor);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalColor(accentColor);
  }, [accentColor]);

  useEffect(() => () => { if (commitTimer.current) clearTimeout(commitTimer.current); }, []);

  const commitColor = (color: string) => {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => onSetAccent(color), 500);
  };

  const pickPreset = (color: string) => {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    setLocalColor(color);
    onSetAccent(color);
  };

  return (
    <div
      ref={popRef}
      className="absolute right-3 top-full z-30 mt-2 w-72 rounded-[22px] border-[3px] border-pine bg-white p-4 shadow-[6px_6px_0_0_var(--color-pine)]"
    >
      <h3 className="font-display text-[16px] font-bold text-pine">Appearance</h3>
      <p className="mt-1 text-[16px] leading-relaxed text-pine/70">
        The color and cover image are how this notebook appears on its tile.
      </p>

      <div className="mt-3">
        <label className="label-caps block text-pine/70">Color</label>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {ACCENT_SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Color ${c}`}
              onClick={() => pickPreset(c)}
              className={cn(
                "h-8 w-8 rounded-full border-2 transition-transform",
                localColor.toLowerCase() === c.toLowerCase()
                  ? "border-pine scale-110"
                  : "border-white shadow-sm hover:scale-105",
              )}
              style={{ background: c }}
            />
          ))}
          <label
            className="relative flex h-8 w-8 items-center justify-center rounded-full border-2 border-dashed border-pine/40 text-pine/50 hover:border-pine"
            title="Custom color"
          >
            <Palette className="h-3.5 w-3.5" strokeWidth={2.5} />
            <input
              type="color"
              value={localColor}
              onInput={(e) => {
                const color = (e.target as HTMLInputElement).value;
                setLocalColor(color);
                commitColor(color);
              }}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              aria-label="Custom color"
            />
          </label>
        </div>
      </div>

      <div className="mt-4">
        <label className="label-caps block text-pine/70">Cover image</label>
        <div className="mt-2 flex items-center gap-3">
          <div className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-[12px] border-2 border-pine/20 bg-oat">
            {hasCover ? (
              <img
                src={`/api/notebooks/${notebookId}/cover?v=${coverBump}`}
                alt="Notebook cover"
                className="h-full w-full object-cover"
              />
            ) : (
              <ImageOff className="h-4 w-4 text-pine/40" strokeWidth={2.5} />
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => coverInputRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-1.5 rounded-full border-2 border-pine/20 px-2.5 py-1.5 text-[16px] font-bold text-pine hover:bg-oat disabled:opacity-50"
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" strokeWidth={2.5} />}
              {hasCover ? "Replace" : "Upload"}
            </button>
            {hasCover && (
              <button
                type="button"
                onClick={onClearCover}
                className="inline-flex items-center gap-1.5 rounded-full border-2 border-pine/20 px-2.5 py-1.5 text-[16px] text-pine/70 hover:bg-oat"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2.5} /> Remove cover
              </button>
            )}
          </div>
        </div>
        <input
          ref={coverInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) onUploadCover(f);
          }}
        />
      </div>
    </div>
  );
}

/** Drag-to-create and drag-to-move overlay for form fields. */
function FieldLayer({
  pageWidth, pageHeight, scale, fields, tool, selected, onSelect, onCreate, onCommit, onEmptyPress, onMenu,
}: {
  /** The box's menu, at a point on screen: right-click, a held finger, or its "…" button. */
  onMenu?: (field: FieldRow, x: number, y: number) => void;
  pageWidth: number;
  pageHeight: number;
  scale: number;
  fields: FieldRow[];
  tool: FieldTool;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (rect: { x: number; y: number; w: number; h: number }) => void;
  onCommit: (id: string, rect: { x: number; y: number; w: number; h: number }) => void;
  /**
   * Offered a press that would otherwise just clear the field selection.
   * Returns true when something below claimed it — today, an annotation.
   */
  onEmptyPress?: (p: { x: number; y: number }) => boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [drag, setDrag] = useState<
    { id: string; mode: "move" | "resize"; startX: number; startY: number; orig: FieldRow; clientX: number; clientY: number } | null
  >(null);
  /**
   * Whether the drag has gone past a few pixels. Until it has, a press is a
   * press: it selects the box but doesn't move it, so a held finger (the
   * long-press) or a wobbly click can't nudge a box and save it somewhere new.
   */
  const dragMoved = useRef(false);
  const [preview, setPreview] = useState<Record<string, { x: number; y: number; w: number; h: number }>>({});

  const toPage = (e: React.PointerEvent | PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(pageWidth, (e.clientX - rect.left) / scale)),
      y: Math.max(0, Math.min(pageHeight, (e.clientY - rect.top) / scale)),
    };
  };

  const start = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (tool === "none") {
      if (onEmptyPress?.(toPage(e))) { e.preventDefault(); return; }
      onSelect(null);
      return;
    }
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = toPage(e);
    start.current = p;
    setDraft({ x: p.x, y: p.y, w: 0, h: 0 });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (drag) {
      if (!dragMoved.current) {
        if (Math.hypot(e.clientX - drag.clientX, e.clientY - drag.clientY) < 5) return;
        dragMoved.current = true;
      }
      const p = toPage(e);
      const dx = p.x - drag.startX;
      const dy = p.y - drag.startY;
      setPreview((prev) => ({
        ...prev,
        [drag.id]:
          drag.mode === "move"
            ? { x: Math.max(0, drag.orig.x + dx), y: Math.max(0, drag.orig.y + dy), w: drag.orig.w, h: drag.orig.h }
            : { x: drag.orig.x, y: drag.orig.y, w: Math.max(MIN_FIELD, drag.orig.w + dx), h: Math.max(MIN_FIELD, drag.orig.h + dy) },
      }));
      return;
    }
    if (!draft || !start.current) return;
    const p = toPage(e);
    setDraft({
      x: Math.min(start.current.x, p.x),
      y: Math.min(start.current.y, p.y),
      w: Math.abs(p.x - start.current.x),
      h: Math.abs(p.y - start.current.y),
    });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (drag) {
      const rect = preview[drag.id];
      if (rect) onCommit(drag.id, rect);
      setDrag(null);
      return;
    }
    if (draft) {
      // A quick tap yields a near-zero-size rect; the caller substitutes a
      // sensible per-type default rather than placing a field you can't see.
      onCreate(draft);
      setDraft(null);
      start.current = null;
    }
  };

  return (
    <div
      ref={ref}
      className="absolute inset-0"
      style={{ touchAction: "none", cursor: tool === "none" ? "default" : "crosshair" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {fields.map((f) => {
        const rect = preview[f.id] ?? { x: f.x, y: f.y, w: f.w, h: f.h };
        const isSelected = selected === f.id;
        return (
          <div
            key={f.id}
            className={cn(
              "group absolute rounded border-2 bg-mint/20",
              isSelected ? "border-pine" : "border-pine/50 hover:border-pine",
            )}
            style={{ left: rect.x * scale, top: rect.y * scale, width: rect.w * scale, height: rect.h * scale, cursor: "move" }}
            data-field-box={f.id}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!longPressJustFired()) onMenu?.(f, e.clientX, e.clientY);
            }}
            onPointerDown={(e) => {
              if (tool !== "none") return;
              e.stopPropagation();
              // The right button is the menu's (onContextMenu); it never drags.
              if (e.pointerType === "mouse" && e.button !== 0) return;
              e.preventDefault();
              (e.currentTarget.parentElement as HTMLElement).setPointerCapture(e.pointerId);
              onSelect(f.id);
              const p = toPage(e);
              dragMoved.current = false;
              setDrag({ id: f.id, mode: "move", startX: p.x, startY: p.y, orig: f, clientX: e.clientX, clientY: e.clientY });
              watchLongPress(e, (x, y) => {
                setDrag(null);
                setPreview((prev) => { const next = { ...prev }; delete next[f.id]; return next; });
                onMenu?.(f, x, y);
              });
            }}
          >
            <span
              className={cn(
                "pointer-events-none absolute -top-5 left-0 whitespace-nowrap rounded bg-pine px-1.5 py-0.5 text-[16px] font-bold text-oat",
                // Links sit inside running text, often a line apart; a label
                // on every one would cover the lines they're in. They name
                // themselves on hover and when selected.
                f.type === "link" && !isSelected && "opacity-0 transition-opacity group-hover:opacity-100",
              )}
            >
              {fieldChip(f)}
            </span>
            <div
              className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-nwse-resize rounded-full border-2 border-white bg-pine"
              onPointerDown={(e) => {
                if (tool !== "none") return;
                e.stopPropagation();
                e.preventDefault();
                (e.currentTarget.parentElement?.parentElement as HTMLElement).setPointerCapture(e.pointerId);
                onSelect(f.id);
                const p = toPage(e);
                dragMoved.current = false;
                setDrag({ id: f.id, mode: "resize", startX: p.x, startY: p.y, orig: f, clientX: e.clientX, clientY: e.clientY });
              }}
            />
            {isSelected && onMenu && (
              <button
                type="button"
                aria-label={`More actions for this ${fieldTypeLabel(f.type).toLowerCase()}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  const at = pointFor(e.currentTarget);
                  onMenu(f, at.x, at.y);
                }}
                className="absolute -right-3.5 -top-3.5 flex h-7 w-7 items-center justify-center rounded-full border-2 border-pine bg-white text-pine shadow-[2px_2px_0_0_var(--color-pine)] hover:bg-oat"
              >
                <span className="absolute -inset-2" aria-hidden />
                <MoreHorizontal className="h-4 w-4" strokeWidth={2.5} />
              </button>
            )}
          </div>
        );
      })}

      {draft && draft.w > 1 && (
        <div
          className="absolute rounded border-2 border-dashed border-pine bg-mint/20"
          style={{ left: draft.x * scale, top: draft.y * scale, width: draft.w * scale, height: draft.h * scale }}
        />
      )}
    </div>
  );
}

/**
 * A small WYSIWYG for a rich text block.
 *
 * `document.execCommand` is deprecated and still the only thing every browser
 * implements for contentEditable formatting; a replacement means shipping an
 * editor framework, which is a lot of weight for bold and bullets.
 *
 * The DOM is the source of truth while typing — writing React state back into
 * a contentEditable on every keystroke would fight the caret — so the value is
 * read out and saved on blur, and the initial HTML is set only when the field
 * being edited changes.
 */
function RichTextEditor({
  fieldId, value, onChange,
}: { fieldId: string; value: string; onChange: (html: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    if (ref.current && loadedFor.current !== fieldId) {
      loadedFor.current = fieldId;
      ref.current.innerHTML = value || "";
    }
  }, [fieldId, value]);

  const exec = (command: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(command, false, arg);
    // Formatting doesn't blur, so nothing else would pick the change up.
    onChange(ref.current?.innerHTML ?? "");
  };

  /**
   * Linking words.
   *
   * Typing the address means leaving the text, which loses the selection the
   * link is for, so the selection is kept aside when the link row opens and put
   * back to apply it. With nothing selected the address goes in as new linked
   * words. Every anchor is then given exactly the attributes the server's
   * sanitiser writes, in its order — otherwise the saved block would differ
   * from what's on screen and the inspector would call it unsaved forever.
   */
  const [linking, setLinking] = useState<{ href: string; editing: HTMLAnchorElement | null } | null>(null);
  const savedRange = useRef<Range | null>(null);
  const linkHref = linking ? normalizeLink(linking.href) : null;

  const anchorAtSelection = (): HTMLAnchorElement | null => {
    const sel = window.getSelection();
    const node = sel?.anchorNode ?? null;
    const el = node instanceof Element ? node : node?.parentElement ?? null;
    const a = el?.closest("a");
    return a && ref.current?.contains(a) ? a : null;
  };

  const openLinking = () => {
    const sel = window.getSelection();
    savedRange.current = sel && sel.rangeCount && ref.current?.contains(sel.anchorNode)
      ? sel.getRangeAt(0).cloneRange()
      : null;
    const editing = anchorAtSelection();
    setLinking({ href: editing?.getAttribute("href") ?? "", editing });
  };

  const tidyAnchors = () => {
    for (const a of Array.from(ref.current?.querySelectorAll("a") ?? [])) {
      const href = normalizeLink(a.getAttribute("href") ?? "");
      if (!href) { a.replaceWith(...Array.from(a.childNodes)); continue; }
      for (const name of a.getAttributeNames()) a.removeAttribute(name);
      a.setAttribute("href", href);
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer nofollow");
    }
    onChange(ref.current?.innerHTML ?? "");
  };

  const applyLink = () => {
    if (!linking || !linkHref || !ref.current) return;
    if (linking.editing && ref.current.contains(linking.editing)) {
      linking.editing.setAttribute("href", linkHref);
    } else {
      ref.current.focus();
      const sel = window.getSelection();
      if (sel && savedRange.current) {
        sel.removeAllRanges();
        sel.addRange(savedRange.current);
      }
      if (!sel || !sel.rangeCount || sel.isCollapsed || !ref.current.contains(sel.anchorNode)) {
        // Nothing chosen to link: put the address in as words of its own.
        const a = document.createElement("a");
        a.setAttribute("href", linkHref);
        a.textContent = linkHost(linkHref);
        if (sel && sel.rangeCount && ref.current.contains(sel.anchorNode)) {
          const range = sel.getRangeAt(0);
          range.insertNode(a);
          range.setStartAfter(a);
          range.collapse(true);
        } else {
          ref.current.appendChild(a);
        }
      } else {
        document.execCommand("createLink", false, linkHref);
      }
    }
    setLinking(null);
    tidyAnchors();
  };

  const removeLink = () => {
    const a = linking?.editing;
    if (a && ref.current?.contains(a)) a.replaceWith(...Array.from(a.childNodes));
    setLinking(null);
    tidyAnchors();
  };

  const BUTTONS: { cmd: string; arg?: string; label: string; className?: string }[] = [
    { cmd: "bold", label: "B", className: "font-bold" },
    { cmd: "italic", label: "I", className: "italic" },
    { cmd: "underline", label: "U", className: "underline" },
    { cmd: "formatBlock", arg: "h2", label: "H" },
    { cmd: "insertUnorderedList", label: "•" },
    { cmd: "insertOrderedList", label: "1." },
    { cmd: "removeFormat", label: "⌫" },
  ];

  return (
    <div className="mt-1.5">
      <div className="mb-1.5 flex flex-wrap gap-1">
        <button
          type="button"
          aria-label="Link words"
          title="Link words — select them first, or add an address as new words"
          aria-pressed={!!linking}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => (linking ? setLinking(null) : openLinking())}
          className={cn(
            "inline-flex h-9 min-w-9 items-center justify-center rounded-[8px] border-2 border-pine/20 px-2 text-pine hover:bg-oat",
            linking && "border-pine bg-mint/30",
          )}
        >
          <LinkIcon className="h-4 w-4" strokeWidth={2.5} />
        </button>
        {BUTTONS.map((b) => (
          <button
            key={b.label}
            type="button"
            // Keep the caret where it is: a toolbar press must not steal focus
            // out of the text, or the command has no selection to act on.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec(b.cmd, b.arg)}
            className={cn(
              "h-9 min-w-9 rounded-[8px] border-2 border-pine/20 px-2 text-[15px] text-pine hover:bg-oat",
              b.className,
            )}
          >
            {b.label}
          </button>
        ))}
      </div>
      {linking && (
        <div className="mb-1.5 rounded-[12px] border-2 border-pine/25 bg-oat p-2">
          <Input
            value={linking.href}
            onChange={(e) => setLinking({ ...linking, href: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); applyLink(); }
              // Escape here closes the link row, not the whole inspector.
              if (e.key === "Escape") { e.stopPropagation(); setLinking(null); }
            }}
            placeholder="Paste a web address"
            aria-label="Web address"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            className="text-[16px]"
          />
          {linking.href.trim() && !linkHref && (
            <p className="mt-1 text-[16px] font-bold text-[#a3341f]">That isn't a web address.</p>
          )}
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Button variant="primary" disabled={!linkHref} onClick={applyLink}>
              {linking.editing ? "Change link" : "Add link"}
            </Button>
            {linking.editing && (
              <Button variant="secondary" onClick={removeLink}>
                <Unlink2 className="h-4 w-4" strokeWidth={2.5} /> Remove
              </Button>
            )}
          </div>
        </div>
      )}
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onBlur={() => onChange(ref.current?.innerHTML ?? "")}
        className="rich-text max-h-64 min-h-24 overflow-y-auto rounded-[12px] border-2 border-pine/25 bg-white p-2 outline-none focus:border-pine"
      />
      <p className="mt-1 text-[14px] text-pine/55">
        Headings, emphasis, lists and links are kept. Anything else is stripped when it saves.
      </p>
    </div>
  );
}

function FieldInspector({
  field, notebookId, onClose, onSave, onDelete, onInvalidate, saving,
}: {
  field?: FieldRow;
  notebookId: string;
  onClose: () => void;
  onSave: (patch: any, fieldId?: string) => void;
  /** True while the field PATCH is in flight, so Save can say so. */
  saving?: boolean;
  onDelete: () => void;
  onInvalidate: () => void;
}) {
  const [label, setLabel] = useState(field?.label ?? "");
  const [options, setOptions] = useState<string>(() => {
    try { return (JSON.parse(field?.options || "[]") as string[]).join("\n"); } catch { return ""; }
  });
  const [prompt, setPrompt] = useState(field?.prompt ?? "");
  const [content, setContent] = useState(field?.content ?? "");
  /** Bumped by Cancel to remount the rich text editor with the reverted value. */
  const [revertNonce, setRevertNonce] = useState(0);
  const [mediaBump, setMediaBump] = useState(0);
  const [mediaBusy, setMediaBusy] = useState(false);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const syncedFieldId = useRef(field?.id);

  // `field` is looked up fresh from query data every render, so it gets a new
  // object identity whenever *anything* invalidates the notebook query — an
  // unrelated field move, an image upload, a background refetch. Resetting on
  // every such change would blow away text the teacher is mid-typing but
  // hasn't blurred out of yet, so only resync when the selected field itself
  // actually changes.
  /**
   * Pending edits survive leaving the inspector, however you leave it.
   *
   * Switching to another field is handled below, but *deselecting* unmounts
   * this component entirely, so that path needs its own cleanup or the edit
   * would vanish with the panel.
   */
  const pending = useRef<{ field?: FieldRow; draft: FieldDraft; save: typeof onSave }>({
    field, draft: { label, options, prompt, content }, save: onSave,
  });
  pending.current = { field, draft: { label, options, prompt, content }, save: onSave };
  useEffect(() => () => {
    const { field: f, draft: d, save } = pending.current;
    if (f && fieldIsDirty(f, d)) save(fieldPatch(f, d), f.id);
  }, []);

  const lastField = useRef<FieldRow | undefined>(field);
  useEffect(() => {
    if (field?.id === syncedFieldId.current) { lastField.current = field; return; }
    // Selecting another field is not "discard": nobody types a label and then
    // clicks away meaning to lose it. Pending edits go with the field they
    // belong to, and Cancel stays the way to actually throw them away.
    const prev = lastField.current;
    if (prev && prev.id === syncedFieldId.current) {
      const pending = { label, options, prompt, content };
      if (fieldIsDirty(prev, pending)) onSave(fieldPatch(prev, pending), prev.id);
    }
    syncedFieldId.current = field?.id;
    lastField.current = field;
    setLabel(field?.label ?? "");
    setPrompt(field?.prompt ?? "");
    setContent(field?.content ?? "");
    setOptions(safeOptions(field?.options).join("\n"));
    // Only the identity of the selected field should drive a resync; including
    // the draft here would reset it on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const draft: FieldDraft = { label, options, prompt, content };
  const dirty = !!field && fieldIsDirty(field, draft);

  const revert = () => {
    setLabel(field?.label ?? "");
    setPrompt(field?.prompt ?? "");
    setContent(field?.content ?? "");
    setOptions(safeOptions(field?.options).join("\n"));
    setRevertNonce((n) => n + 1);
  };

  if (!field) return null;

  const uploadMedia = async (file: File) => {
    setMediaBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await api.upload(`/api/notebooks/${notebookId}/fields/${field.id}/media`, form);
      setMediaBump((n) => n + 1);
      onInvalidate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setMediaBusy(false);
    }
  };

  const removeMedia = async () => {
    setMediaBusy(true);
    try {
      await api.del(`/api/notebooks/${notebookId}/fields/${field.id}/media`);
      setMediaBump((n) => n + 1);
      onInvalidate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setMediaBusy(false);
    }
  };

  const body = (
    <>
      <div className="flex items-center justify-between">
        <h3 className="font-display text-[16px] font-bold text-pine">Field</h3>
        <button onClick={onClose} className="rounded p-1 text-pine/50 hover:bg-pine/8">
          <ChevronDown className="h-4 w-4" strokeWidth={2.5} />
        </button>
      </div>
      <p className="mt-1 text-[16px] text-pine/70">{fieldTypeLabel(field.type)}</p>

      {!["image", "audio", "richtext", "figure", "link"].includes(field.type) && (
        <>
          <label className="label-caps mt-4 block text-pine/70">Label / placeholder</label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="mt-1 text-[16px]"
            placeholder="e.g. Your answer"
          />
        </>
      )}

      {field.type === "choice" && (
        <>
          <label className="label-caps mt-4 block text-pine/70">Options (one per line)</label>
          <Textarea
            value={options}
            onChange={(e) => setOptions(e.target.value)}
            rows={4}
            className="mt-1 text-[16px]"
          />
        </>
      )}

      {field.type === "richtext" && (
        <>
          <label className="label-caps mt-4 block text-pine/70">Text</label>
          <RichTextEditor
            key={`${field.id}:${revertNonce}`}
            fieldId={field.id}
            value={content}
            onChange={setContent}
          />
        </>
      )}

      {field.type === "link" && (() => {
        const href = normalizeLink(content);
        const unusable = !!content.trim() && !href;
        return (
          <>
            <label className="label-caps mt-4 block text-pine/70" htmlFor="link-href">Opens</label>
            <Input
              id="link-href"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Paste a web address"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              autoFocus={!content}
              aria-invalid={unusable || undefined}
              className="mt-1 text-[16px]"
            />
            {unusable ? (
              <p className="mt-1.5 text-[16px] font-bold text-[#a3341f]">
                That isn't a web address. Copy it from the browser's address bar, or start an email address with mailto:
              </p>
            ) : href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 inline-flex min-h-[44px] items-center gap-1.5 text-[16px] font-bold text-pine underline decoration-mint decoration-2 underline-offset-2"
              >
                <ExternalLink className="h-4 w-4" strokeWidth={2.5} /> Try it
              </a>
            ) : null}

            <label className="label-caps mt-4 block text-pine/70" htmlFor="link-words">What it says</label>
            <Input
              id="link-words"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Watch the video"
              className="mt-1 text-[16px]"
            />
            <p className="mt-1.5 text-[16px] leading-snug text-pine/60">
              The words a screen reader says for it. Size the box over the words or picture on the page that
              students should tap.
            </p>
          </>
        );
      })()}

      {field.type === "figure" && (
        <>
          <label className="label-caps mt-4 block text-pine/70">Picture</label>
          {field.has_media ? (
            <div className="mt-1.5">
              <img
                src={`/api/notebooks/${notebookId}/fields/${field.id}/media?v=${mediaBump}`}
                alt=""
                className="w-full rounded-[12px] border-2 border-pine/20 object-contain"
              />
              <div className="mt-1.5 flex gap-1.5">
                <button
                  type="button"
                  onClick={() => mediaInputRef.current?.click()}
                  disabled={mediaBusy}
                  className="inline-flex items-center gap-1.5 rounded-full border-2 border-pine/20 px-2.5 py-1.5 text-[16px] font-bold text-pine hover:bg-oat disabled:opacity-50"
                >
                  {mediaBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" strokeWidth={2.5} />}
                  Replace
                </button>
                <button
                  type="button"
                  onClick={() => void removeMedia()}
                  disabled={mediaBusy}
                  className="inline-flex items-center gap-1.5 rounded-full border-2 border-pine/20 px-2.5 py-1.5 text-[16px] text-pine/70 hover:bg-oat disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2.5} /> Remove
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => mediaInputRef.current?.click()}
              disabled={mediaBusy}
              className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border-2 border-pine/20 px-2.5 py-1.5 text-[16px] font-bold text-pine hover:bg-oat disabled:opacity-50"
            >
              {mediaBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" strokeWidth={2.5} />}
              Upload picture
            </button>
          )}
          <p className="mt-1.5 text-[14px] text-pine/55">Drag the box on the page to size and place it.</p>
        </>
      )}

      {field.type === "prompt" && (
        <>
          <label className="label-caps mt-4 block text-pine/70">Instruction / prompt</label>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder="e.g. Explain your reasoning in 2-3 sentences."
            className="mt-1 text-[16px]"
          />

          <label className="label-caps mt-4 block text-pine/70">Illustration (optional)</label>
          {field.has_media ? (
            <div className="mt-1.5">
              <img
                src={`/api/notebooks/${notebookId}/fields/${field.id}/media?v=${mediaBump}`}
                alt="Prompt illustration"
                className="w-full rounded-[12px] border-2 border-pine/20 object-cover"
              />
              <div className="mt-1.5 flex gap-1.5">
                <button
                  type="button"
                  onClick={() => mediaInputRef.current?.click()}
                  disabled={mediaBusy}
                  className="inline-flex items-center gap-1.5 rounded-full border-2 border-pine/20 px-2.5 py-1.5 text-[16px] font-bold text-pine hover:bg-oat disabled:opacity-50"
                >
                  {mediaBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" strokeWidth={2.5} />}
                  Replace
                </button>
                <button
                  type="button"
                  onClick={() => void removeMedia()}
                  disabled={mediaBusy}
                  className="inline-flex items-center gap-1.5 rounded-full border-2 border-pine/20 px-2.5 py-1.5 text-[16px] text-pine/70 hover:bg-oat disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2.5} /> Remove image
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => mediaInputRef.current?.click()}
              disabled={mediaBusy}
              className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border-2 border-pine/20 px-2.5 py-1.5 text-[16px] font-bold text-pine hover:bg-oat disabled:opacity-50"
            >
              {mediaBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" strokeWidth={2.5} />}
              Upload image
            </button>
          )}
          <input
            ref={mediaInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void uploadMedia(f);
            }}
          />
        </>
      )}

      {field.type === "image" && (
        <p className="mt-4 rounded-[12px] border-2 border-pine/20 bg-oat px-2.5 py-2 text-[16px] leading-relaxed text-pine/70">
          Students will see an empty box here and can add their own picture. The box's shape is the
          crop area, so size it to the aspect ratio you want their photo to fit.
        </p>
      )}

      {field.type === "audio" && (
        <p className="mt-4 rounded-[12px] border-2 border-pine/20 bg-oat px-2.5 py-2 text-[16px] leading-relaxed text-pine/70">
          Students will see a record button here and can record a short answer in place.
        </p>
      )}

      {/* Typed settings wait for Save. Dragging and resizing on the page commit
          as they happen — direct manipulation you can already see the result of,
          where a confirm step would only get in the way. */}
      <div className="sticky bottom-0 -mx-4 mt-4 border-t-2 border-pine/12 bg-white px-4 pb-1 pt-3">
        {dirty && (
          <p className="mb-2 text-[16px] font-bold text-[#8a6a1f]">Unsaved changes</p>
        )}
        <div className="flex gap-2">
          <Button
            variant="primary"
            className="flex-1"
            disabled={!dirty || saving || (field.type === "link" && !!content.trim() && !normalizeLink(content))}
            onClick={() => field && onSave(fieldPatch(field, draft))}
          >
            <Check className="h-4 w-4" strokeWidth={2.5} /> {saving ? "Saving…" : "Save"}
          </Button>
          <Button variant="secondary" disabled={!dirty || saving} onClick={revert}>
            Cancel
          </Button>
        </div>
      </div>

      {/* Only things that take an answer have answers to keep. */}
      {!["richtext", "figure", "link"].includes(field.type) && (
        <p className="mt-4 rounded-[12px] border-2 border-pine/20 bg-oat px-2.5 py-2 text-[16px] leading-relaxed text-pine/70">
          Moving or resizing a field keeps every answer students have already typed into it.
        </p>
      )}

      <button
        onClick={onDelete}
        className="mt-4 inline-flex w-full min-h-[44px] items-center justify-center gap-1.5 rounded-[12px] border-2 border-[#a3341f]/40 px-3 py-2 text-[16px] font-bold text-[#a3341f] hover:bg-[#a3341f]/8"
      >
        <Trash2 className="h-4 w-4" strokeWidth={2.5} /> Delete field
      </button>
    </>
  );

  return (
    <>
      <aside className="hidden w-64 shrink-0 border-l-2 border-pine/12 bg-white p-4 sm:block">
        {body}
      </aside>

      {/* Bottom sheet on phones — there's no room for a fixed right rail. */}
      <div className="fixed inset-0 z-40 flex items-end sm:hidden">
        <div className="absolute inset-0 bg-pine/40" onClick={onClose} aria-hidden />
        <div
          className="relative flex max-h-[80vh] w-full flex-col overflow-y-auto rounded-t-[22px] border-[3px] border-pine bg-white p-4 shadow-xl"
          style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
        >
          {body}
        </div>
      </div>
    </>
  );
}

/**
 * The pages and nothing else.
 *
 * Built for a projector: a dark ground so the paper reads as paper, one
 * floating strip of controls that fades unless the pointer is near it, and
 * the browser's own full screen so the tab bar goes too. Nothing here is
 * saved — the surface is the same one the preview uses, with the teacher's
 * unsent ink included, because the page on the wall should be the page the
 * teacher is looking at.
 *
 * Annotate brings the writing tools up for working an example in front of the
 * class. That ink is a whiteboard marker: it lives in this component, on top
 * of the page, and goes when presenting ends.
 */
function PresentMode({
  notebookId, pages, fields, masterLayers, state, onChange, zoom, onZoomChange, onExit,
}: {
  notebookId: string;
  pages: EditorPage[];
  fields: FieldRow[];
  masterLayers: Record<string, LayerData>;
  state: { mode: "pages" | "scroll"; idx: number };
  onChange: (next: { mode: "pages" | "scroll"; idx: number }) => void;
  zoom: ZoomMode;
  onZoomChange: (z: ZoomMode) => void;
  onExit: () => void;
}) {
  const { mode, idx } = state;
  const last = Math.max(0, pages.length - 1);
  const go = (n: number) => onChange({ mode, idx: Math.max(0, Math.min(last, n)) });

  // ---- Annotate: the tools, and ink that is never sent anywhere ----
  const [annotating, setAnnotating] = useState(false);
  const [tool, setTool] = useState<ToolState>({
    kind: "pen", color: TEACHER_COLORS[0], width: 2.5, stamp: "⭐", fontSize: 18, erase: "quick",
  });
  const [fingerDraw, setFingerDraw] = useState(false);
  const [ink, setInk] = useState<Record<string, LayerData>>({});
  const history = useRef<{ past: { pageId: string; layer: LayerData }[]; future: { pageId: string; layer: LayerData }[] }>({ past: [], future: [] });
  const [, bump] = useState(0);
  const [visiblePageId, setVisiblePageId] = useState<string | null>(null);
  const currentPageId = mode === "pages" ? pages[idx]?.id : visiblePageId ?? pages[idx]?.id;
  const inkOf = (pageId: string) => ink[pageId] ?? emptyLayer();
  const writeInk = (pageId: string, layer: LayerData, record = true) => {
    if (record) {
      history.current.past.push({ pageId, layer: inkOf(pageId) });
      history.current.future = [];
      bump((n) => n + 1);
    }
    setInk((m) => ({ ...m, [pageId]: layer }));
  };
  const step = (from: "past" | "future") => {
    const h = history.current;
    const entry = h[from].pop();
    if (!entry) return;
    (from === "past" ? h.future : h.past).push({ pageId: entry.pageId, layer: inkOf(entry.pageId) });
    writeInk(entry.pageId, entry.layer, false);
    bump((n) => n + 1);
  };

  // The browser's full screen, entered on the way in and left on the way out —
  // and if the person leaves it themselves (Escape does), that is an exit too.
  useEffect(() => {
    const root = document.documentElement;
    root.requestFullscreen?.().catch(() => {});
    const onChangeFs = () => { if (!document.fullscreenElement) onExit(); };
    // Registered a beat later so the entry itself doesn't read as an exit.
    const t = setTimeout(() => document.addEventListener("fullscreenchange", onChangeFs), 300);
    return () => {
      clearTimeout(t);
      document.removeEventListener("fullscreenchange", onChangeFs);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A key some control already handled (Escape closing the tool options)
      // isn't also a command to the room, and nor is typing or moving along the toolbar.
      if (e.defaultPrevented || isEditableTarget(e.target)) return;
      if ((e.target as HTMLElement | null)?.closest?.('[role="toolbar"],[role="dialog"]')) return;
      if (e.key === "Escape") { onExit(); return; }
      if (mode !== "pages") return;
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") { e.preventDefault(); go(idx + 1); }
      if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); go(idx - 1); }
      if (e.key === "Home") go(0);
      if (e.key === "End") go(last);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const shown = mode === "pages" ? pages.slice(idx, idx + 1) : pages;
  const seg = (on: boolean) => cn(
    "inline-flex h-9 items-center gap-1.5 rounded-full px-3 font-display text-[16px] font-bold transition-colors",
    on ? "bg-oat text-pine" : "text-oat/80 hover:bg-oat/15",
  );
  const arrow = "flex h-10 w-10 items-center justify-center rounded-full text-oat hover:bg-oat/15 disabled:opacity-30 disabled:hover:bg-transparent";

  return (
    <div data-presenting className="fixed inset-0 z-[60] flex flex-col bg-pine">
      {annotating && (
        <div className="flex justify-center px-3 pt-3">
          <div className="max-w-full rounded-[22px] border-[3px] border-oat/30 bg-white px-1.5">
            <InkToolbar
              tool={tool}
              onToolChange={setTool}
              fingerDraw={fingerDraw}
              onFingerDrawChange={setFingerDraw}
              onUndo={() => step("past")}
              onRedo={() => step("future")}
              canUndo={history.current.past.length > 0}
              canRedo={history.current.future.length > 0}
              teacherPalette
              zoom={zoom}
              onZoomChange={onZoomChange}
              onClearPage={currentPageId && ink[currentPageId] ? () => writeInk(currentPageId, emptyLayer()) : undefined}
            />
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <NotebookSurface
          key={mode}
          notebookId={notebookId}
          pages={shown}
          fields={fields}
          studentLayers={{}}
          teacherLayers={ink}
          masterLayers={masterLayers}
          fieldValues={{}}
          writeTarget={annotating && tool.kind !== "select" ? "teacher" : null}
          tool={tool}
          fingerDraw={fingerDraw}
          zoom={zoom}
          onZoomChange={onZoomChange}
          fieldsEditable={false}
          preview
          onLayerChange={(pageId, layer) => writeInk(pageId, layer)}
          onFieldChange={() => {}}
          onVisiblePageChange={setVisiblePageId}
        />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-4">
        <div className="pointer-events-auto flex items-center gap-1 rounded-full border-2 border-oat/30 bg-pine/95 p-1.5 shadow-lg backdrop-blur">
          <button type="button" className={seg(mode === "pages")} onClick={() => onChange({ mode: "pages", idx })} title="One page at a time — arrow keys or the buttons">
            <Rows2 className="h-4 w-4" strokeWidth={2.5} /> Pages
          </button>
          <button type="button" className={seg(mode === "scroll")} onClick={() => onChange({ mode: "scroll", idx })} title="The whole notebook, scrolling">
            <GalleryVertical className="h-4 w-4" strokeWidth={2.5} /> Scroll
          </button>
          {mode === "pages" && (
            <>
              <span className="mx-1 h-6 w-px bg-oat/30" aria-hidden />
              <button type="button" className={arrow} onClick={() => go(idx - 1)} disabled={idx === 0} aria-label="Previous page">
                <ChevronLeft className="h-5 w-5" strokeWidth={2.5} />
              </button>
              <span className="min-w-[72px] text-center font-display text-[16px] font-bold text-oat">{idx + 1} / {pages.length}</span>
              <button type="button" className={arrow} onClick={() => go(idx + 1)} disabled={idx >= last} aria-label="Next page">
                <ChevronRight className="h-5 w-5" strokeWidth={2.5} />
              </button>
            </>
          )}
          <span className="mx-1 h-6 w-px bg-oat/30" aria-hidden />
          <button
            type="button"
            className={seg(annotating)}
            aria-pressed={annotating}
            onClick={() => setAnnotating((a) => !a)}
            title={annotating ? "Put the writing tools away" : "Write on the page for the room. Nothing you write here is saved."}
          >
            <PenLine className="h-4 w-4" strokeWidth={2.5} /> Annotate
          </button>
          <span className="mx-1 h-6 w-px bg-oat/30" aria-hidden />
          <select
            value={String(zoom)}
            onChange={(e) => { const v = e.target.value; onZoomChange(v === "page" || v === "width" ? v : Number(v)); }}
            className="h-9 rounded-full border-2 select-on-dark border-oat/30 bg-transparent pl-3 pr-10 font-display text-[16px] font-bold text-oat"
            aria-label="Zoom"
          >
            <option value="page" className="text-pine">Fit page</option>
            <option value="width" className="text-pine">Fit width</option>
            {[1, 1.25, 1.5, 2].map((z) => <option key={z} value={z} className="text-pine">{Math.round(z * 100)}%</option>)}
          </select>
          <button type="button" onClick={onExit} className="ml-1 inline-flex h-9 items-center gap-1.5 rounded-full bg-oat px-3.5 font-display text-[16px] font-bold text-pine hover:bg-white">
            <X className="h-4 w-4" strokeWidth={2.5} /> Exit
          </button>
        </div>
      </div>
    </div>
  );
}


/**
 * A template's classes, from inside the editor: push it to classes it isn't in
 * yet, or send the classes it is in whatever's new. The same actions as the
 * Notebooks page offers, reached without leaving the page being edited.
 */
function TemplateClassesMenu({ templateId, title, className }: { templateId: string; title: string; className?: string }) {
  const qc = useQueryClient();
  const [pushOpen, setPushOpen] = useState(false);
  const classes = useQuery({
    queryKey: ["classes", "active"],
    queryFn: () => api.get<{ classes: { id: string; name: string; my_role: string }[] }>("/api/classes"),
  });
  const list = useQuery({
    queryKey: ["teaching-notebooks"],
    queryFn: () => api.get<{ notebooks: { id: string; copies?: { classId: string; className: string; pendingPages: number; pendingFields: number }[] }[] }>("/api/my/teaching-notebooks"),
  });
  const me = list.data?.notebooks.find((n) => n.id === templateId);
  const copies = me?.copies ?? [];
  const pending = copies.reduce((n, c) => n + c.pendingPages + c.pendingFields, 0);
  const pushed = new Set(copies.map((c) => c.classId));
  const teachable = (classes.data?.classes ?? []).filter((c) => c.my_role === "teacher" && !pushed.has(c.id));
  const hasClasses = (classes.data?.classes ?? []).some((c) => c.my_role === "teacher");
  const refresh = () => qc.invalidateQueries({ queryKey: ["teaching-notebooks"] });

  const sync = useMutation({
    mutationFn: () => api.post<{ classes: number; pagesAdded: number; fieldsAdded: number }>(`/api/templates/${templateId}/sync`, {}),
    onSuccess: (res) => {
      refresh();
      const bits = [];
      if (res.pagesAdded) bits.push(`${res.pagesAdded} page${res.pagesAdded === 1 ? "" : "s"}`);
      if (res.fieldsAdded) bits.push(`${res.fieldsAdded} answer box${res.fieldsAdded === 1 ? "" : "es"}`);
      toast.success(bits.length ? `Sent ${bits.join(" and ")} to ${res.classes} class${res.classes === 1 ? "" : "es"}` : "Every class already has everything in this template");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const items: MenuItem[] = [
    ...(teachable.length > 0 ? [{
      label: "Push to classes…",
      icon: <Send className="h-5 w-5" strokeWidth={2.5} />,
      hint: "Pick one class or several. Each gets a copy as a draft.",
      onClick: () => setPushOpen(true),
    }] : []),
    ...(copies.length > 0 ? [{
      label: pending ? `Send updates to ${copies.length} class${copies.length === 1 ? "" : "es"}` : "Send updates",
      icon: <RefreshCw className="h-5 w-5" strokeWidth={2.5} />,
      disabled: !pending,
      hint: pending
        ? `${pending} new page${pending === 1 ? "" : "s"} or box${pending === 1 ? "" : "es"} waiting. Only what's new is added — nothing already in a class is changed.`
        : "Every class already has everything in this template.",
      onClick: () => sync.mutate(),
    }] : []),
  ];
  if (items.length === 0) {
    items.push({
      label: hasClasses ? "In every class already" : "No classes to push to",
      icon: <Send className="h-5 w-5" strokeWidth={2.5} />,
      disabled: true,
      hint: hasClasses ? "Every class you teach has this template." : "Make a class first, or join one as a teacher.",
      onClick: () => {},
    });
  }

  return (
    <>
    <Menu
      label="Classes"
      className={className}
      triggerClassName={buttonClass(pending ? "primary" : "secondary", "md", className)}
      trigger={<>
        <Send className="h-5 w-5" strokeWidth={2.5} />
        <span>{pending ? `Send updates (${pending})` : copies.length ? `In ${copies.length} class${copies.length === 1 ? "" : "es"}` : "Push to a class"}</span>
        <ChevronDown className="h-4 w-4" strokeWidth={2.5} />
      </>}
      items={items}
    />
    {pushOpen && (
      <PushToClassesModal
        templates={[{ id: templateId, title, copies }]}
        onClose={() => setPushOpen(false)}
      />
    )}
    </>
  );
}
