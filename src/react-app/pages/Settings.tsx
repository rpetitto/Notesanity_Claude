import { LogOut, RotateCcw } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Shell, { Avatar, ErrorNote, Spinner } from "../components/Shell";
import { useSession, signOutHref } from "../lib/session";
import { api } from "../lib/api";
import { Button, ButtonLink, Card, Chip } from "../components/ui";

export default function Settings() {
  const { user, isLoading } = useSession();
  const qc = useQueryClient();

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
          {user.role}
          {user.isAdmin ? " · admin" : ""}
        </Chip>
        <ButtonLink href={signOutHref} variant="secondary" size="sm" className="shrink-0">
          <LogOut className="h-4 w-4" strokeWidth={2.5} />
          Sign out
        </ButtonLink>
      </Card>

      <Card className="mb-6 p-5">
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
      </Card>

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
