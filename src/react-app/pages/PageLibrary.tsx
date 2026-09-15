/**
 * The teacher's saved pages, with a home of their own.
 *
 * Until this existed the library could only be seen from inside the insert
 * modal, which meant there was nowhere to tidy it: no way to rename the entry
 * you saved in a hurry, or clear out last year's. Inserting still belongs in a
 * notebook — that's where the question "where does this page go" has an answer
 * — so this page is for keeping the library in order, not for using it.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, LibraryBig, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import Shell, { EmptyState, ErrorNote, Spinner } from "../components/Shell";
import PageThumb from "../components/PageThumb";
import { Button, Card, ConfirmModal, Input } from "../components/ui";
import { api, libraryPageSource, type LibraryPageRec } from "../lib/api";
import { useSession } from "../lib/session";
import { relativeTime } from "../lib/utils";

export default function PageLibrary() {
  const qc = useQueryClient();
  const { user, isLoading: sessionLoading } = useSession();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [removing, setRemoving] = useState<LibraryPageRec | null>(null);

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
      <h1 className="mb-2 font-display text-[32px] text-pine">Page library</h1>
      <p className="mb-6 measure text-[16px] text-pine/70">
        Pages you've saved to reuse. Add one from any notebook's page list, then drop it into
        another notebook with <span className="font-display font-bold text-pine">Add pages</span>{" "}
        &rarr; <span className="font-display font-bold text-pine">Page library</span>.
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
