/**
 * Email/password and magic-link sign-in, alongside Fling's built-in Google auth.
 *
 * Passwords are stored as PBKDF2-SHA256 (per-user salt) — never reversible,
 * and compared in constant time. Magic-link and reset tokens are
 * stored only as SHA-256 hashes, so a database dump can't be replayed as a login.
 * Sessions are opaque random ids looked up in the database, which is why no
 * signing secret is needed for the cookie to be unforgeable.
 *
 * One deliberate behavior throughout: requesting a link or a reset returns the
 * same response whether or not the address exists. Otherwise the endpoint
 * becomes a way to find out which pupils and staff have accounts.
 */

import { app, db } from "../platform";
import { email as mailer } from "../platform/email";
import { renderEmail } from "../lib/email";
import { logMail } from "../lib/maillog";
import { SUPERADMIN_EMAILS } from "../schema";
import type { Context } from "hono";
import { HttpError, handler, noOrgsYet, now, orgForDomain, roleForDomain, setLocalSessionResolver, uid } from "../lib/session";

const SESSION_COOKIE = "notesanity_session";
const SESSION_DAYS = 30;
const TOKEN_MINUTES = 20;
const MIN_PASSWORD = 10;

/**
 * PBKDF2 work factor.
 *
 * The Workers runtime refuses more than 100,000 iterations in a single
 * `deriveBits` call, so that ceiling is the work factor — not a number chosen
 * for its own sake. It is lower than current OWASP guidance for PBKDF2, which
 * the runtime simply doesn't allow; the stored-per-credential `iterations`
 * column exists so the factor can be raised for new passwords if that changes,
 * without invalidating existing ones.
 *
 * Node's WebCrypto has no such limit, which is exactly why a higher value
 * passed every local test and failed for every real signup.
 */
const PBKDF2_ITERATIONS = 100_000;

const enc = new TextEncoder();
const toHex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

function randomToken(bytes = 32): string {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)).buffer);
}

async function sha256(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(value)));
}

async function derive(password: string, salt: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    // Clamped rather than passed through: a stored count above the ceiling
    // would throw, turning a wrong-password check into a 500. Clamping makes it
    // fail as a mismatch instead, which is the honest answer for a credential
    // this runtime cannot reproduce.
    { name: "PBKDF2", salt: enc.encode(salt), iterations: Math.min(iterations, PBKDF2_ITERATIONS), hash: "SHA-256" },
    key,
    256,
  );
  return toHex(bits);
}

/** Length-independent comparison so timing can't reveal how much matched. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function setSessionCookie(c: Context, id: string, maxAgeSeconds: number) {
  const secure = new URL(c.req.url).protocol === "https:";
  c.header(
    "Set-Cookie",
    `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`,
    { append: true },
  );
}

function clearSessionCookie(c: Context) {
  const secure = new URL(c.req.url).protocol === "https:";
  c.header(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`,
    { append: true },
  );
}

async function startSession(c: Context, userId: string) {
  const id = randomToken(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  await db
    .prepare(`INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
    .bind(id, userId, now(), expires)
    .run();
  setSessionCookie(c, id, SESSION_DAYS * 86400);
}

/** Resolve a local session cookie to a user id, pruning it once expired. */
export async function localSessionUserId(c: Context): Promise<string | null> {
  const raw = c.req.header("Cookie") ?? "";
  const match = raw.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  if (!match) return null;
  const row = await db
    .prepare(`SELECT user_id, expires_at FROM sessions WHERE id = ?`)
    .bind(match[1])
    .first<{ user_id: string; expires_at: string }>();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db.prepare(`DELETE FROM sessions WHERE id = ?`).bind(match[1]).run();
    return null;
  }
  return row.user_id;
}

setLocalSessionResolver(localSessionUserId);

const normalize = (e: string) => (e ?? "").trim().toLowerCase();
const domainOf = (e: string) => e.split("@")[1] ?? "";
const csv = (s: string) => s.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);

/**
 * Decide whether an address may hold an account, and with what role, using the
 * same org rules as Google sign-in. Returns null when the org exists and the
 * domain isn't allowed.
 */
