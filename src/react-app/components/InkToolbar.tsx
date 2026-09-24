/**
 * The writing toolbar: the same row for students, teachers grading, and the
 * notebook editor.
 *
 * One row, never scrolling sideways, whatever tool is in hand. Getting there
 * took two decisions, both checked against published guidance (WAI-ARIA's
 * toolbar and menu-button patterns, WCAG 2.2, NN/g on icons and gestures):
 *
 *  - A tool's options (its colors, its sizes, the eraser's mode) live behind a
 *    ▾ button beside the tool in hand, not in the row. Inline, they made the
 *    row a different width for every tool, which is how a row ends up
 *    scrolling. Tapping the tool you already hold opens the same options —
 *    what GoodNotes and Notability teach — but the button is what makes it
 *    findable, and reachable from a keyboard.
 *  - Zoom and finger drawing go in a View menu; they're set once, not used
 *    constantly.
 *
 * The tools are a radio group inside a `role="toolbar"`: one Tab stop for the
 * row, arrow keys between controls, and a screen reader hears "Pen, radio
 * button, checked, 1 of 8". Each tool has its name under it where there's
 * room, because only a few icons are understood without words; below that the
 * name is its accessible name and tooltip. Each tool remembers its own color
 * and size, per person, across pages and sessions.
 *
 * On a phone the less-used tools (stamp, shapes, comment) move into More, so
 * the row fits at 320px — the width WCAG's reflow rule is tested at.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Eraser, Highlighter, MessageSquarePlus, MousePointer2, Pen, Smile, Trash2, Type, Redo2, Undo2,
  Shapes, Minus, ArrowUpRight, Square, Circle, ChevronDown, Check, Eye, MoreHorizontal,
} from "lucide-react";
import type { ToolState } from "./PageCanvas";
import { HIGHLIGHTER_COLORS, PEN_COLORS, STAMPS, TEACHER_COLORS, type ShapeKind, type ToolKind } from "../lib/ink";
import type { ZoomMode } from "./NotebookSurface";
import { cn } from "../lib/utils";
import type { SaveStatus } from "../lib/autosave";
import { type ContextEntry, openContextMenu, pointFor } from "./ContextMenu";

export interface ViewItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** An on/off setting, drawn with a check. */
  checked?: boolean;
}

interface Props {
  tool: ToolState;
  onToolChange: (t: ToolState) => void;
  fingerDraw: boolean;
  onFingerDrawChange: (v: boolean) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  status?: SaveStatus;
  teacherPalette?: boolean;
  /** Adds the pinned-comment tool (teachers responding to student work). */
  allowComments?: boolean;
  zoom: ZoomMode;
  onZoomChange: (z: ZoomMode) => void;
  /**
   * Wipe this page back to blank paper: ink, highlighter, typed notes, stamps
   * and every answer typed into a box. Absent where there is nothing to clear.
   */
  onClearPage?: () => void;
  /** Controls that lead the row — the editor's Add page and Add element. */
  leading?: ReactNode;
  /** The host's own entries at the top of the View menu: Preview, Present. */
  viewItems?: ViewItem[];
  /** Rendered at the row's end, after the save status. */
  trailing?: ReactNode;
}

type ToolDef = {
  kind: ToolKind;
  icon: typeof Pen;
  label: string;
  hint: string;
  /** Which palette its color comes from, if it has one. */
  palette?: "ink" | "highlight";
  /** On a phone, in the row (true) or under More (false). */
  phone: boolean;
};

const TOOLS: ToolDef[] = [
  { kind: "pen", icon: Pen, label: "Pen", hint: "Pen", palette: "ink", phone: true },
  { kind: "highlighter", icon: Highlighter, label: "Highlight", hint: "Highlighter", palette: "highlight", phone: true },
  { kind: "eraser", icon: Eraser, label: "Eraser", hint: "Eraser", phone: true },
  { kind: "text", icon: Type, label: "Text", hint: "Text — tap to type, drag to draw a box", palette: "ink", phone: true },
  { kind: "stamp", icon: Smile, label: "Stamp", hint: "Stamp", phone: false },
  { kind: "shape", icon: Shapes, label: "Shapes", hint: "Shapes — drag to draw a line, arrow, box or circle", palette: "ink", phone: false },
  { kind: "comment", icon: MessageSquarePlus, label: "Comment", hint: "Add a comment pinned to the page", phone: false },
  { kind: "select", icon: MousePointer2, label: "Select", hint: "Select — pick up and move your own writing; a finger scrolls", phone: true },
];

