import { useEffect, useState, type ReactNode } from "react";
import { ConfirmModal } from "./ui";

/**
 * `confirm()`, in the app's own clothes.
 *
 * The browser's confirm box says "notesanity.com says", can't be styled, can't
 * mark a destructive choice as one, and blocks the page. This asks the same
 * question in the app's dialog and answers with a promise, so a call site reads
 * the way it did: `if (await confirmDialog({...})) doIt()`.
 */
export interface ConfirmOptions {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
}

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };
let show: ((p: Pending) => void) | null = null;

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    // No host mounted (a test render, say): fall back rather than hang.
    if (!show) { resolve(window.confirm(typeof options.body === "string" ? `${options.title}\n\n${options.body}` : options.title)); return; }
    show({ ...options, resolve });
  });
}

/** Mounted once, beside the context menu host. */
export function ConfirmHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  useEffect(() => {
    show = (p) => setPending((prev) => { prev?.resolve(false); return p; });
    return () => { show = null; };
  }, []);
  if (!pending) return null;
  const finish = (ok: boolean) => { pending.resolve(ok); setPending(null); };
  return (
    <ConfirmModal
      title={pending.title}
      body={pending.body}
      confirmLabel={pending.confirmLabel}
      cancelLabel={pending.cancelLabel}
      tone={pending.tone}
      onConfirm={() => finish(true)}
      onClose={() => finish(false)}
    />
  );
}
