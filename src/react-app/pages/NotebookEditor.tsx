import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Check, CheckSquare, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, EyeOff,
  FolderPlus, ImageOff, ImagePlus, ListChecks, Loader2, Mic, MessageSquareText, Palette, Pen,
  Plus, RotateCcw, Send, Trash2, Type as TypeIcon, Upload, X, PanelLeft,
} from "lucide-react";
import { toast } from "sonner";
import { api, assetUrl, type FieldRec, type PageRec } from "../lib/api";
import { readPageSizes } from "../lib/pdf";
import { convertToPdf, needsConversion } from "../lib/google";
import PageCanvas, { type ToolState } from "../components/PageCanvas";
import NotebookPageList, { type ArrangeEntry } from "../components/NotebookPageList";
import InkToolbar from "../components/InkToolbar";
import { emptyLayer, parseLayer, serializeLayer, TEACHER_COLORS, type LayerData } from "../lib/ink";
import type { SaveStatus } from "../lib/autosave";
import Shell, { ErrorNote, Spinner } from "../components/Shell";
import { Button, Chip, IconButton, Input, Textarea } from "../components/ui";
import { useBackTo } from "../lib/useBackTo";
import { cn, formatDue } from "../lib/utils";

type FieldTool = "none" | "text" | "checkbox" | "choice" | "prompt" | "image" | "audio";

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
  "#1A73E8", "#34A853", "#EA4335", "#F9AB00", "#9334E6",
  "#1E8E9C", "#D93025", "#E37400", "#202124", "#5F6368",
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

const MIN_FIELD = 8;

/** Sensible default size when a teacher taps rather than drags to place a field. */
const DEFAULT_FIELD_SIZE: Record<Exclude<FieldTool, "none">, { w: number; h: number }> = {
  text: { w: 160, h: 28 },
  checkbox: { w: 18, h: 18 },
  choice: { w: 160, h: 28 },
  prompt: { w: 260, h: 120 },
  image: { w: 180, h: 140 },
  audio: { w: 220, h: 56 },
};

