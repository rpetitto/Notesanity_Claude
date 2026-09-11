/**
 * Brand primitives (Brand Book §06, "The brand as interface").
 *
 *   3px outlines · 22px corners on cards · 999px on buttons and chips ·
 *   12px on inputs · a hard 4px Pine offset shadow on anything pressable ·
 *   pressed state shifts 3px down-right and drops the shadow · tap targets
 *   never below 44px.
 *
 * Mint is rationed on purpose: it marks the one action on a screen and work
 * that has come back done. Everything else is Pine on Oat.
 */

import { forwardRef, useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "../lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

/**
 * One height per size, applied as a fixed height rather than a minimum, so a row
 * of buttons lines up exactly however much text each one carries. Nothing drops
 * below a 44px target or below the book's 16px interface minimum.
 */
const SIZES: Record<Size, string> = {
  sm: "h-11 px-4 text-[16px]",
  md: "h-12 px-5 text-[17px]",
  lg: "h-14 px-7 text-[18px]",
};

/** Mint only ever carries dark text — Oat or white on Mint fails at every size. */
const VARIANTS: Record<Variant, string> = {
  primary: "bg-mint text-pine border-pine shadow-[4px_4px_0_0_var(--color-pine)] hover:brightness-[1.04]",
  secondary: "bg-white text-pine border-pine shadow-[4px_4px_0_0_var(--color-pine)] hover:bg-oat",
  ghost: "bg-transparent text-pine border-transparent hover:bg-pine/8",
  danger: "bg-white text-[#a3341f] border-[#a3341f] shadow-[4px_4px_0_0_#a3341f] hover:bg-[#a3341f]/8",
};

const base =
  "inline-flex items-center justify-center gap-2 rounded-full border-[3px] font-display font-bold " +
  "transition-[transform,box-shadow,background-color] active:translate-x-[3px] active:translate-y-[3px] " +
  "active:shadow-none disabled:pointer-events-none disabled:opacity-50 " +
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-pine/30";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "secondary", size = "md", className, ...props }, ref) => (
    <button ref={ref} className={cn(base, SIZES[size], VARIANTS[variant], className)} {...props} />
  ),
);
Button.displayName = "Button";

export function ButtonLink({
  to, href, variant = "secondary", size = "md", className, children, ...rest
}: {
  to?: string;
  href?: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
} & Record<string, unknown>) {
  const cls = cn(base, SIZES[size], VARIANTS[variant], className);
  if (to) return <Link to={to} className={cls} {...rest}>{children}</Link>;
  return <a href={href} className={cls} {...rest}>{children}</a>;
}

/** Icon-only pressable. Still 44px, still outlined. */
export function IconButton({
  label, children, variant = "ghost", className, ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; variant?: Variant; children: ReactNode }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-[3px] transition-[transform,box-shadow]",
        "active:translate-x-[3px] active:translate-y-[3px] active:shadow-none",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-pine/30",
        variant === "ghost"
          ? "border-transparent text-pine hover:bg-pine/8"
          : cn("border-pine text-pine", VARIANTS[variant]),
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Card({
  className, children, pressable, accent, ...rest
}: { className?: string; children: ReactNode; pressable?: boolean; accent?: string } & Record<string, unknown>) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[22px] border-[3px] border-pine bg-white",
        pressable && "shadow-[4px_4px_0_0_var(--color-pine)] transition-[transform,box-shadow]",
        className,
      )}
      {...rest}
    >
      {accent && <div className="h-2" style={{ background: accent }} />}
      {children}
    </div>
  );
}

/** A card that is itself a link — gets the pressed squash. */
export function CardLink({
  to, className, children, accent,
}: { to: string; className?: string; children: ReactNode; accent?: string }) {
  return (
    <Link
      to={to}
      className={cn(
        "block overflow-hidden rounded-[22px] border-[3px] border-pine bg-white",
        "shadow-[4px_4px_0_0_var(--color-pine)] transition-[transform,box-shadow]",
        "hover:-translate-y-0.5 hover:shadow-[5px_5px_0_0_var(--color-pine)]",
        "active:translate-x-[3px] active:translate-y-[3px] active:shadow-none",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-pine/30",
        className,
      )}
    >
      {accent && <div className="h-2" style={{ background: accent }} />}
      {children}
    </Link>
  );
}

type ChipTone = "default" | "mint" | "pine" | "warn" | "quiet";

const CHIP_TONES: Record<ChipTone, string> = {
  default: "border-pine bg-white text-pine",
  // "Done" never rides on color alone — callers pair this with a tick or a word.
  mint: "border-pine bg-mint text-pine",
  pine: "border-pine bg-pine text-oat",
  warn: "border-[#8a6a1f] bg-[#f7e6bf] text-[#5c4611]",
  quiet: "border-pine/25 bg-oat text-pine/75",
};

export function Chip({
  tone = "default", className, children, icon,
}: { tone?: ChipTone; className?: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border-2 px-3.5",
        "font-display text-[16px] font-bold",
        CHIP_TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-12 w-full rounded-[12px] border-[3px] border-pine bg-white px-4 text-[17px]",
        "placeholder:text-pine/45 focus:outline-none focus:ring-[3px] focus:ring-mint",
        "disabled:bg-oat disabled:text-pine/60",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-[12px] border-[3px] border-pine bg-white px-4 py-3 text-[17px]",
        "placeholder:text-pine/45 focus:outline-none focus:ring-[3px] focus:ring-mint",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-12 w-full rounded-[12px] border-[3px] border-pine bg-white px-3.5 text-[17px]",
        "focus:outline-none focus:ring-[3px] focus:ring-mint",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, children, htmlFor }: { className?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn("label-caps block text-pine/75", className)}>
      {children}
    </label>
  );
}