/** Every swatch has a name: a color is never the only way to tell one apart (WCAG 1.4.1). */
const COLOR_NAMES: Record<string, string> = {
  "#20302C": "Ink", "#2E7D6B": "Green", "#3F6C9E": "Blue", "#A3341F": "Red", "#7A5C8E": "Purple", "#D9A441": "Gold",
  "#7FD1AE": "Mint", "#F2D98D": "Yellow", "#9EC5E8": "Sky", "#E5B3C6": "Pink",
};
const colorName = (c: string) => COLOR_NAMES[c.toUpperCase()] ?? c;

const PEN_WIDTHS = [1.5, 2.5, 4, 7];
const HIGHLIGHT_WIDTHS = [8, 14, 22];
const TEXT_SIZES = [{ s: 12, label: "Small" }, { s: 14, label: "Medium" }, { s: 18, label: "Large" }, { s: 24, label: "Huge" }];
const SIZE_NAMES = ["Fine", "Medium", "Bold", "Marker"];

/** Drag-to-draw shapes. A line doubles as an underline or a strikethrough. */
const SHAPE_KINDS: { kind: ShapeKind; icon: typeof Pen; label: string }[] = [
  { kind: "line", icon: Minus, label: "Line" },
  { kind: "arrow", icon: ArrowUpRight, label: "Arrow" },
  { kind: "rect", icon: Square, label: "Box" },
  { kind: "ellipse", icon: Circle, label: "Circle" },
];

const ZOOM_OPTIONS: { value: string; label: string }[] = [
  { value: "page", label: "Fit page" },
  { value: "width", label: "Fit width" },
  { value: "0.75", label: "75%" },
  { value: "1", label: "100%" },
  { value: "1.25", label: "125%" },
  { value: "1.5", label: "150%" },
  { value: "2", label: "200%" },
];

const zoomLabel = (z: ZoomMode) =>
  ZOOM_OPTIONS.find((o) => o.value === String(z))?.label ?? (typeof z === "number" ? `${Math.round(z * 100)}%` : "Fit page");

type Memory = Partial<Record<ToolKind, { color?: string; width?: number; fontSize?: number }>>;

