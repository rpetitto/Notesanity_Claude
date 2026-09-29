/**
 * Sign-in. First who you are — teacher, student, or family — then how: Google,
 * a password, or a one-time link by email.
 *
 * Asking who comes first so that nothing is made for someone who leaves
 * halfway: the server creates an account only once it can check the answer
 * (a school address for staff and students, a family code for a parent). The
 * choice never grants more than that address or code already allows, and it
 * doesn't matter at all for someone who already has an account.
 *
 * The copy follows the brand's voice rule — say what happens, in a sentence you
 * would actually say out loud to a colleague.
 */

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Mail, KeyRound, ArrowRight, Check, PenSquare, GraduationCap, Users, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { signOutHref } from "../lib/session";
import { hasGoogleClientId, mountGoogleButton, requestGoogleIdToken } from "../lib/google";
import { Logo } from "../components/Shell";
import { Button, Input, Label } from "../components/ui";
import { cn } from "../lib/utils";

type Method = "link" | "password";
type Door = "teacher" | "student" | "family";

const DOOR_KEY = "notesanity:door";
const DOORS: { key: Door; label: string; hint: string; icon: typeof PenSquare }[] = [
  { key: "teacher", label: "Teacher", hint: "Build notebooks, set work, grade it", icon: PenSquare },
  { key: "student", label: "Student", hint: "Your classes and your notebooks", icon: GraduationCap },
  { key: "family", label: "Parent or guardian", hint: "Follow along with your child's work", icon: Users },
];