export default function NotebookEditor() {
  const { notebookId = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const goBack = useBackTo("/classes");

  const query = useQuery({
    queryKey: ["notebook", notebookId],
    queryFn: () => api.get<NotebookResponse>(`/api/notebooks/${notebookId}?archived=1`),
    enabled: !!notebookId,
  });

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
  const [zoom, setZoom] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const addPagesRef = useRef<HTMLInputElement>(null);
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
  const [annotateMode, setAnnotateMode] = useState(false);
  const [inkTool, setInkTool] = useState<ToolState>({
    kind: "pen", color: TEACHER_COLORS[0], width: 2.5, stamp: "⭐", fontSize: 14,
  });
  const [inkFingerDraw, setInkFingerDraw] = useState(false);
  const [annotationLayer, setAnnotationLayer] = useState<LayerData>(emptyLayer());
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedAnnotationPage = useRef<string | null>(null);

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
    const measure = () => setContainerWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [query.data]);

  const allPages = query.data?.pages ?? [];
  const livePages = useMemo(() => allPages.filter((p) => !p.archived), [allPages]);
  const page = livePages[Math.min(pageIdx, Math.max(0, livePages.length - 1))];
  const fields = useMemo(
    () => (query.data?.fields ?? []).filter((f) => page && f.page_id === page.id),
    [query.data?.fields, page],
  );

  const annotationRows = annotationsQuery.data?.annotations ?? [];
  const hasUnpublishedAnnotations = annotationRows.some((a) => a.unpublished);

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

  const handleAnnotationChange = (layer: LayerData) => {
    setAnnotationLayer(layer);
    if (!page) return;
    setSaveStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const pageId = page.id;
    saveTimer.current = setTimeout(() => {
      saveAnnotation.mutate({ pageId, data: serializeLayer(layer) });
    }, 1000);
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

  const scale = useMemo(() => {
    if (!page) return 1;
    const usable = Math.max(280, containerWidth - 48);
    return Math.min(1.8, usable / page.width) * zoom;
  }, [page, containerWidth, zoom]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["notebook", notebookId] });
    qc.invalidateQueries({ queryKey: ["notebook-assignments", notebookId] });
  };

  const createField = useMutation({
    mutationFn: (body: any) => api.post(`/api/notebooks/${notebookId}/fields`, body),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });
  const updateField = useMutation({
    mutationFn: ({ id, ...body }: any) => api.patch(`/api/notebooks/${notebookId}/fields/${id}`, body),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteField = useMutation({
    mutationFn: (id: string) => api.del(`/api/notebooks/${notebookId}/fields/${id}`),
    onSuccess: () => { setSelectedField(null); invalidate(); },
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

  const arrangePages = useMutation({
    mutationFn: (entries: ArrangeEntry[]) =>
      api.post(`/api/notebooks/${notebookId}/pages/arrange`, { pages: entries }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
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
    mutationFn: (body: { accentColor?: string; clearCover?: boolean }) =>
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
      await api.post(`/api/notebooks/${notebookId}/pages`, { assetKey, pages: sizes });
      toast.success(`Added ${sizes.length} page${sizes.length === 1 ? "" : "s"}`);
      invalidate();
    } catch (e) {
      toast.error((e as Error).message);
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

  const { notebook } = query.data;
  const archivedCount = allPages.filter((p) => p.archived).length;
  const assignments = assignmentsQuery.data?.assignments ?? [];

  /** Shared Pages/Assignments panel content — rendered both in the desktop
   * aside and the mobile drawer, so the two never drift out of sync. */
  const sidePanelBody = (isMobile: boolean) => (
    <>
      <div className="flex border-b-[3px] border-pine">
        {(["pages", "assignments"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setSidePanel(tab)}
            className={cn(
              "flex-1 px-3 py-2 text-xs font-display font-bold capitalize transition-colors",
              sidePanel === tab ? "border-b-[3px] -mb-[3px] border-pine text-pine" : "text-pine/50 hover:bg-oat",
            )}
          >
            {tab}
            {tab === "assignments" && assignments.length > 0 && (
              <span className="ml-1 rounded-full border-2 border-pine/20 bg-oat px-1.5 py-0.5 text-[10px] text-pine/70">
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
          onArrange={(entries) => arrangePages.mutate(entries)}
          onRenameGroup={(from, to) => {
            const ids = allPages.filter((p) => (p.group_name ?? "") === from).map((p) => p.id);
            if (ids.length) bulkPages.mutate({ pageIds: ids, action: "group", groupName: to });
          }}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {assignments.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-pine/60">
              No assignments use this notebook yet. Select pages, then choose “Create assignment”.
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
                    <div className="truncate text-xs font-bold text-pine">{a.title}</div>
                    <div className="mt-0.5 text-[10px] text-pine/70">
                      {a.pageCount} page{a.pageCount === 1 ? "" : "s"} · {formatDue(a.dueAt)}
                    </div>
                    <div className="mt-1 flex items-center gap-1">
                      <Chip tone={a.status === "active" ? "mint" : "quiet"} className="px-1.5 py-0.5 text-[10px]">
                        {a.status === "active" ? "Active" : "Draft"}
                      </Chip>
                      <span className="text-[10px] text-pine/70">{a.submitted}/{a.total} in</span>
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

  return (
    <div className="flex h-dvh flex-col bg-oat">
      <div className="h-1 shrink-0" style={{ backgroundColor: notebook.accentColor || "#20302C" }} />
      <header className="relative flex flex-wrap items-center gap-3 border-b-[3px] border-pine bg-white px-3 py-2">
        <IconButton label="Back" onClick={goBack}>
          <ArrowLeft className="h-4 w-4" strokeWidth={2.5} />
        </IconButton>
        <button
          type="button"
          onClick={() => setPagesDrawerOpen(true)}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border-[3px] border-pine px-3 py-2 text-xs font-display font-bold text-pine hover:bg-oat sm:hidden"
        >
          <PanelLeft className="h-4 w-4" strokeWidth={2.5} /> Pages
        </button>
        <div className="min-w-0 flex-1 sm:flex-initial">
          <div className="truncate font-display text-sm font-bold text-pine">{notebook.title}</div>
          <div className="text-xs text-pine/70">
            {livePages.length} page{livePages.length === 1 ? "" : "s"}
            {archivedCount > 0 && ` · ${archivedCount} archived`}
            {assignments.length > 0 && ` · ${assignments.length} assignment${assignments.length === 1 ? "" : "s"}`}
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Chip
            tone={notebook.status === "published" ? "mint" : "quiet"}
            icon={notebook.status === "published" ? <Check className="h-3 w-3" strokeWidth={2.5} /> : undefined}
          >
            {notebook.status === "published" ? "Published" : "Draft"}
          </Chip>
          <button
            type="button"
            onClick={() => setAppearanceOpen((v) => !v)}
            aria-expanded={appearanceOpen}
            className={cn(
              "inline-flex min-h-[44px] items-center gap-1.5 rounded-full border-[3px] px-3 py-2 text-sm font-display font-bold transition-colors",
              appearanceOpen ? "border-pine bg-oat text-pine" : "border-pine/20 text-pine hover:bg-oat",
            )}
          >
            <Palette className="h-4 w-4" strokeWidth={2.5} /> Appearance
          </button>
          <Button variant="secondary" onClick={() => addPagesRef.current?.click()} disabled={!!busyMessage}>
            <Plus className="h-4 w-4" strokeWidth={2.5} /> {busyMessage || "Add pages"}
          </Button>
          {hasUnpublishedAnnotations && (
            <span
              title="Students will see these annotations after you Update student notebooks."
              className="inline-flex items-center gap-1.5 rounded-full border-[3px] border-[#8a6a1f] bg-[#f7e6bf] px-2.5 py-1 text-xs font-bold text-[#5c4611]"
            >
              <Pen className="h-3 w-3" strokeWidth={2.5} /> Unpublished annotations
            </span>
          )}
          <Button variant="primary" onClick={() => publish.mutate()} disabled={publish.isPending}>
            <Send className="h-4 w-4" strokeWidth={2.5} />
            {notebook.status === "published" ? "Update student notebooks" : "Publish to students"}
          </Button>
        </div>
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
            accentColor={notebook.accentColor || "#1A73E8"}
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

      <div className="flex flex-wrap items-center gap-2 border-b-[3px] border-pine bg-white px-3 py-2">
        <span className="label-caps text-pine/60">Add field:</span>
        {([
          { k: "text", label: "Text box", icon: TypeIcon },
          { k: "checkbox", label: "Checkbox", icon: CheckSquare },
          { k: "choice", label: "Dropdown", icon: ListChecks },
          { k: "prompt", label: "Prompt", icon: MessageSquareText },
          { k: "image", label: "Image", icon: ImagePlus },
          { k: "audio", label: "Audio", icon: Mic },
        ] as const).map(({ k, label, icon: Icon }) => (
          <button
            key={k}
            onClick={() => { setAnnotateMode(false); setTool(tool === k ? "none" : k); }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border-2 px-3 py-1.5 text-xs font-bold transition-colors",
              tool === k ? "border-pine bg-mint text-pine" : "border-pine/20 text-pine/70 hover:bg-oat",
            )}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={2.5} /> {label}
          </button>
        ))}
        {tool !== "none" && <span className="text-xs text-pine/60">Drag on the page to place it</span>}

        <span className="mx-1 h-5 w-px bg-pine/20" aria-hidden />
        <button
          onClick={() => { setTool("none"); setAnnotateMode((v) => !v); }}
          aria-pressed={annotateMode}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border-2 px-3 py-1.5 text-xs font-bold transition-colors",
            annotateMode ? "border-pine bg-pine text-oat" : "border-pine/20 text-pine/70 hover:bg-oat",
          )}
        >
          <Pen className="h-3.5 w-3.5" strokeWidth={2.5} /> Annotate
        </button>

        <div className="ml-auto">
          <select
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="rounded-[12px] border-2 border-pine/20 px-1.5 py-1 text-xs text-pine"
            aria-label="Zoom"
          >
            {[0.5, 0.75, 1, 1.25, 1.5].map((z) => <option key={z} value={z}>{Math.round(z * 100)}%</option>)}
          </select>
        </div>
      </div>

      {annotateMode && (
        <div className="overflow-x-auto">
          <InkToolbar
            tool={inkTool}
            onToolChange={setInkTool}
            fingerDraw={inkFingerDraw}
            onFingerDrawChange={setInkFingerDraw}
            status={saveStatus}
            teacherPalette
            allowComments
            zoom={zoom}
            onZoomChange={(z) => setZoom(typeof z === "number" ? z : 1)}
          />
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-64 shrink-0 flex-col border-r-[3px] border-pine bg-white sm:flex">
          {sidePanelBody(false)}
        </aside>

        {pagesDrawerOpen && (
          <div className="fixed inset-0 z-40 flex sm:hidden">
            <div className="absolute inset-0 bg-pine/40" onClick={() => setPagesDrawerOpen(false)} aria-hidden />
            <div className="relative flex h-full w-[85vw] max-w-xs flex-col border-r-[3px] border-pine bg-white shadow-xl">
              <div className="flex items-center justify-between border-b-[3px] border-pine px-3 py-2">
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

        <div ref={containerRef} className="relative min-w-0 flex-1 overflow-auto bg-oat p-4">
          {!page ? (
            <div className="py-20 text-center text-sm text-pine/70">
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
                <span className="text-xs text-pine/70">
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
                    pdfUrl={assetUrl(notebookId, page.asset_key)}
                    sourceIndex={page.source_index}
                    pageWidth={page.width}
                    pageHeight={page.height}
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
                  />
                ) : (
                  <>
                    <PageCanvas
                      pdfUrl={assetUrl(notebookId, page.asset_key)}
                      sourceIndex={page.source_index}
                      pageWidth={page.width}
                      pageHeight={page.height}
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
                    />
                  </>
                )}
              </div>
            </div>
          )}

          {/* Floating action bar for the current page multi-selection. */}
          {selection.size > 0 && (
            <div className="sticky bottom-4 z-20 mx-auto flex w-fit max-w-full flex-wrap items-center gap-2 rounded-full border-[3px] border-pine bg-white px-3 py-2 shadow-[4px_4px_0_0_var(--color-pine)]">
              <span className="whitespace-nowrap text-xs font-bold text-pine">
                {selection.size} page{selection.size === 1 ? "" : "s"} selected
              </span>
              <button
                onClick={createAssignmentFromSelection}
                className="inline-flex items-center gap-1.5 rounded-full border-2 border-pine bg-white px-3 py-1.5 text-xs font-bold text-pine hover:bg-oat"
              >
                <ClipboardList className="h-3.5 w-3.5" strokeWidth={2.5} /> Create assignment
              </button>
              <button
                onClick={groupSelection}
                className="inline-flex items-center gap-1.5 rounded-full border-2 border-pine/20 px-3 py-1.5 text-xs font-bold text-pine hover:bg-oat"
              >
                <FolderPlus className="h-3.5 w-3.5" strokeWidth={2.5} /> Group
              </button>
              <button
                onClick={() => bulkPages.mutate({ pageIds: Array.from(selection), action: "archive" })}
                title="Hide from students but keep their work"
                className="inline-flex items-center gap-1.5 rounded-full border-2 border-pine/20 px-3 py-1.5 text-xs font-bold text-pine hover:bg-oat"
              >
                <EyeOff className="h-3.5 w-3.5" strokeWidth={2.5} /> Archive
              </button>
              <button
                onClick={() => confirmDelete(Array.from(selection))}
                title="Delete permanently, including student work"
                className="inline-flex items-center gap-1.5 rounded-full border-2 border-[#a3341f] px-3 py-1.5 text-xs font-bold text-[#a3341f] hover:bg-[#a3341f]/8"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={2.5} /> Delete
              </button>
              <button
                onClick={() => bulkPages.mutate({ pageIds: Array.from(selection), action: "restore" })}
                className="inline-flex items-center gap-1.5 rounded-full border-2 border-pine/20 px-3 py-1.5 text-xs font-bold text-pine hover:bg-oat"
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
            onSave={(patch) => updateField.mutate({ id: selectedField, ...patch })}
            onDelete={() => deleteField.mutate(selectedField)}
            onInvalidate={invalidate}
          />
        )}
      </div>
    </div>
  );
}

/** Small popover for customising the accent colour and cover image shown on the notebook's tile. */
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

  return (
    <div
      ref={popRef}
      className="absolute right-3 top-full z-30 mt-2 w-72 rounded-[22px] border-[3px] border-pine bg-white p-4 shadow-[6px_6px_0_0_var(--color-pine)]"
    >
      <h3 className="font-display text-sm font-bold text-pine">Appearance</h3>
      <p className="mt-1 text-xs leading-relaxed text-pine/70">
        The colour and cover image are how this notebook appears on its tile.
      </p>

      <div className="mt-3">
        <label className="label-caps block text-pine/70">Colour</label>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {ACCENT_SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Colour ${c}`}
              onClick={() => onSetAccent(c)}
              className={cn(
                "h-8 w-8 rounded-full border-2 transition-transform",
                accentColor.toLowerCase() === c.toLowerCase()
                  ? "border-pine scale-110"
                  : "border-white shadow-sm hover:scale-105",
              )}
              style={{ background: c }}
            />
          ))}
          <label
            className="relative flex h-8 w-8 items-center justify-center rounded-full border-2 border-dashed border-pine/40 text-pine/50 hover:border-pine"
            title="Custom colour"
          >
            <Palette className="h-3.5 w-3.5" strokeWidth={2.5} />
            <input
              type="color"
              value={accentColor}
              onChange={(e) => onSetAccent(e.target.value)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              aria-label="Custom colour"
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
              className="inline-flex items-center gap-1.5 rounded-full border-2 border-pine/20 px-2.5 py-1.5 text-xs font-bold text-pine hover:bg-oat disabled:opacity-50"
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" strokeWidth={2.5} />}
              {hasCover ? "Replace" : "Upload"}
            </button>
            {hasCover && (
              <button
                type="button"
                onClick={onClearCover}
                className="inline-flex items-center gap-1.5 rounded-full border-2 border-pine/20 px-2.5 py-1.5 text-xs text-pine/70 hover:bg-oat"
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
  pageWidth, pageHeight, scale, fields, tool, selected, onSelect, onCreate, onCommit,
}: {
  pageWidth: number;
  pageHeight: number;
  scale: number;
  fields: FieldRow[];
  tool: FieldTool;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (rect: { x: number; y: number; w: number; h: number }) => void;
  onCommit: (id: string, rect: { x: number; y: number; w: number; h: number }) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [drag, setDrag] = useState<
    { id: string; mode: "move" | "resize"; startX: number; startY: number; orig: FieldRow } | null
  >(null);
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
    if (tool === "none") { onSelect(null); return; }
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = toPage(e);
    start.current = p;
    setDraft({ x: p.x, y: p.y, w: 0, h: 0 });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (drag) {
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
              "absolute rounded border-2 bg-mint/20",
              isSelected ? "border-pine" : "border-pine/50 hover:border-pine",
            )}
            style={{ left: rect.x * scale, top: rect.y * scale, width: rect.w * scale, height: rect.h * scale, cursor: "move" }}
            onPointerDown={(e) => {
              if (tool !== "none") return;
              e.stopPropagation();
              e.preventDefault();
              (e.currentTarget.parentElement as HTMLElement).setPointerCapture(e.pointerId);
              onSelect(f.id);
              const p = toPage(e);
              setDrag({ id: f.id, mode: "move", startX: p.x, startY: p.y, orig: f });
            }}
          >
            <span className="pointer-events-none absolute -top-5 left-0 whitespace-nowrap rounded bg-pine px-1.5 py-0.5 text-[10px] font-bold text-oat">
              {f.type}{f.label ? ` · ${f.label}` : ""}
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
                setDrag({ id: f.id, mode: "resize", startX: p.x, startY: p.y, orig: f });
              }}
            />
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

function FieldInspector({
  field, notebookId, onClose, onSave, onDelete, onInvalidate,
}: {
  field?: FieldRow;
  notebookId: string;
  onClose: () => void;
  onSave: (patch: any) => void;
  onDelete: () => void;
  onInvalidate: () => void;
}) {
  const [label, setLabel] = useState(field?.label ?? "");
  const [options, setOptions] = useState<string>(() => {
    try { return (JSON.parse(field?.options || "[]") as string[]).join("\n"); } catch { return ""; }
  });
  const [prompt, setPrompt] = useState(field?.prompt ?? "");
  const [mediaBump, setMediaBump] = useState(0);
  const [mediaBusy, setMediaBusy] = useState(false);
  const mediaInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLabel(field?.label ?? "");
    setPrompt(field?.prompt ?? "");
    try { setOptions((JSON.parse(field?.options || "[]") as string[]).join("\n")); } catch { setOptions(""); }
  }, [field]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
        <h3 className="font-display text-sm font-bold text-pine">Field</h3>
        <button onClick={onClose} className="rounded p-1 text-pine/50 hover:bg-pine/8">
          <ChevronDown className="h-4 w-4" strokeWidth={2.5} />
        </button>
      </div>
      <p className="mt-1 text-xs capitalize text-pine/70">{field.type}</p>

      {field.type !== "image" && field.type !== "audio" && (
        <>
          <label className="label-caps mt-4 block text-pine/70">Label / placeholder</label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => onSave({ label })}
            className="mt-1 text-sm"
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
            onBlur={() => onSave({ options: options.split("\n").map((s) => s.trim()).filter(Boolean) })}
            rows={4}
            className="mt-1 text-sm"
          />
        </>
      )}

      {field.type === "prompt" && (
        <>
          <label className="label-caps mt-4 block text-pine/70">Instruction / prompt</label>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onBlur={() => onSave({ prompt })}
            rows={4}
            placeholder="e.g. Explain your reasoning in 2-3 sentences."
            className="mt-1 text-sm"
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
                  className="inline-flex items-center gap-1.5 rounded-full border-2 border-pine/20 px-2.5 py-1.5 text-xs font-bold text-pine hover:bg-oat disabled:opacity-50"
                >
                  {mediaBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" strokeWidth={2.5} />}
                  Replace
                </button>
                <button
                  type="button"
                  onClick={() => void removeMedia()}
                  disabled={mediaBusy}
                  className="inline-flex items-center gap-1.5 rounded-full border-2 border-pine/20 px-2.5 py-1.5 text-xs text-pine/70 hover:bg-oat disabled:opacity-50"
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
              className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border-2 border-pine/20 px-2.5 py-1.5 text-xs font-bold text-pine hover:bg-oat disabled:opacity-50"
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
        <p className="mt-4 rounded-[12px] border-2 border-pine/20 bg-oat px-2.5 py-2 text-[11px] leading-relaxed text-pine/70">
          Students will see an empty box here and can add their own picture. The box's shape is the
          crop area, so size it to the aspect ratio you want their photo to fit.
        </p>
      )}

      {field.type === "audio" && (
        <p className="mt-4 rounded-[12px] border-2 border-pine/20 bg-oat px-2.5 py-2 text-[11px] leading-relaxed text-pine/70">
          Students will see a record button here and can record a short answer in place.
        </p>
      )}

      <p className="mt-4 rounded-[12px] border-2 border-pine/20 bg-oat px-2.5 py-2 text-[11px] leading-relaxed text-pine/70">
        Moving or resizing a field keeps every answer students have already typed into it.
      </p>

      <button
        onClick={onDelete}
        className="mt-4 inline-flex w-full min-h-[44px] items-center justify-center gap-1.5 rounded-[12px] border-2 border-[#a3341f]/40 px-3 py-2 text-sm font-bold text-[#a3341f] hover:bg-[#a3341f]/8"
      >
        <Trash2 className="h-4 w-4" strokeWidth={2.5} /> Delete field
      </button>
    </>
  );

  return (
    <>
      <aside className="hidden w-64 shrink-0 border-l-[3px] border-pine bg-white p-4 sm:block">
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
