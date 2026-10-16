/**
 * Pick a saved page and drop it into this notebook.
 *
 * Deliberately the same shape as "Add blank pages": a grid of previews, a
 * "Where" control, and one primary action. A teacher choosing between blank
 * paper and a saved worksheet is making one decision, so the two screens should
 * not feel like different products.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, libraryPageSource, type LibraryPageRec, type PageRec } from "../lib/api";
import { cn, relativeTime } from "../lib/utils";
import { Button, ConfirmModal, Modal, Select } from "./ui";
import { ErrorNote, Spinner } from "./Shell";
import PageThumb from "./PageThumb";

export default function PageLibraryModal({
  pages, currentPageId, busy, onClose, onInsert,
}: {
  pages: PageRec[];
  /** The page on screen behind the modal, if there is one. */
  currentPageId?: string | null;
  busy: boolean;
  onClose: () => void;
  onInsert: (body: { entryId: string; insertAfterPageId: string | null }) => void;
}) {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<string | null>(null);
  const [removing, setRemoving] = useState<LibraryPageRec | null>(null);

  const live = pages.filter((p) => !p.archived);
  /**
   * "Right here" is what a teacher almost always means: they were looking at a
   * page when they reached for the library. So it leads the list and it is the
   * default — the end of a forty-page notebook is a long scroll from wherever
   * they were.
   */
  const currentIdx = currentPageId ? live.findIndex((p) => p.id === currentPageId) : -1;
  const [after, setAfter] = useState(currentIdx >= 0 ? live[currentIdx].id : "");

  const library = useQuery({
    queryKey: ["page-library"],
    queryFn: () => api.get<{ pages: LibraryPageRec[] }>("/api/my/page-library"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/my/page-library/${id}`),
    onSuccess: async (_r, id) => {
      await qc.invalidateQueries({ queryKey: ["page-library"] });
      if (picked === id) setPicked(null);
      setRemoving(null);
      toast.success("Removed from your library");
    },
    onError: (e: Error) => { toast.error(e.message); setRemoving(null); },
  });

  const entries = library.data?.pages ?? [];

  return (
    <Modal onClose={onClose} title="Insert from your library" className="sm:max-w-2xl">
      {library.isLoading && <Spinner label="Loading your library…" />}
      {library.error && <ErrorNote error={library.error as Error} />}

      {!library.isLoading && !library.error && entries.length === 0 && (
        <p className="rounded-[12px] border-2 border-dashed border-pine/30 bg-oat/60 px-4 py-8 text-center text-[16px] text-pine/70">
          Nothing saved yet. Use <span className="font-display font-bold text-pine">Save to library</span> on any
          page — the warm-up you use every week, a lab write-up frame — and it'll be here to drop into any notebook.
        </p>
      )}

      {entries.length > 0 && (
        <>
          <div className="grid max-h-[42vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4">
            {entries.map((e) => (
              <div key={e.id} className="relative">
                <button
                  type="button"
                  onClick={() => setPicked(e.id)}
                  aria-pressed={picked === e.id}
                  className={cn(
                    "flex w-full flex-col items-center gap-1.5 rounded-[12px] border-2 p-2 transition-colors",
                    picked === e.id ? "border-pine bg-mint/25" : "border-pine/20 hover:bg-oat",
                  )}
                >
                  <span className="overflow-hidden rounded-[4px] border border-pine/25">
                    <PageThumb {...libraryPageSource(e)} width={72} />
                  </span>
                  <span className="line-clamp-2 text-center text-[14px] font-bold leading-tight text-pine">
                    {e.title}
                  </span>
                  <span className="text-[13px] text-pine/55">{relativeTime(e.created_at)}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setRemoving(e)}
                  title={`Remove "${e.title}" from your library`}
                  aria-label={`Remove ${e.title} from your library`}
                  className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-oat/90 text-pine/60 hover:bg-oat hover:text-[#a3341f]"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="mt-5">
            <label className="label-caps mb-1 block text-pine/70" htmlFor="library-after">Where</label>
            <Select id="library-after" value={after} onChange={(e) => setAfter(e.target.value)}>
              {currentIdx >= 0 && (
                <option value={live[currentIdx].id}>After the current page (page {currentIdx + 1})</option>
              )}
              <option value="">At the end</option>
              {live.map((p, i) => (
                <option key={p.id} value={p.id}>
                  After page {i + 1}{p.label ? ` — ${p.label}` : ""}
                </option>
              ))}
            </Select>
          </div>
        </>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button
          variant="primary"
          disabled={busy || !picked}
          onClick={() => picked && onInsert({ entryId: picked, insertAfterPageId: after || null })}
        >
          {busy ? "Adding…" : "Add page"}
        </Button>
      </div>

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
    </Modal>
  );
}
