/**
 * Every notebook a teacher teaches from, in one place — and their templates.
 *
 * The class page shows one class's notebooks. This shows all of them, filtered
 * by class, which is what a teacher with five sections wants on a Sunday night.
 * It is also where templates live: a notebook built once, outside any class,
 * pushed into whichever classes teach from it and topped up from here when the
 * template grows.
 */

import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookText, CheckSquare, ChevronDown, Plus, Rows3, Send, Trash2, Upload, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import Shell, { EmptyState, ErrorNote, Spinner } from "../components/Shell";
import NewNotebookModal from "../components/NewNotebookModal";
import PushToClassesModal from "../components/PushToClassesModal";
import { Button, Chip, ConfirmModal, Menu, Select, buttonClass, type MenuItem } from "../components/ui";
import { api, type ClassSummary } from "../lib/api";
import { driveFileAsPdf, hasDrivePicker, pickDriveFile } from "../lib/google";
import { NotebookCard, type ClassNotebook } from "./ClassView";
import GoogleIcon from "../components/GoogleIcon";

interface TeachingNotebook extends ClassNotebook {
  class_id: string;
  class_name: string | null;
  class_emoji?: string | null;
  template_id: string | null;
  copies?: {
    notebookId: string; classId: string; className: string; status: string; archived: boolean;
    pendingPages: number; pendingFields: number;
  }[];
}

