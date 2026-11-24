/**
 * The family view: a parent or guardian reading along with their child's work.
 *
 * Read-only throughout. It shows what the child sees of their own work — what's
 * due, where they've got to, the grades and feedback that came back, and their
 * notebooks with their writing and the teacher's marks — and nothing about any
 * other student. The server enforces that; this only lays it out.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BookOpen, Check, ClipboardList, Eye, MessageSquareText, Plus, UserMinus } from "lucide-react";
import { toast } from "sonner";
import Shell, { Avatar, EmptyState, ErrorNote, Spinner } from "../components/Shell";
import { Button, Card, CardLink, Chip, ConfirmModal, Input, Label, Select } from "../components/ui";
import NotebookSurface, { buildLayerMaps, type LayerMap, type ZoomMode } from "../components/NotebookSurface";
import { ZoomSelect } from "../components/InkToolbar";
import type { ToolState } from "../components/PageCanvas";
import { api, type FieldRec, type LayerRec, type PageRec } from "../lib/api";
import { parseLayer, PEN_COLORS } from "../lib/ink";
import { cn, dueLabel } from "../lib/utils";

interface Child {
  id: string;
  name: string;
  picture: string | null;
  open: boolean;
  classes: { id: string; name: string; emoji: string; teacher: string }[];
}

interface FamilyAssignment {
  id: string;
  title: string;
  instructions: string;
  classId: string;
  className: string;
  notebookId: string;
  notebookTitle: string;
  pageIds: string[];
  releaseAt: string | null;
  dueAt: string | null;
  status: "not_started" | "in_progress" | "submitted" | "returned" | string;
  submittedAt: string | null;
  grade: {
    grading: "points" | "letter" | "complete" | "none";
    pointsMax: number;
    points: number | null;
    letter: string | null;
    complete: number | null;
    feedback: string;
  } | null;
}

interface FamilyNotebook {
  id: string;
  title: string;
  own: boolean;
  pageCount: number;
  color: string;
  classId: string;
  className: string;
}

const useChildren = () =>
  useQuery({ queryKey: ["family-children"], queryFn: () => api.get<{ children: Child[] }>("/api/family/children") });

/** Add a child with a code. Used on the home screen and when a family link is followed while signed in. */
function AddChild({ initialCode = "", onDone }: { initialCode?: string; onDone?: (studentId: string) => void }) {
  const qc = useQueryClient();
  const [code, setCode] = useState(initialCode);
  const link = useMutation({
    mutationFn: () => api.post<{ ok: true; studentId: string }>("/api/family/link", { code }),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ["family-children"] });
      await qc.invalidateQueries({ queryKey: ["me"] });
      toast.success("Added");
      setCode("");
      onDone?.(res.studentId);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => { e.preventDefault(); if (code.trim()) link.mutate(); }}
    >
      <div className="min-w-[12rem] flex-1">
        <Label htmlFor="add-child-code">Family code</Label>
        <Input
          id="add-child-code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ABCD-2345"
          autoComplete="off"
          className="mt-1.5 font-display tracking-[0.12em]"
        />
      </div>
      <Button type="submit" variant="primary" disabled={!code.trim() || link.isPending}>
        <Plus className="h-4 w-4" strokeWidth={2.5} /> Add child
      </Button>
    </form>
  );
}

