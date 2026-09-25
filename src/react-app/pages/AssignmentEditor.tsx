import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, ExternalLink, Trash2 } from "lucide-react";

import { api, pageSource, type PageRec } from "../lib/api";
import Shell, { ErrorNote, Spinner } from "../components/Shell";
import PageThumb from "../components/PageThumb";
import { Button, Card, Input, Label, Modal, Select, Textarea } from "../components/ui";
import { cn, toIso, toLocalInput } from "../lib/utils";
import { createCoursework, hasGoogleClientId } from "../lib/google";
import GoogleIcon from "../components/GoogleIcon";

type Grading = "none" | "complete" | "points" | "letter";

const GRADING_LABELS: Record<string, string> = {
  none: "Ungraded",
  complete: "Complete / Incomplete",
  points: "Points",
  letter: "Letter grade",
};

/**
 * What Google Classroom should grade this out of.
 *
 * Classroom grades are numbers and nothing else. Points carry across exactly;
 * complete/incomplete becomes the one-point assignment teachers already use for
 * it there; a letter grade has no honest numeric form, so that coursework is
 * posted ungraded and the letter stays in Notesanity rather than being invented
 * as a percentage.
 */
function classroomMaxPoints(grading: Grading, pointsMax: number): number | null {
  if (grading === "points") return Math.max(1, Math.round(pointsMax || 0));
  if (grading === "complete") return 1;
  return null;
}

/** What deleting (or heavily editing) an assignment would actually disturb. */
interface AssignmentImpact {
  submitted: number;
  graded: number;
  returned: number;
  total: number;
  started: number;
  grading: string;
  status: string;
}

/**
 * A plain confirm dialog isn't enough for a destructive, hard-to-undo action
 * that affects a whole roster — the teacher needs the real numbers in front of
 * them, and needs to understand that student *work* survives even though the
 * assignment record doesn't.
 */