async function resolveOrgFor(email: string): Promise<{ orgId: string; role: string; isAdmin: number } | null> {
  const domain = domainOf(email);
  if (!domain) return null;

  const org = await orgForDomain(domain);

  // A superadmin whose domain isn't on any allowlist still gets in — they are
  // the person who edits the allowlists, and locking them behind one is
  // circular. They land in their own school when it exists, and otherwise in
  // the oldest one, which is a home address rather than a limit: `is_superadmin`
  // is what actually grants them sight across schools.
  if (SUPERADMIN_EMAILS.includes(email)) {
    const home =
      org ?? (await db.prepare(`SELECT * FROM orgs ORDER BY created_at LIMIT 1`).first<any>());
    if (home) return { orgId: home.id, role: "teacher", isAdmin: 1 };
  }

  // Bootstrap only when no school exists at all. Once one does, an unknown
  // domain is refused rather than silently founding a second school.
  if (!org) {
    if (!(await noOrgsYet())) return null;
    const orgId = uid();
    await db
      .prepare(
        `INSERT INTO orgs (id, name, primary_domain, teacher_domains, student_domains, created_at)
         VALUES (?, ?, ?, '', '', ?)`,
      )
      .bind(orgId, domain, domain, now())
      .run();
    return { orgId, role: "teacher", isAdmin: 1 };
  }

  return { orgId: org.id, role: roleForDomain(org, domain), isAdmin: 0 };
}

