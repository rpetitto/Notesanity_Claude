import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Activity, BookOpen, BookText, ClipboardList, Eye, LayoutGrid, LibraryBig, LogOut, Megaphone, Settings, ShieldCheck, Sparkles, Users } from "lucide-react";
import { signOutHref, useSession } from "../lib/session";
import { api } from "../lib/api";
import { cn, initials } from "../lib/utils";

/**
 * Sits above everything while a superadmin is viewing as another user for
 * support — impossible to miss, and the only way out other than it expiring
 * on its own. Rendered once, in Shell, so no page can forget it.
 */
function ImpersonationBanner({ viewingAsEmail, reason }: { viewingAsEmail: string; reason: string }) {
  const qc = useQueryClient();
  const end = useMutation({
    mutationFn: () => api.post("/api/admin/impersonate/end", {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
  return (
    <div className="flex flex-wrap items-center gap-2 border-b-2 border-[#8a6a1f] bg-[#fdf1cf] px-4 py-2 text-[15px] text-[#5c4713]">
      <Eye className="h-4 w-4 shrink-0" />
      <span>
        Viewing as <strong>{viewingAsEmail}</strong> for support — read-only. Reason: {reason}
      </span>
      <button
        type="button"
        onClick={() => end.mutate()}
        disabled={end.isPending}
        className="ml-auto shrink-0 rounded-full border-2 border-[#8a6a1f] px-3 py-1 font-display font-bold hover:bg-[#8a6a1f]/10"
      >
        {end.isPending ? "Exiting…" : "Exit"}
      </button>
    </div>
  );
}

export function Avatar({ name, picture, size = 32 }: { name: string; picture?: string | null; size?: number }) {
  if (picture) {
    return (
      <img
        src={picture}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        className="shrink-0 rounded-full border-2 border-pine object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full border-2 border-pine bg-mint font-display font-bold text-pine"
      style={{ width: size, height: size, fontSize: Math.max(13, size * 0.42) }}
    >
      {initials(name || "?")}
    </div>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden>
      <g stroke="#20302C" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
        <rect x="10" y="12" width="40" height="40" rx="10" fill="#F4EFE6" transform="rotate(-10 30 32)" />
        <rect x="18" y="14" width="38" height="40" rx="10" fill="#7FD1AE" />
        <path d="M27 34.5 33 40.5 46 27" strokeWidth={4} />
      </g>
    </svg>
  );
}

export function FlingBadge() {
  return null;
}

/**
 * The avatar is the account menu, the way Google's is: who you're signed in
 * as, your plan, Settings and Sign out, the public pages a signed-in person
 * otherwise has no way back to, and the legal links along the foot.
 *
 * Sign out stays a plain link to /api/auth/leave — google.ts listens for a
 * click on exactly that href to forget the account's Google tokens.
 */
function AccountMenu() {
  const { user, plan } = useSession();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // First item gets focus, so the keyboard lands inside the menu it opened.
    panel.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); return; }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const items = [...(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next = e.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
      items[next]?.focus();
      e.preventDefault();
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("pointerdown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  if (!user) return null;
  const roleLabel = user.role === "guardian" ? "Parent or guardian" : user.role === "student" ? "Student" : null;
  // Upgrade is offered to a teacher on Free. While in beta it says so: the
  // link still goes to the plans, which show what's coming and when.
  const offerUpgrade = user.role === "teacher" && plan?.source === "free";
  const item = "flex min-h-[44px] w-full items-center gap-3 rounded-[12px] px-3 text-left font-display text-[16px] font-bold text-pine hover:bg-oat focus-visible:bg-oat focus-visible:outline-none";
  const close = () => setOpen(false);

  return (
    <div ref={wrap} className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${user.name}`}
        title={user.email}
        className={cn(
          "flex h-11 w-11 items-center justify-center rounded-full transition-shadow",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-pine/40",
          open ? "ring-[3px] ring-mint" : "hover:ring-[3px] hover:ring-pine/15",
        )}
      >
        <Avatar name={user.name} picture={user.picture} size={32} />
      </button>

      {open && (
        <div
          ref={panel}
          role="menu"
          aria-label="Account"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-[min(320px,calc(100vw-24px))] overflow-hidden rounded-[22px] border-[3px] border-pine bg-white shadow-[4px_4px_0_0_var(--color-pine)]"
        >
          <div className="flex items-center gap-3 border-b-2 border-pine/12 bg-oat/60 px-4 py-4">
            <Avatar name={user.name} picture={user.picture} size={48} />
            <div className="min-w-0">
              <div className="truncate font-display text-[17px] font-bold text-pine">{user.name}</div>
              <div className="truncate text-[16px] text-pine/70">{user.email}</div>
              {(plan || roleLabel) && (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {roleLabel && <span className="rounded-full border-2 border-pine/20 px-2.5 text-[16px] font-bold text-pine/75">{roleLabel}</span>}
                  {plan && user.role === "teacher" && (
                    <span className="rounded-full border-2 border-pine/20 px-2.5 text-[16px] font-bold text-pine/75">
                      {plan.label} plan
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="p-2">
            {offerUpgrade && (
              <a role="menuitem" href="/pricing" onClick={close} className={cn(item, "mb-1 py-2 bg-mint/25 hover:bg-mint/40 focus-visible:bg-mint/40")}>
                <Sparkles className="h-5 w-5 shrink-0" strokeWidth={2.5} />
                <span className="min-w-0 flex-1">
                  Upgrade to Pro
                  {plan?.beta && <span className="block text-[16px] font-normal leading-snug text-pine/70">Free for everyone during the beta</span>}
                </span>
              </a>
            )}
            <Link role="menuitem" to="/settings" onClick={close} className={item}>
              <Settings className="h-5 w-5 shrink-0" strokeWidth={2.5} /> Settings
            </Link>
            <a role="menuitem" href="/changelog" target="_blank" rel="noopener" onClick={close} className={item}>
              <Megaphone className="h-5 w-5 shrink-0" strokeWidth={2.5} /> What's new
            </a>
            <a role="menuitem" href="/status" target="_blank" rel="noopener" onClick={close} className={item}>
              <Activity className="h-5 w-5 shrink-0" strokeWidth={2.5} /> Status
            </a>
            <div className="my-1 border-t-2 border-pine/12" />
            <a role="menuitem" href={signOutHref} className={item}>
              <LogOut className="h-5 w-5 shrink-0" strokeWidth={2.5} /> Sign out
            </a>
          </div>

          <div className="flex items-center justify-center gap-2 border-t-2 border-pine/12 bg-oat/60 px-4 py-2.5 text-[15px] text-pine/70">
            <a href="/privacy" target="_blank" rel="noopener" className="rounded px-1 py-1 hover:text-pine hover:underline">Privacy Policy</a>
            <span aria-hidden>•</span>
            <a href="/terms" target="_blank" rel="noopener" className="rounded px-1 py-1 hover:text-pine hover:underline">Terms of Service</a>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Shell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const { user, impersonating } = useSession();
  const { pathname } = useLocation();

  const nav = user?.role === "guardian"
    ? [
        { to: "/family", label: "My children", icon: Users },
        { to: "/settings", label: "Settings", icon: Settings },
      ]
    : user?.role === "teacher"
    ? [
        { to: "/classes", label: "Classes", icon: LayoutGrid },
        { to: "/notebooks", label: "Notebooks", icon: BookText },
        { to: "/assignments", label: "Assignments", icon: ClipboardList },
        { to: "/library", label: "Library", icon: LibraryBig },
        { to: "/settings", label: "Settings", icon: Settings },
      ]
    : [
        { to: "/work", label: "My work", icon: BookOpen },
        { to: "/settings", label: "Settings", icon: Settings },
      ];

  // Superadmins get one more door, wherever they sit in a school.
  if (user?.isSuperadmin) nav.push({ to: "/admin", label: "Admin", icon: ShieldCheck });

  return (
    <div className="min-h-dvh">
      <div className="sticky top-0 z-30">
        {impersonating && user && <ImpersonationBanner viewingAsEmail={user.email} reason={impersonating.reason} />}
        <header className="border-b-2 border-pine/12 bg-oat/95 backdrop-blur">
        <div className={cn("mx-auto flex h-14 items-center gap-4 px-4", wide ? "max-w-none" : "max-w-6xl")}>
          <Link to={user?.role === "teacher" ? "/classes" : user?.role === "guardian" ? "/family" : "/work"} className="flex shrink-0 items-center gap-2">
            <Logo size={26} />
            {/* The mark alone carries the brand once space is tight. */}
            <span className="wordmark hidden text-[22px] md:inline">Notesanity</span>
          </Link>

          <nav className="ml-2 hidden min-w-0 items-center gap-1 overflow-x-auto sm:flex">
            {nav.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                data-tour={`nav-${to.slice(1)}`}
                title={label}
                aria-label={label}
                className={cn(
                  "flex min-h-[44px] shrink-0 items-center gap-2 rounded-full border-[3px] px-4 font-display text-[16px] font-bold transition-colors",
                  pathname.startsWith(to)
                    ? "border-pine bg-pine text-oat"
                    : "border-transparent text-pine hover:bg-pine/8",
                )}
              >
                <Icon className="h-4 w-4" />
                {/* Five items now; below `xl` the icons carry them and the word is the tooltip. */}
                <span className="hidden xl:inline">{label}</span>
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-3">
            {user ? (
              <AccountMenu />
            ) : (
              <a href={signOutHref} title="Sign out" className="flex h-11 w-11 items-center justify-center rounded-full text-pine hover:bg-pine/8">
                <LogOut className="h-4 w-4" />
              </a>
            )}
          </div>
        </div>
        </header>
      </div>
      <main className={cn("mx-auto px-4 py-6 pb-24 sm:pb-6", wide ? "max-w-none" : "max-w-6xl")}>{children}</main>

      {/* Phone navigation. The header row collapses below sm:, so without this
          there is no way to move between sections on a handset. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex border-t-2 border-pine/12 bg-oat/97 backdrop-blur sm:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {nav.map(({ to, label, icon: Icon }) => {
          const active = pathname.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              data-tour={`nav-${to.slice(1)}-mobile`}
              className={cn(
                // `min-w-0` is what lets a long label shrink; without it the
                // row's min-content width pushed the bar past the viewport.
                "flex min-h-[56px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1",
                "font-display text-[15px] font-bold",
                active ? "text-pine" : "text-pine/55",
              )}
            >
              <Icon className="h-6 w-6 shrink-0" strokeWidth={2.5} />
              <span className="w-full truncate text-center">{label}</span>
            </Link>
          );
        })}
      </nav>

    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="rounded-[22px] border-[3px] border-dashed border-pine/40 bg-white/60 px-6 py-14 text-center">
      <div className="font-display text-[22px] text-pine">{title}</div>
      {body && <p className="measure mx-auto mt-2 text-pine/70">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-pine/70">
      <span className="h-5 w-5 animate-spin rounded-full border-[3px] border-pine/25 border-t-pine" />
      {label ?? "Loading…"}
    </div>
  );
}

export function ErrorNote({ error }: { error: Error }) {
  return (
    <div className="rounded-[12px] border-[3px] border-[#a3341f] bg-[#fbe9e4] px-4 py-3 text-[#7d2716]">
      {error.message}
    </div>
  );
}
