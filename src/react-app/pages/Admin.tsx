/**
 * The superadmin console.
 *
 * Everything in the system, as tables you can read and — where it's safe —
 * edit in place. The grid is `glide-data-grid`, which draws to canvas rather
 * than the DOM, so a few thousand rows scroll without the browser building a
 * few thousand elements.
 *
 * Editing is limited to what the server's allowlist accepts: names, roles,
 * titles, grades. There are no deletes here on purpose — a spreadsheet cell
 * makes destruction look like a typo, and the screens that already delete
 * things explain what they take with them.
 *
 * This module is loaded on demand (see App.tsx). The grid is a large
 * dependency and no student should ever download it.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DataEditor, GridCellKind,
  type EditableGridCell, type GridCell, type GridColumn, type Item,
} from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import { toast } from "sonner";
import Shell, { Avatar, ErrorNote, Spinner } from "../components/Shell";
import { Button, Card, Input, Label, Select } from "../components/ui";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { cn, relativeTime } from "../lib/utils";

type ColumnKind = "text" | "number" | "boolean";

interface AdminColumn {
  id: string;
  title: string;
  width?: number;
  kind?: ColumnKind;
  /** Absent means read-only, which is the default. */
  editable?: boolean;
}

interface TableSpec {
  key: string;
  label: string;
  /** The `/api/admin/:kind` segment used for both reading and writing. */
  endpoint: string;
  /** The table name the server accepts edits for, when different. */
  writeKind?: string;
  columns: AdminColumn[];
  hint: string;
}

const TABLES: TableSpec[] = [
  {
    key: "orgs",
    label: "Schools",
    endpoint: "orgs",
    hint: "Sign-in resolves a person to a school by their email domain. The primary domain is fixed once accounts exist under it.",
    columns: [
      { id: "name", title: "School", width: 200, editable: true },
      { id: "primary_domain", title: "Primary domain", width: 190 },
      { id: "teacher_domains", title: "Teacher domains", width: 200, editable: true },
      { id: "student_domains", title: "Student domains", width: 200, editable: true },
      { id: "users", title: "People", width: 90, kind: "number" },
      { id: "classes", title: "Classes", width: 90, kind: "number" },
      { id: "plan", title: "Plan", width: 110 },
    ],
  },
  {
    key: "users",
    label: "Users",
    endpoint: "users",
    hint: "Role and admin rights are editable. A superadmin can appoint school admins here.",
    columns: [
      { id: "email", title: "Email", width: 240 },
      { id: "name", title: "Name", width: 170, editable: true },
      { id: "role", title: "Role", width: 100, editable: true },
      { id: "is_admin", title: "Admin", width: 80, kind: "boolean", editable: true },
      { id: "is_superadmin", title: "Superadmin", width: 110, kind: "boolean", editable: true },
      { id: "classes", title: "Classes", width: 80, kind: "number" },
      { id: "last_seen_at", title: "Last seen", width: 130 },
    ],
  },
  {
    key: "notebooks",
    label: "Notebooks",
    endpoint: "notebooks",
    hint: "Title and published status are editable.",
    columns: [
      { id: "title", title: "Title", width: 230, editable: true },
      { id: "class_name", title: "Class", width: 160 },
      { id: "owner_email", title: "Owner", width: 210 },
      { id: "status", title: "Status", width: 110, editable: true },
      { id: "page_count", title: "Pages", width: 80, kind: "number" },
      { id: "assignments", title: "Assignments", width: 110, kind: "number" },
      { id: "updated_at", title: "Updated", width: 130 },
    ],
  },
  {
    key: "assignments",
    label: "Assignments",
    endpoint: "assignments",
    hint: "Title, due date, status and points are editable.",
    columns: [
      { id: "title", title: "Title", width: 200, editable: true },
      { id: "class_name", title: "Class", width: 150 },
      { id: "notebook_title", title: "Notebook", width: 180 },
      { id: "status", title: "Status", width: 100, editable: true },
      { id: "due_at", title: "Due", width: 130, editable: true },
      { id: "points_max", title: "Points", width: 80, kind: "number", editable: true },
      { id: "submissions", title: "Handed in", width: 100, kind: "number" },
      { id: "graded", title: "Graded", width: 90, kind: "number" },
    ],
  },
  {
    key: "grades",
    label: "Grades",
    endpoint: "grades",
    writeKind: "submissions",
    hint: "Points, letter and feedback are editable. Changes here bypass the grading screen — use it deliberately.",
    columns: [
      { id: "student_email", title: "Student", width: 220 },
      { id: "assignment", title: "Assignment", width: 190 },
      { id: "class_name", title: "Class", width: 140 },
      { id: "status", title: "Status", width: 110, editable: true },
      { id: "grade_points", title: "Points", width: 80, kind: "number", editable: true },
      { id: "points_max", title: "Out of", width: 80, kind: "number" },
      { id: "grade_letter", title: "Letter", width: 80, editable: true },
      { id: "feedback", title: "Feedback", width: 260, editable: true },
    ],
  },
  {
    key: "school",
    label: "School",
    endpoint: "",
    hint: "",
    columns: [],
  },
  {
    key: "logs",
    label: "API errors",
    endpoint: "logs",
    hint: "Failed requests only — the last 500. Successful calls aren't recorded; a write per request would cost more than it explains.",
    columns: [
      { id: "created_at", title: "When", width: 140 },
      { id: "status", title: "Status", width: 80, kind: "number" },
      { id: "method", title: "Method", width: 90 },
      { id: "path", title: "Path", width: 300 },
      { id: "message", title: "Message", width: 320 },
      { id: "user_email", title: "User", width: 200 },
      { id: "org_name", title: "School", width: 160 },
      { id: "duration_ms", title: "ms", width: 70, kind: "number" },
    ],
  },
  {
    key: "impersonations",
    label: "Impersonation log",
    endpoint: "impersonations",
    hint: "Every time a superadmin viewed as someone else, and why. Read-only — this is the audit trail.",
    columns: [
      { id: "started_at", title: "Started", width: 140 },
      { id: "superadmin_email", title: "Superadmin", width: 200 },
      { id: "target_email", title: "Viewed as", width: 200 },
      { id: "reason", title: "Reason", width: 280 },
      { id: "expires_at", title: "Expires", width: 140 },
      { id: "ended_at", title: "Ended", width: 140 },
    ],
  },
];

