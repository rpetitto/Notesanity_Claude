/**
 * Google sign-in.
 *
 * Notesanity has its own password and magic-link authentication, kept entirely
 * in `routes/auth.ts` and `lib/session.ts`; Google was only ever a third way in,
 * provided by the platform. `user()` returning null therefore means "no Google
 * session", which the app already handles — it simply falls through to its own
 * session cookie. So the app is fully usable before Google is reconnected in a
 * later step, rather than being blocked on it.
 */

import type { Context } from "hono";

export interface AuthUser {
  email: string;
  name: string;
  picture?: string;
}

export interface AuthAllowConfig {
  domains?: string[];
  sessionMaxAge?: number;
}

export const auth = {
  /** Kept so the existing call site compiles; domain rules live in lib/session.ts. */
  allow(_config?: AuthAllowConfig): void {},

  async user(_c: Context): Promise<AuthUser | null> {
    return null;
  },
};
