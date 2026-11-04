import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Mail, Printer, RefreshCw, UserX } from "lucide-react";
import { toast } from "sonner";
import { Spinner, ErrorNote } from "./Shell";
import { Button, IconButton, Input, Modal } from "./ui";
import { api } from "../lib/api";
import { confirmDialog } from "./ConfirmDialog";

interface FamilyRow {
  id: string;
  name: string;
  email: string;
  code: string;
  link: string;
  guardians: { linkId: string; id: string; name: string; email: string; since: string }[];
}

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]!));

/**
 * One slip per student, to cut up and send home — the way most families will
 * first hear of this. Printed from its own window so the page's chrome stays out.
 */
function printSlips(className: string, rows: FamilyRow[]) {
  const origin = window.location.origin;
  const slips = rows.map((r) => `
    <div class="slip">
      <div class="who">${esc(r.name)}</div>
      <div class="cls">${esc(className)}</div>
      <p>See ${esc(r.name.split(" ")[0])}'s notebooks, assignments and grades on Notesanity. You can look, not change anything.</p>
      <ol>
        <li>Go to <b>${esc(origin)}/family</b></li>
        <li>Choose <b>Parent or guardian</b></li>
        <li>Enter this code, then sign in with any email address</li>
      </ol>
      <div class="code">${esc(r.code)}</div>
    </div>`).join("");
  const w = window.open("", "_blank");
  if (!w) { toast.error("Your browser blocked the print window — allow pop-ups and try again."); return; }
  w.document.write(`<!doctype html><html><head><title>Family codes · ${esc(className)}</title>
    <style>
      body { font-family: Nunito, system-ui, sans-serif; color: #20302C; margin: 24px; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
      .slip { border: 2px dashed #20302C; border-radius: 14px; padding: 14px 16px; break-inside: avoid; }
      .who { font-size: 20px; font-weight: 800; }
      .cls { color: #55615d; font-size: 14px; }
      p, li { font-size: 14px; line-height: 1.4; }
      ol { padding-left: 20px; margin: 6px 0 10px; }
      .code { font-size: 26px; font-weight: 800; letter-spacing: 0.14em; font-family: ui-monospace, monospace; }
      @media print { body { margin: 0; } }
    </style></head><body><div class="grid">${slips}</div>
    <script>window.onload = () => { window.print(); };</script></body></html>`);
  w.document.close();
}

/**
 * Families for one class: each student's code, who's already linked, and the
 * ways to reach a family — an email, a link to copy, or a printed slip.
 */
