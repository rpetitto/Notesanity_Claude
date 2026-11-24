/**
 * Rate limits, over Cloudflare's Rate Limiting bindings.
 *
 * Two budgets, declared in wrangler.jsonc: STRICT_LIMIT for things worth
 * guessing at (passwords, sign-up, sign-in links, family and class codes) and
 * LOOSE_LIMIT as an overall ceiling per address. The counters live at the
 * edge location that served the request, which is exactly right for stopping
 * one machine hammering a route and costs no database write.
 *
 * Where a binding is missing (an older local setup) the check passes rather
 * than locking everyone out: a limiter that fails closed turns a config slip
 * into an outage.
 */

import { currentEnv } from "./context";

export type Budget = "strict" | "loose";

interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export async function allowed(budget: Budget, key: string): Promise<boolean> {
  const env = currentEnv() as Record<string, unknown>;
  const binding = (budget === "strict" ? env.STRICT_LIMIT : env.LOOSE_LIMIT) as RateLimitBinding | undefined;
  if (!binding?.limit) return true;
  try {
    return (await binding.limit({ key })).success;
  } catch {
    return true;
  }
}
