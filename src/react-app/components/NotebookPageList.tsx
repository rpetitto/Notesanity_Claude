/**
 * The notebook's page organizer.
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
import { pageSource, type PageRec } from "../lib/api";
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
  /** Which page the dragged one would land in front of; `null` means the end. */
  const [dropBefore, setDropBefore] = useState<{ id: string | null } | null>(null);
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

  /**
   * Which page would the dragged one land in front of?
   *
   * The dragged page is skipped, so the answer is a position in the list as it
   * will be *after* the move. Measuring against every row including the dragged
   * one meant its own height sat between it and its neighbour: nudging a page
   * one place down landed back where it started, and only a drag of more than a
   * full row registered at all.
   */
  const computeDropBefore = useCallback((clientY: number, draggingId: string) => {
    for (const page of pages) {
      if (page.id === draggingId) continue;
      const el = rowRefs.current[page.id];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return { id: page.id };
    }
    return { id: null };
  }, [pages]);

  const startDrag = (e: React.PointerEvent, pageId: string) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id: pageId, y: e.clientY });
    setDropBefore(computeDropBefore(e.clientY, pageId));
  };

  const moveDrag = (e: React.PointerEvent) => {
    if (!drag) return;
    e.preventDefault();
    setDrag({ ...drag, y: e.clientY });
    setDropBefore(computeDropBefore(e.clientY, drag.id));

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
    const moved = pages.find((p) => p.id === drag.id);
    const beforeId = dropBefore?.id ?? null;
    setDrag(null);
    setDropBefore(null);
    if (!moved) return;

    const next = pages.filter((p) => p.id !== moved.id);
    const at = beforeId ? next.findIndex((p) => p.id === beforeId) : next.length;
    next.splice(at < 0 ? next.length : at, 0, moved);
    // Nothing actually moved — don't churn the server or the list.
    if (next.every((p, i) => p.id === pages[i].id)) return;

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
              const showDropLine = dropBefore?.id === p.id;
              const isDragging = drag?.id === p.id;
              const count = assignmentCounts[p.id] ?? 0;
              return (
                <div key={p.id}>
                  {showDropLine && <div className="mx-1 my-0.5 h-0.5 rounded bg-mint" />}
                  <div
                    ref={(node) => { rowRefs.current[p.id] = node; }}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey) toggleSelect(p.id, e.shiftKey);
                      else if (!p.archived) onOpenPage(p.id);
                    }}
                    className={cn(
                      "group mb-1 flex cursor-pointer items-start gap-1.5 rounded-lg p-1.5 transition-colors",
                      currentPageId === p.id && "bg-mint/20 ring-1 ring-mint",
                      selection.has(p.id) && "bg-mint/30",
                      isDragging && "opacity-40",
                      !isDragging && currentPageId !== p.id && !selection.has(p.id) && "hover:bg-oat",
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
                      className="mt-6 cursor-grab touch-none rounded p-0.5 text-pine/35 hover:text-pine/75 active:cursor-grabbing"
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
                      className="mt-6 h-4 w-4 shrink-0 accent-pine"
                      aria-label={`Select page ${index + 1}`}
                    />

                    <div className="relative">
                      <PageThumb
                        {...pageSource(notebookId, p)}
                        width={52}
                        dimmed={!!p.archived}
                      />
                      {count > 0 && (
                        <span
                          title={`Used in ${count} assignment${count === 1 ? "" : "s"}`}
                          className="absolute -right-2 -top-2 flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-pine bg-mint px-1 font-display text-[13px] text-pine"
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
                          className="w-full rounded border border-pine px-1 py-0.5 text-[16px] outline-none"
                        />
                      ) : (
                        <div className="truncate text-[16px] font-medium text-pine">
                          {p.label || `Page ${index + 1}`}
                        </div>
                      )}
                      <div className="mt-0.5 flex items-center gap-1 text-[16px] text-pine/55">
                        <span>#{index + 1}</span>
                        {count > 0 && <span className="text-pine">· assigned</span>}
                        {!!p.archived && <span className="text-[#5c4611]">· archived</span>}
                      </div>
                      <div className="mt-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <button
                          title="Rename page"
                          onClick={(e) => { e.stopPropagation(); setRenaming(p.id); }}
                          className="rounded p-1 text-pine/55 hover:bg-white hover:text-pine"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          title={p.archived ? "Restore page" : "Hide from students (keeps their work)"}
                          onClick={(e) => { e.stopPropagation(); onArchiveToggle(p.id, !p.archived); }}
                          className="rounded p-1 text-pine/55 hover:bg-white hover:text-pine"
                        >
                          {p.archived ? <RotateCcw className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                        </button>
                        <button
                          title="Delete page permanently"
                          onClick={(e) => { e.stopPropagation(); onDelete(p.id); }}
                          className="rounded p-1 text-pine/55 hover:bg-[#fbe9e4] hover:text-[#a3341f]"
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
                className="mb-1 w-full rounded-lg border border-dashed border-pine/20 py-2 text-[16px] text-pine/70 hover:bg-oat"
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
          <div key={`${section.name}-${si}`} className="mb-2 rounded-xl border border-pine/20 bg-oat/60 p-1.5">
            <div className="mb-1 flex h-11 items-center gap-1 px-1">
              <button
                onClick={() => toggleCollapsed(section.name)}
                className="flex h-9 w-9 items-center justify-center rounded-full text-pine hover:bg-white"
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
                  className="min-w-0 flex-1 rounded border border-pine px-1 py-0.5 text-[16px] outline-none"
                />
              ) : (
                <button
                  onDoubleClick={() => setRenaming(`group:${section.name}`)}
                  onClick={() => toggleCollapsed(section.name)}
                  className="label-caps min-w-0 flex-1 truncate self-stretch text-left leading-[44px] text-pine/80"
                  title="Double-click to rename"
                >
                  {section.name}
                </button>
              )}
              <span className="text-[16px] text-pine/55">{section.pages.length}</span>
              <button
                onClick={() => setRenaming(`group:${section.name}`)}
                className="flex h-9 w-9 items-center justify-center rounded-full text-pine/70 hover:bg-white hover:text-pine"
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
      {drag && dropBefore?.id === null && <div className="mx-1 h-0.5 rounded bg-mint" />}
    </div>
  );
}