async function findOrCreateUser(email: string, name?: string) {
  const existing = await db.prepare(`SELECT * FROM users WHERE email = ?`).bind(email).first<any>();
  if (existing) {
    // Re-applied rather than set once: the seed list is the source of truth, so
    // adding a name to it works for accounts that already exist.
    if (SUPERADMIN_EMAILS.includes(email) && !existing.is_superadmin) {
      await db.prepare(`UPDATE users SET is_superadmin = 1, is_admin = 1 WHERE id = ?`).bind(existing.id).run();
      return { ...existing, is_superadmin: 1, is_admin: 1 };
    }
    return existing;
  }

  const resolved = await resolveOrgFor(email);
  if (!resolved) {
    // No school is named: with several tenants, that would tell a stranger who
    // the customers are.
    throw new HttpError(
      403,
      "That email isn't on a domain any school here has approved. Ask your Notesanity admin to add it.",
    );
  }
  const id = uid();
  await db
    .prepare(
      `INSERT INTO users (id, org_id, email, name, role, is_admin, is_superadmin, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id, resolved.orgId, email, name?.trim() || email, resolved.role,
      resolved.isAdmin, SUPERADMIN_EMAILS.includes(email) ? 1 : 0, now(), now(),
    )
    .run();
  return await db.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first<any>();
}

function appOrigin(c: Context): string {
  const url = new URL(c.req.url);
  return `${url.protocol}//${url.host}`;
}

// ---------------------------------------------------------------- password

app.post("/api/auth/password/register", handler(async (c) => {
  const { email, password, name } = await c.req.json<{ email: string; password: string; name?: string }>();
  const address = normalize(email);
  if (!address.includes("@")) throw new HttpError(400, "Enter a valid email address.");
  if (!password || password.length < MIN_PASSWORD) {
    throw new HttpError(400, `Choose a password of at least ${MIN_PASSWORD} characters.`);
  }

  const user = await findOrCreateUser(address, name);
  const existing = await db.prepare(`SELECT user_id FROM credentials WHERE user_id = ?`).bind(user.id).first();
  if (existing) {
    throw new HttpError(409, "That account already has a password. Sign in instead, or use a sign-in link.");
  }

  const salt = randomToken(16);
  const iterations = PBKDF2_ITERATIONS;
  await db
    .prepare(`INSERT INTO credentials (user_id, password_hash, salt, iterations, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(user.id, await derive(password, salt, iterations), salt, iterations, now())
    .run();

  await startSession(c, user.id);
  return c.json({ ok: true });
}));

app.post("/api/auth/password/login", handler(async (c) => {
  const { email, password } = await c.req.json<{ email: string; password: string }>();
  const address = normalize(email);
  const user = await db.prepare(`SELECT * FROM users WHERE email = ?`).bind(address).first<any>();
  const cred = user
    ? await db.prepare(`SELECT * FROM credentials WHERE user_id = ?`).bind(user.id).first<any>()
    : null;

  // Always do the work, so a missing account and a wrong password take the same
  // time and produce the same message.
  const salt = cred?.salt ?? "placeholder-salt";
  const iterations = cred?.iterations ?? PBKDF2_ITERATIONS;
  const attempt = await derive(password ?? "", salt, iterations);
  if (!cred || !timingSafeEqual(attempt, cred.password_hash)) {
    throw new HttpError(401, "That email and password don't match.");
  }

  await db.prepare(`UPDATE users SET last_seen_at = ? WHERE id = ?`).bind(now(), user.id).run();
  await startSession(c, user.id);
  return c.json({ ok: true });
}));

app.post("/api/auth/password/change", handler(async (c) => {
  const userId = await localSessionUserId(c);
  if (!userId) throw new HttpError(401, "Sign in first.");
  const { currentPassword, newPassword } = await c.req.json<{ currentPassword?: string; newPassword: string }>();
  if (!newPassword || newPassword.length < MIN_PASSWORD) {
    throw new HttpError(400, `Choose a password of at least ${MIN_PASSWORD} characters.`);
  }
  const cred = await db.prepare(`SELECT * FROM credentials WHERE user_id = ?`).bind(userId).first<any>();
  if (cred) {
    const attempt = await derive(currentPassword ?? "", cred.salt, cred.iterations);
    if (!timingSafeEqual(attempt, cred.password_hash)) throw new HttpError(401, "That current password isn't right.");
  }

  const salt = randomToken(16);
  const iterations = PBKDF2_ITERATIONS;
  const hash = await derive(newPassword, salt, iterations);
  if (cred) {
    await db
      .prepare(`UPDATE credentials SET password_hash = ?, salt = ?, iterations = ?, updated_at = ? WHERE user_id = ?`)
      .bind(hash, salt, iterations, now(), userId)
      .run();
  } else {
    await db
      .prepare(`INSERT INTO credentials (user_id, password_hash, salt, iterations, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(userId, hash, salt, iterations, now())
      .run();
  }
  return c.json({ ok: true });
}));

// ------------------------------------------------------------- magic link

async function issueToken(address: string, purpose: string): Promise<string> {
  const token = randomToken(32);
  await db
    .prepare(
      `INSERT INTO auth_tokens (id, token_hash, email, purpose, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      uid(),
      await sha256(token),
      address,
      purpose,
      new Date(Date.now() + TOKEN_MINUTES * 60_000).toISOString(),
      now(),
    )
    .run();
  return token;
}

app.post("/api/auth/magic/request", handler(async (c) => {
  const { email: raw, purpose } = await c.req.json<{ email: string; purpose?: string }>();
  const address = normalize(raw);
  const kind = purpose === "reset" ? "reset" : "magic";
  if (!address.includes("@")) throw new HttpError(400, "Enter a valid email address.");

  // Only send when the address could actually sign in, but never say which.
  const user = await db.prepare(`SELECT id FROM users WHERE email = ?`).bind(address).first();
  const allowed = user ? true : Boolean(await resolveOrgFor(address).catch(() => null));

  if (!allowed) {
    // Nothing is sent, and the caller is told the same thing either way — so
    // record it, or a domain that was never on the allowlist is indistinguishable
    // from a mail that got filtered.
    await logMail({ address, kind, status: "refused_domain",
      detail: "Address is not on the org's allowed domains, so no email was sent." });
  }

  if (allowed) {
    const token = await issueToken(address, kind);
    const link = `${appOrigin(c)}/api/auth/magic/callback?token=${token}`;
    const reset = kind === "reset";
    const { html, text } = renderEmail({
      preheader: reset
        ? "Set a new password — the link works once and expires in 20 minutes."
        : "Sign in — the link works once and expires in 20 minutes.",
      heading: reset ? "Set a new password" : "Sign in to Notesanity",
      body: [
        reset
          ? "Someone asked to reset the password for this address. Use the button below to choose a new one."
          : "Use the button below to sign in. It works once, and only for the next 20 minutes.",
      ],
      action: { label: reset ? "Set a new password" : "Sign in to Notesanity", url: link },
      note: "If you didn't ask for this, you can ignore this email — nothing will change.",
    });
    try {
      const result = await mailer.send({
        to: address,
        subject: reset ? "Reset your Notesanity password" : "Your Notesanity sign-in link",
        text,
        html,
      });
      // The provider reports failure by return value as well as by throwing.
      if (result && result.success === false) {
        await logMail({ address, kind, status: "failed", detail: "Provider reported the send as unsuccessful." });
      } else {
        await logMail({ address, kind, status: "sent", detail: result?.messageId ?? "" });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Three sends a minute, per project — a staff room signing in together
      // hits it easily, and the failure is otherwise completely silent.
      const limited = message.includes("PLUGIN_RATE_LIMIT_EXCEEDED");
      await logMail({
        address, kind,
        status: limited ? "rate_limited" : "failed",
        detail: limited ? "Hit the 3-per-minute send limit. Ask them to try again in a minute." : message,
      });
      console.error("magic link send failed", message);
    }
  }

  // Same answer either way — whether the address can sign in is not something
  // this endpoint will reveal. It no longer claims to have *sent* anything.
  return c.json({ ok: true });
}));

app.get("/api/auth/magic/callback", handler(async (c) => {
  const token = c.req.query("token") ?? "";
  const row = await db
    .prepare(`SELECT * FROM auth_tokens WHERE token_hash = ?`)
    .bind(await sha256(token))
    .first<any>();

  const expired = !row || row.used_at || new Date(row.expires_at).getTime() < Date.now();
  if (expired) {
    return c.redirect("/?auth_error=link_expired", 302);
  }

  await db.prepare(`UPDATE auth_tokens SET used_at = ? WHERE id = ?`).bind(now(), row.id).run();

  let user;
  try {
    user = await findOrCreateUser(row.email);
  } catch {
    return c.redirect("/?auth_error=not_allowed", 302);
  }
  await db.prepare(`UPDATE users SET last_seen_at = ? WHERE id = ?`).bind(now(), user.id).run();
  await startSession(c, user.id);

  // A reset link lands on the page where a new password can be chosen.
  return c.redirect(row.purpose === "reset" ? "/settings?reset=1" : "/", 302);
}));

// ---------------------------------------------------------------- session

app.post("/api/auth/signout", handler(async (c) => {
  const raw = c.req.header("Cookie") ?? "";
  const match = raw.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  if (match) await db.prepare(`DELETE FROM sessions WHERE id = ?`).bind(match[1]).run();
  clearSessionCookie(c);
  return c.json({ ok: true });
}));

/**
 * Sign out, as a link the header can point at.
 *
 * This used to hand off to the platform's own sign-out afterwards, to clear a
 * Google session alongside ours. There is no longer a second session to clear:
 * Google proves identity once and we issue our own cookie, so dropping that
 * cookie *is* signing out. The hand-off outlived the thing it handed off to
 * and became a redirect to a POST-only route, which is a 404 to a browser.
 */
app.get("/api/auth/leave", handler(async (c) => {
  const raw = c.req.header("Cookie") ?? "";
  const match = raw.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  if (match) await db.prepare(`DELETE FROM sessions WHERE id = ?`).bind(match[1]).run();
  clearSessionCookie(c);
  return c.redirect("/", 302);
}));

/** Which sign-in methods this account already has, for the Settings screen. */
app.get("/api/auth/methods", handler(async (c) => {
  const userId = await localSessionUserId(c);
  if (!userId) return c.json({ password: false, local: false });
  const cred = await db.prepare(`SELECT user_id FROM credentials WHERE user_id = ?`).bind(userId).first();
  return c.json({ password: !!cred, local: true });
}));

// ------------------------------------------------------------------ google

/**
 * Sign in with Google.
 *
 * The browser does the Google half — it already loads Google's script for
 * Classroom and Drive — and posts back the ID token it receives. This endpoint
 * verifies that token's signature against Google's published keys and, if it
 * holds up, issues exactly the same session a password login would.
 *
 * Verifying an ID token rather than running an authorization-code exchange
 * means there is no client secret anywhere in this system: the client id is
 * public by design, and the proof of identity is a JWT Google signed. One less
 * credential to store, rotate, or leak.
 *
 * Google is a way of proving who you are, not a separate kind of account. It
 * resolves to a user through the same `findOrCreateUser` as every other route,
 * so domain rules, roles and which school someone lands in are decided in one
 * place regardless of how they signed in.
 */

interface GoogleClaims {
  iss: string;
  aud: string;
  exp: number;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  picture?: string;
}

const GOOGLE_ISSUERS = ["accounts.google.com", "https://accounts.google.com"];
const GOOGLE_JWKS = "https://www.googleapis.com/oauth2/v3/certs";

const b64url = (s: string) => {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
};

/** Verify a Google ID token and return its claims, or throw. */
async function verifyGoogleIdToken(token: string, clientId: string): Promise<GoogleClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new HttpError(401, "That Google sign-in couldn't be read.");

  const header = JSON.parse(new TextDecoder().decode(b64url(parts[0]))) as { kid?: string; alg?: string };
  if (header.alg !== "RS256") throw new HttpError(401, "Unexpected Google token algorithm.");

  const jwks = await fetch(GOOGLE_JWKS).then((r) => r.json() as Promise<{ keys: JsonWebKey[] & { kid: string }[] }>);
  const jwk = jwks.keys.find((k: any) => k.kid === header.kid);
  if (!jwk) throw new HttpError(401, "Google signed that token with a key we don't recognize.");

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk as JsonWebKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(parts[2]), signed);
  if (!valid) throw new HttpError(401, "That Google sign-in failed verification.");

  const claims = JSON.parse(new TextDecoder().decode(b64url(parts[1]))) as GoogleClaims;

  // A valid signature only says Google issued it — these say it was issued to
  // us, recently, for a real address. Skipping `aud` in particular would let a
  // token minted for any other Google app sign someone in here.
  if (!GOOGLE_ISSUERS.includes(claims.iss)) throw new HttpError(401, "That token didn't come from Google.");
  if (claims.aud !== clientId) throw new HttpError(401, "That Google sign-in was issued for a different app.");
  if (claims.exp * 1000 < Date.now()) throw new HttpError(401, "That Google sign-in has expired — try again.");
  if (!claims.email) throw new HttpError(401, "That Google account has no email address.");
  if (claims.email_verified === false || claims.email_verified === "false") {
    throw new HttpError(401, "That Google account's email isn't verified.");
  }
  return claims;
}

app.post("/api/auth/google", handler(async (c) => {
  const clientId = (c.env as Record<string, string | undefined>)?.GOOGLE_CLIENT_ID ?? "";
  if (!clientId) throw new HttpError(503, "Google sign-in isn't configured for this deployment.");

  const { credential } = await c.req.json<{ credential?: string }>();
  if (!credential) throw new HttpError(400, "No Google credential was sent.");

  const claims = await verifyGoogleIdToken(credential, clientId);
  const address = normalize(claims.email!);

  // Throws 403 with the domain message when the address belongs to no school,
  // which is the same answer the other sign-in routes give.
  const user = await findOrCreateUser(address, claims.name);

  // Google is the authority on these two, so keep them fresh on every sign-in.
  await db
    .prepare(`UPDATE users SET name = ?, picture = ?, last_seen_at = ? WHERE id = ?`)
    .bind(claims.name?.trim() || user.name, claims.picture ?? user.picture ?? null, now(), user.id)
    .run();

  await startSession(c, user.id);
  return c.json({ ok: true });
}));

/** Whether the sign-in page should offer the Google button. */
app.get("/api/auth/google/config", handler(async (c) => {
  const clientId = (c.env as Record<string, string | undefined>)?.GOOGLE_CLIENT_ID ?? "";
  return c.json({ enabled: !!clientId, clientId });
}));