export default function FamilyAccessModal({ classId, className, onClose }: { classId: string; className: string; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["class-family", classId],
    queryFn: () => api.get<{ familyAccess: boolean; students: FamilyRow[] }>(`/api/classes/${classId}/family`),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["class-family", classId] });
  const [inviting, setInviting] = useState<string | null>(null);
  const [email, setEmail] = useState("");

  const invite = useMutation({
    mutationFn: (studentId: string) => api.post(`/api/classes/${classId}/family/${studentId}/invite`, { email }),
    onSuccess: () => { toast.success(`Sent to ${email}`); setInviting(null); setEmail(""); },
    onError: (e: Error) => toast.error(e.message),
  });
  const newCode = useMutation({
    mutationFn: (studentId: string) => api.post(`/api/classes/${classId}/family/${studentId}/new-code`, {}),
    onSuccess: () => { refresh(); toast.success("New code made — the old one no longer works"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const unlink = useMutation({
    mutationFn: ({ studentId, guardianId }: { studentId: string; guardianId: string }) =>
      api.del(`/api/classes/${classId}/family/${studentId}/guardians/${guardianId}`),
    onSuccess: () => { refresh(); toast.success("Removed"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.success("Link copied"); }
    catch { toast.error("Couldn't copy — select the code instead."); }
  };

  const rows = q.data?.students ?? [];

  return (
    <Modal onClose={onClose} title="Families" className="sm:max-w-2xl">
      <p className="mb-3 text-[16px] text-pine/75">
        Each student has a family code. A parent or guardian who signs in with it sees that child's notebooks,
        assignments and returned grades — to look at, never to change — and nothing about anyone else.
      </p>
      {q.data && !q.data.familyAccess && (
        <div className="mb-3 rounded-[12px] border-[3px] border-[#8a6a1f] bg-[#f7e6bf] p-3 text-[16px] text-[#5c4611]">
          Family access is turned off for your school, so codes won't work yet. A school admin can turn it on from the Admin page.
        </div>
      )}
      {q.isLoading && <Spinner label="Loading…" />}
      {q.error && <ErrorNote error={q.error as Error} />}
      {rows.length > 0 && (
        <>
          <div className="mb-3 flex justify-end">
            <Button variant="secondary" size="sm" onClick={() => printSlips(className, rows)}>
              <Printer className="h-4 w-4" strokeWidth={2.5} /> Print codes to send home
            </Button>
          </div>
          <ul className="divide-y divide-pine/15 overflow-hidden rounded-[16px] border-[3px] border-pine">
            {rows.map((r) => (
              <li key={r.id} className="p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-display text-pine">{r.name}</div>
                    <div className="text-[16px] text-pine/70">
                      Code <span className="select-all font-display tracking-[0.12em] text-pine">{r.code}</span>
                    </div>
                  </div>
                  <IconButton label={`Copy ${r.name}'s family link`} variant="ghost" onClick={() => void copy(r.link)}>
                    <Copy className="h-4 w-4" strokeWidth={2.5} />
                  </IconButton>
                  <IconButton label={`Email ${r.name}'s family`} variant="ghost" onClick={() => { setInviting(inviting === r.id ? null : r.id); setEmail(""); }}>
                    <Mail className="h-4 w-4" strokeWidth={2.5} />
                  </IconButton>
                  <IconButton
                    label={`Make a new code for ${r.name}`}
                    variant="ghost"
                    onClick={async () => { if (await confirmDialog({ title: `New family code for ${r.name}?`, body: "The old code stops working at once. Families already linked stay linked.", confirmLabel: "Make a new code" })) newCode.mutate(r.id); }}
                  >
                    <RefreshCw className="h-4 w-4" strokeWidth={2.5} />
                  </IconButton>
                </div>
                {inviting === r.id && (
                  <form
                    className="mt-2 flex flex-wrap items-center gap-2"
                    onSubmit={(e) => { e.preventDefault(); invite.mutate(r.id); }}
                  >
                    <Input
                      type="email"
                      autoFocus
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="parent@example.com"
                      aria-label={`Family email for ${r.name}`}
                      className="min-w-[14rem] flex-1"
                    />
                    <Button type="submit" variant="primary" size="sm" disabled={invite.isPending}>Send invite</Button>
                  </form>
                )}
                {r.guardians.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {r.guardians.map((g) => (
                      <li key={g.linkId} className="flex items-center gap-2 rounded-[10px] bg-oat px-3 py-1.5 text-[16px] text-pine">
                        <span className="min-w-0 flex-1 truncate">{g.name}{g.email !== g.name ? ` · ${g.email}` : ""}</span>
                        <IconButton
                          label={`Remove ${g.name}`}
                          variant="ghost"
                          className="h-9 w-9 hover:bg-[#a3341f]/10 hover:text-[#a3341f]"
                          onClick={async () => { if (await confirmDialog({ title: `Remove ${g.name}?`, body: `They'll stop seeing ${r.name}'s work. To see it again they'd need a family code.`, confirmLabel: "Remove", tone: "danger" })) unlink.mutate({ studentId: r.id, guardianId: g.id }); }}
                        >
                          <UserX className="h-4 w-4" strokeWidth={2.5} />
                        </IconButton>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {q.data && rows.length === 0 && <p className="py-4 text-center text-[16px] text-pine/70">No students in this class yet.</p>}
    </Modal>
  );
}