/** Each tool's last color and size, per person. Storage can be missing (a private window); then it's per visit. */
function useToolMemory(key: string) {
  const [memory, setMemory] = useState<Memory>(() => {
    try { return JSON.parse(localStorage.getItem(key) || "{}") as Memory; } catch { return {}; }
  });
  const remember = useCallback((kind: ToolKind, patch: { color?: string; width?: number; fontSize?: number }) => {
    setMemory((m) => {
      const next = { ...m, [kind]: { ...m[kind], ...patch } };
      try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }, [key]);
  return { memory, remember };
}

export default function InkToolbar({
  tool, onToolChange, fingerDraw, onFingerDrawChange,
  onUndo, onRedo, canUndo, canRedo, status, teacherPalette, allowComments, zoom, onZoomChange,
  onClearPage, leading, viewItems = [], trailing,
}: Props) {
  const optionsBtn = useRef<HTMLButtonElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const tools = TOOLS.filter((t) => t.kind !== "comment" || allowComments);
  const inkColors = teacherPalette ? TEACHER_COLORS : PEN_COLORS;
  const { memory, remember } = useToolMemory(`notesanity:tools:${teacherPalette ? "teacher" : "student"}`);
  /** Where the options panel hangs from: the ▾ beside the tool, or More on a phone. Null when closed. */
  const [optionsAnchor, setOptionsAnchor] = useState<HTMLElement | null>(null);
  const optionsOpen = optionsAnchor !== null;
  const setOptionsOpen = (open: boolean | ((o: boolean) => boolean)) => {
    const next = typeof open === "function" ? open(optionsOpen) : open;
    setOptionsAnchor(next ? optionsBtn.current ?? rowRef.current : null);
  };
  const [menuOpen, setMenuOpen] = useState<null | "view" | "more">(null);

  const def = TOOLS.find((t) => t.kind === tool.kind) ?? TOOLS[0];
  const hasOptions = (k: ToolKind) => k !== "select" && k !== "comment";

  /** What a tool's color is when it isn't the one in hand — its own memory, or its palette's first. */
  const colorOf = (t: ToolDef): string | undefined => {
    if (!t.palette) return undefined;
    if (t.kind === tool.kind) return tool.color;
    return memory[t.kind]?.color ?? (t.palette === "highlight" ? HIGHLIGHTER_COLORS[0] : inkColors[0]);
  };

  /** Pick a tool, bringing back what it had last time — a highlighter shouldn't inherit the pen's red. */
  const pick = (kind: ToolKind) => {
    if (kind === tool.kind) {
      if (hasOptions(kind)) setOptionsOpen((o) => !o);
      return;
    }
    const t = TOOLS.find((x) => x.kind === kind)!;
    const m = memory[kind] ?? {};
    const palette = t.palette === "highlight" ? HIGHLIGHTER_COLORS : inkColors;
    const color = t.palette ? (m.color && palette.includes(m.color) ? m.color : palette[0]) : tool.color;
    const widths = kind === "highlighter" ? HIGHLIGHT_WIDTHS : PEN_WIDTHS;
    const width = m.width && widths.includes(m.width) ? m.width : kind === "highlighter" ? 14 : kind === "eraser" ? 7 : 2.5;
    setOptionsAnchor(null);
    // A new tool opens its options straight away, once its ▾ exists to hang them from.
    openOnPick.current = hasOptions(kind);
    onToolChange({ ...tool, kind, color, width, fontSize: kind === "text" ? m.fontSize ?? 14 : tool.fontSize });
  };
  const openOnPick = useRef(false);
  useLayoutEffect(() => {
    if (!openOnPick.current) return;
    openOnPick.current = false;
    // A tool from the phone's More menu has no ▾ on screen: hang the panel from More instead.
    const btn = optionsBtn.current?.offsetParent ? optionsBtn.current : moreBtn.current;
    setOptionsAnchor(btn ?? rowRef.current);
  }, [tool.kind]);

  const setOption = (patch: Partial<ToolState>) => {
    onToolChange({ ...tool, ...patch });
    remember(tool.kind, {
      ...(patch.color ? { color: patch.color } : {}),
      ...(patch.width ? { width: patch.width } : {}),
      ...(patch.fontSize ? { fontSize: patch.fontSize } : {}),
    });
  };

  // ---- one Tab stop for the row: roving tabindex over its controls ----
  const items = () =>
    Array.from(rowRef.current?.querySelectorAll<HTMLElement>("[data-tb]") ?? []).filter((el) => el.offsetParent !== null && !(el as HTMLButtonElement).disabled);
  const lastFocused = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const list = items();
    const current = (lastFocused.current && list.includes(lastFocused.current))
      ? lastFocused.current
      : list.find((el) => el.getAttribute("aria-checked") === "true") ?? list[0];
    // Every control, shown or not, leaves the Tab order except the one stop.
    for (const el of rowRef.current?.querySelectorAll<HTMLElement>("[data-tb]") ?? []) el.tabIndex = el === current ? 0 : -1;
  });
  const onRowKey = (e: React.KeyboardEvent) => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(e.key)) return;
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? list.length - 1
      : (at + (e.key === "ArrowRight" ? 1 : -1) + list.length) % list.length;
    list[next].focus();
  };

  const zoomEntries = (): ContextEntry[] => [
    { kind: "heading", text: "Zoom" },
    ...ZOOM_OPTIONS.map((o) => ({
      kind: "radio" as const, group: "zoom", label: o.label, checked: String(zoom) === o.value,
      onSelect: () => onZoomChange(o.value === "page" || o.value === "width" ? o.value : Number(o.value)),
    })),
  ];
  const fingerEntry: ContextEntry = {
    label: "Draw with my finger", checked: fingerDraw, onSelect: () => onFingerDrawChange(!fingerDraw),
    hint: fingerDraw ? "A finger draws; use two fingers to scroll" : "A finger scrolls; a stylus draws",
  };

  const openView = (btn: HTMLElement) => {
    setMenuOpen("view");
    openContextMenu({
      ...pointFor(btn), title: "View", onClose: () => setMenuOpen(null),
      entries: [
        ...viewItems.map((v) => ({ label: v.label, icon: v.icon, onSelect: v.onSelect, disabled: v.disabled, checked: v.checked })),
        ...(viewItems.length ? [{ kind: "separator" as const }] : []),
        fingerEntry,
        { kind: "separator" },
        ...zoomEntries(),
      ],
    });
  };

  /** Phones: the tools that didn't fit, Redo, and the View menu, in one place. */
  const openMore = (btn: HTMLElement) => {
    setMenuOpen("more");
    const hidden = tools.filter((t) => !t.phone);
    const activeHidden = hidden.find((t) => t.kind === tool.kind && hasOptions(t.kind));
    openContextMenu({
      ...pointFor(btn), title: "More", onClose: () => setMenuOpen(null),
      entries: [
        ...hidden.map((t) => ({ label: t.label, icon: <t.icon />, checked: tool.kind === t.kind, onSelect: () => pick(t.kind) })),
        // A tool that lives here has its ▾ here too, or its options would be out of reach.
        ...(activeHidden ? [{ label: `${activeHidden.label} options`, icon: <ChevronDown />, onSelect: () => setOptionsAnchor(moreBtn.current) }] : []),
        { kind: "separator" },
        { label: "Redo", icon: <Redo2 />, disabled: !canRedo, onSelect: () => onRedo?.() },
        ...viewItems.map((v) => ({ label: v.label, icon: v.icon, onSelect: v.onSelect, disabled: v.disabled, checked: v.checked })),
        { kind: "separator" },
        fingerEntry,
        { kind: "separator" },
        ...zoomEntries(),
      ],
    });
  };

  return (
    <div
      ref={rowRef}
      role="toolbar"
      aria-label="Page tools"
      onKeyDown={onRowKey}
      onFocus={(e) => { if ((e.target as HTMLElement).dataset.tb !== undefined) lastFocused.current = e.target as HTMLElement; }}
      className="flex flex-nowrap items-center gap-1.5 border-b border-pine/20 bg-white/95 px-1.5 py-1.5 backdrop-blur min-[380px]:px-2 sm:gap-2 sm:px-3"
      style={{ touchAction: "manipulation" }}
    >
      {leading && <div className="hidden shrink-0 items-center gap-2 md:flex">{leading}</div>}
      {leading && <span className="hidden h-8 w-0.5 shrink-0 rounded-full bg-pine/15 md:block" aria-hidden />}

      <div role="radiogroup" aria-label="Writing tool" data-tour="ink-tools" className="flex shrink-0 items-center gap-0.5 rounded-[14px] bg-oat p-[3px]">
        {tools.map((t) => {
          const on = t.kind === tool.kind;
          const color = colorOf(t);
          return (
            <span key={t.kind} className={cn("items-center", t.phone ? "flex" : "hidden sm:flex")}>
              <button
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={t.label === "Highlight" ? "Highlighter" : t.label}
                title={t.hint}
                data-tb=""
                onClick={() => pick(t.kind)}
                className={cn(
                  "relative flex flex-col items-center justify-center gap-px rounded-[12px] font-display text-[12px] font-bold leading-none outline-none transition-colors",
                  "h-11 w-10 min-[380px]:w-11 lg:h-[54px] lg:w-auto lg:min-w-[54px] lg:px-1",
                  "focus-visible:ring-[3px] focus-visible:ring-mint",
                  on ? "bg-white text-pine shadow-[inset_0_0_0_2px_var(--color-pine)]" : "text-pine/70 hover:bg-white/60 hover:text-pine",
                )}
              >
                <t.icon className="h-[18px] w-[18px]" strokeWidth={on ? 2.5 : 2} aria-hidden />
                {/* The color in the tool, outlined so a pale one still shows (WCAG 1.4.11). */}
                <span
                  aria-hidden
                  className={cn("mt-0.5 h-[5px] w-4 rounded-full", color ? "shadow-[0_0_0_1.5px_var(--color-pine)]" : "opacity-0")}
                  style={color ? { background: color } : undefined}
                />
                <span className="hidden lg:block">{t.label}</span>
              </button>
              {on && hasOptions(t.kind) && (
                <button
                  ref={optionsBtn}
                  type="button"
                  aria-label={`${t.label === "Highlight" ? "Highlighter" : t.label} options`}
                  aria-haspopup="dialog"
                  aria-expanded={optionsOpen}
                  aria-controls="ink-tool-options"
                  title={`${t.label} options`}
                  data-tb=""
                  onClick={() => setOptionsOpen((o) => !o)}
                  className={cn(
                    "ml-px flex h-11 w-6 items-center justify-center rounded-[10px] border-2 border-pine outline-none lg:h-[54px] lg:w-[26px]",
                    "focus-visible:ring-[3px] focus-visible:ring-mint",
                    optionsOpen ? "bg-pine text-oat" : "bg-mint text-pine hover:bg-mint/80",
                  )}
                >
                  <ChevronDown className="h-4 w-4" strokeWidth={2.75} aria-hidden />
                </button>
              )}
            </span>
          );
        })}
      </div>

      <span className="hidden h-8 w-0.5 shrink-0 rounded-full bg-pine/15 sm:block" aria-hidden />

      <div className="flex shrink-0 items-center">
        <button type="button" data-tb="" onClick={onUndo} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)"
          className="flex h-11 w-10 items-center justify-center rounded-full text-pine outline-none hover:bg-oat focus-visible:ring-[3px] focus-visible:ring-mint disabled:opacity-30 min-[380px]:w-11">
          <Undo2 className="h-[18px] w-[18px]" strokeWidth={2.5} />
        </button>
        <button type="button" data-tb="" onClick={onRedo} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)"
          className="hidden h-11 w-11 items-center justify-center rounded-full text-pine outline-none hover:bg-oat focus-visible:ring-[3px] focus-visible:ring-mint disabled:opacity-30 sm:flex">
          <Redo2 className="h-[18px] w-[18px]" strokeWidth={2.5} />
        </button>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {status && <span className="hidden lg:block"><SaveIndicator status={status} /></span>}
        <button
          type="button"
          data-tb=""
          data-tour="finger-draw"
          aria-haspopup="menu"
          aria-expanded={menuOpen === "view"}
          onClick={(e) => openView(e.currentTarget)}
          onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); openView(e.currentTarget); } }}
          title="View: zoom, finger drawing, and more"
          className="hidden h-11 shrink-0 items-center gap-1.5 rounded-full border-2 border-pine/25 px-3 font-display text-[16px] font-bold text-pine outline-none hover:bg-oat focus-visible:ring-[3px] focus-visible:ring-mint sm:inline-flex"
        >
          <Eye className="h-[18px] w-[18px]" strokeWidth={2.5} aria-hidden />
          <span className="hidden lg:inline">View</span>
          <span className="hidden text-pine/60 xl:inline">· {zoomLabel(zoom)}</span>
          <ChevronDown className="h-4 w-4" strokeWidth={2.5} aria-hidden />
        </button>
        <button
          ref={moreBtn}
          type="button"
          data-tb=""
          aria-label={tools.some((t) => !t.phone && t.kind === tool.kind) ? `More tools and view (${def.label} in hand)` : "More tools and view"}
          aria-haspopup="menu"
          aria-expanded={menuOpen === "more"}
          onClick={(e) => openMore(e.currentTarget)}
          onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); openMore(e.currentTarget); } }}
          className={cn(
            "flex h-11 w-10 items-center justify-center rounded-full text-pine outline-none hover:bg-oat focus-visible:ring-[3px] focus-visible:ring-mint min-[380px]:w-11 sm:hidden",
            tools.some((t) => !t.phone && t.kind === tool.kind) && "bg-white shadow-[inset_0_0_0_2px_var(--color-pine)]",
          )}
        >
          {tools.some((t) => !t.phone && t.kind === tool.kind) ? <def.icon className="h-5 w-5" strokeWidth={2.5} /> : <MoreHorizontal className="h-5 w-5" strokeWidth={2.5} />}
        </button>
        {trailing}
      </div>

      {optionsOpen && hasOptions(tool.kind) && (
        <ToolOptions
          anchor={optionsAnchor}
          label={def.label === "Highlight" ? "Highlighter" : def.label}
          tool={tool}
          inkColors={inkColors}
          fingerDraw={fingerDraw}
          onFingerDrawChange={onFingerDrawChange}
          onChange={setOption}
          onClearPage={onClearPage}
          onClose={(refocus) => { const a = optionsAnchor; setOptionsAnchor(null); if (refocus) a?.focus(); }}
        />
      )}
    </div>
  );
}

