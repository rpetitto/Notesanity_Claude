import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, CheckSquare, ChevronDown, ChevronLeft, ChevronRight, EyeOff, ListChecks,
  Plus, RotateCcw, Send, Trash2, Type as TypeIcon,
} from "lucide-react";
import { toast } from "sonner";
import { api, assetUrl, type FieldRec, type PageRec } from "../lib/api";
import { readPageSizes } from "../lib/pdf";
import { convertToPdf, needsConversion } from "../lib/google";
import PageCanvas from "../components/PageCanvas";
import { emptyLayer } from "../lib/ink";
import Shell, { ErrorNote, Spinner } from "../components/Shell";
import { cn } from "../lib/utils";

type FieldTool = "none" | "text" | "checkbox" | "choice";

interface NotebookResponse {
  notebook: { id: string; classId: string; title: string; status: string; pageCount: number; assetKey: string; lastPublishedAt: string | null };
  pages: PageRec[];
  fields: FieldRec[];
  isTeacher: boolean;
}

const MIN_FIELD = 8;

export default function NotebookEditor() {
  const { notebookId = "" } = useParams();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["notebook", notebookId],
    queryFn: () => api.get<NotebookResponse>(`/api/notebooks/${notebookId}?archived=1`),
    enabled: !!notebookId,
  });

  const [pageIdx, setPageIdx] = useState(0);
  const [tool, setTool] = useState<FieldTool>("none");
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const addPagesRef = useRef<HTMLInputElement>(null);
  const [busyMessage, setBusyMessage] = useState("");

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setContainerWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [query.data]);

  const livePages = useMemo(
    () => (query.data?.pages ?? []).filter((p) => !p.archived),
    [query.data?.pages],
  );
  const page = livePages[Math.min(pageIdx, Math.max(0, livePages.length - 1))];
  const fields = useMemo(
    () => (query.data?.fields ?? []).filter((f) => f.id && page && f.page_id === page.id),
    [query.data?.fields, page],
  );

  const scale = useMemo(() => {
    if (!page) return 1;
    const usable = Math.max(280, containerWidth - 48);
    return Math.min(1.8, usable / page.width) * zoom;
  }, [page, containerWidth, zoom]);

  const createField = useMutation({
    mutationFn: (body: any) => api.post(`/api/notebooks/${notebookId}/fields`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notebook", notebookId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const updateField = useMutation({
    mutationFn: ({ id, ...body }: any) => api.patch(`/api/notebooks/${notebookId}/fields/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notebook", notebookId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteField = useMutation({
    mutationFn: (id: string) => api.del(`/api/notebooks/${notebookId}/fields/${id}`),
    onSuccess: () => {
      setSelected(null);
      qc.invalidateQueries({ queryKey: ["notebook", notebookId] });
    },
  });

  const patchPage = useMutation({
    mutationFn: ({ id, ...body }: any) => api.patch(`/api/notebooks/${notebookId}/pages/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notebook", notebookId] }),
  });

  const publish = useMutation({
    mutationFn: () => api.post<{ provisioned: number; summary: any }>(`/api/notebooks/${notebookId}/publish`),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["notebook", notebookId] });
      const s = res.summary;
      toast.success(
        s
          ? `Students updated — ${s.pagesAdded} page(s) added, ${s.fieldsChanged} field(s) changed. Existing work untouched.`
          : `Published to ${res.provisioned} student${res.provisioned === 1 ? "" : "s"}.`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

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
      qc.invalidateQueries({ queryKey: ["notebook", notebookId] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyMessage("");
    }
  };

  if (query.isLoading) return <Spinner label="Loading notebook…" />;
  if (query.error) return <Shell><ErrorNote error={query.error as Error} /></Shell>;
  if (!query.data) return null;

  const { notebook } = query.data;
  const archivedCount = (query.data.pages ?? []).filter((p) => p.archived).length;

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-3 py-2">
        <Link to={`/classes/${notebook.classId}`} className="rounded-full p-2 text-slate-500 hover:bg-slate-100" aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{notebook.title}</div>
          <div className="text-xs text-slate-500">
            Template edit mode · {livePages.length} page{livePages.length === 1 ? "" : "s"}
            {archivedCount > 0 && ` · ${archivedCount} archived`}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className={cn(
            "rounded-full px-2.5 py-1 text-xs",
            notebook.status === "published" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600",
          )}>
            {notebook.status === "published" ? "Published" : "Draft"}
          </span>
          <button
            onClick={() => addPagesRef.current?.click()}
            disabled={!!busyMessage}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> {busyMessage || "Add pages"}
          </button>
          <button
            onClick={() => publish.mutate()}
            disabled={publish.isPending}
            className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            <Send className="h-4 w-4" />
            {notebook.status === "published" ? "Update student notebooks" : "Publish to students"}
          </button>
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
      </header>

      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <span className="text-xs font-medium text-slate-500">Add field:</span>
        {([
          { k: "text", label: "Text box", icon: TypeIcon },
          { k: "checkbox", label: "Checkbox", icon: CheckSquare },
          { k: "choice", label: "Dropdown", icon: ListChecks },
        ] as const).map(({ k, label, icon: Icon }) => (
          <button
            key={k}
            onClick={() => setTool(tool === k ? "none" : k)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors",
              tool === k ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50",
            )}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
        {tool !== "none" && (
          <span className="text-xs text-slate-500">Drag on the page to place it</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <select
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="rounded-md border border-slate-200 px-1.5 py-1 text-xs"
            aria-label="Zoom"
          >
            {[0.5, 0.75, 1, 1.25, 1.5].map((z) => <option key={z} value={z}>{Math.round(z * 100)}%</option>)}
          </select>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-44 shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-2 sm:block">
          {(query.data.pages ?? []).map((p, i) => {
            const liveIndex = livePages.findIndex((lp) => lp.id === p.id);
            return (
              <div
                key={p.id}
                className={cn(
                  "group mb-1 flex items-center gap-2 rounded-lg px-2 py-2 text-sm",
                  p.archived ? "opacity-50" : "cursor-pointer hover:bg-slate-100",
                  page?.id === p.id && "bg-blue-50 text-blue-700",
                )}
                onClick={() => { if (!p.archived && liveIndex >= 0) setPageIdx(liveIndex); }}
              >
                <span className="w-6 text-xs text-slate-400">{i + 1}</span>
                <span className="flex-1 truncate">{p.label || `Page ${i + 1}`}</span>
                <button
                  title={p.archived ? "Restore page" : "Archive page (student work is kept)"}
                  onClick={(e) => { e.stopPropagation(); patchPage.mutate({ id: p.id, archived: !p.archived }); }}
                  className="rounded p-1 text-slate-400 opacity-0 hover:bg-white hover:text-slate-700 group-hover:opacity-100"
                >
                  {p.archived ? <RotateCcw className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                </button>
              </div>
            );
          })}
        </aside>

        <div ref={containerRef} className="min-w-0 flex-1 overflow-auto bg-slate-100 p-4">
          {!page ? (
            <div className="py-20 text-center text-sm text-slate-500">
              Every page is archived. Restore one from the list to keep editing.
            </div>
          ) : (
            <div className="mx-auto" style={{ width: page.width * scale }}>
              <div className="mb-2 flex items-center justify-between">
                <button
                  onClick={() => setPageIdx((i) => Math.max(0, i - 1))}
                  disabled={pageIdx === 0}
                  className="rounded-full p-1.5 text-slate-500 hover:bg-white disabled:opacity-30"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-xs text-slate-500">
                  Page {pageIdx + 1} of {livePages.length}
                </span>
                <button
                  onClick={() => setPageIdx((i) => Math.min(livePages.length - 1, i + 1))}
                  disabled={pageIdx >= livePages.length - 1}
                  className="rounded-full p-1.5 text-slate-500 hover:bg-white disabled:opacity-30"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              <div className="relative">
                <PageCanvas
                  pdfUrl={assetUrl(notebookId, page.asset_key)}
                  sourceIndex={page.source_index}
                  pageWidth={page.width}
                  pageHeight={page.height}
                  scale={scale}
                  fields={[]}
                  fieldValues={{}}
                  studentLayer={emptyLayer()}
                  teacherLayer={emptyLayer()}
                  writeTarget={null}
                  tool={{ kind: "select", color: "#000", width: 2, stamp: "", fontSize: 14 }}
                  fingerDraw={false}
                  fieldsEditable={false}
                />
                <FieldLayer
                  key={page.id}
                  pageId={page.id}
                  pageWidth={page.width}
                  pageHeight={page.height}
                  scale={scale}
                  fields={fields}
                  tool={tool}
                  selected={selected}
                  onSelect={setSelected}
                  onCreate={(rect) => {
                    createField.mutate({
                      pageId: page.id,
                      type: tool === "none" ? "text" : tool,
                      ...rect,
                      label: "",
                      options: tool === "choice" ? ["Option A", "Option B"] : [],
                    });
                    setTool("none");
                  }}
                  onCommit={(id, rect) => updateField.mutate({ id, ...rect })}
                />
              </div>
            </div>
          )}
        </div>

        {selected && (
          <FieldInspector
            field={(query.data.fields ?? []).find((f) => f.id === selected)}
            onClose={() => setSelected(null)}
            onSave={(patch) => updateField.mutate({ id: selected, ...patch })}
            onDelete={() => deleteField.mutate(selected)}
          />
        )}
      </div>
    </div>
  );
}

/** Drag-to-create and drag-to-move overlay for form fields. */
function FieldLayer({
  pageId, pageWidth, pageHeight, scale, fields, tool, selected, onSelect, onCreate, onCommit,
}: {
  pageId: string;
  pageWidth: number;
  pageHeight: number;
  scale: number;
  fields: FieldRec[];
  tool: FieldTool;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (rect: { x: number; y: number; w: number; h: number }) => void;
  onCommit: (id: string, rect: { x: number; y: number; w: number; h: number }) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [drag, setDrag] = useState<
    { id: string; mode: "move" | "resize"; startX: number; startY: number; orig: FieldRec } | null
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
      // A quick tap places a sensibly-sized default rather than a zero-size field.
      const rect =
        draft.w < MIN_FIELD || draft.h < MIN_FIELD
          ? { x: draft.x, y: draft.y, w: tool === "checkbox" ? 18 : 160, h: tool === "checkbox" ? 18 : 28 }
          : draft;
      onCreate(rect);
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
              "absolute rounded border-2 bg-blue-100/30",
              isSelected ? "border-blue-600" : "border-blue-400/70 hover:border-blue-500",
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
            <span className="pointer-events-none absolute -top-5 left-0 whitespace-nowrap rounded bg-blue-600 px-1.5 py-0.5 text-[10px] text-white">
              {f.type}{f.label ? ` · ${f.label}` : ""}
            </span>
            <div
              className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-nwse-resize rounded-full border-2 border-white bg-blue-600"
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
          className="absolute rounded border-2 border-dashed border-blue-600 bg-blue-200/30"
          style={{ left: draft.x * scale, top: draft.y * scale, width: draft.w * scale, height: draft.h * scale }}
        />
      )}
      <span className="hidden">{pageId}</span>
    </div>
  );
}

function FieldInspector({
  field, onClose, onSave, onDelete,
}: {
  field?: FieldRec;
  onClose: () => void;
  onSave: (patch: any) => void;
  onDelete: () => void;
}) {
  const [label, setLabel] = useState(field?.label ?? "");
  const [options, setOptions] = useState<string>(() => {
    try { return (JSON.parse(field?.options || "[]") as string[]).join("\n"); } catch { return ""; }
  });

  useEffect(() => {
    setLabel(field?.label ?? "");
    try { setOptions((JSON.parse(field?.options || "[]") as string[]).join("\n")); } catch { setOptions(""); }
  }, [field]);

  if (!field) return null;

  return (
    <aside className="w-64 shrink-0 border-l border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Field</h3>
        <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100">
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-500 capitalize">{field.type}</p>

      <label className="mt-4 block text-xs font-medium text-slate-600">Label / placeholder</label>
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => onSave({ label })}
        className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
        placeholder="e.g. Your answer"
      />

      {field.type === "choice" && (
        <>
          <label className="mt-4 block text-xs font-medium text-slate-600">Options (one per line)</label>
          <textarea
            value={options}
            onChange={(e) => setOptions(e.target.value)}
            onBlur={() => onSave({ options: options.split("\n").map((s) => s.trim()).filter(Boolean) })}
            rows={4}
            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
          />
        </>
      )}

      <p className="mt-4 rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] leading-relaxed text-slate-500">
        Moving or resizing a field keeps every answer students have already typed into it.
      </p>

      <button
        onClick={onDelete}
        className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 text-sm text-rose-700 hover:bg-rose-50"
      >
        <Trash2 className="h-4 w-4" /> Delete field
      </button>
    </aside>
  );
}
