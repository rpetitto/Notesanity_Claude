import {
  Eraser, Hand, Highlighter, MessageSquarePlus, Pen, Smile, Type, Redo2, Undo2,
  Hand as FingerIcon,
} from "lucide-react";
import type { ToolState } from "./PageCanvas";
import { HIGHLIGHTER_COLORS, PEN_COLORS, STAMPS, TEACHER_COLORS, type ToolKind } from "../lib/ink";
import type { ZoomMode } from "./NotebookSurface";
import { cn } from "../lib/utils";
import type { SaveStatus } from "../lib/autosave";

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
}

const BASE_TOOLS: { kind: ToolKind; icon: typeof Pen; label: string }[] = [
  { kind: "pen", icon: Pen, label: "Pen" },
  { kind: "highlighter", icon: Highlighter, label: "Highlighter" },
  { kind: "eraser", icon: Eraser, label: "Eraser" },
  { kind: "text", icon: Type, label: "Text" },
  { kind: "stamp", icon: Smile, label: "Stamp" },
  { kind: "select", icon: Hand, label: "Scroll only" },
];

const COMMENT_TOOL = { kind: "comment" as ToolKind, icon: MessageSquarePlus, label: "Add comment" };

const ZOOM_OPTIONS: { value: string; label: string }[] = [
  { value: "page", label: "Fit page" },
  { value: "width", label: "Fit width" },
  { value: "0.75", label: "75%" },
  { value: "1", label: "100%" },
  { value: "1.25", label: "125%" },
  { value: "1.5", label: "150%" },
  { value: "2", label: "200%" },
];

export default function InkToolbar({
  tool, onToolChange, fingerDraw, onFingerDrawChange,
  onUndo, onRedo, canUndo, canRedo, status, teacherPalette, allowComments, zoom, onZoomChange,
}: Props) {
  const TOOLS = allowComments
    ? [...BASE_TOOLS.slice(0, 5), COMMENT_TOOL, BASE_TOOLS[5]]
    : BASE_TOOLS;
  const colors = tool.kind === "highlighter"
    ? HIGHLIGHTER_COLORS
    : teacherPalette ? TEACHER_COLORS : PEN_COLORS;

  const widths = tool.kind === "highlighter" ? [8, 14, 22] : [1.5, 2.5, 4, 7];

  return (
    <div
      // Wrapping is only allowed once the row genuinely fits. At `sm` it kicked in
      // right where tablets live, turning one row of tools into two or three.
      className="flex snap-x items-center gap-2 overflow-x-auto border-b border-pine/20 bg-white/95 px-3 py-2 backdrop-blur 2xl:flex-wrap 2xl:overflow-visible"
      style={{ touchAction: "manipulation", scrollbarWidth: "thin" }}
    >
      <div className="flex shrink-0 items-center gap-1 rounded-lg bg-oat p-1">
        {TOOLS.map(({ kind, icon: Icon, label }) => (
          <button
            key={kind}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={tool.kind === kind}
            onClick={() => onToolChange({ ...tool, kind })}
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-full transition-colors",
              tool.kind === kind ? "bg-white text-pine shadow-sm" : "text-pine/70 hover:text-pine",
            )}
          >
            <Icon className="h-4 w-4" />
          </button>
        ))}
      </div>

      {(tool.kind === "pen" || tool.kind === "highlighter" || tool.kind === "text") && (
        <div className="flex shrink-0 items-center gap-1">
          {colors.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Colour ${c}`}
              onClick={() => onToolChange({ ...tool, color: c })}
              className={cn(
                "h-6 w-6 rounded-full border-2 transition-transform",
                tool.color === c ? "border-pine scale-110" : "border-white shadow-sm hover:scale-105",
              )}
              style={{ background: c }}
            />
          ))}
        </div>
      )}

      {(tool.kind === "pen" || tool.kind === "highlighter" || tool.kind === "eraser") && (
        <div className="flex shrink-0 items-center gap-1">
          {widths.map((w) => (
            <button
              key={w}
              type="button"
              aria-label={`Width ${w}`}
              onClick={() => onToolChange({ ...tool, width: w })}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-md hover:bg-oat",
                tool.width === w && "bg-pine/15",
              )}
            >
              <span
                className="rounded-full bg-pine"
                style={{ width: Math.max(3, w), height: Math.max(3, w) }}
              />
            </button>
          ))}
        </div>
      )}

      {tool.kind === "stamp" && (
        <div className="flex shrink-0 items-center gap-0.5">
          {STAMPS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onToolChange({ ...tool, stamp: s })}
              className={cn("rounded-md px-1.5 py-1 text-lg leading-none hover:bg-oat", tool.stamp === s && "bg-mint/20 ring-2 ring-mint")}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => onFingerDrawChange(!fingerDraw)}
          title={fingerDraw ? "Finger draws — tap to switch back to scrolling" : "Finger scrolls — tap to draw with finger"}
          className={cn(
            "flex h-11 items-center gap-1.5 rounded-full border-2 px-3.5 font-display text-[16px] transition-colors",
            fingerDraw ? "border-pine/45 bg-mint/20 text-pine" : "border-pine/20 text-pine/70 hover:bg-oat",
          )}
        >
          <FingerIcon className="h-3.5 w-3.5" />
          {fingerDraw ? "Finger draws" : "Finger scrolls"}
        </button>

        <div className="flex items-center gap-1 text-pine/70">
          <button type="button" onClick={onUndo} disabled={!canUndo} title="Undo"
            className="rounded-md p-1.5 hover:bg-oat disabled:opacity-30">
            <Undo2 className="h-4 w-4" />
          </button>
          <button type="button" onClick={onRedo} disabled={!canRedo} title="Redo"
            className="rounded-md p-1.5 hover:bg-oat disabled:opacity-30">
            <Redo2 className="h-4 w-4" />
          </button>
        </div>

        <select
          value={String(zoom)}
          onChange={(e) => {
            const v = e.target.value;
            onZoomChange(v === "page" || v === "width" ? v : Number(v));
          }}
          className="h-11 rounded-full border-2 border-pine/25 bg-white px-3 font-display text-[16px] text-pine"
          aria-label="Zoom"
        >
          {ZOOM_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        {status && <SaveIndicator status={status} />}
      </div>
    </div>
  );
}

export function SaveIndicator({ status }: { status: SaveStatus }) {
  const map: Record<SaveStatus, { label: string; className: string }> = {
    idle: { label: "", className: "" },
    saving: { label: "Saving…", className: "text-pine/70" },
    saved: { label: "Saved", className: "text-pine" },
    offline: { label: "Offline — retrying", className: "text-[#5c4611]" },
  };
  const s = map[status];
  if (!s.label) return null;
  return (
    <span className={cn("flex items-center gap-1.5 text-[16px] whitespace-nowrap", s.className)}>
      <span className={cn(
        "h-1.5 w-1.5 rounded-full",
        status === "saved" ? "bg-mint" : status === "offline" ? "bg-[#8a6a1f] animate-pulse" : "bg-pine/50 animate-pulse",
      )} />
      {s.label}
    </span>
  );
}