/** The oversight tables a school's own admin sees, alongside the school tab. Read-only — see AdminGrid's scope handling. */
const ORG_TABLES = TABLES.filter((t) => t.key === "notebooks" || t.key === "assignments" || t.key === "grades");

/** Dates render as "3 hours ago"; everything else as given. */
const display = (columnId: string, value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (/_at$/.test(columnId) && typeof value === "string" && value) {
    return relativeTime(value);
  }
  return String(value);
};

/** How many rows one page of a console table holds. */
const PAGE_SIZE = 100;

/**
 * Adding a school, which the grid can't do — it edits rows, it doesn't create
 * them. A school is the unit of tenancy: everyone whose email domain resolves
 * here lands in it, and never sees another one's classes.
 */
function NewSchool() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [open, setOpen] = useState(false);

  const create = useMutation({
    mutationFn: () =>
      api.post("/api/admin/orgs", { name, primaryDomain: domain }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "orgs"] });
      toast.success(`${name} added`);
      setName(""); setDomain(""); setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Add a school
      </Button>
    );
  }

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => { e.preventDefault(); create.mutate(); }}
    >
      <div>
        <Label htmlFor="school-name">School</Label>
        <Input id="school-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Westfield District" className="h-11" />
      </div>
      <div>
        <Label htmlFor="school-domain">Primary domain</Label>
        <Input id="school-domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="westfield.edu" className="h-11" />
      </div>
      <Button type="submit" disabled={create.isPending || !name.trim() || !domain.trim()}>
        {create.isPending ? "Adding…" : "Add"}
      </Button>
      <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
    </form>
  );
}

/**
 * Start a support session as another user, by email — the fastest way to see
 * what someone is actually seeing. A reason is required because it's the
 * whole point of the audit trail below; the session is read-only and expires
 * on its own in 30 minutes even if nobody remembers to exit it.
 */