/**
 * A tool's options, as a non-modal dialog under its ▾ button.
 *
 * Opens downward so neither hand covers it. Colors and sizes are each a radio
 * group; the chosen swatch carries a check, not just a ring. Clear page is
 * last, set apart and in the warning red, because it's the one thing here that
 * isn't undone stroke by stroke. Escape closes it and puts focus back on ▾.
 */
function ToolOptions({
  anchor, label, tool, inkColors, fingerDraw, onFingerDrawChange, onChange, onClearPage, onClose,
}: {
  anchor: HTMLElement | null;
  label: string;
  tool: ToolState;
  inkColors: string[];
  fingerDraw: boolean;
  onFingerDrawChange: (v: boolean) => void;
  onChange: (patch: Partial<ToolState>) => void;
  onClearPage?: () => void;
  onClose: (refocus: boolean) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const r = anchor?.getBoundingClientRect();
    const w = panel.current?.offsetWidth ?? 320;
    if (!r) return;
    setPos({ left: Math.max(8, Math.min(r.left - 40, window.innerWidth - w - 8)), top: r.bottom + 8 });
  }, [anchor]);

  // The latest onClose, without re-running the effect below every render —
  // which would pull focus back into the panel on each one.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('[aria-checked="true"], button')?.focus({ preventScroll: true });
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchor?.contains(t)) return;
      // A press on the tool itself toggles the panel from there.
      if ((t as HTMLElement).closest?.('[role="radio"][aria-checked="true"]')) return;
      closeRef.current(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); closeRef.current(true); } };
    const onResize = () => closeRef.current(false);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onResize);
    };
  }, [anchor]);

  const colors = tool.kind === "highlighter" ? HIGHLIGHTER_COLORS
    : tool.kind === "pen" || tool.kind === "text" || tool.kind === "shape" ? inkColors : null;
  const widths = tool.kind === "highlighter" ? HIGHLIGHT_WIDTHS
    : tool.kind === "pen" || tool.kind === "shape" || tool.kind === "eraser" ? PEN_WIDTHS : null;
  const draws = tool.kind === "pen" || tool.kind === "highlighter" || tool.kind === "eraser" || tool.kind === "shape";

  /** Arrow keys inside one radio group of the panel. */
  const groupKeys = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    const radios = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'));
    const at = radios.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    e.preventDefault();
    e.stopPropagation();
    const next = radios[(at + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1) + radios.length) % radios.length];
    next.focus();
    next.click();
  };

  const heading = "mb-1.5 font-display text-[14px] font-bold uppercase tracking-[0.06em] text-pine/55";

  return createPortal(
    <div
      ref={panel}
      id="ink-tool-options"
      role="dialog"
      aria-label={`${label} options`}
      className="fixed z-[65] grid w-[min(340px,calc(100vw-16px))] gap-4 rounded-[16px] border-[3px] border-pine bg-white p-4 shadow-[4px_4px_0_0_var(--color-pine)]"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? 0 }}
    >
      {colors && (
        <div>
          <p className={heading} id="opt-color">Color</p>
          <div role="radiogroup" aria-labelledby="opt-color" onKeyDown={groupKeys} className="flex flex-wrap gap-2">
            {colors.map((c) => {
              const on = tool.color.toUpperCase() === c.toUpperCase();
              return (
                <button key={c} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} aria-label={colorName(c)}
                  onClick={() => onChange({ color: c })}
                  className="flex w-11 flex-col items-center gap-0.5 rounded-lg text-[13px] text-pine/70 outline-none focus-visible:ring-[3px] focus-visible:ring-mint">
                  <span className={cn("flex h-9 w-9 items-center justify-center rounded-full shadow-[0_0_0_2px_var(--color-pine)]", on && "shadow-[0_0_0_2px_#fff,0_0_0_5px_var(--color-pine)]")}
                    style={{ background: c }}>
                    {on && <Check className="h-5 w-5" strokeWidth={3} style={{ color: tool.kind === "highlighter" ? "#20302C" : "#fff" }} aria-hidden />}
                  </span>
                  {colorName(c)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {widths && (
        <div>
          <p className={heading} id="opt-size">Size</p>
          <div role="radiogroup" aria-labelledby="opt-size" onKeyDown={groupKeys} className="flex gap-1.5">
            {widths.map((w, i) => {
              const on = tool.width === w;
              const name = tool.kind === "highlighter" ? ["Thin", "Medium", "Wide"][i] : SIZE_NAMES[i];
              return (
                <button key={w} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} aria-label={name} title={name}
                  onClick={() => onChange({ width: w })}
                  className={cn("flex h-11 w-11 items-center justify-center rounded-[10px] outline-none focus-visible:ring-[3px] focus-visible:ring-mint",
                    on ? "bg-pine/12 shadow-[inset_0_0_0_2px_var(--color-pine)]" : "hover:bg-oat")}>
                  <span className="rounded-full bg-pine" style={{ width: Math.min(22, Math.max(4, w * (tool.kind === "highlighter" ? 1 : 1.6))), height: Math.min(22, Math.max(4, w * (tool.kind === "highlighter" ? 1 : 1.6))) }} />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {tool.kind === "text" && (
        <div>
          <p className={heading} id="opt-textsize">Text size</p>
          <div role="radiogroup" aria-labelledby="opt-textsize" onKeyDown={groupKeys} className="flex flex-wrap gap-1.5">
            {TEXT_SIZES.map(({ s, label: name }) => {
              const on = tool.fontSize === s;
              return (
                <button key={s} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1}
                  onClick={() => onChange({ fontSize: s })}
                  className={cn("h-11 rounded-full px-3 font-display font-bold outline-none focus-visible:ring-[3px] focus-visible:ring-mint",
                    on ? "bg-pine text-oat" : "text-pine hover:bg-oat")}
                  style={{ fontSize: Math.min(20, s + 2) }}>
                  {name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {tool.kind === "shape" && (
        <div>
          <p className={heading} id="opt-shape">Shape</p>
          <div role="radiogroup" aria-labelledby="opt-shape" onKeyDown={groupKeys} className="flex gap-1.5">
            {SHAPE_KINDS.map(({ kind, icon: Icon, label: name }) => {
              const on = (tool.shape ?? "line") === kind;
              return (
                <button key={kind} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} aria-label={name} title={name}
                  onClick={() => onChange({ shape: kind })}
                  className={cn("flex h-11 w-11 flex-col items-center justify-center rounded-[10px] text-[11px] font-bold outline-none focus-visible:ring-[3px] focus-visible:ring-mint",
                    on ? "bg-pine/12 shadow-[inset_0_0_0_2px_var(--color-pine)]" : "hover:bg-oat")}>
                  <Icon className="h-4 w-4" strokeWidth={2.5} aria-hidden />{name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {tool.kind === "stamp" && (
        <div>
          <p className={heading} id="opt-stamp">Stamp</p>
          <div role="radiogroup" aria-labelledby="opt-stamp" onKeyDown={groupKeys} className="grid grid-cols-6 gap-1">
            {STAMPS.map((st) => {
              const on = tool.stamp === st;
              return (
                <button key={st} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1}
                  onClick={() => onChange({ stamp: st })}
                  className={cn("flex h-11 w-11 items-center justify-center rounded-[10px] text-[22px] outline-none focus-visible:ring-[3px] focus-visible:ring-mint",
                    on ? "bg-mint/40 shadow-[inset_0_0_0_2px_var(--color-pine)]" : "hover:bg-oat")}>
                  {st}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {tool.kind === "eraser" && (
        <div>
          <p className={heading} id="opt-erase">Erases</p>
          <div role="radiogroup" aria-labelledby="opt-erase" onKeyDown={groupKeys} className="grid gap-1.5">
            {([
              { mode: "quick", name: "Whole strokes", hint: "Touch a stroke to remove all of it" },
              { mode: "manual", name: "Part of a stroke", hint: "Erases only where you drag" },
            ] as const).map((o) => {
              const on = (tool.erase ?? "quick") === o.mode;
              return (
                <button key={o.mode} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1}
                  onClick={() => onChange({ erase: o.mode })}
                  className={cn("flex min-h-[44px] items-center gap-2.5 rounded-[12px] px-3 py-1.5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-mint",
                    on ? "bg-pine/10" : "hover:bg-oat")}>
                  <span aria-hidden className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-pine", on && "after:h-2.5 after:w-2.5 after:rounded-full after:bg-pine after:content-['']")} />
                  <span><span className="block font-display font-bold text-pine">{o.name}</span><span className="block text-[14px] leading-snug text-pine/60">{o.hint}</span></span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {draws && (
        <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 border-t-2 border-pine/10 pt-3">
          <span>
            <span className="block font-display font-bold text-pine">Draw with my finger</span>
            <span className="block text-[14px] leading-snug text-pine/60">{fingerDraw ? "On — use two fingers to scroll" : "Off — a finger scrolls, a stylus draws"}</span>
          </span>
          <input type="checkbox" role="switch" checked={fingerDraw} onChange={(e) => onFingerDrawChange(e.target.checked)}
            className="h-6 w-6 shrink-0 accent-pine" />
        </label>
      )}

      {tool.kind === "eraser" && onClearPage && (
        <button type="button" onClick={() => { onClose(false); onClearPage(); }}
          className="flex min-h-[44px] items-center justify-center gap-2 rounded-full border-2 border-[#a3341f] font-display font-bold text-[#a3341f] outline-none hover:bg-[#a3341f]/8 focus-visible:ring-[3px] focus-visible:ring-mint">
          <Trash2 className="h-4 w-4" strokeWidth={2.5} aria-hidden /> Clear this page
        </button>
      )}
    </div>,
    document.body,
  );
}

export function SaveIndicator({ status }: { status: SaveStatus }) {
  const map: Record<SaveStatus, { label: string; className: string }> = {
    idle: { label: "", className: "" },
    saving: { label: "Saving…", className: "text-pine/70" },
    saved: { label: "Saved", className: "text-pine" },
    offline: { label: "Offline — retrying", className: "text-[#5c4611]" },
    retrying: { label: "Couldn't save — retrying", className: "text-[#5c4611]" },
  };
  const s = map[status];
  if (!s.label) return null;
  return (
    <span className={cn("flex items-center gap-1.5 text-[16px] whitespace-nowrap", s.className)}>
      <span className={cn(
        "h-1.5 w-1.5 rounded-full",
        status === "saved" ? "bg-mint"
          : status === "offline" || status === "retrying" ? "bg-[#8a6a1f] animate-pulse"
          : "bg-pine/50 animate-pulse",
      )} />
      {s.label}
    </span>
  );
}

/**
 * The zoom menu, one shape everywhere a page is shown: Fit page, Fit width,
 * and the presets. A pinch lands between the presets; the menu says where.
 */
export function ZoomSelect({ zoom, onZoomChange, className }: { zoom: ZoomMode; onZoomChange: (z: ZoomMode) => void; className?: string }) {
  return (
    <select
      value={String(zoom)}
      onChange={(e) => {
        const v = e.target.value;
        onZoomChange(v === "page" || v === "width" ? v : Number(v));
      }}
      className={cn("h-11 rounded-full border-2 border-pine/25 bg-white pl-3 pr-10 font-display text-[16px] text-pine", className)}
      aria-label="Zoom"
    >
      {ZOOM_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
      {typeof zoom === "number" && !ZOOM_OPTIONS.some((o) => String(o.value) === String(zoom)) && (
        <option value={String(zoom)}>{Math.round(zoom * 100)}%</option>
      )}
    </select>
  );
}
