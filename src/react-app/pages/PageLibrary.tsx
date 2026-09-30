/**
 * The teacher's saved pages, with a home of their own.
 *
 * Until this existed the library could only be seen from inside the insert
 * modal, which meant there was nowhere to tidy it: no way to rename the entry
 * you saved in a hurry, or clear out last year's. Inserting still belongs in a
 * notebook — that's where the question "where does this page go" has an answer
 * — so this page keeps the library in order, and pushes a saved page to the end
 * of several notebooks at once, which is the one insert that has no single
 * notebook to start from.
 */

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, LibraryBig, Loader2, Pencil, Plus, Send, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import Shell, { EmptyState, ErrorNote, Spinner } from "../components/Shell";
import PageThumb from "../components/PageThumb";
import { Button, Card, ConfirmModal, Input, Label, Menu, Modal, buttonClass } from "../components/ui";
import { convertToPdf, driveFileAsPdf, hasDrivePicker, hasGoogleClientId, needsConversion, pickDriveFile } from "../lib/google";
import { readPageSizes, type PageSize } from "../lib/pdf";
import { cn } from "../lib/utils";
import { api, libraryPageSource, type LibraryPageRec } from "../lib/api";
import { useSession } from "../lib/session";
import { relativeTime } from "../lib/utils";
import GoogleIcon from "../components/GoogleIcon";

