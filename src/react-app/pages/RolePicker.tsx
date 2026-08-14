import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { GraduationCap, PenSquare } from "lucide-react";
import { toast } from "sonner";
import Shell from "../components/Shell";
import { api } from "../lib/api";

type Role = "teacher" | "student";

export default function RolePicker() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const mutation = useMutation({
    mutationFn: (role: Role) => api.post<{ ok: true; role: Role }>("/api/me/role", { role }),
    onSuccess: async (_data, role) => {
      await qc.invalidateQueries({ queryKey: ["me"] });
      navigate(role === "teacher" ? "/classes" : "/work");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const choose = (role: Role) => mutation.mutate(role);

  return (
    <Shell>
      <div className="mx-auto max-w-2xl py-10 text-center">
        <h1 className="text-2xl text-pine">Welcome to Notesanity</h1>
        <p className="measure mx-auto mt-2 text-pine/70">Tell us how you'll be using it so we can set up the right space.</p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <button
            type="button"
            disabled={mutation.isPending}
            onClick={() => choose("teacher")}
            className="flex flex-col items-center gap-3 rounded-[22px] border-[3px] border-pine bg-white p-8 text-center transition-[transform,box-shadow] hover:-translate-y-0.5 disabled:opacity-60"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full border-[3px] border-pine bg-oat text-pine">
              <PenSquare className="h-7 w-7" strokeWidth={2.5} />
            </span>
            <span className="font-display text-lg text-pine">I'm a teacher</span>
            <span className="text-sm text-pine/70">Create classes, build notebooks, and grade student work.</span>
          </button>

          <button
            type="button"
            disabled={mutation.isPending}
            onClick={() => choose("student")}
            className="flex flex-col items-center gap-3 rounded-[22px] border-[3px] border-pine bg-white p-8 text-center transition-[transform,box-shadow] hover:-translate-y-0.5 disabled:opacity-60"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full border-[3px] border-pine bg-oat text-pine">
              <GraduationCap className="h-7 w-7" strokeWidth={2.5} />
            </span>
            <span className="font-display text-lg text-pine">I'm a student</span>
            <span className="text-sm text-pine/70">Join classes and complete your notebook assignments.</span>
          </button>
        </div>
      </div>
    </Shell>
  );
}
