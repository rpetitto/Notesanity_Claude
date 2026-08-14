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

export const signInHref = (redirect?: string) =>
  `/api/auth/signin/google${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ""}`;
// Clears the local session first, then hands off to Google sign-out.
export const signOutHref = "/api/auth/leave";
