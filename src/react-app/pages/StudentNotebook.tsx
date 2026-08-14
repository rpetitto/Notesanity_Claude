/**
 * Teacher browsing one student's whole notebook — the un-scoped counterpart to
 * grading. Grading holds still on one assignment's pages and moves across the
 * roster; this page holds still on one student and lets the teacher read
 * (and annotate) everything they've done in the notebook.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, ImageOff, PanelLeft } from "lucide-react";
import { api, assetUrl, type WorkResponse } from "../lib/api";
import { useNotebookWork } from "../lib/useNotebookWork";
import { parseLayer } from "../lib/ink";
import { useSession } from "../lib/session";
import { useBackTo } from "../lib/useBackTo";
import NotebookSurface, { type ZoomMode, type LayerMap } from "../components/NotebookSurface";
import PageThumb from "../components/PageThumb";
import InkToolbar from "../components/InkToolbar";
import type { ToolState } from "../components/PageCanvas";
import Shell, { Avatar, EmptyState, ErrorNote, Spinner } from "../components/Shell";
import { cn, relativeTime } from "../lib/utils";

const RAIL_KEY = "notesanity:browseRail";

interface StudentNotebookCard {
  id: string;
  title: string;
  page_count: number;
  updated_at: string;
  accent_color: string | null;
  has_cover: number | boolean;
  first_asset_key: string | null;
  first_source_index: number | null;
  first_width: number | null;
  first_height: number | null;
  pages_worked: number;
  last_worked_at: string | null;
}

interface StudentNotebooksResponse {
  student: { id: string; name: string; email: string; picture?: string | null };
  notebooks: StudentNotebookCard[];
}

/** `/classes/:classId/students/:studentId` — grid of a student's published notebooks. */
export function StudentNotebookList() {
  const { classId = "", studentId = "" } = useParams();
  const goBack = useBackTo(`/classes/${classId}?tab=roster`);

  const query = useQuery({
    queryKey: ["student-notebooks", classId, studentId],
    queryFn: () =>
      api.get<StudentNotebooksResponse>(`/api/classes/${classId}/students/${studentId}/notebooks`),
    enabled: !!classId && !!studentId,
  });

  if (query.isLoading) return <Spinner label="Loading student…" />;
  if (query.error) return <Shell><ErrorNote error={query.error as Error} /></Shell>;
  if (!query.data) return null;

  const { student, notebooks } = query.data;

  return (
    <Shell>
      <button
        type="button"
        onClick={goBack}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" /> Back to roster
      </button>

      <div className="mb-6 flex items-center gap-3">
        <Avatar name={student.name} picture={student.picture} size={44} />
        <div>
          <h1 className="text-lg font-semibold">{student.name}</h1>
          <p className="text-sm text-slate-500">{student.email}</p>
        </div>
      </div>

      {notebooks.length === 0 ? (
        <EmptyState
          title="No published notebooks"
          body="Once you publish a notebook to this class, it will show up here for every student."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {notebooks.map((nb) => (
            <Link
              key={nb.id}
              to={`/classes/${classId}/students/${studentId}/notebooks/${nb.id}`}
              className="group overflow-hidden rounded-2xl border border-slate-200 bg-white transition-shadow hover:shadow-md"
            >
              <div
                className="h-1.5"
                style={{ backgroundColor: nb.accent_color || "#1A73E8" }}
              />
              <div className="flex h-32 items-center justify-center overflow-hidden bg-slate-50">
                {nb.has_cover ? (
                  <img
                    src={`/api/notebooks/${nb.id}/cover`}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : nb.first_asset_key && nb.first_width && nb.first_height ? (
                  <PageThumb
                    pdfUrl={assetUrl(nb.id, nb.first_asset_key)}
                    sourceIndex={nb.first_source_index ?? 0}
                    pageWidth={nb.first_width}
                    pageHeight={nb.first_height}
                    width={96}
                  />
                ) : (
                  <ImageOff className="h-6 w-6 text-slate-300" />
                )}
              </div>
              <div className="p-3">
                <div className="truncate text-sm font-medium text-slate-800 group-hover:text-blue-700">
                  {nb.title}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {nb.page_count} page{nb.page_count === 1 ? "" : "s"}
                </div>
                {nb.pages_worked > 0 && (
                  <div className="mt-1 text-[11px] text-slate-400">
                    {nb.pages_worked} page{nb.pages_worked === 1 ? "" : "s"} with work
                    {nb.last_worked_at && ` · ${relativeTime(nb.last_worked_at)}`}
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </Shell>
  );
}

/** `/classes/:classId/students/:studentId/notebooks/:notebookId` */
export default function StudentNotebook() {
  const { classId = "", studentId = "", notebookId = "" } = useParams();
  const { user } = useSession();
  const goBack = useBackTo(`/classes/${classId}?tab=roster`);

  const work = useQuery({
    queryKey: ["work", notebookId, studentId],
    queryFn: () =>
      api.get<WorkResponse>(`/api/notebooks/${notebookId}/work?student=${encodeURIComponent(studentId)}`),
    enabled: !!notebookId && !!studentId,
  });

  // Published teacher annotations on the template, shown beneath the student's work.
  const masterLayers = useMemo<LayerMap>(() => {
    const map: LayerMap = {};
    for (const a of (work.data as any)?.masterAnnotations ?? []) map[a.pageId] = parseLayer(a.data);
    return map;
  }, [work.data]);

  const notebookWork = useNotebookWork({
    notebookId,
    studentId,
    writeTarget: "teacher",
    data: work.data,
  });

  const [tool, setTool] = useState<ToolState>({
    kind: "pen", color: "#D93025", width: 2.5, stamp: "✅", fontSize: 14,
  });
  const [fingerDraw, setFingerDraw] = useState(false);
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

  const pages = useMemo(() => work.data?.pages ?? [], [work.data?.pages]);

  useEffect(() => {
    if (!visiblePage && pages[0]) setVisiblePage(pages[0].id);
  }, [pages, visiblePage]);

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

  if (work.isLoading) return <Spinner label="Loading notebook…" />;
  if (work.error) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <ErrorNote error={work.error as Error} />
        <button onClick={goBack} className="mt-4 text-sm text-blue-600 hover:underline">Go back</button>
      </div>
    );
  }
  if (!work.data) return null;

  const pageIndex = pages.findIndex((p) => p.id === visiblePage);
  const student = work.data.student;

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-3 py-2">
        <button type="button" onClick={goBack} className="rounded-full p-2 text-slate-500 hover:bg-slate-100" aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setRailOpen((v) => !v)}
          className="hidden rounded-full p-2 text-slate-500 hover:bg-slate-100 sm:inline-flex"
          aria-label={railOpen ? "Hide pages" : "Show pages"}
          aria-pressed={railOpen}
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setMobileRailOpen(true)}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 sm:hidden"
          aria-label="Show pages"
        >
          <PanelLeft className="h-4 w-4" /> Pages
        </button>
        <Avatar name={student.name} picture={student.picture} size={30} />
        <div className="min-w-0 flex-1 sm:flex-initial">
          <div className="truncate text-sm font-semibold">{student.name}</div>
          <div className="truncate text-xs text-slate-500">
            {work.data.notebook.title}
            {pages.length > 0 && ` · Page ${Math.max(1, pageIndex + 1)} of ${pages.length}`}
          </div>
        </div>
      </header>

      <div className="overflow-x-auto">
        <InkToolbar
          tool={tool}
          onToolChange={setTool}
          fingerDraw={fingerDraw}
          onFingerDrawChange={setFingerDraw}
          onUndo={() => visiblePage && notebookWork.undo(visiblePage)}
          onRedo={() => visiblePage && notebookWork.redo(visiblePage)}
          canUndo={!!visiblePage && notebookWork.canUndo(visiblePage)}
          canRedo={!!visiblePage && notebookWork.canRedo(visiblePage)}
          status={notebookWork.status}
          teacherPalette
          allowComments
          zoom={zoom}
          onZoomChange={setZoom}
        />
      </div>

      {mobileRailOpen && (
        <div className="fixed inset-0 z-40 flex sm:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMobileRailOpen(false)} aria-hidden />
          <aside className="relative flex h-full w-[200px] max-w-[85vw] flex-col overflow-y-auto border-r border-slate-200 bg-white px-2 py-3 shadow-xl">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-xs font-semibold text-slate-500">Pages</span>
              <button
                type="button"
                onClick={() => setMobileRailOpen(false)}
                className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100"
                aria-label="Close pages"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-col gap-3">
              {pages.map((page, i) => (
                <button
                  key={page.id}
                  type="button"
                  onClick={() => goToPage(page.id)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-lg p-1.5 text-left transition-colors",
                    visiblePage === page.id ? "bg-blue-50 ring-2 ring-blue-500" : "hover:bg-slate-100",
                  )}
                >
                  <PageThumb
                    pdfUrl={assetUrl(notebookId, page.asset_key)}
                    sourceIndex={page.source_index}
                    pageWidth={page.width}
                    pageHeight={page.height}
                    width={64}
                  />
                  <span className="w-full truncate text-center text-[11px] text-slate-600">
                    {i + 1}{page.label ? ` · ${page.label}` : ""}
                  </span>
                </button>
              ))}
            </div>
          </aside>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        {railOpen && (
          <aside className="hidden w-[104px] shrink-0 overflow-y-auto border-r border-slate-200 bg-white px-2 py-3 sm:block">
            <div className="flex flex-col gap-3">
              {pages.map((page, i) => (
                <button
                  key={page.id}
                  type="button"
                  onClick={() => goToPage(page.id)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-lg p-1.5 text-left transition-colors",
                    visiblePage === page.id ? "bg-blue-50 ring-2 ring-blue-500" : "hover:bg-slate-100",
                  )}
                >
                  <PageThumb
                    pdfUrl={assetUrl(notebookId, page.asset_key)}
                    sourceIndex={page.source_index}
                    pageWidth={page.width}
                    pageHeight={page.height}
                    width={64}
                  />
                  <span className="w-full truncate text-center text-[11px] text-slate-600">
                    {i + 1}{page.label ? ` · ${page.label}` : ""}
                  </span>
                </button>
              ))}
            </div>
          </aside>
        )}
        {!railOpen && (
          <button
            type="button"
            onClick={() => setRailOpen(true)}
            className="absolute bottom-6 left-3 z-20 hidden items-center gap-1 rounded-full border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 sm:flex"
            aria-label="Show pages"
          >
            <ChevronRight className="h-3.5 w-3.5" /> Pages
          </button>
        )}
        <div className="min-w-0 flex-1">
          <NotebookSurface
            notebookId={notebookId}
            pages={pages}
            fields={work.data.fields}
            studentLayers={notebookWork.studentLayers}
            teacherLayers={notebookWork.teacherLayers}
            masterLayers={masterLayers}
            studentId={studentId}
            fieldValues={notebookWork.fieldValues}
            writeTarget="teacher"
            tool={tool}
            fingerDraw={fingerDraw}
            zoom={zoom}
            authorName={user?.name}
            fieldsEditable={false}
            onLayerChange={notebookWork.setLayer}
            onFieldChange={() => {}}
            onVisiblePageChange={setVisiblePage}
            scrollRef={scrollRef}
          />
        </div>
      </div>
    </div>
  );
}
