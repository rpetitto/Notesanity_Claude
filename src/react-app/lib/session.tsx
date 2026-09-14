import { useQuery } from "@tanstack/react-query";
import { api, type Me } from "./api";

export interface Impersonating {
  superadminEmail: string;
  reason: string;
  expiresAt: string;
}

/** What the person has and what it means today — see the worker's lib/plans.ts. */
export interface Plan {
  tier: "free" | "pro" | "school";
  source: "school" | "department" | "pro" | "free";
  label: string;
  /** True while everything is free: every gate is open and prices are struck through. */
  beta: boolean;
  quota: { used: number; limit: number | null; remaining: number | null; unlimited: boolean };
  renewsAt: string | null;
  cancelAtPeriodEnd: boolean;
  canUpgrade: boolean;
  hasPortal: boolean;
  seats: { used: number; total: number } | null;
  prices: { pro: number; department: number; school: number };
}

interface MeResponse {
  user: Me | null;
  org: { name: string; primaryDomain: string } | null;
  impersonating: Impersonating | null;
  plan: Plan | null;
}

export function useSession() {
  const q = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<MeResponse>("/api/me"),
    retry: false,
    staleTime: 60_000,
  });
  return {
    user: q.data?.user ?? null,
    org: q.data?.org ?? null,
    impersonating: q.data?.impersonating ?? null,
    plan: q.data?.plan ?? null,
    isLoading: q.isLoading,
    error: q.error as Error | null,
    refetch: q.refetch,
  };
}

/**
 * Signing in is no longer a link to somewhere else — Google is asked in the
 * page and answered by our own endpoint — so only signing out is a href.
 */
export const signOutHref = "/api/auth/leave";