/**
 * A confirmation that looks like the rest of the app.
 *
 * `window.confirm` was doing this job, which meant the moment a teacher was
 * asked to think hardest was the one moment the product handed them a grey OS
 * dialog with an OK button. It also can't say *why* — no room for the sentence
 * that distinguishes archiving (everything kept, reversible) from deleting
 * (nothing kept, final), which is the distinction the whole question turns on.
 *
 * `tone` decides which of those it is. Destructive confirmations put the
 * consequence in a red panel above the buttons and draw the action in red; a
 * reversible one just asks.
 */
export function ConfirmModal({
  title, body, confirmLabel, cancelLabel = "Cancel", tone = "default", busy, onConfirm, onClose,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <Modal onClose={onClose} title={title}>
      {tone === "danger" ? (
        <div className="rounded-[14px] border-[3px] border-[#a3341f] bg-[#a3341f]/8 p-4 text-[16px] leading-relaxed text-[#7d2716]">
          {body}
        </div>
      ) : (
        <div className="text-[16px] leading-relaxed text-pine/80">{body}</div>
      )}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>{cancelLabel}</Button>
        <Button
          variant={tone === "danger" ? "danger" : "primary"}
          onClick={onConfirm}
          disabled={busy}
          autoFocus
        >
          {busy ? "Working…" : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** A second line, for a choice whose consequence isn't obvious from its name. */
  hint?: string;
  /** Destructive: drawn in the warning red, and always placed last by the caller. */
  danger?: boolean;
}

/**
 * A "…" menu.
 *
 * Four surfaces need the same short list of actions hanging off a card or a
 * header — a notebook, a class, a page, a notebook's own toolbar — and each
 * one growing its own dropdown is how four subtly different dropdowns happen.
 *
 * Closes on a press anywhere else and on Escape. The press that opens it is
 * stopped from propagating, which matters because these sit inside cards that
 * are themselves links: without it, opening the menu would navigate away.
 */
export function Menu({
  items, label = "More actions", trigger, align = "right", className, disabled, tour,
}: {
  items: MenuItem[];
  label?: string;
  /** Defaults to a "…" icon button sized like every other icon button. */
  trigger?: ReactNode;
  align?: "left" | "right";
  className?: string;
  disabled?: boolean;
  /** `data-tour` anchor, for menus a guided tour points at. */
  tour?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  /**
   * Where to draw the panel, in viewport coordinates.
   *
   * The panel is portalled to the body rather than drawn where it sits in the
   * tree, because every place this is used is a card with `overflow-hidden` —
   * a menu rendered inside one is a menu with its bottom half sliced off. The
   * cost is positioning it by hand, which is this.
   */
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(272, window.innerWidth - 24);
    // Flips above the trigger when there isn't room below — a menu on a card
    // near the bottom of a long page otherwise opens off-screen.
    const estimated = 64 * items.length + 12;
    const below = r.bottom + 8;
    const top = below + estimated < window.innerHeight - 12 ? below : Math.max(12, r.top - 8 - estimated);
    const left = align === "right"
      ? Math.max(12, Math.min(r.right - width, window.innerWidth - width - 12))
      : Math.max(12, Math.min(r.left, window.innerWidth - width - 12));
    setAt({ top, left });
  }, [align, items.length]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    // Scrolling or resizing while it's open moves the trigger out from under
    // the panel, so the panel goes rather than drifting away from its button.
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div data-tour={tour} className={cn("relative shrink-0", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          if (!open) place();
          setOpen((v) => !v);
        }}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
        className={cn(
          "inline-flex h-11 w-11 items-center justify-center rounded-full border-[3px] border-transparent",
          "text-pine transition-colors hover:bg-pine/10 disabled:opacity-40",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-pine/30",
          open && "bg-pine/10",
        )}
      >
        {trigger ?? <MoreHorizontal className="h-5 w-5" strokeWidth={2.5} />}
      </button>

      {open && at && createPortal(
        <div
          role="menu"
          style={{ top: at.top, left: at.left }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "fixed z-[60] w-[min(17rem,calc(100vw-24px))] overflow-hidden rounded-[16px]",
            "border-[3px] border-pine bg-white shadow-[4px_4px_0_0_var(--color-pine)]",
          )}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => { setOpen(false); item.onClick(); }}
              className={cn(
                "flex w-full items-start gap-2.5 px-4 py-3 text-left transition-colors",
                "disabled:pointer-events-none disabled:opacity-45",
                item.danger ? "text-[#a3341f] hover:bg-[#a3341f]/8" : "text-pine hover:bg-oat",
              )}
            >
              {item.icon && <span className="mt-0.5 shrink-0">{item.icon}</span>}
              <span className="min-w-0">
                <span className="block font-display text-[17px] font-bold">{item.label}</span>
                {item.hint && (
                  <span className={cn("block text-[16px] leading-snug", item.danger ? "text-[#a3341f]/75" : "text-pine/65")}>
                    {item.hint}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

/** Modal shell: outlined card, scrollable on a phone, dismiss on backdrop. */
export function Modal({
  onClose, children, className, title,
}: { onClose: () => void; children: ReactNode; className?: string; title?: string }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-pine/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className={cn(
          "max-h-[88vh] w-full overflow-y-auto rounded-t-[22px] border-[3px] border-pine bg-white p-5",
          "sm:max-w-lg sm:rounded-[22px] sm:shadow-[6px_6px_0_0_var(--color-pine)]",
          className,
        )}
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && <h2 className="mb-3 text-[22px]">{title}</h2>}
        {children}
      </div>
    </div>
  );
}
