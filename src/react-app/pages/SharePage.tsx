/**
 * Where a "send a copy to a colleague" link lands.
 *
 * A teacher who's signed in adds the copy with one press. Someone who isn't
 * sees what they were sent and signs in or up as a teacher; the link is kept
 * through sign-in (including the emailed-link kinds, which come back to `/`),
 * so they land back here to add it rather than at an empty home page.
 */

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BookCopy, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { ErrorNote, Logo, Spinner } from "../components/Shell";
import { Button } from "../components/ui";
import Landing from "./Landing";

export const PENDING_SHARE_KEY = "notesanity:pendingShare";

interface SharePreview { title: string; from: string; accentColor: string; pages: number; boxes: number; keyed: number }

/** After signing in some other way, finish what the share link started. */
export function PendingShare({ role }: { role: string }) {
  const navigate = useNavigate();
  useEffect(() => {
    let token: string | null = null;
    try { token = localStorage.getItem(PENDING_SHARE_KEY); } catch { /* private mode */ }
    if (!token) return;
    // Only a teacher can add one; anyone else would be sent back here forever.
    if (role !== "teacher") { forget(); return; }
    if (!window.location.pathname.startsWith("/share/")) navigate(`/share/${token}`, { replace: true });
  }, [navigate, role]);
  return null;
}

const forget = () => { try { localStorage.removeItem(PENDING_SHARE_KEY); } catch { /* private mode */ } };

export default function SharePage() {
  const { token = "" } = useParams();
  const { user } = useSession();
  const navigate = useNavigate();
  const [signingIn, setSigningIn] = useState(false);

  const preview = useQuery({
    queryKey: ["share-preview", token],
    queryFn: () => api.get<{ share: SharePreview }>(`/api/shares/${encodeURIComponent(token)}`),
    retry: false,
  });

  // Kept until it's used or turns out to be dead, so a sign-in by email link still finds its way back.
  useEffect(() => {
    if (!user) { try { localStorage.setItem(PENDING_SHARE_KEY, token); } catch { /* private mode */ } }
  }, [user, token]);
  useEffect(() => { if (preview.error) forget(); }, [preview.error]);

  const add = useMutation({
    mutationFn: () => api.post<{ notebook: { id: string } }>(`/api/shares/${encodeURIComponent(token)}/copy`, {}),
    onSuccess: (r) => {
      forget();
      toast.success("Added to your templates — it's yours to change");
      navigate(`/notebooks/${r.notebook.id}/edit`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!user && signingIn) return <Landing />;

  const s = preview.data?.share;
  return (
    <div className="min-h-dvh bg-oat px-4 py-10">
      <div className="mx-auto max-w-lg">
        <div className="mb-6 flex justify-center"><Logo size={34} /></div>
        {preview.isLoading ? (
          <Spinner label="Opening the link…" />
        ) : preview.error ? (
          <div className="rounded-[22px] border-[3px] border-pine bg-white p-6 shadow-[4px_4px_0_0_var(--color-pine)]">
            <ErrorNote error={preview.error as Error} />
            <p className="mt-3 text-[16px] text-pine/70">Ask whoever sent it for a new one.</p>
            {user && <Link to="/" className="mt-4 inline-block font-bold text-pine underline decoration-mint decoration-2 underline-offset-2">Go to Notesanity</Link>}
          </div>
        ) : s ? (
          <div className="overflow-hidden rounded-[22px] border-[3px] border-pine bg-white shadow-[4px_4px_0_0_var(--color-pine)]" data-testid="share-card">
            <div className="h-3" style={{ background: s.accentColor }} aria-hidden />
            <div className="p-6">
              <p className="label-caps text-pine/60">{s.from} sent you a notebook</p>
              <h1 className="mt-1 font-display text-[26px] font-bold leading-tight text-pine">{s.title}</h1>
              <ul className="mt-3 space-y-1 text-[16px] text-pine/80">
                <li className="flex items-center gap-2"><BookCopy className="h-4 w-4 text-pine/60" strokeWidth={2.5} />
                  {s.pages} page{s.pages === 1 ? "" : "s"}{s.boxes ? `, ${s.boxes} answer box${s.boxes === 1 ? "" : "es"}` : ""}
                </li>
                {s.keyed > 0 && (
                  <li className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-pine/60" strokeWidth={2.5} />
                    Answer key on {s.keyed} box{s.keyed === 1 ? "" : "es"}
                  </li>
                )}
              </ul>
              <p className="mt-4 text-[16px] leading-relaxed text-pine/70">
                Adding it gives you your own copy to change, push to your classes and grade. None of
                anyone's students or their work comes with it.
              </p>

              {!user ? (
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button variant="primary" onClick={() => setSigningIn(true)}>Sign up free to add it</Button>
                  <Button variant="secondary" onClick={() => setSigningIn(true)}>I have an account</Button>
                </div>
              ) : user.role === "teacher" ? (
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button variant="primary" onClick={() => add.mutate()} disabled={add.isPending}>
                    {add.isPending ? "Adding…" : "Add to my notebooks"}
                  </Button>
                  <Button variant="ghost" onClick={() => { forget(); navigate("/"); }}>No thanks</Button>
                </div>
              ) : (
                <p className="mt-5 rounded-[14px] border-2 border-pine/20 bg-oat px-3 py-2 text-[16px] text-pine/80">
                  Only a teacher can add a copy. Sign out and sign in with your teacher account to add it.
                </p>
              )}
            </div>
          </div>
        ) : null}
        {!user && s && (
          <p className="mt-6 text-center text-[16px] leading-relaxed text-pine/70">
            Notesanity turns the worksheets you already have into notebooks students write on, and
            you grade them on the page — no printing. Free for teachers during the beta.{" "}
            <a href="/" className="font-bold text-pine underline decoration-mint decoration-2 underline-offset-2">What it does</a>
          </p>
        )}
      </div>
    </div>
  );
}
