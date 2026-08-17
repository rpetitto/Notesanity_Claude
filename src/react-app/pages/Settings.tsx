import { LogOut } from "lucide-react";
import Shell, { Avatar, ErrorNote, Spinner } from "../components/Shell";
import { useSession, signOutHref } from "../lib/session";
import { ButtonLink, Card, Chip } from "../components/ui";

export default function Settings() {
  const { user, isLoading } = useSession();

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