function StartImpersonation() {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);

  const start = useMutation({
    mutationFn: async () => {
      const found = await api.get<{ rows: { id: string; email: string }[] }>(
        `/api/admin/users?q=${encodeURIComponent(email.trim())}&limit=5`,
      );
      const match = found.rows.find((r) => r.email.toLowerCase() === email.trim().toLowerCase());
      if (!match) throw new Error(`No account matches "${email.trim()}" exactly`);
      return api.post<{ targetName: string }>("/api/admin/impersonate", { targetUserId: match.id, reason });
    },
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ["me"] });
      toast.success(`Viewing as ${res.targetName} — reload any open tab to see it`);
      setEmail(""); setReason(""); setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        View as a user
      </Button>
    );
  }

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => { e.preventDefault(); start.mutate(); }}
    >
      <div>
        <Label htmlFor="impersonate-email">Their email</Label>
        <Input id="impersonate-email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teacher@school.edu" className="h-11" />
      </div>
      <div>
        <Label htmlFor="impersonate-reason">Reason (goes on the record)</Label>
        <Input id="impersonate-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ticket #4821 — can't see roster" className="h-11 w-64" />
      </div>
      <Button type="submit" disabled={start.isPending || !email.trim() || !reason.trim()}>
        {start.isPending ? "Starting…" : "Start"}
      </Button>
      <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
    </form>
  );
}

/**
 * Switch a school's plan on by hand — the whole of the invoice/PO path.
 *
 * A reason is required because this writes the audit trail; a Pro comp also
 * needs to know whose it is. Department seats are not chosen here: the school
 * knows its own department, so its admin hands those out under People.
 */
function CompPlan() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [orgId, setOrgId] = useState("");
  const [plan, setPlan] = useState("school");
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [seatEmail, setSeatEmail] = useState("");

  const orgs = useQuery({
    queryKey: ["admin", "orgs", "picker"],
    queryFn: () => api.get<{ rows: { id: string; name: string }[] }>(`/api/admin/orgs?limit=500`),
    enabled: open,
  });

  const comp = useMutation({
    mutationFn: () =>
      api.post<{ plan: string; seats: number | null }>(`/api/admin/orgs/${orgId}/plan`, {
        plan, reason, expiresAt: expiresAt || undefined, seatEmail: seatEmail || undefined,
      }),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ["admin", "orgs"] });
      toast.success(
        res.plan === "department"
          ? `Department plan set — ${res.seats} seats. The school's admin assigns them under My School › People.`
          : res.plan === "free" ? "Plan removed" : `${res.plan} plan set`,
      );
      setReason(""); setExpiresAt(""); setSeatEmail(""); setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Set a plan
      </Button>
    );
  }

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => { e.preventDefault(); comp.mutate(); }}
    >
      <div>
        <Label htmlFor="comp-org">School</Label>
        <Select id="comp-org" value={orgId} onChange={(e) => setOrgId(e.target.value)} className="h-11">
          <option value="">Choose…</option>
          {(orgs.data?.rows ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </Select>
      </div>
      <div>
        <Label htmlFor="comp-plan">Plan</Label>
        <Select id="comp-plan" value={plan} onChange={(e) => setPlan(e.target.value)} className="h-11">
          <option value="school">School</option>
          <option value="department">Department (20 seats)</option>
          <option value="pro">Pro (one teacher)</option>
          <option value="free">Free — end the comp</option>
        </Select>
      </div>
      {plan === "pro" && (
        <div>
          <Label htmlFor="comp-email">Teacher's email</Label>
          <Input id="comp-email" value={seatEmail} onChange={(e) => setSeatEmail(e.target.value)} placeholder="teacher@school.edu" className="h-11" />
        </div>
      )}
      <div>
        <Label htmlFor="comp-reason">Reason (goes on the record)</Label>
        <Input id="comp-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="PO #4821, paid 9/14" className="h-11 w-56" />
      </div>
      <div>
        <Label htmlFor="comp-expires">Until (optional)</Label>
        <Input id="comp-expires" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="h-11" />
      </div>
      <Button type="submit" disabled={comp.isPending || !orgId || !reason.trim() || (plan === "pro" && !seatEmail.trim())}>
        {comp.isPending ? "Saving…" : "Set plan"}
      </Button>
      <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
    </form>
  );
}

