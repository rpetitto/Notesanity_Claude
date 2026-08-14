import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

export function relativeTime(iso?: string | null): string {
  if (!iso) return "";
  const then = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z").getTime();
  if (Number.isNaN(then)) return "";
  const diff = Math.max(0, Date.now() - then);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(then).toLocaleDateString();
}

export function formatDue(iso?: string | null): string {
  if (!iso) return "No due date";
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return "No due date";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function isOverdue(iso?: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  return !Number.isNaN(d.getTime()) && d.getTime() < Date.now();
}

/** Convert a datetime-local input value to an ISO string, and back. */
export const toIso = (local: string) => (local ? new Date(local).toISOString() : null);
export const toLocalInput = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * Accent palette for classes and notebooks.
 *
 * Every colour here is muted enough to sit on Oat and hold its own beside Pine
 * and Mint. Mint itself is deliberately absent: it means "the action" or "done",
 * so letting a class adopt it would break that signal.
 */
const PALETTE = [
  "#2E7D6B", // deep teal
  "#20302C", // pine
  "#3F6C9E", // slate blue
  "#7A5C8E", // plum
  "#C4703F", // clay
  "#D9A441", // ochre
  "#A3341F", // brick
  "#4F7A3A", // moss
];

/** Used wherever a class or notebook hasn't picked a colour yet. */
export const DEFAULT_ACCENT = "#2E7D6B";
export function accentFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
