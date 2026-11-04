import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { BookOpen, CreditCard, KeyRound, LogOut, RotateCcw } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Shell, { Avatar, ErrorNote, Spinner } from "../components/Shell";
import { useSession, signOutHref, type Plan } from "../lib/session";
import { api } from "../lib/api";
import { Button, ButtonLink, Card, Chip, Input } from "../components/ui";
import { FREE_NOTEBOOK_LIMIT, FREE_STUDENT_LIMIT } from "../../shared/plans.mjs";

const dollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

/** One plain sentence per way of having a plan, keyed by how the plan was reached. */
const PLAN_BLURBS: Record<Plan["source"], string> = {
  free: `Up to ${FREE_NOTEBOOK_LIMIT} class notebooks, up to ${FREE_STUDENT_LIMIT} students in each class, and every marking tool.`,
  pro: "Unlimited class notebooks, plus a page library you can reuse across them.",
  department: "A Pro seat from your school's department bundle — unlimited notebooks and the page library.",
  school: "Everything Notesanity does, for every teacher in your school, plus the admin panel.",
};

/**
 * What the person is on, and the one thing they can do about it.
 *
 * During the beta that one thing is nothing — everything is open — so the card
 * says so plainly and names the price that's coming, rather than hiding a
 * button. A page that says "free" without saying "for now" reads as a
 * bait-and-switch the moment it changes.
 */
function PlanCard({ plan, isTeacher }: { plan: Plan; isTeacher: boolean }) {
  const go = useMutation({
    mutationFn: (path: "/api/billing/checkout" | "/api/billing/portal") => api.post<{ url: string }>(path),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (e: Error) => toast.error(e.message),
  });

  const { quota } = plan;
  const usage = quota.unlimited
    ? quota.limit === null
      ? "Unlimited class notebooks."
      : `${quota.used} of ${quota.limit} class notebooks — unlimited while Notesanity is in beta.`
    : `${quota.used} of ${quota.limit} class notebooks.`;

  return (
    <Card className="mb-6 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-[17px] text-pine">Plan</h2>
        <Chip tone="quiet">{plan.label}</Chip>
        {plan.beta && <Chip>Free while in beta</Chip>}
      </div>
      <p className="mt-1 text-[16px] text-pine/70">
        {usage}
        {plan.renewsAt && (
          <> {plan.cancelAtPeriodEnd ? "Ends" : "Renews"} on {new Date(plan.renewsAt).toLocaleDateString("en-US")}.</>
        )}
      </p>
      {isTeacher && (
        <p className="mt-2 text-[16px] text-pine/70">
          {PLAN_BLURBS[plan.source]}{" "}
          <a href="/pricing" className="font-bold text-pine underline decoration-2 underline-offset-2 hover:bg-mint/40">
            Compare plans
          </a>
        </p>
      )}
      {plan.seats && (
        <p className="mt-2 text-[16px] text-pine/70">
          Department seats: {plan.seats.used} of {plan.seats.total} assigned — hand them out under Admin › People.
        </p>
      )}
      {plan.canUpgrade && (
        <Button variant="primary" className="mt-3" disabled={go.isPending} onClick={() => go.mutate("/api/billing/checkout")}>
          <CreditCard className="h-4 w-4" strokeWidth={2.5} />
          Upgrade to Pro — {dollars(plan.prices.pro)}/year
        </Button>
      )}
      {plan.hasPortal && (
        <Button variant="secondary" className="mt-3" disabled={go.isPending} onClick={() => go.mutate("/api/billing/portal")}>
          Manage billing
        </Button>
      )}
    </Card>
  );
}

/**
 * Every teacher gets the getting-started notebook once. This is how they get
 * it again — after deleting it, or to see what's been added since.
 */
function GuideCard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["guide-available"], queryFn: () => api.get<{ available: boolean }>("/api/my/guide") });
  const get = useMutation({
    mutationFn: () => api.post<{ notebook: { id: string } }>("/api/my/guide", {}),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["teaching-notebooks"] });
      toast.success("A fresh copy of the guide is in your templates");
      navigate(`/notebooks/${r.notebook.id}/edit`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!status.data?.available) return null;
  return (
    <Card className="mb-6 p-5">
      <h2 className="font-display text-[17px] text-pine">Getting-started guide</h2>
      <p className="mt-1 text-[16px] text-pine/70">
        A notebook that shows you each feature by having you try it. Get a fresh copy any time — it goes in
        Notebooks → Templates, and your old copy stays as it is.
      </p>
      <Button variant="secondary" className="mt-3" disabled={get.isPending} onClick={() => get.mutate()}>
        <BookOpen className="h-4 w-4" strokeWidth={2.5} />
        {get.isPending ? "Copying…" : "Get the latest guide"}
      </Button>
    </Card>
  );
}

/**
 * Set, change or reset a password.
 *
 * A reset link lands here with ?reset=1, and for twenty minutes that session
 * may choose a new password without the old one — the link already proved
 * the address. Saving signs out every other device.
 */
