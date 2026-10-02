/**
 * The box around a selected annotation, with handles to move, resize and turn it.
 *
 * Everything here is expressed in page units and converted to screen pixels
 * only at paint time, which is what lets a mark selected on a phone come back
 * with exactly the same box on a desktop at another zoom.
 *
 * The box is drawn once, rotated as a whole; the handles then sit at plain
 * positions inside it. That way a mark turned 30° gets handles turned 30° with
 * it, and the arithmetic for a drag stays a single un-rotation into the box's
 * own frame rather than nine special cases.
 */

import { useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { MoreHorizontal } from "lucide-react";
import type { MarkBox, MarkOp } from "../lib/ink";

/** The eight box handles, plus the one above the top edge that turns it. */
type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "rotate";

/** Each handle's corner of the box, as -1/0/1 along each axis. */
const GRIP: Record<Exclude<Handle, "rotate">, { hx: -1 | 0 | 1; hy: -1 | 0 | 1; cursor: string }> = {
  nw: { hx: -1, hy: -1, cursor: "nwse-resize" },
  n: { hx: 0, hy: -1, cursor: "ns-resize" },
  ne: { hx: 1, hy: -1, cursor: "nesw-resize" },
  e: { hx: 1, hy: 0, cursor: "ew-resize" },
  se: { hx: 1, hy: 1, cursor: "nwse-resize" },
  s: { hx: 0, hy: 1, cursor: "ns-resize" },
  sw: { hx: -1, hy: 1, cursor: "nesw-resize" },
  w: { hx: -1, hy: 0, cursor: "ew-resize" },
};

const spin = (x: number, y: number, cx: number, cy: number, cos: number, sin: number) => ({
  x: cx + (x - cx) * cos - (y - cy) * sin,
  y: cy + (x - cx) * sin + (y - cy) * cos,
});

/** Below this a drag is still a tap, so a press to select doesn't nudge the mark. */
const SLOP = 4;
/** Nothing may be squashed past this — a mark scaled to nothing can't be grabbed back. */
const MIN_FACTOR = 0.06;

export default function MarkSelection({
  box, scale, pageRef, onPreview, onCommit, onMenu,
}: {
  /** The "…" button: everything the right-click menu offers, for a finger or a mouse that doesn't know to ask. */
  onMenu?: () => void;
  box: MarkBox;
  scale: number;
  /** The page element, so a pointer position can be read in page units. */
  pageRef: RefObject<HTMLDivElement | null>;
  /** Called through a drag with the operation so far — never committed. */
  onPreview: (op: MarkOp | null) => void;
  /** Called once on release, with the operation to keep, or null if it was a tap. */
  onCommit: (op: MarkOp | null) => void;
}) {
  const drag = useRef<
    | {
        handle: Handle | "body";
        pointerId: number;
        startX: number;
        startY: number;
        moved: boolean;
        op: MarkOp | null;
        /**
         * The box as it was when the press landed.
         *
         * Every frame of a drag is computed against this, never against the box
         * on screen: the preview reshapes the mark, which reshapes the box, so
         * measuring against the live one would fold each frame's growth into
         * the next and the mark would run away from the finger.
         */
        box: MarkBox;
      }
    | null
  >(null);

  const toPage = (e: ReactPointerEvent) => {
    const rect = pageRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
  };

  const start = (handle: Handle | "body") => (e: ReactPointerEvent) => {
    // The right button opens the menu (the page listens for that); it never drags.
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const p = toPage(e);
    if (!p) return;
    e.preventDefault();
    e.stopPropagation();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    drag.current = { handle, pointerId: e.pointerId, startX: p.x, startY: p.y, moved: false, op: null, box };
  };

  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const p = toPage(e);
    if (!p) return;
    if (!d.moved && Math.hypot(p.x - d.startX, p.y - d.startY) * scale < SLOP) return;
    d.moved = true;
    e.preventDefault();
    e.stopPropagation();

    const b = d.box;
    const rad = (b.rot * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;

    if (d.handle === "body") {
      d.op = { kind: "move", dx: p.x - d.startX, dy: p.y - d.startY };
    } else if (d.handle === "rotate") {
      // The angle swept about the centre, from where the press landed to here.
      const from = Math.atan2(d.startY - cy, d.startX - cx);
      const to = Math.atan2(p.y - cy, p.x - cx);
      d.op = { kind: "rotate", cx, cy, deg: ((to - from) * 180) / Math.PI };
    } else {
      const { hx, hy } = GRIP[d.handle];
      // The opposite handle stays put and everything stretches away from it.
      const ax = cx + ((-hx * b.w) / 2) * cos - ((-hy * b.h) / 2) * sin;
      const ay = cy + ((-hx * b.w) / 2) * sin + ((-hy * b.h) / 2) * cos;
      // Un-turn the pointer into the box's own frame, where the stretch is two
      // independent ratios along the box's width and height.
      const local = spin(p.x, p.y, ax, ay, cos, -sin);
      const fx = hx === 0 ? 1 : Math.max(MIN_FACTOR, (local.x - ax) / (hx * b.w));
      const fy = hy === 0 ? 1 : Math.max(MIN_FACTOR, (local.y - ay) / (hy * b.h));
      d.op = { kind: "scale", ax, ay, fx, fy, rot: b.rot };
    }
    onPreview(d.op);
  };

  const end = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    onPreview(null);
    onCommit(d.moved ? d.op : null);
  };

  const handlers = {
    onPointerMove: move,
    onPointerUp: end,
    onPointerCancel: end,
  };

  const px = (n: number) => n * scale;

  return (
    <div
      className="absolute"
      style={{
        left: px(box.x),
        top: px(box.y),
        width: px(box.w),
        height: px(box.h),
        transform: `rotate(${box.rot}deg)`,
        transformOrigin: "center",
        pointerEvents: "none",
        touchAction: "none",
      }}
    >
      {/* The box itself is the move target. Dashed, so it never reads as part
          of the page the way a solid rule would. */}
      <div
        role="presentation"
        onPointerDown={start("body")}
        {...handlers}
        className="absolute inset-0 border-2 border-dashed border-[#3F6C9E]"
        style={{ pointerEvents: "auto", cursor: "move", touchAction: "none" }}
      />

      {/* Turn handle, on a stalk above the top edge. */}
      <div
        role="presentation"
        aria-label="Rotate"
        onPointerDown={start("rotate")}
        {...handlers}
        className="absolute flex h-6 w-6 items-center justify-center rounded-full border-2 border-[#3F6C9E] bg-white"
        style={{ left: "50%", top: -34, marginLeft: -12, pointerEvents: "auto", cursor: "grab", touchAction: "none" }}
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="#3F6C9E" strokeWidth={3} strokeLinecap="round">
          <path d="M20 10a8 8 0 1 0-2 7" />
          <path d="M20 4v6h-6" />
        </svg>
      </div>
      <div className="absolute border-l-2 border-[#3F6C9E]" style={{ left: "50%", top: -10, height: 10 }} />

      {onMenu && (
        <button
          type="button"
          aria-label="More actions for this mark"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onMenu(); }}
          className="absolute flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#3F6C9E] bg-white text-[#3F6C9E] hover:bg-[#3F6C9E]/10"
          // Off the top-right corner, clear of the corner handle; a 44px hit
          // area around the visible 28px dot so a finger finds it.
          style={{ left: "100%", top: -34, marginLeft: 6, pointerEvents: "auto", touchAction: "manipulation" }}
        >
          <span className="absolute -inset-2" aria-hidden />
          <MoreHorizontal className="h-4 w-4" strokeWidth={2.5} />
        </button>
      )}

      {(Object.keys(GRIP) as Exclude<Handle, "rotate">[]).map((h) => {
        const { hx, hy, cursor } = GRIP[h];
        const corner = hx !== 0 && hy !== 0;
        return (
          <div
            key={h}
            role="presentation"
            aria-label={`Resize ${h}`}
            onPointerDown={start(h)}
            {...handlers}
            className="absolute border-2 border-[#3F6C9E] bg-white"
            style={{
              // Corners are square and the edges are bars, so which one is
              // under a finger is obvious without looking closely.
              width: corner ? 12 : hx === 0 ? 18 : 8,
              height: corner ? 12 : hy === 0 ? 18 : 8,
              borderRadius: corner ? 2 : 4,
              left: `${(hx + 1) * 50}%`,
              top: `${(hy + 1) * 50}%`,
              transform: "translate(-50%, -50%)",
              pointerEvents: "auto",
              cursor,
              touchAction: "none",
            }}
          />
        );
      })}
    </div>
  );
}