/** `/family` — the children on this account. One child goes straight to their page. */
export function FamilyHome() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const codeInUrl = params.get("code") ?? "";
  const q = useChildren();
  const kids = q.data?.children ?? [];

  useEffect(() => {
    if (!codeInUrl && kids.length === 1) navigate(`/family/${kids[0].id}`, { replace: true });
  }, [kids, codeInUrl, navigate]);

  return (
    <Shell>
      <h1 className="font-display text-[32px] text-pine">My children</h1>
      <p className="text-[16px] text-pine/70">Their notebooks and assignments, to look at — nothing here can be changed.</p>

      {codeInUrl && (
        <Card className="mt-5 p-5">
          <h2 className="font-display text-[20px] text-pine">Add a child</h2>
          <p className="mb-3 text-[16px] text-pine/70">You followed a family link. Add this child to your account?</p>
          <AddChild initialCode={codeInUrl} onDone={(id) => navigate(`/family/${id}`)} />
        </Card>
      )}

      {q.isLoading && <Spinner label="Loading…" />}
      {q.error && <ErrorNote error={q.error as Error} />}
      {!q.isLoading && !q.error && kids.length === 0 && !codeInUrl && (
        <EmptyState title="No children yet" body="Enter the family code from your child's teacher to see their work." />
      )}
      {kids.length > 0 && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {kids.map((k) => (
            <CardLink key={k.id} to={`/family/${k.id}`} className="p-5">
              <div className="flex items-center gap-3">
                <Avatar name={k.name} picture={k.picture} size={44} />
                <div className="min-w-0">
                  <div className="truncate font-display text-[20px] text-pine">{k.name}</div>
                  <div className="text-[16px] text-pine/70">
                    {k.open ? `${k.classes.length} class${k.classes.length === 1 ? "" : "es"}` : "Family access is off for now"}
                  </div>
                </div>
              </div>
            </CardLink>
          ))}
        </div>
      )}

      {!codeInUrl && (
        <Card className="mt-8 p-5">
          <h2 className="font-display text-[20px] text-pine">Add a child</h2>
          <p className="mb-3 text-[16px] text-pine/70">Each child has their own code from their teacher.</p>
          <AddChild onDone={(id) => navigate(`/family/${id}`)} />
        </Card>
      )}
    </Shell>
  );
}

const STATUS: Record<string, { label: string; tone: "quiet" | "default" | "mint" | "pine" }> = {
  not_started: { label: "Not started", tone: "quiet" },
  in_progress: { label: "Started", tone: "default" },
  submitted: { label: "Handed in", tone: "mint" },
  returned: { label: "Returned", tone: "pine" },
};

function gradeText(g: NonNullable<FamilyAssignment["grade"]>): string | null {
  if (g.grading === "points" && g.points != null) return `${g.points} / ${g.pointsMax}`;
  if (g.grading === "letter" && g.letter) return g.letter;
  if (g.grading === "complete" && g.complete != null) return g.complete ? "Complete" : "Incomplete";
  return null;
}