export default function PageLibrary() {
  const qc = useQueryClient();
  const { user, isLoading: sessionLoading } = useSession();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [removing, setRemoving] = useState<LibraryPageRec | null>(null);
  /** The saved page being pushed into notebooks. */
  const [pushing, setPushing] = useState<LibraryPageRec | null>(null);
  /** A document on its way in: picked, converted if it needs it, then its pages chosen. */
  const [importing, setImporting] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const importFromDrive = async () => {
    try {
      const picked = await pickDriveFile();
      if (!picked) return;
      const blob = await driveFileAsPdf(picked);
      setImporting(new File([blob], picked.name.replace(/\.[^.]+$/, "") + ".pdf", { type: "application/pdf" }));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const library = useQuery({
    queryKey: ["page-library"],
    queryFn: () => api.get<{ pages: LibraryPageRec[] }>("/api/my/page-library"),
    enabled: user?.role === "teacher",
  });

  const rename = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      api.patch(`/api/my/page-library/${id}`, { title }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["page-library"] });
      setRenaming(null);
      toast.success("Renamed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/my/page-library/${id}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["page-library"] });
      setRemoving(null);
      toast.success("Removed from your library");
    },
    onError: (e: Error) => { toast.error(e.message); setRemoving(null); },
  });

  if (sessionLoading) return <Shell><Spinner /></Shell>;
  if (user?.role !== "teacher") {
    return (
      <Shell>
        <ErrorNote error={new Error("The page library is for teachers")} />
      </Shell>
    );
  }

  const pages = library.data?.pages ?? [];

  return (
    <Shell>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-[32px] text-pine">Page library</h1>
        <Menu
          label="Add pages"
          className="ml-auto"
          triggerClassName={buttonClass("primary", "md")}
          trigger={<><Plus className="h-5 w-5" strokeWidth={2.5} /> Add pages <ChevronDown className="h-4 w-4" strokeWidth={2.5} /></>}
          items={[
            {
              label: "A file from this device",
              icon: <Upload className="h-5 w-5" strokeWidth={2.5} />,
              hint: "PDF, Word or PowerPoint — you choose which pages to keep",
              onClick: () => fileRef.current?.click(),
            },
            ...(hasDrivePicker ? [{
              label: "From Google Drive",
              icon: <GoogleIcon product="drive" />,
              hint: "Pick a file without downloading it",
              onClick: () => void importFromDrive(),
            }] : []),
          ]}
        />
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,.doc,.pptx,.ppt,application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) setImporting(f);
          }}
        />
      </div>
      <p className="mb-6 measure text-[16px] text-pine/70">
        Pages you've saved to reuse. Save one from any notebook's page list, or bring a document
        straight in here and keep the pages you want. Drop any of them into a notebook from its{" "}
        <span className="font-display font-bold text-pine">Pages</span> tab &rarr;{" "}
        <span className="font-display font-bold text-pine">Library</span>, or add one to several notebooks at once from here.
      </p>

      {library.isLoading && <Spinner label="Loading your library…" />}
      {library.error && <ErrorNote error={library.error as Error} />}

      {!library.isLoading && !library.error && pages.length === 0 && (
        <EmptyState
          title="Nothing saved yet"
          body="Hover any page in a notebook and choose Save to your page library — the warm-up you use every week, a lab write-up frame, an exit ticket. It'll be here to drop into any notebook."
        />
      )}

      {pages.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {pages.map((p) => (
            <Card key={p.id} className="flex flex-col items-center gap-2 p-3">
              <PageThumb {...libraryPageSource(p)} width={120} />

              {renaming === p.id ? (
                <form
                  className="flex w-full items-center gap-1"
                  onSubmit={(e) => { e.preventDefault(); rename.mutate({ id: p.id, title: draftTitle }); }}
                >
                  <Input
                    autoFocus
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    aria-label="Page name"
                    className="h-10 min-w-0 flex-1 text-[16px]"
                  />
                  <button
                    type="submit"
                    disabled={rename.isPending || !draftTitle.trim()}
                    aria-label="Save name"
                    className="rounded p-1.5 text-pine/60 hover:bg-oat hover:text-pine"
                  >
                    <Check className="h-4 w-4" strokeWidth={2.5} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setRenaming(null)}
                    aria-label="Cancel rename"
                    className="rounded p-1.5 text-pine/60 hover:bg-oat hover:text-pine"
                  >
                    <X className="h-4 w-4" strokeWidth={2.5} />
                  </button>
                </form>
              ) : (
                <>
                  <div className="w-full text-center font-display text-[16px] leading-tight text-pine">
                    {p.title}
                  </div>
                  <div className="text-[14px] text-pine/55">{relativeTime(p.created_at)}</div>
                  <Button variant="primary" size="sm" className="w-full" onClick={() => setPushing(p)} aria-label={`Add ${p.title} to notebooks`}>
                    <Send className="h-3.5 w-3.5" strokeWidth={2.5} />
                    {/* Two cards across a small phone leave no room for the long label. */}
                    <span className="min-[360px]:hidden">Add to…</span>
                    <span className="hidden min-[360px]:inline">Add to notebooks…</span>
                  </Button>
                  <div className="flex gap-1">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => { setRenaming(p.id); setDraftTitle(p.title); }}
                    >
                      <Pencil className="h-3.5 w-3.5" strokeWidth={2.5} />
                      Rename
                    </Button>
                    <button
                      type="button"
                      onClick={() => setRemoving(p)}
                      aria-label={`Remove ${p.title} from your library`}
                      className="rounded-full px-2 text-pine/55 hover:bg-[#fbe9e4] hover:text-[#a3341f]"
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={2.5} />
                    </button>
                  </div>
                </>
              )}
            </Card>
          ))}
        </div>
      )}

      {pages.length > 0 && (
        <p className="mt-6 flex items-center gap-2 text-[16px] text-pine/55">
          <LibraryBig className="h-4 w-4" strokeWidth={2.5} />
          {pages.length} saved page{pages.length === 1 ? "" : "s"}
        </p>
      )}

      {importing && (
        <LibraryImport
          source={importing}
          onClose={() => setImporting(null)}
          onSaved={async (n) => {
            setImporting(null);
            await qc.invalidateQueries({ queryKey: ["page-library"] });
            toast.success(`Added ${n} page${n === 1 ? "" : "s"} to your library`);
          }}
        />
      )}
      {pushing && <PushToNotebooks entry={pushing} onClose={() => setPushing(null)} />}
      {removing && (
        <ConfirmModal
          title="Remove from your library?"
          body={`"${removing.title}" goes out of your library. Any notebook you already added it to keeps its copy.`}
          confirmLabel="Remove"
          tone="danger"
          busy={remove.isPending}
          onConfirm={() => remove.mutate(removing.id)}
          onClose={() => setRemoving(null)}
        />
      )}
    </Shell>
  );
}

