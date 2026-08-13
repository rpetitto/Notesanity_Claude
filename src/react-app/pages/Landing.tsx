import { Logo, FlingBadge } from "../components/Shell";
import { signInHref, signOutHref } from "../lib/session";

/**
 * `error` is set when the account is signed in to Google but Notesanity refused
 * it — almost always a domain outside the school. Without showing it, sign-in
 * silently bounces back here and looks like the app is broken.
 */
export default function Landing({ error }: { error?: Error | null }) {
  const blocked = Boolean(error);

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="flex justify-center">
          <Logo size={48} />
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">Notesanity</h1>
        <p className="mt-2 text-sm text-slate-600">Interactive notebooks for your classroom.</p>

        {blocked && (
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-left">
            <div className="text-sm font-medium text-amber-900">Can't sign you in</div>
            <p className="mt-1 text-xs leading-relaxed text-amber-800">{error?.message}</p>
            <a
              href={signOutHref}
              className="mt-3 inline-flex h-9 items-center justify-center rounded-full border border-amber-300 bg-white px-3 text-xs font-medium text-amber-900 hover:bg-amber-100"
            >
              Sign out and use a different account
            </a>
          </div>
        )}

        <a
          href={signInHref("/")}
          className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-blue-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
        >
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
            <path
              fill="#FFC107"
              d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.5 6 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"
            />
            <path
              fill="#FF3D00"
              d="M6.3 14.7l6.6 4.8C14.6 16 18.9 13 24 13c3.1 0 5.8 1.1 8 3l5.7-5.7C34.5 6.9 29.5 5 24 5 16 5 9.1 9.5 6.3 14.7z"
            />
            <path
              fill="#4CAF50"
              d="M24 44c5.4 0 10.3-1.8 14.1-5l-6.5-5.5C29.6 35.3 26.9 36 24 36c-5.2 0-9.6-3.3-11.2-7.9l-6.5 5C9 39.4 15.9 44 24 44z"
            />
            <path
              fill="#1976D2"
              d="M43.6 20.5H42V20H24v8h11.3c-1 3-3.2 5.4-6 6.8l6.5 5.5C39.8 37.3 44 31.4 44 24c0-1.3-.1-2.7-.4-3.5z"
            />
          </svg>
          {blocked ? "Try signing in again" : "Sign in with Google"}
        </a>

        <p className="mt-4 text-xs text-slate-400">
          {blocked
            ? "An admin can add your domain under Settings → School settings."
            : "First person to sign in becomes the school admin."}
        </p>
      </div>
      <FlingBadge />
    </div>
  );
}
