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

import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
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
