import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Clock, GraduationCap, PenSquare, Users } from "lucide-react";
import { toast } from "sonner";
import Shell from "../components/Shell";
import { Button, Input, Label } from "../components/ui";
import { api } from "../lib/api";
import { signOutHref, useSession } from "../lib/session";

type Choice = "teacher" | "student" | "guardian";

/**
 * For an account that doesn't have a role yet — made before sign-in asked who
 * someone is, or on an address shared by staff and students.
 *
 * Every option is checked on the server: a school address for a student, an
 * admin's say-so for a teacher (this only asks), a family code for a parent.
 * So choosing wrongly can't grant anything, and someone waiting on an admin
 * is told that plainly rather than shown the choice again.
 */
export default function RolePicker() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user } = useSession();
  const [familyOpen, setFamilyOpen] = useState(false);
  const [code, setCode] = useState("");

  const mutation = useMutation({
    mutationFn: (role: Choice) => api.post<{ ok: true; role: string }>("/api/me/role", { role, familyCode: code }),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ["me"] });
      navigate(res.role === "student" ? "/work" : res.role === "guardian" ? "/family" : "/");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (user?.requestedRole === "teacher") {
    return (
      <Shell>
        <div className="mx-auto max-w-xl py-10 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border-[3px] border-pine bg-oat text-pine">
            <Clock className="h-7 w-7" strokeWidth={2.5} />
          </span>
          <h1 className="mt-4 text-2xl text-pine">Waiting for your school to confirm</h1>
          <p className="measure mx-auto mt-2 text-pine/75">
            Your school uses one email domain for staff and students, so an admin confirms each new teacher account.
            They'll see your request on the Admin page. Once they have, sign in again and your classes are ready to build.
          </p>
          <a href={signOutHref} className="mt-6 inline-block font-display text-[16px] underline">Sign out</a>
        </div>
      </Shell>
    );
  }

  const card =
    "flex flex-col items-center gap-3 rounded-[22px] border-[3px] border-pine bg-white p-6 text-center transition-[transform,box-shadow] hover:-translate-y-0.5 disabled:opacity-60";
  const badge = "flex h-14 w-14 items-center justify-center rounded-full border-[3px] border-pine bg-oat text-pine";

  return (
    <Shell>
      <div className="mx-auto max-w-3xl py-10 text-center">
        <h1 className="text-2xl text-pine">Welcome to Notesanity</h1>
        <p className="measure mx-auto mt-2 text-pine/70">Tell us who you are so we can set up the right space.</p>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <button type="button" disabled={mutation.isPending} onClick={() => mutation.mutate("teacher")} className={card}>
            <span className={badge}><PenSquare className="h-7 w-7" strokeWidth={2.5} /></span>
            <span className="font-display text-lg text-pine">I'm a teacher</span>
            <span className="text-[16px] text-pine/70">An admin at your school confirms teacher accounts.</span>
          </button>
          <button type="button" disabled={mutation.isPending} onClick={() => mutation.mutate("student")} className={card}>
            <span className={badge}><GraduationCap className="h-7 w-7" strokeWidth={2.5} /></span>
            <span className="font-display text-lg text-pine">I'm a student</span>
            <span className="text-[16px] text-pine/70">Join your classes and work in your notebooks.</span>
          </button>
          <button type="button" disabled={mutation.isPending} onClick={() => setFamilyOpen(true)} className={card} aria-expanded={familyOpen}>
            <span className={badge}><Users className="h-7 w-7" strokeWidth={2.5} /></span>
            <span className="font-display text-lg text-pine">I'm a parent or guardian</span>
            <span className="text-[16px] text-pine/70">Follow along with your child's work, with a code from their teacher.</span>
          </button>
        </div>

        {familyOpen && (
          <form
            className="mx-auto mt-6 max-w-sm rounded-[22px] border-[3px] border-pine bg-white p-5 text-left"
            onSubmit={(e) => { e.preventDefault(); mutation.mutate("guardian"); }}
          >
            <Label htmlFor="pending-family-code">Family code</Label>
            <Input
              id="pending-family-code"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABCD-2345"
              className="mt-1.5 font-display tracking-[0.12em]"
            />
            <p className="mt-1.5 text-[16px] text-pine/70">Your child's teacher can give you one.</p>
            <Button type="submit" variant="primary" className="mt-4 w-full" disabled={!code.trim() || mutation.isPending}>
              See my child's work
            </Button>
          </form>
        )}
      </div>
    </Shell>
  );
}