/** Which base path a grid reads/writes — the superadmin console or one school's own view. */
type AdminScope = "admin" | "org";

function AdminGrid({ spec, scope = "admin" }: { spec: TableSpec; scope?: AdminScope }) {
  const qc = useQueryClient();
  const [term, setTerm] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [orgFilter, setOrgFilter] = useState("");
  const base = `/api/${scope}`;
  const showOrgFilter = scope === "admin" && spec.endpoint === "logs";
  const queryKey = [scope, spec.endpoint, q, offset, orgFilter];

  // Typing shouldn't put a query on the wire per keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(term.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [term]);

  const orgs = useQuery({
    queryKey: ["admin", "orgs", "picker"],
    queryFn: () => api.get<{ rows: { id: string; name: string }[] }>(`/api/admin/orgs?limit=500`),
    enabled: showOrgFilter,
  });

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey,
    queryFn: () =>
      api.get<{ rows: Record<string, unknown>[]; total: number }>(
        `${base}/${spec.endpoint}?limit=${PAGE_SIZE}&offset=${offset}${q ? `&q=${encodeURIComponent(q)}` : ""}${orgFilter ? `&org_id=${encodeURIComponent(orgFilter)}` : ""}`,
      ),
    // Keeps the previous page painted while the next one loads, so paging
    // doesn't flash a spinner over the grid.
    placeholderData: (prev) => prev,
  });
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const total = data?.total ?? 0;

  const save = useMutation({
    mutationFn: ({ id, column, value }: { id: string; column: string; value: unknown }) =>
      api.patch(`${base}/${spec.writeKind ?? spec.endpoint}/${id}`, { column, value }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
    onError: (e: Error) => {
      toast.error(e.message);
      // The grid already painted the new value optimistically; refetching puts
      // the rejected cell back to what the server actually holds.
      qc.invalidateQueries({ queryKey });
    },
  });

  const columns: GridColumn[] = useMemo(
    () => spec.columns.map((c) => ({ title: c.title, id: c.id, width: c.width ?? 150 })),
    [spec],
  );

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const column = spec.columns[col];
      const record = rows[row];
      const raw = record?.[column.id];
      // The org-scoped console has no write endpoints — it's oversight, not
      // the place to bypass the grading screen — so nothing in it is editable
      // regardless of what the table spec allows in superadmin mode.
      const editable = scope === "admin" && !!column.editable;

      if (column.kind === "boolean") {
        return { kind: GridCellKind.Boolean, data: !!raw, allowOverlay: false, readonly: !editable };
      }
      if (column.kind === "number") {
        return {
          kind: GridCellKind.Number,
          data: typeof raw === "number" ? raw : Number(raw ?? 0),
          displayData: raw === null || raw === undefined ? "" : String(raw),
          allowOverlay: editable,
          readonly: !editable,
        };
      }
      const text = display(column.id, raw);
      return {
        kind: GridCellKind.Text,
        // Edits start from the stored value, not the prettified one — otherwise
        // editing a date would replace it with "3 hours ago".
        data: raw === null || raw === undefined ? "" : String(raw),
        displayData: text,
        allowOverlay: editable,
        readonly: !editable,
      };
    },
    [rows, spec, scope],
  );

  const onCellEdited = useCallback(
    ([col, row]: Item, newValue: EditableGridCell) => {
      const column = spec.columns[col];
      const record = rows[row];
      if (scope !== "admin" || !column?.editable || !record?.id) return;
      const value =
        newValue.kind === GridCellKind.Boolean ? !!newValue.data
        : newValue.kind === GridCellKind.Number ? newValue.data ?? null
        : String(newValue.data ?? "");
      save.mutate({ id: String(record.id), column: column.id, value });
    },
    [rows, spec, save, scope],
  );

  if (isLoading) return <Spinner label={`Loading ${spec.label.toLowerCase()}…`} />;
  if (error) return <ErrorNote error={error as Error} />;

  const from = total === 0 ? 0 : offset + 1;
  const to = offset + rows.length;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={`Search ${spec.label.toLowerCase()}…`}
          className="h-11 w-full max-w-xs"
          aria-label={`Search ${spec.label.toLowerCase()}`}
        />
        {showOrgFilter && (
          <Select
            value={orgFilter}
            onChange={(e) => { setOrgFilter(e.target.value); setOffset(0); }}
            aria-label="Filter by school"
            className="h-11 w-auto"
          >
            <option value="">All schools</option>
            {(orgs.data?.rows ?? []).map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </Select>
        )}
        <p className="text-[16px] text-pine/70">
          {total === 0
            ? "No matches"
            : `${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()}`}
          {" · "}
          {spec.hint}
          {isFetching && " · updating…"}
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {spec.endpoint === "orgs" && <><NewSchool /><CompPlan /></>}
          {spec.endpoint === "impersonations" && <StartImpersonation />}
          <Button
            variant="secondary"
            size="sm"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            Previous
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={to >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Next
          </Button>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-[12px] border-2 border-pine/20 bg-oat p-4 text-[16px] text-pine/70">
          {q ? `Nothing matches “${q}”.` : "Nothing here yet."}
        </p>
      ) : (
        <div className="overflow-hidden rounded-[12px] border-[3px] border-pine">
          <DataEditor
            columns={columns}
            rows={rows.length}
            getCellContent={getCellContent}
            onCellEdited={onCellEdited}
            rowMarkers="number"
            smoothScrollX
            smoothScrollY
            width="100%"
            height={Math.min(620, Math.max(240, rows.length * 34 + 60))}
            getCellsForSelection
          />
        </div>
      )}
    </div>
  );
}

