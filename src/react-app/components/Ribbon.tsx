/**
 * The notebook editor's ribbon.
 *
 * Three tabs in the header — Pages, Answer boxes, Annotate — in the order a
 * teacher works, and one row under them that only ever shows the current
 * tab's tools. The tools are icon-over-label buttons with the group named
 * beneath, the way the ribbon in Word or Slides does it, because a tool with
 * its name on it needs no tour.
 *
 * Nothing here scrolls sideways. A row that doesn't fit wraps, and on a phone
 * the buttons drop their labels and the group caption says where you are.
 */

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { FileText, Pen, TextCursorInput } from "lucide-react";
import { cn } from "../lib/utils";

export type RibbonTab = "pages" | "boxes" | "annotate";

const TABS: { key: RibbonTab; label: string; icon: LucideIcon; hint: string }[] = [
  { key: "pages", label: "Pages", icon: FileText, hint: "Add pages, and put text or a picture of your own on one" },
  { key: "boxes", label: "Answer boxes", icon: TextCursorInput, hint: "Boxes your students fill in" },
  { key: "annotate", label: "Annotate", icon: Pen, hint: "Write on the page yourself — sent to students when you publish" },
];

/**
 * The tab strip. Labels show from `md` up; between `sm` and `md` only the
 * current tab keeps its word; on a phone all three are icons, and the group
 * captions in the row below name the place instead.
 */
export function RibbonTabs({
  value, onChange, tours = {}, className,
}: {
  value: RibbonTab;
  onChange: (tab: RibbonTab) => void;
  /** `data-tour` anchors per tab, for the guided tour. */
  tours?: Partial<Record<RibbonTab, string>>;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label="Editor tools"
      className={cn(
        "inline-flex shrink-0 gap-0.5 rounded-full border-[3px] border-pine bg-white p-[2px]",
        "shadow-[4px_4px_0_0_var(--color-pine)]",
        className,
      )}
    >
      {TABS.map(({ key, label, icon: Icon, hint }) => {
        const on = key === value;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={on}
            title={hint}
            data-tour={tours[key]}
            onClick={() => onChange(key)}
            className={cn(
              "inline-flex h-[34px] items-center gap-2 rounded-full px-2.5 font-display text-[16px] font-bold transition-colors sm:h-[38px]",
              on ? "bg-pine text-oat" : "text-pine hover:bg-oat",
              on ? "sm:px-3.5" : "md:px-3.5",
            )}
          >
            <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={2.5} />
            <span className={cn("whitespace-nowrap", on ? "hidden sm:inline" : "hidden md:inline")}>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** One row of tools. Wraps rather than scrolls; groups sit on a shared baseline so their captions line up. */
export function RibbonRow({ children, tour, className }: { children: ReactNode; tour?: string; className?: string }) {
  return (
    <div
      data-tour={tour}
      className={cn(
        "flex flex-wrap items-end gap-x-3 gap-y-2 border-b-2 border-pine/12 bg-white px-3 py-2 sm:gap-x-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A named cluster of buttons. The caption is what tells a phone user where they are. */
export function RibbonGroup({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-1">
      <div className="flex items-center gap-0.5 sm:gap-1">{children}</div>
      <div className="whitespace-nowrap text-[16px] leading-none text-pine/55">{caption}</div>
    </div>
  );
}

export function RibbonDivider() {
  // Not on a phone: there the row is icon-only and the two pixels are the difference between fitting and wrapping.
  return <span className="mb-4 hidden h-10 w-0.5 shrink-0 self-end rounded-full bg-pine/15 sm:block sm:h-12" aria-hidden />;
}

/**
 * One tool. Icon over its name from `sm` up; the icon alone on a phone, where
 * the name would cost the row its fit — the caption and the hint carry it.
 */
export function RibbonButton({
  icon: Icon, label, active, onClick, disabled, title, tour, busy,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  tour?: string;
  /** Swaps the icon for a spinner while something this button started is running. */
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      aria-label={label}
      aria-pressed={active}
      data-tour={tour}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full border-2 transition-colors",
        "h-11 w-11 sm:h-16 sm:w-auto sm:min-w-[76px] sm:flex-col sm:gap-1 sm:rounded-[14px] sm:px-2.5",
        active ? "border-pine bg-mint text-pine" : "border-transparent text-pine/80 hover:bg-oat hover:text-pine",
        "disabled:opacity-40 disabled:hover:bg-transparent",
      )}
    >
      <Icon className={cn("h-5 w-5 sm:h-[22px] sm:w-[22px]", busy && "animate-spin")} strokeWidth={2.25} />
      <span className="hidden whitespace-nowrap font-display text-[16px] font-bold leading-none sm:inline">{label}</span>
    </button>
  );
}

/** The one-line explanation under a row, for the tool in hand. On a phone it is the tool's name. */
export function RibbonHint({ children }: { children: ReactNode }) {
  return (
    <span className="basis-full self-center text-[16px] text-pine/60 sm:basis-auto sm:pb-4">{children}</span>
  );
}
