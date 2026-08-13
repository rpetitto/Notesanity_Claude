import { type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { BookOpen, GraduationCap, LayoutGrid, LogOut, Settings } from "lucide-react";
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
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-blue-600 font-medium text-white"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initials(name || "?")}
    </div>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect x="9" y="6" width="46" height="52" rx="7" fill="#1A73E8" />
      <rect x="15" y="6" width="5" height="52" fill="#0B4EA2" />
      <rect x="26" y="19" width="22" height="3.5" rx="1.75" fill="#fff" />
      <rect x="26" y="29" width="22" height="3.5" rx="1.75" fill="#fff" />
      <rect x="26" y="39" width="14" height="3.5" rx="1.75" fill="#fff" />
    </svg>
  );
}

export function FlingBadge() {
  return (
    <a
      href="https://flingit.io"
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-3 left-3 z-40 flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-500 shadow-sm hover:text-slate-800"
    >
      <span className="inline-block h-3 w-3 rounded-sm bg-blue-600" />
      Made with Fling
    </a>
  );
}

export default function Shell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const { user } = useSession();
  const { pathname } = useLocation();

  const nav = user?.role === "teacher"
    ? [
        { to: "/classes", label: "Classes", icon: LayoutGrid },
        { to: "/settings", label: "Settings", icon: Settings },
      ]
    : [
        { to: "/work", label: "My work", icon: BookOpen },
        { to: "/settings", label: "Settings", icon: Settings },
      ];

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className={cn("mx-auto flex h-14 items-center gap-4 px-4", wide ? "max-w-none" : "max-w-6xl")}>
          <Link to={user?.role === "teacher" ? "/classes" : "/work"} className="flex items-center gap-2">
            <Logo size={26} />
            <span className="text-lg font-semibold tracking-tight">Notesanity</span>
          </Link>

          <nav className="ml-2 hidden items-center gap-1 sm:flex">
            {nav.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors",
                  pathname.startsWith(to) ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-100",
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            {user && (
              <span className="hidden items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 sm:flex">
                <GraduationCap className="h-3.5 w-3.5" />
                {user.role === "teacher" ? "Teacher" : "Student"}
              </span>
            )}
            {user && <Avatar name={user.name} picture={user.picture} size={30} />}
            <a href={signOutHref} title="Sign out" className="rounded-full p-2 text-slate-500 hover:bg-slate-100">
              <LogOut className="h-4 w-4" />
            </a>
          </div>
        </div>
      </header>
      <main className={cn("mx-auto px-4 py-6", wide ? "max-w-none" : "max-w-6xl")}>{children}</main>
      <FlingBadge />
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-14 text-center">
      <div className="text-base font-medium text-slate-800">{title}</div>
      {body && <p className="mx-auto mt-1.5 max-w-md text-sm text-slate-500">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
      {label ?? "Loading…"}
    </div>
  );
}

export function ErrorNote({ error }: { error: Error }) {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
      {error.message}
    </div>
  );
}
