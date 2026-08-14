/**
 * The notebook's page organiser.
 *
 * Pages live in a single ordered list; a section is just a label shared by a run
 * of consecutive pages. Dragging therefore only ever does two things — move a
 * page to a new position, and adopt the section it was dropped into — which is
 * why reordering can never orphan student work: the page UUID, and everything
 * anchored to it, is untouched.
 *
 * Drag uses pointer events rather than HTML5 drag-and-drop, because HTML5 DnD
 * does not fire on iPad Safari at all and this list has to work on a tablet.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import {
  ChevronDown, ChevronRight, EyeOff, GripVertical, Pencil, RotateCcw, Trash2,
} from "lucide-react";
import PageThumb from "./PageThumb";
import { assetUrl, type PageRec } from "../lib/api";
import { cn } from "../lib/utils";

export interface ListPage extends PageRec {
  group_name?: string;
}

export interface ArrangeEntry {
  id: string;
  groupName: string;
}

interface Props {
  notebookId: string;
  pages: ListPage[];
  /** How many assignments reference each page. */
  assignmentCounts: Record<string, number>;
  currentPageId?: string;
  selection: Set<string>;
  onSelectionChange: (next: Set<string>) => void;
  onOpenPage: (pageId: string) => void;
  onRename: (pageId: string, label: string) => void;
  onArchiveToggle: (pageId: string, archived: boolean) => void;
  onDelete: (pageId: string) => void;
  onArrange: (entries: ArrangeEntry[]) => void;
  onRenameGroup: (from: string, to: string) => void;
}

interface Section {
  name: string;
  pages: ListPage[];
}

