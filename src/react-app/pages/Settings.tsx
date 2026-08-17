import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import Shell, { Avatar, ErrorNote, Spinner } from "../components/Shell";
import { Button, ButtonLink, Card, Chip, Input, Label, Select } from "../components/ui";
import { api } from "../lib/api";
import { signOutHref, useSession } from "../lib/session";
import { cn, relativeTime } from "../lib/utils";

interface MailEntry {
  address: string;
  kind: string;
  status: string;
  detail: string;
  created_at: string;
}

interface OrgResponse {
  name: string;
  primaryDomain: string;
  teacherDomains: string;
  studentDomains: string;
  canEdit: boolean;
}

interface OrgUser {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  role: "teacher" | "student" | "pending";
  is_admin: number;
  last_seen_at: string | null;
}

function OrgSettings() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["org"],
    queryFn: () => api.get<OrgResponse>("/api/org"),
  });

  const [name, setName] = useState("");
  const [teacherDomains, setTeacherDomains] = useState("");
  const [studentDomains, setStudentDomains] = useState("");

  useEffect(() => {
    if (data) {
      setName(data.name);
      setTeacherDomains(data.teacherDomains);
      setStudentDomains(data.studentDomains);
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: () => api.patch("/api/org", { name, teacherDomains, studentDomains }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["org"] });
      toast.success("School settings saved");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorNote error={(error as Error) ?? new Error("Couldn't load school settings")} />;

  return (
    <Card className="p-5">
      <h2 className="font-display text-[17px] text-pine">School settings</h2>
      <p className="mt-1 text-[16px] text-pine/70">
        Only these domains can sign in. Anyone else gets no email and no account — so if staff aren't receiving
        sign-in links, check their domain is listed here first.
      </p>
      <p className="mt-2 text-[16px] text-pine/70">
        Currently allowed: <span className="font-display font-bold text-pine">
          {[data?.primaryDomain, data?.teacherDomains, data?.studentDomains].filter(Boolean).join(", ")}
        </span>
      </p>

      <div className="mt-4 space-y-3">
        <div>
          <Label>School name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <Label>Teacher domains (comma-separated)</Label>
          <Input
            value={teacherDomains}
            onChange={(e) => setTeacherDomains(e.target.value)}
            placeholder="staff.school.edu"
            className="mt-1.5"
          />
        </div>
        <div>
          <Label>Student domains (comma-separated)</Label>
          <Input
            value={studentDomains}
            onChange={(e) => setStudentDomains(e.target.value)}
            placeholder="students.school.edu"
            className="mt-1.5"
          />
        </div>
        <Button type="button" variant="primary" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </Card>
  );
}

/**
 * What actually happened to recent sign-in emails.
 *
 * The sign-in endpoint answers the same way whether it sent, refused or failed,
 * so without this an admin has no way to tell a misconfigured domain from a
 * spam filter — the two look identical from the outside.
 */
function MailLog() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["org-mail"],
    queryFn: () => api.get<{ entries: MailEntry[] }>("/api/org/mail"),
  });

  const TONE: Record<string, { label: string; className: string; hint: string }> = {
    sent: { label: "Sent", className: "text-pine", hint: "Handed to the mail provider. If it didn't arrive, it was filtered after this point." },
    refused_domain: { label: "Not sent", className: "text-[#a3341f]", hint: "That domain isn't on the allowlist above, so no email was sent." },
    rate_limited: { label: "Rate limited", className: "text-[#8a6a1f]", hint: "Only three sign-in emails can go out per minute. They can try again shortly." },
    failed: { label: "Failed", className: "text-[#a3341f]", hint: "The mail provider rejected it." },
  };

  return (
    <Card className="p-5">
      <h2 className="font-display text-[17px] text-pine">Sign-in email delivery</h2>
      <p className="mt-1 text-[16px] text-pine/70">
        The last 50 attempts. Everyone sees the same "check your email" message when they request a link, so this is
        the only place the difference shows.
      </p>
      {isLoading && <Spinner />}
      {error && <ErrorNote error={error as Error} />}
      {data && data.entries.length === 0 && (
        <p className="mt-4 text-[16px] text-pine/70">No sign-in emails requested yet.</p>
      )}
      {data && data.entries.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[420px] text-[16px]">
            <tbody className="divide-y divide-pine/10">
              {data.entries.map((e, i) => {
                const tone = TONE[e.status] ?? { label: e.status, className: "text-pine/70", hint: "" };
                return (
                  <tr key={i}>
                    <td className="py-2 pr-3 text-pine">{e.address}</td>
                    <td className={cn("whitespace-nowrap py-2 pr-3 font-display font-bold", tone.className)}
                        title={tone.hint}>
                      {tone.label}
                    </td>
                    <td className="whitespace-nowrap py-2 text-right text-pine/55">{relativeTime(e.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function OrgUsers() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["org-users"],
    queryFn: () => api.get<{ users: OrgUser[] }>("/api/org/users"),
  });

  const mutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: "teacher" | "student" }) =>
      api.patch(`/api/org/users/${id}`, { role }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["org-users"] });
      toast.success("Role updated");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorNote error={(error as Error) ?? new Error("Couldn't load users")} />;

  return (
    <Card className="mt-6">
      <h2 className="p-5 pb-0 font-display text-[17px] text-pine">People</h2>
      <ul className="mt-3 divide-y divide-pine/15">
        {data.users.map((u) => (
          <li key={u.id} className="flex items-center gap-3 px-5 py-3">
            <Avatar name={u.name} picture={u.picture} size={32} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-display text-pine">
                {u.name} {u.is_admin ? <span className="text-[16px] font-sans font-normal text-pine/60">(admin)</span> : null}
              </span>
              <span className="block truncate text-[16px] text-pine/70">{u.email}</span>
            </span>
            <Select
              value={u.role === "pending" ? "" : u.role}
              onChange={(e) => mutation.mutate({ id: u.id, role: e.target.value as "teacher" | "student" })}
              disabled={mutation.isPending}
              className="min-h-[40px] w-auto shrink-0 px-2 text-[16px]"
            >
              <option value="" disabled>
                Pending
              </option>
              <option value="teacher">Teacher</option>
              <option value="student">Student</option>
            </Select>
          </li>
        ))}
      </ul>
    </Card>
  );
}

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

      {user.isAdmin && (
        <>
          <OrgSettings />
          <MailLog />
          <OrgUsers />
        </>
      )}
    </Shell>
  );
}