function DeleteAssignmentModal({
  impact, loading, deleting, onCancel, onConfirm,
}: {
  impact: AssignmentImpact | null;
  loading: boolean;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal onClose={onCancel} title="Delete assignment?">
      {loading || !impact ? (
        <div className="py-8"><Spinner label="Checking impact…" /></div>
      ) : (
        <>
          <div className="mt-1 space-y-1.5 text-[16px] text-pine/80">
            {impact.submitted > 0 && (
              <p>{impact.submitted} of {impact.total} students have turned this in.</p>
            )}
            {impact.graded > 0 && <p>{impact.graded} have been graded.</p>}
            {impact.submitted === 0 && impact.graded === 0 && (
              <p>No one has turned this in yet.</p>
            )}
          </div>
          <p className="mt-3 rounded-[12px] bg-oat p-3 text-[16px] leading-relaxed text-pine/80">
            Deleting removes the assignment and all of its grades and submission records.
            It does <strong>not</strong> delete the pages or anything students wrote on them —
            that work stays in the notebook.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={onCancel}>Cancel</Button>
            <Button variant="danger" onClick={onConfirm} disabled={deleting}>
              <Trash2 className="h-4 w-4" strokeWidth={2.5} /> Delete assignment
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

type SiblingClass = {
  classId: string;
  className: string;
  notebookId: string;
  published: boolean;
  googleCourseId: string | null;
  /** This notebook's page id → the same page in that class's copy. */
  pageMap: Record<string, string>;
};

export default function AssignmentEditor() {
  const { classId: classIdParam, assignmentId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const editing = !!assignmentId;

  const existing = useQuery({
    queryKey: ["assignment", assignmentId],
    queryFn: () => api.get<any>(`/api/assignments/${assignmentId}`),
    enabled: editing,
  });

  const impactQuery = useQuery({
    queryKey: ["assignment-impact", assignmentId],
    queryFn: () => api.get<AssignmentImpact>(`/api/assignments/${assignmentId}/impact`),
    enabled: editing,
  });
  const impact = impactQuery.data;
  const hasImpact = !!impact && (impact.submitted > 0 || impact.graded > 0 || impact.started > 0);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const deleteMutation = useMutation({
    mutationFn: () => api.del(`/api/assignments/${assignmentId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assignments", classId] });
      qc.invalidateQueries({ queryKey: ["class", classId] });
      toast.success("Assignment deleted");
      navigate(`/classes/${classId}?tab=assignments`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const classId = classIdParam ?? existing.data?.assignment?.classId ?? "";

  const classQuery = useQuery({
    queryKey: ["class", classId],
    queryFn: () => api.get<any>(`/api/classes/${classId}`),
    enabled: !!classId,
  });

  // Arriving from the notebook editor's "Create assignment" action carries the
  // page multi-selection straight through, so the teacher doesn't repick pages.
  const handoff = (useLocation().state as { notebookId?: string; pageIds?: string[] } | null) ?? null;

  const [notebookId, setNotebookId] = useState(handoff?.notebookId ?? searchParams.get("notebook") ?? "");
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [pageIds, setPageIds] = useState<string[]>(handoff?.pageIds ?? []);
  const [releaseAt, setReleaseAt] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [grading, setGrading] = useState<Grading>("points");
  const [pointsMax, setPointsMax] = useState(100);
  const [postToClassroom, setPostToClassroom] = useState(true);

  useEffect(() => {
    const a = existing.data?.assignment;
    if (!a) return;
    setNotebookId(a.notebookId);
    setTitle(a.title);
    setInstructions(a.instructions ?? "");
    setPageIds(a.pageIds ?? []);
    setReleaseAt(toLocalInput(a.releaseAt));
    setDueAt(toLocalInput(a.dueAt));
    setGrading(a.grading);
    setPointsMax(a.pointsMax);
  }, [existing.data]);

  const notebooks = useMemo(
    () => (classQuery.data?.notebooks ?? []).filter((n: any) => n.status === "published" || n.id === notebookId),
    [classQuery.data, notebookId],
  );

  /**
   * Posting to Classroom is offered only for a class that came from a Classroom
   * course, and only once: the coursework id is what a grade is later sent
   * against, and a second post would leave two assignments competing for it.
   */
  const googleCourseId: string | null = classQuery.data?.class?.google_course_id ?? null;
  const postedLink: string | null = existing.data?.assignment?.googleCourseworkLink ?? null;
  const alreadyPosted = !!existing.data?.assignment?.googleCourseworkId;
  const canPostToClassroom = hasGoogleClientId && !!googleCourseId && !alreadyPosted;

  const notebookQuery = useQuery({
    queryKey: ["notebook", notebookId],
    queryFn: () => api.get<{ pages: PageRec[] }>(`/api/notebooks/${notebookId}`),
    enabled: !!notebookId,
  });
  const pages = notebookQuery.data?.pages ?? [];

  /**
   * The same notebook in the teacher's other classes (copies of one template),
   * for setting this assignment there too. Each class gets its own assignment
   * with its own dates; only creating them is shared.
   */
  const siblingsQuery = useQuery({
    queryKey: ["sibling-classes", notebookId],
    queryFn: () => api.get<{ classes: SiblingClass[] }>(`/api/notebooks/${notebookId}/sibling-classes`),
    enabled: !editing && !!notebookId,
  });
  const siblings = siblingsQuery.data?.classes ?? [];
  /** Per class: whether it's ticked, and dates only once the teacher changes them (until then it follows this class's). */
  const [alsoIn, setAlsoIn] = useState<Record<string, { on: boolean; releaseAt?: string; dueAt?: string }>>({});
  useEffect(() => { setAlsoIn({}); }, [notebookId]);
  // A ticked class that has none of the chosen pages drops out rather than getting an empty assignment.
  const chosenSiblings = siblings.filter((sib) => alsoIn[sib.classId]?.on && pageIds.some((pid) => sib.pageMap[pid]));
  const datesFor = (classId: string) => ({
    releaseAt: alsoIn[classId]?.releaseAt ?? releaseAt,
    dueAt: alsoIn[classId]?.dueAt ?? dueAt,
  });
  const setSibling = (classId: string, patch: { on?: boolean; releaseAt?: string; dueAt?: string }) =>
    setAlsoIn((m) => ({ ...m, [classId]: { ...(m[classId] ?? { on: false }), ...patch } }));

  /**
   * Pages are picked, not read — nobody needs to see all hundred at once to
   * tick the four they want. Paginated the same way the notebook's own page
   * list is, at a size that fills the grid's widest layout (7 columns) evenly.
   */
  const PAGE_SIZE = 35;
  const [pagePage, setPagePage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(pages.length / PAGE_SIZE));
  useEffect(() => { setPagePage(0); }, [notebookId]);
  const visiblePages = pages.slice(pagePage * PAGE_SIZE, pagePage * PAGE_SIZE + PAGE_SIZE);

  const save = useMutation({
    mutationFn: async (status: "draft" | "active") => {
      const body = {
        notebookId, title, instructions, pageIds,
        releaseAt: toIso(releaseAt), dueAt: toIso(dueAt),
        grading, pointsMax, status,
      };
      const extra = editing ? [] : chosenSiblings.map((sib) => {
        const d = datesFor(sib.classId);
        return { classId: sib.classId, releaseAt: toIso(d.releaseAt), dueAt: toIso(d.dueAt) };
      });
      type Created = { assignment: { id: string }; alsoIn?: { id: string; classId: string; status: string }[] };
      const res = editing
        ? await api.patch(`/api/assignments/${assignmentId}`, body)
        : await api.post<Created>(`/api/classes/${classId}/assignments`, { ...body, alsoIn: extra });
      const id = editing ? assignmentId! : (res as Created).assignment.id;
      const others = editing ? [] : (res as Created).alsoIn ?? [];

      // Each class posts to its own Classroom course, if it came from one. A
      // draft is deliberately not posted: the link would be one students can't
      // open yet, which is worse than not having posted at all.
      const targets: { id: string; courseId: string; releaseAt: string; dueAt: string }[] = [];
      if (postToClassroom && hasGoogleClientId && status === "active") {
        if (canPostToClassroom && googleCourseId) targets.push({ id, courseId: googleCourseId, releaseAt, dueAt });
        for (const o of others) {
          const sib = siblings.find((x) => x.classId === o.classId);
          if (o.status === "active" && sib?.googleCourseId) targets.push({ id: o.id, courseId: sib.googleCourseId, ...datesFor(o.classId) });
        }
      }

      // Google refusing is not the assignment failing — it already exists, and
      // saying otherwise would send the teacher back to recreate it.
      let posted = 0, scheduled = 0;
      const refusals: string[] = [];
      for (const t of targets) {
        try {
          const cw = await createCoursework(t.courseId, {
            title,
            description: instructions,
            link: `${window.location.origin}/assignments/${t.id}`,
            dueAt: toIso(t.dueAt),
            scheduledAt: toIso(t.releaseAt),
            maxPoints: classroomMaxPoints(grading, pointsMax),
          });
          await api.post(`/api/assignments/${t.id}/classroom`, { courseworkId: cw.id, link: cw.link });
          if (cw.published) posted++; else scheduled++;
        } catch (e) {
          refusals.push((e as Error).message);
        }
      }
      return { id, others, posted, scheduled, refusals };
    },
    onSuccess: (res) => {
      for (const cid of [classId, ...res.others.map((o) => o.classId)]) {
        qc.invalidateQueries({ queryKey: ["assignments", cid] });
        qc.invalidateQueries({ queryKey: ["class", cid] });
      }
      qc.invalidateQueries({ queryKey: ["notebook-assignments"] });
      const drafts = res.others.filter((o) => o.status === "draft").length;
      toast.success(
        editing ? "Assignment updated"
          : res.others.length ? `Assignment created in ${res.others.length + 1} classes` : "Assignment created",
        drafts && res.others.length ? { description: `${drafts} saved as a draft, where the notebook isn't published yet.` } : undefined,
      );
      if (res.refusals.length) {
        toast.error(`Saved here, but Google Classroom refused ${res.refusals.length === 1 ? "it" : `${res.refusals.length} of them`}: ${res.refusals[0]}`);
      } else if (res.posted || res.scheduled) {
        toast.success(res.scheduled && !res.posted ? "Scheduled in Google Classroom" : "Posted to Google Classroom");
      }
      navigate(`/classes/${classId}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (editing && existing.isLoading) return <Spinner />;
  if (classQuery.isLoading) return <Spinner />;

  const toggleAll = () => setPageIds(pageIds.length === pages.length ? [] : pages.map((p) => p.id));
  const canSave = !!notebookId && !!title.trim() && pageIds.length > 0;

  const openDeleteModal = () => setShowDeleteModal(true);

  return (
    <Shell>
      <div className="mx-auto max-w-2xl">
        <h1 className="font-display text-[32px] text-pine">{editing ? "Edit assignment" : "New assignment"}</h1>
        {classQuery.error && <div className="mt-4"><ErrorNote error={classQuery.error as Error} /></div>}

        {editing && hasImpact && impact && (
          <div className="mt-4 rounded-[12px] border-[3px] border-[#8a6a1f] bg-[#f7e6bf] p-4 text-[16px] text-[#5c4611]">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} />
              <div className="space-y-1.5">
                <p className="font-display">Students have already started this assignment</p>
                {(impact.submitted > 0 || impact.started > 0) && (
                  <p>
                    Removing pages from the selection below hides that page from the assignment —
                    a student's writing on it is <strong>not</strong> deleted. It stays in the notebook
                    and reappears if the page is added back.
                  </p>
                )}
                {impact.graded > 0 && grading !== impact.grading && (
                  <p>
                    {impact.graded} existing grade{impact.graded === 1 ? "" : "s"} were recorded as{" "}
                    <strong>{GRADING_LABELS[impact.grading] ?? impact.grading}</strong> and won't convert
                    automatically now that you're switching to <strong>{GRADING_LABELS[grading]}</strong>.
                  </p>
                )}
                {impact.returned > 0 && (
                  <p>
                    {impact.returned} student{impact.returned === 1 ? "" : "s"} have already seen their
                    grade — changing points possible will change what their score means.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        <Card className="mt-6 space-y-5 p-6">
          <div>
            <Label>Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Unit 3 practice problems"
              className="mt-1.5"
            />
          </div>

          <div>
            <Label>Instructions</Label>
            <Textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={3}
              className="mt-1.5"
            />
          </div>

          <div>
            <Label>Notebook</Label>
            <Select
              value={notebookId}
              onChange={(e) => { setNotebookId(e.target.value); setPageIds([]); }}
              className="mt-1.5"
            >
              <option value="">Choose a notebook…</option>
              {notebooks.map((n: any) => (
                <option key={n.id} value={n.id}>{n.title} ({n.page_count} pages)</option>
              ))}
            </Select>
            {notebooks.length === 0 && (
              <p className="mt-1.5 text-[16px] text-[#8a6a1f]">
                No published notebooks yet — publish one first, then create the assignment.
              </p>
            )}
          </div>

          {notebookId && (
            <div>
              <div className="flex items-center justify-between">
                <Label>Pages ({pageIds.length} selected)</Label>
                <button type="button" onClick={toggleAll} className="font-display text-[16px] text-pine hover:underline">
                  {pageIds.length === pages.length ? "Clear all" : "Select all"}
                </button>
              </div>
              <p className="mt-0.5 text-[16px] text-pine/70">Pages don't have to be next to each other.</p>
              <div className="mt-2 grid grid-cols-3 gap-2.5 sm:grid-cols-5 lg:grid-cols-7">
                {visiblePages.map((p) => {
                  const i = pages.indexOf(p);
                  const on = pageIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() =>
                        setPageIds((prev) => (on ? prev.filter((x) => x !== p.id) : [...prev, p.id]))
                      }
                      title={p.label || `Page ${i + 1}`}
                      className={cn(
                        "relative flex flex-col items-center rounded-[12px] p-1.5 transition-colors",
                        on ? "ring-[3px] ring-pine bg-oat" : "border-2 border-pine/20 hover:bg-oat",
                      )}
                    >
                      <PageThumb
                        {...pageSource(notebookId, p)}
                        width={72}
                      />
                      <span className="absolute bottom-1.5 left-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-pine bg-white px-1 font-display text-[16px] text-pine">
                        {i + 1}
                      </span>
                      {on && (
                        <span className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-pine bg-mint text-pine">
                          <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {pageCount > 1 && (
                <div className="mt-3 flex items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => setPagePage((n) => Math.max(0, n - 1))}
                    disabled={pagePage === 0}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-pine hover:bg-oat disabled:opacity-30"
                    aria-label="Previous pages"
                  >
                    <ChevronLeft className="h-4 w-4" strokeWidth={2.5} />
                  </button>
                  <span className="text-[16px] tabular-nums text-pine/70">
                    Pages {pagePage * PAGE_SIZE + 1}–{Math.min(pages.length, pagePage * PAGE_SIZE + PAGE_SIZE)} of {pages.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPagePage((n) => Math.min(pageCount - 1, n + 1))}
                    disabled={pagePage >= pageCount - 1}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-pine hover:bg-oat disabled:opacity-30"
                    aria-label="More pages"
                  >
                    <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Release</Label>
              <Input
                type="datetime-local"
                value={releaseAt}
                onChange={(e) => setReleaseAt(e.target.value)}
                className="mt-1.5"
              />
              <p className="mt-1 text-[16px] text-pine/70">Leave blank to release immediately.</p>
            </div>
            <div>
              <Label>Due</Label>
              <Input
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className="mt-1.5"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Grading</Label>
              <Select value={grading} onChange={(e) => setGrading(e.target.value as Grading)} className="mt-1.5">
                <option value="points">Points</option>
                <option value="letter">Letter grade</option>
                <option value="complete">Complete / Incomplete</option>
                <option value="none">Ungraded</option>
              </Select>
            </div>
            {grading === "points" && (
              <div>
                <Label>Points possible</Label>
                <Input
                  type="number"
                  min={1}
                  value={pointsMax}
                  onChange={(e) => setPointsMax(Number(e.target.value))}
                  className="mt-1.5"
                />
              </div>
            )}
          </div>

          {!editing && siblings.length > 0 && (
            <fieldset className="rounded-[12px] border-[3px] border-pine/20 p-3">
              <legend className="px-1 font-display text-[16px] text-pine">Also assign in</legend>
              <p className="text-[16px] text-pine/70">
                Your other classes with this notebook. Each gets its own assignment, graded on its own, with its own dates.
              </p>
              <ul className="mt-2 space-y-2">
                {siblings.map((sib) => {
                  const row = alsoIn[sib.classId];
                  const on = !!row?.on;
                  const missing = pageIds.filter((pid) => !sib.pageMap[pid]).length;
                  const none = pageIds.length > 0 && missing === pageIds.length;
                  const d = datesFor(sib.classId);
                  return (
                    <li key={sib.classId} className={cn("rounded-[12px] p-2", on && "bg-oat")}>
                      <label className="flex min-h-11 items-start gap-3 text-[16px] text-pine">
                        <input
                          type="checkbox"
                          checked={on && !none}
                          disabled={none}
                          onChange={(e) => setSibling(sib.classId, { on: e.target.checked })}
                          className="mt-1 h-5 w-5 shrink-0 accent-mint"
                        />
                        <span>
                          <span className="block font-display">{sib.className}</span>
                          {none ? (
                            <span className="block text-pine/70">None of these pages are in this class's copy.</span>
                          ) : (
                            <>
                              {missing > 0 && (
                                <span className="block text-[#8a6a1f]">
                                  {missing} of these pages {missing === 1 ? "isn't" : "aren't"} in this class's copy, so {missing === 1 ? "it's" : "they're"} left out there.
                                </span>
                              )}
                              {!sib.published && (
                                <span className="block text-pine/70">Not published in this class yet, so it's saved there as a draft.</span>
                              )}
                            </>
                          )}
                        </span>
                      </label>
                      {on && !none && (
                        <div className="mt-2 grid gap-3 pl-8 sm:grid-cols-2">
                          <div>
                            <Label>Release</Label>
                            <Input
                              type="datetime-local"
                              value={d.releaseAt}
                              onChange={(e) => setSibling(sib.classId, { releaseAt: e.target.value })}
                              className="mt-1.5"
                              aria-label={`Release in ${sib.className}`}
                            />
                          </div>
                          <div>
                            <Label>Due</Label>
                            <Input
                              type="datetime-local"
                              value={d.dueAt}
                              onChange={(e) => setSibling(sib.classId, { dueAt: e.target.value })}
                              className="mt-1.5"
                              aria-label={`Due in ${sib.className}`}
                            />
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          )}

          {(canPostToClassroom || alreadyPosted || (!editing && hasGoogleClientId && chosenSiblings.some((sib) => sib.googleCourseId))) && (
            <div className="rounded-[12px] border-[3px] border-pine/20 bg-oat p-3">
              {alreadyPosted ? (
                <div className="flex items-start gap-2 text-[16px] text-pine">
                  <GoogleIcon product="classroom" className="mt-0.5" />
                  <span>
                    This is posted in Google Classroom.{" "}
                    {postedLink && (
                      <a
                        href={postedLink}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 whitespace-nowrap font-display text-pine underline"
                      >
                        Open it <ExternalLink className="h-3.5 w-3.5" strokeWidth={2.5} />
                      </a>
                    )}
                  </span>
                </div>
              ) : (
                <>
                  <label className="flex items-start gap-3 text-[16px] text-pine">
                    <input
                      type="checkbox"
                      checked={postToClassroom}
                      onChange={(e) => setPostToClassroom(e.target.checked)}
                      className="mt-1 h-4 w-4 shrink-0 accent-mint"
                    />
                    <span>
                      <span className="flex items-center gap-2 font-display">
                        <GoogleIcon product="classroom" /> Also post to Google Classroom
                      </span>
                      <span className="block text-pine/70">
                        {chosenSiblings.length
                          ? "Creates an assignment in the Classroom course each class came from, linking back here."
                          : "Creates an assignment in the course this class came from, linking back here."}
                        Google asks your permission the first time.
                      </span>
                    </span>
                  </label>
                  {postToClassroom && (
                    <p className="mt-2 pl-7 text-[16px] text-pine/70">
                      Posted when you assign to the class — saving a draft doesn't post anything.
                      {grading === "letter" && " Classroom only accepts number grades, so this one posts ungraded there."}
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <Button variant="primary" disabled={!canSave || save.isPending} onClick={() => save.mutate("active")}>
              {editing ? "Save changes" : chosenSiblings.length ? `Assign to ${chosenSiblings.length + 1} classes` : "Assign to class"}
            </Button>
            <Button variant="secondary" disabled={!canSave || save.isPending} onClick={() => save.mutate("draft")}>
              Save as draft
            </Button>
            <Button variant="ghost" onClick={() => navigate(`/classes/${classId}`)}>
              Cancel
            </Button>
          </div>

          {editing && (
            <div className="border-t-[3px] border-pine/15 pt-5">
              <Button type="button" variant="danger" onClick={openDeleteModal}>
                <Trash2 className="h-4 w-4" strokeWidth={2.5} /> Delete assignment
              </Button>
            </div>
          )}
        </Card>
      </div>

      {showDeleteModal && (
        <DeleteAssignmentModal
          impact={impact ?? null}
          loading={impactQuery.isLoading}
          deleting={deleteMutation.isPending}
          onCancel={() => setShowDeleteModal(false)}
          onConfirm={() => deleteMutation.mutate()}
        />
      )}
    </Shell>
  );
}
