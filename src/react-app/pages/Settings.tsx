import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import Shell, { Avatar, ErrorNote, Spinner } from "../components/Shell";
import { Button, ButtonLink, Card, Chip, Input, Label, Select } from "../components/ui";
import { api } from "../lib/api";
import { signOutHref, useSession } from "../lib/session";

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
      <p className="mt-1 text-[15px] text-pine/70">
        Domains listed as teacher or student automatically get that role on first sign-in. Everyone else chooses their
        role themselves.
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
                {u.name} {u.is_admin ? <span className="text-[13px] font-sans font-normal text-pine/60">(admin)</span> : null}
              </span>
              <span className="block truncate text-[13px] text-pine/70">{u.email}</span>
            </span>
            <Select
              value={u.role === "pending" ? "" : u.role}
              onChange={(e) => mutation.mutate({ id: u.id, role: e.target.value as "teacher" | "student" })}
              disabled={mutation.isPending}
              className="min-h-[40px] w-auto shrink-0 px-2 text-[13px]"
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
          <div className="truncate text-[15px] text-pine/70">{user.email}</div>
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
          <OrgUsers />
        </>
      )}
    </Shell>
  );
}
