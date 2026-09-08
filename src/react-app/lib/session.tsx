import { useQuery } from "@tanstack/react-query";
import { api, type Me } from "./api";

interface MeResponse {
  user: Me | null;
  org: { name: string; primaryDomain: string } | null;
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
