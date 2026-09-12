import { type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { BookOpen, ClipboardList, GraduationCap, LayoutGrid, LogOut, Settings, ShieldCheck } from "lucide-react";
import { signOutHref, useSession } from "../lib/session";
import { cn, initials } from "../lib/utils";

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

export default function Shell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const { user } = useSession();
  const { pathname } = useLocation();

  const nav = user?.role === "teacher"
    ? [
        { to: "/classes", label: "Classes", icon: LayoutGrid },
        { to: "/assignments", label: "Assignments", icon: ClipboardList },
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
      <header className="sticky top-0 z-30 border-b-2 border-pine/12 bg-oat/95 backdrop-blur">
        <div className={cn("mx-auto flex h-14 items-center gap-4 px-4", wide ? "max-w-none" : "max-w-6xl")}>
          <Link to={user?.role === "teacher" ? "/classes" : "/work"} className="flex shrink-0 items-center gap-2">
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
                className={cn(
                  "flex min-h-[44px] shrink-0 items-center gap-2 rounded-full border-[3px] px-4 font-display text-[16px] font-bold transition-colors",
                  pathname.startsWith(to)
                    ? "border-pine bg-pine text-oat"
                    : "border-transparent text-pine hover:bg-pine/8",
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-3">
            {user && (
              <span className="label-caps hidden items-center gap-1.5 rounded-full border-2 border-pine/25 px-2.5 py-1 text-pine/70 lg:flex">
                <GraduationCap className="h-3.5 w-3.5" />
                {user.role === "teacher" ? "Teacher" : "Student"}
              </span>
            )}
            {user && <Avatar name={user.name} picture={user.picture} size={30} />}
            <a href={signOutHref} title="Sign out" className="flex h-11 w-11 items-center justify-center rounded-full text-pine hover:bg-pine/8">
              <LogOut className="h-4 w-4" />
            </a>
          </div>
        </div>
      </header>
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
