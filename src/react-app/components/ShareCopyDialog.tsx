import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Link2, Mail } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { Button, Input, Modal } from "./ui";
import { Spinner } from "./Shell";

interface Share { token: string; url: string; copies: number }

/**
 * "Send a copy to a colleague": a link another teacher opens to add this
 * notebook to their own templates. The copy is the notebook as you built it —
 * pages, boxes, answer keys and your writing on the pages — and never any
 * student's work. One live link per notebook; stopping sharing switches it off.
 */
export function ShareCopyDialog({ notebookId, title, onClose }: { notebookId: string; title: string; onClose: () => void }) {
  const qc = useQueryClient();
  const key = ["share", notebookId];
  const current = useQuery({ queryKey: key, queryFn: () => api.get<{ share: Share | null }>(`/api/notebooks/${notebookId}/share`) });
  const make = useMutation({
    mutationFn: () => api.post<{ share: Share }>(`/api/notebooks/${notebookId}/share`, {}),
    onSuccess: (r) => qc.setQueryData(key, { share: r.share }),
    onError: (e: Error) => toast.error(e.message),
  });
  const stop = useMutation({
    mutationFn: () => api.del(`/api/notebooks/${notebookId}/share`),
    onSuccess: () => { qc.setQueryData(key, { share: null }); toast.success("That link no longer works. Copies already made stay with their teachers."); },
    onError: (e: Error) => toast.error(e.message),
  });
  const [copied, setCopied] = useState(false);
  const share = current.data?.share ?? null;

  const copy = async () => {
    if (!share) return;
    try {
      await navigator.clipboard.writeText(share.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy it — select the link and copy it yourself.");
    }
  };
  const mail = share
    ? `mailto:?subject=${encodeURIComponent(`A Notesanity notebook for you: ${title}`)}&body=${encodeURIComponent(`I thought you could use this. Open the link to add a copy to your own Notesanity notebooks:\n\n${share.url}\n`)}`
    : "";

  return (
    <Modal onClose={onClose} title="Send a copy to a colleague">
      <p className="text-[16px] leading-relaxed text-pine/80">
        Another teacher who opens the link can add a copy of <b>{title}</b> to their own notebooks:
        its pages, answer boxes and answer keys, and anything you've written on the pages.
        <b> No student work goes with it.</b> Their copy is theirs to change — it doesn't change yours.
      </p>
      {current.isLoading ? (
        <Spinner label="Checking…" />
      ) : share ? (
        <div className="mt-4">
          <label className="label-caps block text-pine/70" htmlFor="share-url">Link</label>
          <div className="mt-1 flex gap-2">
            <Input id="share-url" readOnly value={share.url} onFocus={(e) => e.currentTarget.select()} className="text-[16px]" />
            <Button variant="primary" onClick={copy} aria-label="Copy the link">
              {copied ? <Check className="h-4 w-4" strokeWidth={2.5} /> : <Copy className="h-4 w-4" strokeWidth={2.5} />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <a href={mail} className="inline-flex min-h-[44px] items-center gap-1.5 font-bold text-pine underline decoration-mint decoration-2 underline-offset-2">
              <Mail className="h-4 w-4" strokeWidth={2.5} /> Email it
            </a>
            <span className="text-[16px] text-pine/60" data-testid="share-copies">
              {share.copies ? `Added by ${share.copies} teacher${share.copies === 1 ? "" : "s"} so far` : "Nobody has added it yet"}
            </span>
          </div>
          <p className="mt-3 text-[15px] leading-snug text-pine/60">
            Anyone with the link who teaches can add a copy, so send it to people rather than posting it
            publicly. Stop sharing whenever you like; copies already made stay with their teachers.
          </p>
          <div className="mt-5 flex justify-between gap-2">
            <Button variant="danger" onClick={() => stop.mutate()} disabled={stop.isPending}>Stop sharing</Button>
            <Button variant="secondary" onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => make.mutate()} disabled={make.isPending}>
            <Link2 className="h-4 w-4" strokeWidth={2.5} /> {make.isPending ? "Making the link…" : "Make a link"}
          </Button>
        </div>
      )}
    </Modal>
  );
}