export default function TeacherNotebooks() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<string>("all");
  const [blankOpen, setBlankOpen] = useState(false);
  const [deleting, setDeleting] = useState<TeachingNotebook | null>(null);
  /** Template ids the push dialog is open for. */
  const [pushing, setPushing] = useState<string[] | null>(null);
  /** Picking several templates to push at once; null when not picking. */
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const list = useQuery({
    queryKey: ["teaching-notebooks"],
    queryFn: () => api.get<{ notebooks: TeachingNotebook[] }>("/api/my/teaching-notebooks"),
  });
  const classes = useQuery({
    queryKey: ["classes", "active"],
    queryFn: () => api.get<{ classes: ClassSummary[] }>("/api/classes"),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["teaching-notebooks"] });

  const sync = useMutation({
    mutationFn: (templateId: string) =>
      api.post<{ classes: number; pagesAdded: number; fieldsAdded: number }>(`/api/templates/${templateId}/sync`, {}),
    onSuccess: (res) => {
      refresh();
      const bits = [];
      if (res.pagesAdded) bits.push(`${res.pagesAdded} page${res.pagesAdded === 1 ? "" : "s"}`);
      if (res.fieldsAdded) bits.push(`${res.fieldsAdded} answer box${res.fieldsAdded === 1 ? "" : "es"}`);
      toast.success(bits.length
        ? `Sent ${bits.join(" and ")} to ${res.classes} class${res.classes === 1 ? "" : "es"}`
        : "Every class already has everything in this template");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/templates/${id}`),
    onSuccess: () => { refresh(); setDeleting(null); toast.success("Template deleted — the notebooks it was pushed to are untouched"); },
    onError: (e: Error) => { toast.error(e.message); setDeleting(null); },
  });

  const importFromDrive = async () => {
    try {
      const picked = await pickDriveFile();
      if (!picked) return;
      const blob = await driveFileAsPdf(picked);
      const file = new File([blob], picked.name.replace(/\.[^.]+$/, "") + ".pdf", { type: "application/pdf" });
      navigate("/templates/upload", { state: { file, template: true } });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const all = list.data?.notebooks ?? [];
  const hasClasses = (classes.data?.classes ?? []).some((c) => c.my_role === "teacher");
  const shown = useMemo(() => {
    if (filter === "all") return all;
    if (filter === "templates") return all.filter((n) => n.kind === "template");
    return all.filter((n) => n.class_id === filter);
  }, [all, filter]);
  const templates = shown.filter((n) => n.kind === "template");
  const inClasses = shown.filter((n) => n.kind !== "template");

  const templateMenu = (t: TeachingNotebook): MenuItem[] => {
    const pending = (t.copies ?? []).reduce((n, c) => n + c.pendingPages + c.pendingFields, 0);
    return [
      {
        label: "Push to classes…",
        icon: <Send className="h-5 w-5" strokeWidth={2.5} />,
        disabled: !hasClasses,
        hint: hasClasses
          ? "Pick one class or several. Each gets a copy as a draft."
          : "Make a class first, or join one as a teacher.",
        onClick: () => setPushing([t.id]),
      },
      ...((t.copies ?? []).length > 0 ? [{
        label: pending ? `Send updates to ${t.copies!.length} class${t.copies!.length === 1 ? "" : "es"}` : "Send updates",
        icon: <RefreshCw className="h-5 w-5" strokeWidth={2.5} />,
        disabled: !pending,
        hint: pending
          ? `${pending} new page${pending === 1 ? "" : "s"} or box${pending === 1 ? "" : "es"} waiting. Only what's new is added — nothing already in a class is changed.`
          : "Every class already has everything in this template.",
        onClick: () => sync.mutate(t.id),
      }] : []),
      {
        label: "Delete template",
        icon: <Trash2 className="h-5 w-5" strokeWidth={2.5} />,
        danger: true,
        hint: "The notebooks it was pushed to stay exactly as they are.",
        onClick: () => setDeleting(t),
      },
    ];
  };

  const togglePicked = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const allTemplates = all.filter((n) => n.kind === "template");

  const byline = (t: TeachingNotebook) => {
    const copies = t.copies ?? [];
    if (copies.length === 0) return "Template · not in a class yet";
    const pending = copies.reduce((n, c) => n + c.pendingPages + c.pendingFields, 0);
    return `Template · in ${copies.length} class${copies.length === 1 ? "" : "es"}${pending ? ` · ${pending} update${pending === 1 ? "" : "s"} to send` : ""}`;
  };

  return (
    <Shell>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="font-display text-[32px] text-pine">Notebooks</h1>
          <p className="text-[16px] text-pine/70">Everything you teach from, in every class — and the templates you build them from.</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Show" className="h-12">
            <option value="all">All classes</option>
            <option value="templates">Templates only</option>
            {(classes.data?.classes ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Menu
            label="New template"
            triggerClassName={buttonClass("primary", "md")}
            trigger={<><Plus className="h-5 w-5" strokeWidth={2.5} /> New template <ChevronDown className="h-4 w-4" strokeWidth={2.5} /></>}
            items={[
              { label: "Blank pages", icon: <Rows3 className="h-5 w-5" strokeWidth={2.5} />, hint: "Lined, graph, dot grid, staves…", onClick: () => setBlankOpen(true) },
              { label: "Upload a file", icon: <Upload className="h-5 w-5" strokeWidth={2.5} />, hint: "PDF, Word or PowerPoint", onClick: () => fileRef.current?.click() },
              ...(hasDrivePicker ? [{ label: "From Google Drive", icon: <GoogleIcon product="drive" />, hint: "Pick a file without downloading it", onClick: () => void importFromDrive() }] : []),
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
              if (f) navigate("/templates/upload", { state: { file: f, template: true } });
            }}
          />
        </div>
      </div>

      {list.isLoading && <Spinner label="Loading your notebooks…" />}
      {list.error && <ErrorNote error={list.error as Error} />}

      {!list.isLoading && !list.error && (
        <>
          {(filter === "all" || filter === "templates") && (
            <section className="mb-8">
              <h2 className="mb-3 flex items-center gap-2 font-display text-[20px] text-pine">
                <BookText className="h-5 w-5" strokeWidth={2.5} /> Templates
                <Chip tone="quiet">{templates.length}</Chip>
                {templates.length > 0 && (
                  <Button
                    size="sm"
                    variant={picked ? "primary" : "secondary"}
                    className="ml-auto"
                    onClick={() => setPicked(picked ? null : new Set())}
                    aria-pressed={!!picked}
                  >
                    {picked ? <X className="h-4 w-4" strokeWidth={2.5} /> : <CheckSquare className="h-4 w-4" strokeWidth={2.5} />}
                    {picked ? "Done selecting" : "Select"}
                  </Button>
                )}
              </h2>
              {templates.length === 0 ? (
                <EmptyState
                  title="No templates yet"
                  body="Build a notebook once, then push it into every class that uses it. When you add pages to the template later, send just the new ones to all of them at once."
                />
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {templates.map((t) => (
                    <NotebookCard
                      key={t.id}
                      nb={t}
                      to={`/notebooks/${t.id}/edit`}
                      byline={byline(t)}
                      menu={templateMenu(t)}
                      selected={picked?.has(t.id)}
                      onSelect={picked ? () => togglePicked(t.id) : undefined}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {filter !== "templates" && (
            <section>
              <h2 className="mb-3 font-display text-[20px] text-pine">
                {filter === "all" ? "In your classes" : (classes.data?.classes.find((c) => c.id === filter)?.name ?? "This class")}
                <Chip tone="quiet" className="ml-2">{inClasses.length}</Chip>
              </h2>
              {inClasses.length === 0 ? (
                <EmptyState title="Nothing here yet" body="Notebooks you make inside a class, or push from a template, show up here." />
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {inClasses.map((n) => (
                    <NotebookCard
                      key={n.id}
                      nb={n}
                      to={`/notebooks/${n.id}/edit`}
                      byline={`${n.class_emoji ? `${n.class_emoji} ` : ""}${n.class_name ?? ""}${n.template_id ? " · from a template" : ""}`}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}

      {/* The selection's actions stay in reach however far down the list goes. */}
      {picked && (
        <div className="sticky bottom-4 z-30 mt-6 flex flex-wrap items-center gap-3 rounded-[22px] border-[3px] border-pine bg-white p-3 shadow-[4px_4px_0_0_var(--color-pine)]">
          <span className="pl-2 font-display text-[17px] text-pine">
            {picked.size === 0 ? "Tap templates to select them" : `${picked.size} selected`}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            {picked.size < allTemplates.length ? (
              <Button variant="ghost" onClick={() => setPicked(new Set(allTemplates.map((t) => t.id)))}>Select all</Button>
            ) : (
              <Button variant="ghost" onClick={() => setPicked(new Set())}>Clear</Button>
            )}
            <Button variant="primary" disabled={picked.size === 0 || !hasClasses} onClick={() => setPushing([...picked])}>
              <Send className="h-5 w-5" strokeWidth={2.5} /> Push to classes…
            </Button>
          </div>
        </div>
      )}

      {pushing && (
        <PushToClassesModal
          templates={allTemplates.filter((t) => pushing.includes(t.id))}
          onClose={() => setPushing(null)}
          onDone={() => setPicked(null)}
        />
      )}
      {blankOpen && (
        <NewNotebookModal
          destination={{ kind: "template" }}
          onClose={() => setBlankOpen(false)}
          onCreated={(id) => { setBlankOpen(false); navigate(`/notebooks/${id}/edit`); }}
        />
      )}
      {deleting && (
        <ConfirmModal
          title={`Delete “${deleting.title}”?`}
          body="The template goes for good. Any notebook you pushed from it stays in its class, exactly as it is, and stops receiving updates."
          confirmLabel="Delete template"
          tone="danger"
          busy={remove.isPending}
          onClose={() => setDeleting(null)}
          onConfirm={() => remove.mutate(deleting.id)}
        />
      )}
    </Shell>
  );
}