function PasswordCard({ resetting, onDone }: { resetting: boolean; onDone: () => void }) {
  const methods = useQuery({ queryKey: ["auth-methods"], queryFn: () => api.get<{ password: boolean; local: boolean }>("/api/auth/methods") });
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const save = useMutation({
    mutationFn: () => api.post("/api/auth/password/change", { currentPassword: current, newPassword: next }),
    onSuccess: () => {
      setCurrent(""); setNext("");
      methods.refetch();
      toast.success("Password saved. Any other devices were signed out.");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!methods.data?.local) return null;
  const has = methods.data.password;
  const askCurrent = has && !resetting;
  return (
    <Card className="mb-6 p-5" data-testid="password-card">
      <h2 className="font-display text-[17px] text-pine">{resetting ? "Choose a new password" : has ? "Password" : "Add a password"}</h2>
      <p className="mt-1 text-[16px] text-pine/70">
        {resetting
          ? "You came here from a reset link, so you don't need the old one."
          : has
            ? "Change the password you sign in with. Saving signs you out on every other device."
            : "You sign in with Google or an email link. Add a password if you'd like another way in."}
      </p>
      <form className="mt-3 grid gap-3 sm:max-w-md" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        {askCurrent && (
          <label className="block">
            <span className="label-caps mb-1 block text-pine/70">Current password</span>
            <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </label>
        )}
        <label className="block">
          <span className="label-caps mb-1 block text-pine/70">New password</span>
          <Input type="password" autoComplete="new-password" minLength={10} value={next} onChange={(e) => setNext(e.target.value)} />
          <span className="mt-1 block text-[15px] text-pine/60">At least 10 characters.</span>
        </label>
        <div>
          <Button type="submit" variant="secondary" disabled={save.isPending || next.length < 10 || (askCurrent && !current)}>
            <KeyRound className="h-4 w-4" strokeWidth={2.5} />
            {save.isPending ? "Saving…" : "Save password"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function Settings() {
  const { user, plan, isLoading } = useSession();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();

  /**
   * Clear the record of which tours have been seen.
   *
   * The cached session is corrected in place as well as on the server —
   * otherwise the guides wouldn't come back until the session query went
   * stale, which reads as the button having done nothing.
   */
  const replay = useMutation({
    mutationFn: () => api.del("/api/me/tours"),
    onSuccess: () => {
      qc.setQueryData(["me"], (old: any) =>
        old?.user ? { ...old, user: { ...old.user, toursSeen: [] } } : old,
      );
      toast.success("The tours will show again");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /*
   * Back from Checkout. The webhook is usually seconds behind the redirect,
   * so the session is confirmed here — otherwise this page would greet a
   * teacher who just paid with "Free".
   */
  const billing = params.get("billing");
  const sessionId = params.get("session_id");
  useEffect(() => {
    if (billing !== "success" || !sessionId) return;
    api.post("/api/billing/confirm", { sessionId })
      .then(() => { qc.invalidateQueries({ queryKey: ["me"] }); toast.success("You're on Pro. Thank you!"); })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setParams({}, { replace: true }));
  }, [billing, sessionId, qc, setParams]);

  if (isLoading) {
    return (
      <Shell>
        <Spinner />
      </Shell>
    );
  }
  if (!user) {
    return (
      <Shell>
        <ErrorNote error={new Error("Not signed in")} />
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="mb-6 font-display text-[32px] text-pine">Settings</h1>

      <Card className="mb-6 flex items-center gap-4 p-5">
        <Avatar name={user.name} picture={user.picture} size={52} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-[17px] text-pine">{user.name}</div>
          <div className="truncate text-[16px] text-pine/70">{user.email}</div>
        </div>
        <Chip tone="quiet" className="shrink-0 capitalize">
          {user.role === "guardian" ? "Family" : user.role}
          {user.isAdmin ? " · admin" : ""}
        </Chip>
        <ButtonLink href={signOutHref} variant="secondary" size="sm" className="shrink-0">
          <LogOut className="h-4 w-4" strokeWidth={2.5} />
          Sign out
        </ButtonLink>
      </Card>

      <PasswordCard
        resetting={params.get("reset") === "1"}
        onDone={() => { if (params.get("reset")) setParams({}, { replace: true }); }}
      />

      {/* A teacher who is also a parent here: the way to their children, kept
          off the main menu, which is already full for a teacher. */}
      {user.role !== "guardian" && (user.childCount ?? 0) > 0 && (
        <Card className="mb-6 flex flex-wrap items-center gap-3 p-5">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[17px] text-pine">My children</h2>
            <p className="mt-1 text-[16px] text-pine/70">Your {user.childCount === 1 ? "child's" : "children's"} notebooks and assignments, to look at.</p>
          </div>
          <ButtonLink to="/family" variant="secondary" size="sm">Open</ButtonLink>
        </Card>
      )}

      {/* Students have nothing to buy and nothing to manage, so the card is theirs to not see. */}
      {plan && user.role === "teacher" && <PlanCard plan={plan} isTeacher />}

      {user.role === "teacher" && <GuideCard />}

      {user.role !== "guardian" && <Card className="mb-6 p-5">
        <h2 className="font-display text-[17px] text-pine">Guided tours</h2>
        <p className="mt-1 text-[16px] text-pine/70">
          The short walkthroughs of your home screen, a class and a notebook. Start them over and
          you'll see each one again the next time you open that screen.
        </p>
        <Button
          variant="secondary"
          className="mt-3"
          disabled={replay.isPending}
          onClick={() => replay.mutate()}
        >
          <RotateCcw className="h-4 w-4" strokeWidth={2.5} />
          {replay.isPending ? "Resetting…" : "Show the tours again"}
        </Button>
      </Card>}

      {/* School-wide administration lives on the Admin page now, so this page
          stays about the person using it. */}
      {user.isAdmin && (
        <Card className="p-5">
          <h2 className="font-display text-[17px] text-pine">School administration</h2>
          <p className="mt-1 text-[16px] text-pine/70">
            Domains, people and sign-in email delivery have moved to the Admin page.
          </p>
          <ButtonLink to="/admin" variant="secondary" className="mt-3">Open Admin</ButtonLink>
        </Card>
      )}
    </Shell>
  );
}
