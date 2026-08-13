import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import Shell, { Avatar, ErrorNote, Spinner } from "../components/Shell";
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
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">School settings</h2>
      <p className="mt-1 text-sm text-slate-500">
        Domains listed as teacher or student automatically get that role on first sign-in. Everyone else chooses their
        role themselves.
      </p>

      <div className="mt-4 space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">School name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Teacher domains (comma-separated)</label>
          <input
            value={teacherDomains}
            onChange={(e) => setTeacherDomains(e.target.value)}
            placeholder="staff.school.edu"
            className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Student domains (comma-separated)</label>
          <input
            value={studentDomains}
            onChange={(e) => setStudentDomains(e.target.value)}
            placeholder="students.school.edu"
            className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="h-10 rounded-full bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {mutation.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
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
    <div className="mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
      <h2 className="p-5 pb-0 text-base font-semibold text-slate-900">People</h2>
      <ul className="mt-3 divide-y divide-slate-100">
        {data.users.map((u) => (
          <li key={u.id} className="flex items-center gap-3 px-5 py-3">
            <Avatar name={u.name} picture={u.picture} size={32} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-slate-900">
                {u.name} {u.is_admin ? <span className="text-xs font-normal text-blue-600">(admin)</span> : null}
              </span>
              <span className="block truncate text-xs text-slate-500">{u.email}</span>
            </span>
            <select
              value={u.role === "pending" ? "" : u.role}
              onChange={(e) => mutation.mutate({ id: u.id, role: e.target.value as "teacher" | "student" })}
              disabled={mutation.isPending}
              className="h-9 shrink-0 rounded-lg border border-slate-300 px-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="" disabled>
                Pending
              </option>
              <option value="teacher">Teacher</option>
              <option value="student">Student</option>
            </select>
          </li>
        ))}
      </ul>
    </div>
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
      <h1 className="mb-6 text-2xl font-semibold tracking-tight text-slate-900">Settings</h1>

      <div className="mb-6 flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <Avatar name={user.name} picture={user.picture} size={52} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold text-slate-900">{user.name}</div>
          <div className="truncate text-sm text-slate-500">{user.email}</div>
        </div>
        <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium capitalize text-slate-600">
          {user.role}
          {user.isAdmin ? " · admin" : ""}
        </span>
        <a
          href={signOutHref}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-slate-300 px-3 text-sm text-slate-600 hover:bg-slate-50"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </a>
      </div>

      {user.isAdmin && (
        <>
          <OrgSettings />
          <OrgUsers />
        </>
      )}
    </Shell>
  );
}