/**
 * A document coming into the library: converted if it's Word or PowerPoint,
 * uploaded to the library's own shelf, then laid out page by page so the
 * teacher keeps the two worksheets they wanted and not the twelve pages of
 * answer key behind them. Nothing is an entry until they say so — backing
 * out throws the upload away.
 */
function LibraryImport({ source, onClose, onSaved }: { source: File; onClose: () => void; onSaved: (n: number) => void }) {
  const [phase, setPhase] = useState<"preparing" | "choose" | "saving">("preparing");
  const [message, setMessage] = useState("Reading the file…");
  const [error, setError] = useState<string | null>(null);
  const [assetKey, setAssetKey] = useState("");
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [title, setTitle] = useState(source.name.replace(/\.[^.]+$/, ""));
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        let pdf: Blob = source;
        if (needsConversion(source)) {
          if (!hasGoogleClientId) throw new Error("Word and PowerPoint conversion needs Google Drive access, which isn't configured. Export the file to PDF and upload that instead.");
          setMessage("Converting to PDF…");
          pdf = await convertToPdf(source, setMessage);
        }
        setMessage("Uploading…");
        const form = new FormData();
        form.append("file", new File([pdf], source.name.replace(/\.[^.]+$/, ".pdf"), { type: "application/pdf" }));
        const { assetKey: key } = await api.upload<{ assetKey: string }>("/api/my/page-library/upload", form);
        setAssetKey(key);
        setMessage("Reading pages…");
        const read = await readPageSizes(pdf);
        if (read.length === 0) throw new Error("That PDF has no pages.");
        setSizes(read);
        setPicked(new Set(read.map((p) => p.sourceIndex)));
        setPhase("choose");
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [source]);

  const cancel = () => {
    // Nothing kept: the upload goes too. Best effort — a leftover file costs
    // nothing a person would notice, and the modal shouldn't hang on it.
    if (assetKey && phase !== "saving") api.post("/api/my/page-library/discard-upload", { key: assetKey }).catch(() => {});
    onClose();
  };

  const save = async () => {
    setPhase("saving");
    try {
      const chosen = sizes.filter((p) => picked.has(p.sourceIndex));
      const res = await api.post<{ ids: string[] }>("/api/my/page-library/from-upload", { assetKey, title, pages: chosen });
      onSaved(res.ids.length);
    } catch (e) {
      setError((e as Error).message);
      setPhase("choose");
    }
  };

  const toggle = (i: number) => setPicked((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const all = picked.size === sizes.length;
  const pdfUrl = `/api/my/page-library/asset?key=${encodeURIComponent(assetKey)}`;

  return (
    <Modal onClose={cancel} title="Add pages to your library" className="sm:max-w-3xl">
      {error && <ErrorNote error={new Error(error)} />}
      {phase === "preparing" && !error && (
        <div className="flex items-center gap-3 py-6 text-[16px] text-pine/70">
          <Loader2 className="h-5 w-5 animate-spin" /> {message}
        </div>
      )}
      {phase !== "preparing" && (
        <>
          <Label htmlFor="lib-import-title">Name</Label>
          <Input id="lib-import-title" value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1.5" />
          <p className="mt-1 text-[16px] text-pine/60">Each page is saved as “{title.trim() || "Uploaded page"} — p.N”. You can rename any of them after.</p>

          <div className="mt-4 flex items-center justify-between">
            <span className="font-display text-[16px] font-bold text-pine">{picked.size} of {sizes.length} page{sizes.length === 1 ? "" : "s"} chosen</span>
            <button type="button" className="text-[16px] font-bold text-pine underline" onClick={() => setPicked(all ? new Set() : new Set(sizes.map((p) => p.sourceIndex)))}>
              {all ? "Choose none" : "Choose all"}
            </button>
          </div>
          {/* Columns come from the room there is, not from breakpoints: the screen's width
              says nothing about the modal's, and a fixed count squeezed each cell narrower
              than the thumbnail it holds. */}
          <div className="mt-2 grid max-h-[34vh] grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2 overflow-y-auto p-1.5 sm:max-h-[50vh]">
            {sizes.map((p) => {
              const on = picked.has(p.sourceIndex);
              return (
                <button
                  key={p.sourceIndex}
                  type="button"
                  onClick={() => toggle(p.sourceIndex)}
                  aria-pressed={on}
                  className={cn(
                    "relative flex flex-col items-center gap-1 rounded-[12px] border-2 p-1.5 transition-colors",
                    on ? "border-pine bg-mint/20" : "border-pine/15 opacity-60 hover:opacity-100",
                  )}
                >
                  <PageThumb pdfUrl={pdfUrl} sourceIndex={p.sourceIndex} pageWidth={p.width} pageHeight={p.height} width={76} />
                  <span className="text-[16px] text-pine/70">p.{p.sourceIndex + 1}</span>
                  <span className={cn("absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-pine", on ? "bg-mint" : "bg-white")}>
                    {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={cancel} disabled={phase === "saving"}>Cancel</Button>
            <Button variant="primary" onClick={() => void save()} disabled={picked.size === 0 || phase === "saving"}>
              {phase === "saving" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" strokeWidth={2.5} />}
              Save {picked.size} page{picked.size === 1 ? "" : "s"}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

interface PushTarget {
  id: string;
  title: string;
  kind: string;
  status: string;
  archived?: number;
  class_id: string;
  class_name: string | null;
  class_emoji?: string | null;
  class_archived?: number | null;
}

/**
 * One saved page, added to the end of every notebook the teacher picks.
 *
 * Only notebooks still in use are offered: templates, and class notebooks that
 * aren't archived in classes that aren't archived. The teacher decides once,
 * for the whole push, whether students see the page now or whether it waits
 * hidden until they show it from the notebook's page list.
 */
function PushToNotebooks({ entry, onClose }: { entry: LibraryPageRec; onClose: () => void }) {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["teaching-notebooks"],
    queryFn: () => api.get<{ notebooks: PushTarget[] }>("/api/my/teaching-notebooks"),
  });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [visibility, setVisibility] = useState<"students" | "draft">("students");

  const usable = (list.data?.notebooks ?? []).filter(
    (n) => n.kind === "template" || (n.kind === "class" && !n.archived && !n.class_archived),
  );
  // Grouped the way a teacher thinks of them: by class, templates last.
  const groups = new Map<string, { label: string; items: PushTarget[] }>();
  for (const n of usable) {
    const key = n.kind === "template" ? "~templates" : n.class_id;
    const label = n.kind === "template" ? "Templates" : `${n.class_emoji ? `${n.class_emoji} ` : ""}${n.class_name ?? "Class"}`;
    if (!groups.has(key)) groups.set(key, { label, items: [] });
    groups.get(key)!.items.push(n);
  }
  const ordered = [...groups.entries()].sort(([a, ga], [b, gb]) =>
    a === "~templates" ? 1 : b === "~templates" ? -1 : ga.label.localeCompare(gb.label));
  const pickedTargets = usable.filter((n) => picked.has(n.id));
  const pickedClassNotebooks = pickedTargets.filter((n) => n.kind === "class");
  const pickedDraftNotebooks = pickedClassNotebooks.filter((n) => n.status !== "published").length;

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleGroup = (items: PushTarget[]) => setPicked((s) => {
    const n = new Set(s);
    const all = items.every((i) => n.has(i.id));
    for (const i of items) if (all) n.delete(i.id); else n.add(i.id);
    return n;
  });

  const push = useMutation({
    mutationFn: () => api.post<{ added: number; shown: number; hidden: number; templates: number; unpublished: number; skipped: number }>(
      `/api/my/page-library/${entry.id}/push`, { notebookIds: [...picked], visibility },
    ),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["teaching-notebooks"] });
      const bits = [`Added “${entry.title}” to ${r.added} notebook${r.added === 1 ? "" : "s"}`];
      if (r.hidden) bits.push(`hidden from students in ${r.hidden === 1 ? "it" : "them"} until you show it`);
      else if (r.unpublished) bits.push(`${r.unpublished} of them ${r.unpublished === 1 ? "isn't" : "aren't"} published yet, so students see it when you publish`);
      toast.success(bits.join(" — "));
      if (r.skipped) toast.warning(`${r.skipped} notebook${r.skipped === 1 ? " was" : "s were"} skipped — archived, or no longer yours to edit.`);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Modal onClose={onClose} title={`Add “${entry.title}” to notebooks`} className="sm:max-w-2xl">
      <p className="mb-3 text-[16px] text-pine/70">It goes on the end of each notebook you choose, as its own copy — change it in one and the others stay as they are.</p>
      {list.isLoading && <Spinner label="Loading your notebooks…" />}
      {list.error && <ErrorNote error={list.error as Error} />}
      {list.data && usable.length === 0 && (
        <p className="rounded-[12px] border-2 border-dashed border-pine/30 bg-oat/60 px-4 py-6 text-center text-[16px] text-pine/70">
          No notebooks to add it to yet. Make one in a class, or a template on the Notebooks page.
        </p>
      )}
      {usable.length > 0 && (
        <>
          <div className="max-h-[38vh] overflow-y-auto rounded-[16px] border-[3px] border-pine sm:max-h-[42vh]">
            {ordered.map(([key, g]) => {
              const all = g.items.every((i) => picked.has(i.id));
              return (
                <fieldset key={key} className="border-b-2 border-pine/15 last:border-b-0">
                  <legend className="sr-only">{g.label}</legend>
                  <div className="flex items-center gap-2 bg-oat/70 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate font-display text-[16px] font-bold text-pine">{g.label}</span>
                    {g.items.length > 1 && (
                      <button type="button" className="min-h-[44px] px-1 text-[16px] font-bold text-pine underline" onClick={() => toggleGroup(g.items)}>
                        {all ? "Clear" : "Choose all"}
                      </button>
                    )}
                  </div>
                  {g.items.map((n) => (
                    <label key={n.id} className="flex min-h-[44px] cursor-pointer items-center gap-3 px-3 py-2 hover:bg-mint/15">
                      <input
                        type="checkbox"
                        checked={picked.has(n.id)}
                        onChange={() => toggle(n.id)}
                        className="h-5 w-5 shrink-0 accent-[#20302C]"
                      />
                      <span className="min-w-0 flex-1 truncate text-[16px] text-pine">{n.title}</span>
                      {n.kind === "class" && n.status !== "published" && (
                        <span className="shrink-0 text-[14px] text-pine/55">not published</span>
                      )}
                    </label>
                  ))}
                </fieldset>
              );
            })}
          </div>

          <fieldset className="mt-4">
            <legend className="label-caps mb-2 text-pine/70">Students</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {([
                ["students", "Show to students now", "It's in their notebooks as soon as it's added."],
                ["draft", "Keep as a draft", "Hidden from students. Show it from the notebook's Pages list when you're ready."],
              ] as const).map(([value, label, hint]) => (
                <label
                  key={value}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-[14px] border-2 p-3",
                    visibility === value ? "border-pine bg-mint/20" : "border-pine/20 hover:bg-oat",
                  )}
                >
                  <input
                    type="radio"
                    name="push-visibility"
                    value={value}
                    checked={visibility === value}
                    onChange={() => setVisibility(value)}
                    className="mt-1 h-5 w-5 shrink-0 accent-[#20302C]"
                  />
                  <span>
                    <span className="block font-display text-[16px] font-bold text-pine">{label}</span>
                    <span className="block text-[15px] leading-snug text-pine/70">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {visibility === "students" && pickedDraftNotebooks > 0 && (
              <p className="mt-2 text-[15px] text-pine/70">
                {pickedDraftNotebooks === 1 ? "One notebook you chose isn't" : `${pickedDraftNotebooks} notebooks you chose aren't`} published yet — students see the page when you publish {pickedDraftNotebooks === 1 ? "it" : "them"}.
              </p>
            )}
            {pickedTargets.some((n) => n.kind === "template") && (
              <p className="mt-2 text-[15px] text-pine/70">Templates have no students of their own: the page reaches their classes when you send the template's updates.</p>
            )}
          </fieldset>
        </>
      )}

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={push.isPending}>Cancel</Button>
        <Button variant="primary" onClick={() => push.mutate()} disabled={picked.size === 0 || push.isPending}>
          {push.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" strokeWidth={2.5} />}
          {picked.size === 0 ? "Add to notebooks" : `Add to ${picked.size} notebook${picked.size === 1 ? "" : "s"}`}
        </Button>
      </div>
    </Modal>
  );
}