export default function Landing({ error }: { error?: Error | null }) {
  const [params] = useSearchParams();
  const [method, setMethod] = useState<Method>("link");

  // A family link (/family?code=…) arrives with the door already chosen.
  const codeInUrl = params.get("code") ?? "";
  const [door, setDoorState] = useState<Door | null>(() => {
    if (codeInUrl || window.location.pathname.startsWith("/family")) return "family";
    try { const d = localStorage.getItem(DOOR_KEY); return d === "teacher" || d === "student" || d === "family" ? d : null; } catch { return null; }
  });
  const setDoor = (d: Door | null) => {
    setDoorState(d);
    try { if (d) localStorage.setItem(DOOR_KEY, d); else localStorage.removeItem(DOOR_KEY); } catch { /* ignore */ }
  };
  const [familyCode, setFamilyCode] = useState(codeInUrl);
  const [classCode, setClassCode] = useState("");
  const [codeCheck, setCodeCheck] = useState<{ valid: boolean; child?: string; reason?: string } | null>(null);
  useEffect(() => {
    const code = familyCode.replace(/[^a-z0-9]/gi, "");
    if (door !== "family" || code.length !== 8) { setCodeCheck(null); return; }
    let dead = false;
    api.get<{ valid: boolean; child?: string; reason?: string }>(`/api/family/code/${encodeURIComponent(code)}`)
      .then((r) => { if (!dead) setCodeCheck(r); })
      .catch(() => { if (!dead) setCodeCheck(null); });
    return () => { dead = true; };
  }, [familyCode, door]);
  /** What every sign-in call carries: the door, and a family code when there is one. */
  const intent = () => ({
    door: door ?? undefined,
    familyCode: door === "family" && familyCode.trim() ? familyCode.trim() : undefined,
    classCode: door === "student" && classCode.trim() ? classCode.trim() : undefined,
  });
  // Google's button calls back long after it was mounted; this keeps its answer current.
  const intentRef = useRef(intent);
  intentRef.current = intent;

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
      await api.post("/api/auth/google", { credential, ...intentRef.current() });
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
      await api.post("/api/auth/google", { credential, ...intent() });
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
    return () => { dead = true; teardown?.(); setGoogleMounted(false); };
    // Mounted again whenever the door changes, because the button only exists once one is chosen.
  }, [door]);
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [linkSent, setLinkSent] = useState(false);

  const blocked = Boolean(error);
  const linkProblem = params.get("auth_error");

  const sendLink = useMutation({
    mutationFn: () => api.post("/api/auth/magic/request", { email, ...intent() }),
    onSuccess: () => setLinkSent(true),
    onError: (e: Error) => toast.error(e.message),
  });

  const withPassword = useMutation({
    mutationFn: () =>
      register
        ? api.post("/api/auth/password/register", { email, password, name, ...intent() })
        : api.post("/api/auth/password/login", { email, password, ...intent() }),
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
          {!door ? (
            <div>
              <h1 className="mb-1 text-[22px]">Who's signing in?</h1>
              <p className="mb-4 text-[16px] text-pine/70">So we can set up the right space — and check it's really you.</p>
              <div className="space-y-2.5" role="list">
                {DOORS.map(({ key, label, hint, icon: Icon }) => (
                  <button
                    key={key}
                    type="button"
                    role="listitem"
                    onClick={() => setDoor(key)}
                    className="flex min-h-[64px] w-full items-center gap-3 rounded-[16px] border-[3px] border-pine bg-white px-4 py-2.5 text-left transition-[transform,box-shadow] hover:bg-oat active:translate-x-[2px] active:translate-y-[2px]"
                  >
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-[3px] border-pine bg-oat text-pine">
                      <Icon className="h-5 w-5" strokeWidth={2.5} />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-display text-[17px] text-pine">{label}</span>
                      <span className="block text-[16px] text-pine/70">{hint}</span>
                    </span>
                    <ArrowRight className="ml-auto h-5 w-5 shrink-0 text-pine/50" strokeWidth={2.5} />
                  </button>
                ))}
              </div>
            </div>
          ) : linkSent ? (
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
              <div className="-mt-1 mb-4 flex items-center justify-between gap-2">
                <span className="font-display text-[17px] text-pine">
                  {door === "teacher" ? "Signing in as a teacher" : door === "student" ? "Signing in as a student" : "Signing in as family"}
                </span>
                <button type="button" onClick={() => setDoor(null)} className="inline-flex min-h-[44px] items-center gap-1 rounded-full px-2 text-[16px] text-pine/70 underline underline-offset-2 hover:text-pine">
                  <ArrowLeft className="h-4 w-4" strokeWidth={2.5} /> Change
                </button>
              </div>

              {door === "family" && (
                <div className="mb-5 rounded-[16px] border-[3px] border-pine/20 bg-oat p-3">
                  <Label htmlFor="family-code">Family code</Label>
                  <Input
                    id="family-code"
                    value={familyCode}
                    onChange={(e) => setFamilyCode(e.target.value.toUpperCase())}
                    placeholder="ABCD-2345"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    className="mt-1.5 font-display tracking-[0.12em]"
                    aria-describedby="family-code-help"
                  />
                  <p id="family-code-help" className="mt-1.5 text-[16px] text-pine/75" aria-live="polite">
                    {codeCheck?.valid
                      ? <span className="inline-flex items-center gap-1.5 font-display text-pine"><Check className="h-4 w-4" strokeWidth={3} /> {codeCheck.child}'s family code</span>
                      : codeCheck && !codeCheck.valid
                        ? codeCheck.reason ?? "That code isn't right, or it has been replaced. Check it with your child's teacher."
                        : "First time? Enter the code from your child's teacher. Already signed up? Leave it blank."}
                  </p>
                </div>
              )}

              {door === "student" && (
                <div className="mb-5">
                  <Label htmlFor="class-code">Class code (if you have one)</Label>
                  <Input
                    id="class-code"
                    value={classCode}
                    onChange={(e) => setClassCode(e.target.value.toUpperCase())}
                    placeholder="From your teacher"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    className="mt-1.5 font-display tracking-[0.12em]"
                  />
                  <p className="mt-1.5 text-[16px] text-pine/70">Signing in with your school email? You can leave this blank.</p>
                </div>
              )}

              {door === "teacher" && (
                <p className="mb-5 text-[16px] text-pine/75">
                  Use your school email if your school is on Notesanity. Otherwise any address gets you a classroom of your own, free.
                </p>
              )}

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
                <Label htmlFor="email">{door === "student" ? "School email" : "Your email"}</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={door === "student" || door === "teacher" ? "you@school.edu" : "you@example.com"}
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