// ---- school administration, moved here from the Settings page ----

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
  const [term, setTerm] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(term.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [term]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["org-users", q, offset],
    queryFn: () =>
      api.get<{ users: OrgUser[]; total: number }>(
        `/api/org/users?limit=${PAGE_SIZE}&offset=${offset}${q ? `&q=${encodeURIComponent(q)}` : ""}`,
      ),
    placeholderData: (prev) => prev,
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

  // Department seats, if the school has a Department plan to hand out.
  const seats = useQuery({
    queryKey: ["org-seats"],
    queryFn: () => api.get<{ department: { total: number; used: number; holders: string[] } | null }>("/api/org/seats"),
  });
  const department = seats.data?.department ?? null;
  const holders = new Set(department?.holders ?? []);
  const seat = useMutation({
    mutationFn: ({ id, give }: { id: string; give: boolean }) =>
      give ? api.put(`/api/org/seats/${id}`) : api.del(`/api/org/seats/${id}`),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["org-seats"] }),
        qc.invalidateQueries({ queryKey: ["me"] }),
      ]);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorNote error={(error as Error) ?? new Error("Couldn't load users")} />;

  const total = data.total ?? data.users.length;
  const to = offset + data.users.length;

  return (
    <Card className="mt-6">
      <div className="flex flex-wrap items-center gap-3 p-5 pb-0">
        <h2 className="font-display text-[17px] text-pine">People</h2>
        {department && (
          <span className="text-[16px] text-pine/70">Pro seats: {department.used} of {department.total}</span>
        )}
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search by name or email…"
          className="h-11 w-full max-w-xs"
          aria-label="Search people"
        />
        <span className="text-[16px] text-pine/70">
          {total === 0 ? "No matches" : `${(offset + 1).toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()}`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
            Previous
          </Button>
          <Button variant="secondary" size="sm" disabled={to >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
            Next
          </Button>
        </div>
      </div>
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
            {department && u.role === "teacher" && (
              <Button
                variant="secondary"
                size="sm"
                className="shrink-0"
                disabled={seat.isPending}
                onClick={() => seat.mutate({ id: u.id, give: !holders.has(u.id) })}
              >
                {holders.has(u.id) ? "Remove seat" : "Give Pro seat"}
              </Button>
            )}
            <Select
              value={u.role === "pending" ? "" : u.role}
              onChange={(e) => mutation.mutate({ id: u.id, role: e.target.value as "teacher" | "student" })}
              disabled={mutation.isPending}
              className="min-h-[40px] w-auto shrink-0 pl-2 pr-10 text-[16px]"
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


function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[12px] border-2 border-pine/20 bg-white px-3 py-2">
      <div className="font-display text-[24px] leading-none text-pine">{value}</div>
      <div className="label-caps mt-1 text-pine/55">{label}</div>
    </div>
  );
}

/** A school's own admin — everyone but the superadmin sees just this, one tab, no bar to switch away from it. */
function SchoolAdmin() {
  return (
    <Shell wide>
      <h1 className="mb-4 text-2xl text-pine">My School</h1>
      <OrgOverview />
      <div className="mt-4 space-y-4">
        <OrgSettings />
        <MailLog />
        <OrgUsers />
      </div>
      <div className="mt-6 space-y-6">
        {ORG_TABLES.map((spec) => (
          <div key={spec.key}>
            <h2 className="mb-2 font-display text-[17px] text-pine">{spec.label}</h2>
            <AdminGrid spec={spec} scope="org" />
          </div>
        ))}
      </div>
    </Shell>
  );
}

function OrgOverview() {
  const overview = useQuery({
    queryKey: ["org", "overview"],
    queryFn: () => api.get<Record<string, number>>("/api/org/overview"),
  });
  if (!overview.data) return null;
  return (
    <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <Stat label="Users" value={overview.data.users} />
      <Stat label="Teachers" value={overview.data.teachers} />
      <Stat label="Students" value={overview.data.students} />
      <Stat label="Classes" value={overview.data.classes} />
      <Stat label="Notebooks" value={overview.data.notebooks} />
      <Stat label="Assignments" value={overview.data.assignments} />
    </div>
  );
}

export default function Admin() {
  const { user } = useSession();
  const [tab, setTab] = useState(TABLES[0].key);
  const overview = useQuery({
    queryKey: ["admin", "overview"],
    queryFn: () => api.get<Record<string, number>>("/api/admin/overview"),
    enabled: !!user?.isSuperadmin,
  });

  if (!user?.isAdmin && !user?.isSuperadmin) {
    return (
      <Shell>
        <Card className="p-5">
          <h1 className="font-display text-[19px] text-pine">Not available</h1>
          <p className="mt-2 text-[16px] text-pine/70">
            This area is for people who manage a school's account on Notesanity. If that's not you, there's nothing
            to see here.
          </p>
        </Card>
      </Shell>
    );
  }

  // A school's own admin gets exactly the school tab, unlabeled as a subset
  // of a console they otherwise can't see. The full tab bar — every school's
  // data, platform-wide — is superadmin only.
  if (!user?.isSuperadmin) {
    return <SchoolAdmin />;
  }

  const spec = TABLES.find((t) => t.key === tab) ?? TABLES[0];

  return (
    <Shell wide>
      <h1 className="mb-4 text-2xl text-pine">Admin</h1>

      {overview.data && (
        <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          <Stat label="Users" value={overview.data.users} />
          <Stat label="Teachers" value={overview.data.teachers} />
          <Stat label="Students" value={overview.data.students} />
          <Stat label="Classes" value={overview.data.classes} />
          <Stat label="Notebooks" value={overview.data.notebooks} />
          <Stat label="Assignments" value={overview.data.assignments} />
          <Stat label="Submissions" value={overview.data.submissions} />
          <Stat label="Errors 24h" value={overview.data.errorsToday} />
        </div>
      )}

      <div className="mb-5 flex gap-1 overflow-x-auto rounded-full border-[3px] border-pine bg-white p-1">
        {TABLES.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-pressed={tab === t.key}
            className={cn(
              "inline-flex h-11 shrink-0 items-center justify-center rounded-full px-4",
              "font-display text-[17px] font-bold transition-colors",
              tab === t.key ? "bg-pine text-oat" : "text-pine hover:bg-pine/8",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "school" ? (
        <div className="space-y-4">
          <OrgSettings />
          <MailLog />
          <OrgUsers />
        </div>
      ) : (
        <AdminGrid key={spec.key} spec={spec} />
      )}
    </Shell>
  );
}
