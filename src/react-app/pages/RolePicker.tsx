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
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Welcome to Notesanity</h1>
        <p className="mt-2 text-sm text-slate-600">Tell us how you'll be using it so we can set up the right space.</p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <button
            type="button"
            disabled={mutation.isPending}
            onClick={() => choose("teacher")}
            className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-50/50 disabled:opacity-60"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 text-blue-600">
              <PenSquare className="h-7 w-7" />
            </span>
            <span className="text-lg font-medium text-slate-900">I'm a teacher</span>
            <span className="text-sm text-slate-500">Create classes, build notebooks, and grade student work.</span>
          </button>

          <button
            type="button"
            disabled={mutation.isPending}
            onClick={() => choose("student")}
            className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-50/50 disabled:opacity-60"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 text-blue-600">
              <GraduationCap className="h-7 w-7" />
            </span>
            <span className="text-lg font-medium text-slate-900">I'm a student</span>
            <span className="text-sm text-slate-500">Join classes and complete your notebook assignments.</span>
          </button>
        </div>
      </div>
    </Shell>
  );
}