export default function NotebookPageList({
  notebookId, pages, assignmentCounts, currentPageId, selection,
  onSelectionChange, onOpenPage, onRename, onArchiveToggle, onDelete, onArrange, onRenameGroup,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; y: number } | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const listRef = useRef<HTMLDivElement>(null);

  const sections = useMemo<Section[]>(() => {
    const out: Section[] = [];
    for (const p of pages) {
      const name = p.group_name ?? "";
      const last = out[out.length - 1];
      if (last && last.name === name) last.pages.push(p);
      else out.push({ name, pages: [p] });
    }
    return out;
  }, [pages]);

  const toggleCollapsed = (name: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const toggleSelect = (id: string, shift: boolean) => {
    const next = new Set(selection);
    if (shift && selection.size > 0) {
      const order = pages.map((p) => p.id);
      const last = Array.from(selection)[selection.size - 1];
      const a = order.indexOf(last);
      const b = order.indexOf(id);
      if (a >= 0 && b >= 0) {
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(order[i]);
        onSelectionChange(next);
        return;
      }
    }
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  };

  /** Which gap in the flat list is the pointer currently over? */
  const computeDropIndex = useCallback((clientY: number) => {
    let index = pages.length;
    for (let i = 0; i < pages.length; i++) {
      const el = rowRefs.current[pages[i].id];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) { index = i; break; }
    }
    return index;
  }, [pages]);

  const startDrag = (e: React.PointerEvent, pageId: string) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id: pageId, y: e.clientY });
    setDropAt(computeDropIndex(e.clientY));
  };

  const moveDrag = (e: React.PointerEvent) => {
    if (!drag) return;
    e.preventDefault();
    setDrag({ ...drag, y: e.clientY });
    setDropAt(computeDropIndex(e.clientY));

    // Auto-scroll when dragging near the edges of the list.
    const el = listRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      if (e.clientY < rect.top + 40) el.scrollTop -= 8;
      else if (e.clientY > rect.bottom - 40) el.scrollTop += 8;
    }
  };

  const endDrag = (e: React.PointerEvent) => {
    if (!drag) return;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    const from = pages.findIndex((p) => p.id === drag.id);
    const target = dropAt ?? from;
    setDrag(null);
    setDropAt(null);
    if (from < 0 || target === from || target === from + 1) return;

    const next = pages.slice();
    const [moved] = next.splice(from, 1);
    next.splice(target > from ? target - 1 : target, 0, moved);

    // A page adopts the section of whatever it now sits beneath; landing at the
    // very top of the list means it joins whatever section starts there.
    const landedAt = next.findIndex((p) => p.id === moved.id);
    const neighbour = landedAt > 0 ? next[landedAt - 1] : next[landedAt + 1];
    const group = neighbour?.group_name ?? "";

    onArrange(next.map((p) => ({
      id: p.id,
      groupName: p.id === moved.id ? group : (p.group_name ?? ""),
    })));
  };

  let flatIndex = 0;

  return (
    <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-2" style={{ touchAction: drag ? "none" : "auto" }}>
      {sections.map((section, si) => {
        const isCollapsed = section.name !== "" && collapsed.has(section.name);
        const body = (
          <>
            {!isCollapsed && section.pages.map((p) => {
              const index = flatIndex++;
              const showDropLine = dropAt === index;
              const isDragging = drag?.id === p.id;
              const count = assignmentCounts[p.id] ?? 0;
              return (
                <div key={p.id}>
                  {showDropLine && <div className="mx-1 my-0.5 h-0.5 rounded bg-blue-500" />}
                  <div
                    ref={(node) => { rowRefs.current[p.id] = node; }}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey) toggleSelect(p.id, e.shiftKey);
                      else if (!p.archived) onOpenPage(p.id);
                    }}
                    className={cn(
                      "group mb-1 flex cursor-pointer items-start gap-1.5 rounded-lg p-1.5 transition-colors",
                      currentPageId === p.id && "bg-blue-50 ring-1 ring-blue-200",
                      selection.has(p.id) && "bg-blue-100/60",
                      isDragging && "opacity-40",
                      !isDragging && currentPageId !== p.id && !selection.has(p.id) && "hover:bg-slate-50",
                      p.archived && "opacity-50",
                    )}
                  >
                    <button
                      type="button"
                      aria-label="Drag to reorder"
                      onPointerDown={(e) => startDrag(e, p.id)}
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-6 cursor-grab touch-none rounded p-0.5 text-slate-300 hover:text-slate-600 active:cursor-grabbing"
                    >
                      <GripVertical className="h-4 w-4" />
                    </button>

                    <input
                      type="checkbox"
                      checked={selection.has(p.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const native = e.nativeEvent as unknown as { shiftKey?: boolean };
                        toggleSelect(p.id, !!native.shiftKey);
                      }}
                      className="mt-6 h-4 w-4 shrink-0 accent-blue-600"
                      aria-label={`Select page ${index + 1}`}
                    />

                    <div className="relative">
                      <PageThumb
                        pdfUrl={assetUrl(notebookId, p.asset_key)}
                        sourceIndex={p.source_index}
                        pageWidth={p.width}
                        pageHeight={p.height}
                        width={52}
                        dimmed={!!p.archived}
                      />
                      {count > 0 && (
                        <span
                          title={`Used in ${count} assignment${count === 1 ? "" : "s"}`}
                          className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[9px] font-semibold text-white ring-2 ring-white"
                        >
                          {count}
                        </span>
                      )}
                    </div>

                    <div className="min-w-0 flex-1 pt-0.5">
                      {renaming === p.id ? (
                        <input
                          autoFocus
                          defaultValue={p.label}
                          placeholder={`Page ${index + 1}`}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={(e) => { onRename(p.id, e.target.value.trim()); setRenaming(null); }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            if (e.key === "Escape") setRenaming(null);
                          }}
                          className="w-full rounded border border-blue-400 px-1 py-0.5 text-xs outline-none"
                        />
                      ) : (
                        <div className="truncate text-xs font-medium text-slate-700">
                          {p.label || `Page ${index + 1}`}
                        </div>
                      )}
                      <div className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-400">
                        <span>#{index + 1}</span>
                        {count > 0 && <span className="text-blue-600">· assigned</span>}
                        {!!p.archived && <span className="text-amber-600">· archived</span>}
                      </div>
                      <div className="mt-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <button
                          title="Rename page"
                          onClick={(e) => { e.stopPropagation(); setRenaming(p.id); }}
                          className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          title={p.archived ? "Restore page" : "Hide from students (keeps their work)"}
                          onClick={(e) => { e.stopPropagation(); onArchiveToggle(p.id, !p.archived); }}
                          className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700"
                        >
                          {p.archived ? <RotateCcw className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                        </button>
                        <button
                          title="Delete page permanently"
                          onClick={(e) => { e.stopPropagation(); onDelete(p.id); }}
                          className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {isCollapsed && (flatIndex += section.pages.length) >= 0 && (
              <button
                onClick={() => toggleCollapsed(section.name)}
                className="mb-1 w-full rounded-lg border border-dashed border-slate-200 py-2 text-[11px] text-slate-500 hover:bg-slate-50"
              >
                {section.pages.length} page{section.pages.length === 1 ? "" : "s"} hidden — show
              </button>
            )}
          </>
        );

        // Ungrouped runs render bare so the list doesn't look like a wall of cards.
        if (section.name === "") {
          return <div key={`plain-${si}`}>{body}</div>;
        }

        return (
          <div key={`${section.name}-${si}`} className="mb-2 rounded-xl border border-slate-200 bg-slate-50/60 p-1.5">
            <div className="mb-1 flex items-center gap-1 px-1">
              <button
                onClick={() => toggleCollapsed(section.name)}
                className="rounded p-0.5 text-slate-500 hover:bg-white"
                aria-label={isCollapsed ? "Expand section" : "Collapse section"}
              >
                {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
              {renaming === `group:${section.name}` ? (
                <input
                  autoFocus
                  defaultValue={section.name}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== section.name) onRenameGroup(section.name, v);
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  className="min-w-0 flex-1 rounded border border-blue-400 px-1 py-0.5 text-[11px] outline-none"
                />
              ) : (
                <button
                  onDoubleClick={() => setRenaming(`group:${section.name}`)}
                  onClick={() => toggleCollapsed(section.name)}
                  className="min-w-0 flex-1 truncate text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600"
                  title="Double-click to rename"
                >
                  {section.name}
                </button>
              )}
              <span className="text-[10px] text-slate-400">{section.pages.length}</span>
              <button
                onClick={() => setRenaming(`group:${section.name}`)}
                className="rounded p-0.5 text-slate-400 hover:bg-white hover:text-slate-700"
                title="Rename section"
              >
                <Pencil className="h-3 w-3" />
              </button>
            </div>
            {body}
          </div>
        );
      })}

      {/* Trailing drop zone so a page can be moved to the very end. */}
      {dropAt === pages.length && <div className="mx-1 h-0.5 rounded bg-blue-500" />}
    </div>
  );
}