/** `/family/:studentId` — one child's assignments and notebooks. */
export function FamilyChild() {
  const { studentId = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const kids = useChildren();
  const q = useQuery({
    queryKey: ["family-overview", studentId],
    queryFn: () => api.get<{ child: { id: string; name: string }; assignments: FamilyAssignment[]; notebooks: FamilyNotebook[] }>(
      `/api/family/children/${studentId}/overview`,
    ),
    enabled: !!studentId,
  });
  const [removing, setRemoving] = useState(false);
  const remove = useMutation({
    mutationFn: () => api.del(`/api/family/children/${studentId}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["family-children"] });
      await qc.invalidateQueries({ queryKey: ["me"] });
      navigate("/family");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const children = kids.data?.children ?? [];
  const name = q.data?.child.name ?? children.find((k) => k.id === studentId)?.name ?? "";
  const first = name.split(" ")[0];
  const upcoming = (q.data?.assignments ?? []).filter((a) => a.status !== "returned");
  const returned = (q.data?.assignments ?? []).filter((a) => a.status === "returned");

  return (
    <Shell>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-[32px] text-pine">{name || "…"}</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {children.length > 1 && (
            <Select
              aria-label="Switch child"
              value={studentId}
              onChange={(e) => navigate(`/family/${e.target.value}`)}
              className="h-11 w-auto"
            >
              {children.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </Select>
          )}
          <Link to="/family" className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 font-display text-[16px] text-pine hover:bg-oat">
            <Plus className="h-4 w-4" strokeWidth={2.5} /> Add a child
          </Link>
        </div>
      </div>

      {q.isLoading && <Spinner label="Loading…" />}
      {q.error && <ErrorNote error={q.error as Error} />}

      {q.data && (
        <>
          <section className="mb-8">
            <h2 className="mb-3 flex items-center gap-2 font-display text-[20px] text-pine">
              <ClipboardList className="h-5 w-5" strokeWidth={2.5} /> To do and handed in
              <Chip tone="quiet">{upcoming.length}</Chip>
            </h2>
            {upcoming.length === 0 ? (
              <EmptyState title="Nothing due" body={`${first} has no open assignments right now.`} />
            ) : (
              <ul className="space-y-3">
                {upcoming.map((a) => <AssignmentRow key={a.id} a={a} studentId={studentId} />)}
              </ul>
            )}
          </section>

          {returned.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-3 flex items-center gap-2 font-display text-[20px] text-pine">
                <Check className="h-5 w-5" strokeWidth={2.5} /> Returned with a grade
                <Chip tone="quiet">{returned.length}</Chip>
              </h2>
              <ul className="space-y-3">
                {returned.map((a) => <AssignmentRow key={a.id} a={a} studentId={studentId} />)}
              </ul>
            </section>
          )}

          <section className="mb-8">
            <h2 className="mb-3 flex items-center gap-2 font-display text-[20px] text-pine">
              <BookOpen className="h-5 w-5" strokeWidth={2.5} /> Notebooks
              <Chip tone="quiet">{q.data.notebooks.length}</Chip>
            </h2>
            {q.data.notebooks.length === 0 ? (
              <EmptyState title="No notebooks yet" body={`Notebooks ${first}'s teachers publish show up here.`} />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {q.data.notebooks.map((n) => (
                  <CardLink key={n.id} to={`/family/${studentId}/notebooks/${n.id}`} accent={n.color} className="p-4">
                    <div className="truncate font-display text-[18px] text-pine">{n.title}</div>
                    <div className="mt-0.5 text-[16px] text-pine/70">
                      {n.className}{n.own ? ` · ${first}'s own` : ""} · {n.pageCount} page{n.pageCount === 1 ? "" : "s"}
                    </div>
                  </CardLink>
                ))}
              </div>
            )}
          </section>

          <div className="border-t-[3px] border-pine/15 pt-5">
            <Button variant="ghost" onClick={() => setRemoving(true)}>
              <UserMinus className="h-4 w-4" strokeWidth={2.5} /> Remove {first} from my account
            </Button>
          </div>
        </>
      )}

      {removing && (
        <ConfirmModal
          title={`Remove ${first}?`}
          body={`You'll stop seeing ${first}'s work. To see it again you'll need a family code from their teacher.`}
          confirmLabel="Remove"
          busy={remove.isPending}
          onClose={() => setRemoving(false)}
          onConfirm={() => remove.mutate()}
        />
      )}
    </Shell>
  );
}

function AssignmentRow({ a, studentId }: { a: FamilyAssignment; studentId: string }) {
  const st = STATUS[a.status] ?? STATUS.not_started;
  const overdue = a.dueAt && a.status !== "submitted" && a.status !== "returned" && new Date(a.dueAt).getTime() < Date.now();
  const g = a.grade ? gradeText(a.grade) : null;
  return (
    <li>
      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <div className="font-display text-[18px] text-pine">{a.title}</div>
            <div className="text-[16px] text-pine/70">
              {a.className} · {a.notebookTitle} · {a.pageIds.length} page{a.pageIds.length === 1 ? "" : "s"}
            </div>
            <div className={cn("mt-1 text-[16px]", overdue ? "font-display text-[#a3341f]" : "text-pine/70")}>
              {dueLabel(a.dueAt)}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {g && <Chip tone="mint">{g}</Chip>}
            <Chip tone={st.tone}>{st.label}</Chip>
            <Link
              to={`/family/${studentId}/notebooks/${a.notebookId}?pages=${a.pageIds.join(",")}&title=${encodeURIComponent(a.title)}`}
              className="inline-flex h-11 items-center gap-1.5 rounded-full border-[3px] border-pine px-4 font-display text-[16px] text-pine hover:bg-oat"
            >
              <Eye className="h-4 w-4" strokeWidth={2.5} /> Look
            </Link>
          </div>
        </div>
        {a.grade?.feedback && (
          <div className="mt-3 flex items-start gap-2 rounded-[12px] bg-oat p-3 text-[16px] text-pine">
            <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} />
            <span className="whitespace-pre-wrap">{a.grade.feedback}</span>
          </div>
        )}
      </Card>
    </li>
  );
}

