/**
 * Sign-in. Three ways in: Google, a password, or a one-time link by email.
 *
 * The copy follows the brand's voice rule — say what happens, in a sentence you
 * would actually say out loud to a colleague.
 */

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Mail, KeyRound, ArrowRight, Check } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { signOutHref } from "../lib/session";
import { hasGoogleClientId, mountGoogleButton, requestGoogleIdToken } from "../lib/google";
import { Logo } from "../components/Shell";
import { Button, Input, Label } from "../components/ui";
import { cn } from "../lib/utils";

type Method = "link" | "password";

export default function Landing({ error }: { error?: Error | null }) {
  const [params] = useSearchParams();
  const [method, setMethod] = useState<Method>("link");

  const [googleBusy, setGoogleBusy] = useState(false);

  /**
   * Google proves who you are; the session is still ours. The token goes
   * straight to our own endpoint, which verifies Google's signature and sets
   * the same cookie a password login would — so everything downstream, from
   * which school you land in to what role you get, is decided in one place.
   *
   * Two routes arrive here: Google's own rendered button (the reliable one,
   * overlaid on ours below) and the One Tap prompt (the fallback, for when
   * that button never mounted).
   */
  const completeGoogle = async (credential: string) => {
    setGoogleBusy(true);
    try {
      await api.post("/api/auth/google", { credential });
      window.location.href = "/";
    } catch (e) {
      toast.error((e as Error).message);
      setGoogleBusy(false);
    }
  };

  /** The fallback path: only runs if Google's own button never mounted. */
  const signInWithGoogle = async () => {
    setGoogleBusy(true);
    try {
      const credential = await requestGoogleIdToken();
      await api.post("/api/auth/google", { credential });
      window.location.href = "/";
    } catch (e) {
      toast.error((e as Error).message);
      setGoogleBusy(false);
    }
  };

  const googleMountRef = useRef<HTMLDivElement>(null);
  /**
   * Whether Google's own button actually rendered into the overlay.
   *
   * This gates the overlay's pointer events, and it is not a nicety: an empty
   * overlay still sits over the brand button and still swallows every click,
   * so if Google's script fails to load — a school proxy, a blocked domain, a
   * bad minute on the network — the sign-in button would silently do nothing
   * at all. Worse than the problem this was written to fix. Clicks only go to
   * the overlay once there is something in it to receive them.
   */
  const [googleMounted, setGoogleMounted] = useState(false);
  useEffect(() => {
    const el = googleMountRef.current;
    if (!el || !hasGoogleClientId) return;
    let teardown: (() => void) | undefined;
    let dead = false;
    mountGoogleButton(el, (credential) => void completeGoogle(credential), (m) => toast.error(m))
      .then((off) => {
        if (dead) { off(); return; }
        teardown = off;
        setGoogleMounted(true);
      })
      // The overlay stays inert and the brand button underneath keeps working
      // through the prompt path, which is the honest fallback.
      .catch(() => {});
    return () => { dead = true; teardown?.(); };
  }, []);
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [linkSent, setLinkSent] = useState(false);

  const blocked = Boolean(error);
  const linkProblem = params.get("auth_error");

  const sendLink = useMutation({
    mutationFn: () => api.post("/api/auth/magic/request", { email }),
    onSuccess: () => setLinkSent(true),
    onError: (e: Error) => toast.error(e.message),
  });

  const withPassword = useMutation({
    mutationFn: () =>
      register
        ? api.post("/api/auth/password/register", { email, password, name })
        : api.post("/api/auth/password/login", { email, password }),
    onSuccess: () => { window.location.href = "/"; },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-oat px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-3">
          <Logo size={44} />
          <span className="wordmark text-[34px] text-pine">Notesanity</span>
        </div>
        <div className="measure mx-auto mb-7 text-center">
          <p className="font-display text-[19px] text-pine">Stop passing out paper — and chasing it down later.</p>
          <p className="mt-1 text-pine/75">
            One push gets it to your whole class. Update it instantly, assign just the pages you need.
          </p>
        </div>

        {blocked && (
          <div className="mb-5 rounded-[22px] border-[3px] border-[#8a6a1f] bg-[#f7e6bf] p-4 text-[#5c4611]">
            <div className="font-display text-[17px]">We can't sign you in</div>
            <p className="mt-1 text-[16px] leading-relaxed">{error?.message}</p>
            <a href={signOutHref} className="mt-3 inline-block font-display text-[16px] underline">
              Sign out and use another account
            </a>
          </div>
        )}

        {linkProblem === "link_expired" && (
          <div className="mb-5 rounded-[22px] border-[3px] border-[#8a6a1f] bg-[#f7e6bf] p-4 text-[#5c4611]">
            <div className="font-display text-[17px]">That link has expired</div>
            <p className="mt-1 text-[16px]">Links last 20 minutes and work once. Ask for a fresh one below.</p>
          </div>
        )}

        <div className="rounded-[22px] border-[3px] border-pine bg-white p-5 shadow-[6px_6px_0_0_var(--color-pine)]">
          {linkSent ? (
            <div className="py-4 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border-[3px] border-pine bg-mint">
                <Check className="h-7 w-7 text-pine" strokeWidth={2.5} />
              </div>
              <h1 className="mt-4 text-[22px]">Check your email</h1>
              <p className="measure mx-auto mt-2 text-pine/75">
                If <span className="font-bold">{email}</span> can sign in, there's a link waiting. It works once and
                expires in 20 minutes.
              </p>
              <Button className="mt-5" onClick={() => { setLinkSent(false); sendLink.reset(); }}>
                Use a different address
              </Button>
            </div>
          ) : (
            <>
              {/* Method switch — neither option is the mint action; the submit button is. */}
              <div className="mb-5 flex gap-1 rounded-full border-[3px] border-pine p-1">
                {([
                  { key: "link" as Method, label: "Email me a link", icon: Mail },
                  { key: "password" as Method, label: "Use a password", icon: KeyRound },
                ]).map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setMethod(key)}
                    className={cn(
                      "flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-full font-display text-[16px] transition-colors",
                      method === key ? "bg-pine text-oat" : "text-pine hover:bg-pine/8",
                    )}
                  >
                    <Icon className="h-4 w-4" strokeWidth={2.5} />
                    {label}
                  </button>
                ))}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (method === "link") sendLink.mutate();
                  else withPassword.mutate();
                }}
              >
                <Label htmlFor="email">School email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@school.edu"
                  className="mt-1.5"
                />

                {method === "password" && (
                  <>
                    {register && (
                      <>
                        <Label htmlFor="name" className="mt-4">Your name</Label>
                        <Input
                          id="name"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Alex Rivera"
                          autoComplete="name"
                          className="mt-1.5"
                        />
                      </>
                    )}
                    <Label htmlFor="password" className="mt-4">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      required
                      minLength={register ? 10 : undefined}
                      autoComplete={register ? "new-password" : "current-password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="mt-1.5"
                    />
                    {register && <p className="mt-1.5 text-[16px] text-pine/70">At least 10 characters.</p>}
                  </>
                )}

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  className="mt-5 w-full"
                  disabled={sendLink.isPending || withPassword.isPending}
                >
                  {method === "link"
                    ? sendLink.isPending ? "Sending…" : "Email me a sign-in link"
                    : withPassword.isPending
                      ? "One moment…"
                      : register ? "Create account" : "Sign in"}
                  <ArrowRight className="h-5 w-5" strokeWidth={2.5} />
                </Button>
              </form>

              {method === "password" && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[16px]">
                  <button
                    type="button"
                    onClick={() => setRegister((v) => !v)}
                    className="font-display underline underline-offset-2"
                  >
                    {register ? "I already have an account" : "Set up a password"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!email) return toast.error("Enter your email first.");
                      api.post("/api/auth/magic/request", { email, purpose: "reset" })
                        .then(() => setLinkSent(true))
                        .catch((e: Error) => toast.error(e.message));
                    }}
                    className="text-pine/70 underline underline-offset-2"
                  >
                    Forgotten it?
                  </button>
                </div>
              )}

              <div className="my-5 flex items-center gap-3 text-pine/50">
                <span className="h-[3px] flex-1 rounded-full bg-pine/15" />
                <span className="label-caps">or</span>
                <span className="h-[3px] flex-1 rounded-full bg-pine/15" />
              </div>

              {/* Google's own button, invisible, sits exactly on top of ours.
                  The click it receives is a real one on a real Google element —
                  which is the whole point: the account chooser opens directly
                  instead of going through the One Tap prompt the browser is
                  free to refuse. Ours stays underneath as the thing you see,
                  so the brand survives the reliability fix. Where Google's
                  script can't load at all, the overlay never appears and the
                  button underneath is a working fallback on its own. */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => void signInWithGoogle()}
                  disabled={googleBusy}
                  className={cn(
                    "flex min-h-[52px] w-full items-center justify-center gap-3 rounded-full border-[3px] border-pine",
                    "bg-white font-display text-[17px] text-pine shadow-[4px_4px_0_0_var(--color-pine)]",
                    "transition-[transform,box-shadow] hover:bg-oat active:translate-x-[3px] active:translate-y-[3px] active:shadow-none",
                    "disabled:opacity-70",
                  )}
                >
                  <GoogleG />
                  {googleBusy ? "Signing in…" : "Continue with Google"}
                </button>
                <div
                  ref={googleMountRef}
                  aria-hidden
                  className={cn(
                    "absolute inset-0 overflow-hidden opacity-0",
                    (!googleMounted || googleBusy) && "pointer-events-none",
                  )}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.5 6 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 16 18.9 13 24 13c3.1 0 5.8 1.1 8 3l5.7-5.7C34.5 6.9 29.5 5 24 5 16 5 9.1 9.5 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.4 0 10.3-1.8 14.1-5l-6.5-5.5C29.6 35.3 26.9 36 24 36c-5.2 0-9.6-3.3-11.2-7.9l-6.5 5C9 39.4 15.9 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-1 3-3.2 5.4-6 6.8l6.5 5.5C39.8 37.3 44 31.4 44 24c0-1.3-.1-2.7-.4-3.5z" />
    </svg>
  );
}