interface FamilyWork {
  notebook: { id: string; title: string; classId: string; kind: string };
  pages: PageRec[];
  fields: FieldRec[];
  layers: LayerRec[];
  values: { field_id: string; value: string }[];
  masterAnnotations: { pageId: string; data: string }[];
}

const NO_TOOL: ToolState = { kind: "select", color: PEN_COLORS[0], width: 2.5, stamp: "⭐", fontSize: 14, erase: "quick" };

/** `/family/:studentId/notebooks/:notebookId` — the child's copy, to read. `?pages=` narrows it to an assignment. */
export function FamilyNotebookView() {
  const { studentId = "", notebookId = "" } = useParams();
  const [params] = useSearchParams();
  const pages = params.get("pages") ?? "";
  const title = params.get("title");
  const q = useQuery({
    queryKey: ["family-work", studentId, notebookId, pages],
    queryFn: () => api.get<FamilyWork>(
      `/api/family/children/${studentId}/notebooks/${notebookId}${pages ? `?pages=${encodeURIComponent(pages)}` : ""}`,
    ),
    enabled: !!studentId && !!notebookId,
  });
  const [zoom, setZoom] = useState<ZoomMode>("page");
  const scrollRef = useRef<HTMLDivElement>(null);

  const maps = useMemo(() => buildLayerMaps((q.data?.layers ?? []) as any), [q.data]);
  const master = useMemo<LayerMap>(() => {
    const m: LayerMap = {};
    for (const a of q.data?.masterAnnotations ?? []) m[a.pageId] = parseLayer(a.data);
    return m;
  }, [q.data]);
  const values = useMemo(() => {
    const v: Record<string, string> = {};
    for (const r of q.data?.values ?? []) v[r.field_id] = r.value;
    return v;
  }, [q.data]);

  return (
    <div className="flex h-dvh flex-col bg-oat">
      <header className="flex flex-wrap items-center gap-3 border-b-[3px] border-pine/15 bg-white px-4 py-2.5">
        <Link to={`/family/${studentId}`} aria-label="Back" className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-oat">
          <ArrowLeft className="h-5 w-5" strokeWidth={2.5} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-[18px] text-pine">{title || q.data?.notebook.title || "…"}</div>
          <div className="text-[16px] text-pine/70">Looking only — nothing here can be changed</div>
        </div>
        <ZoomSelect zoom={zoom} onZoomChange={setZoom} />
      </header>
      {q.isLoading && <Spinner label="Opening…" />}
      {q.error && <div className="p-4"><ErrorNote error={q.error as Error} /></div>}
      {q.data && (
        <div className="min-h-0 flex-1">
          <NotebookSurface
            notebookId={notebookId}
            pages={q.data.pages}
            fields={q.data.fields}
            studentLayers={maps.student}
            teacherLayers={maps.teacher}
            masterLayers={master}
            studentId={studentId}
            fieldValues={values}
            writeTarget={null}
            tool={NO_TOOL}
            fingerDraw={false}
            zoom={zoom}
            onZoomChange={setZoom}
            fieldsEditable={false}
            preview
            onLayerChange={() => {}}
            onFieldChange={() => {}}
            scrollRef={scrollRef}
          />
        </div>
      )}
    </div>
  );
}
