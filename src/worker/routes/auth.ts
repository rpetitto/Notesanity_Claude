/**
 * Email/password and magic-link sign-in, alongside Fling's built-in Google auth.
 *
 * Passwords are stored as PBKDF2-SHA256 (per-user salt) — never reversible,
 * and compared in constant time. Magic-link and reset tokens are
 * stored only as SHA-256 hashes, so a database dump can't be replayed as a login.
 * Sessions are opaque random ids looked up in the database, which is why no
 * signing secret is needed for the cookie to be unforgeable.
 *
 * One deliberate behaviour throughout: requesting a link or a reset returns the
 * same response whether or not the address exists. Otherwise the endpoint
 * becomes a way to find out which pupils and staff have accounts.
 */

import { app, db } from "flingit";
import { email as mailer } from "flingit/plugin/email-send";
import type { Context } from "hono";
import { HttpError, handler, now, setLocalSessionResolver, uid } from "../lib/session";

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

const normalise = (e: string) => (e ?? "").trim().toLowerCase();
const domainOf = (e: string) => e.split("@")[1] ?? "";
const csv = (s: string) => s.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);

/**
 * Decide whether an address may hold an account, and with what role, using the
 * same org rules as Google sign-in. Returns null when the org exists and the
 * domain isn't allowed.
 */
async function resolveOrgFor(email: string): Promise<{ orgId: string; role: string; isAdmin: number } | null> {
  const org = await db.prepare(`SELECT * FROM orgs LIMIT 1`).first<any>();
  const domain = domainOf(email);
  if (!domain) return null;

  if (!org) {
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

  const allowed = new Set([
    String(org.primary_domain).toLowerCase(),
    ...csv(org.teacher_domains ?? ""),
    ...csv(org.student_domains ?? ""),
  ]);
  if (!allowed.has(domain)) return null;

  let role = "pending";
  if (csv(org.teacher_domains ?? "").includes(domain)) role = "teacher";
  else if (csv(org.student_domains ?? "").includes(domain)) role = "student";
  return { orgId: org.id, role, isAdmin: 0 };
}

async function findOrCreateUser(email: string, name?: string) {
  const existing = await db.prepare(`SELECT * FROM users WHERE email = ?`).bind(email).first<any>();
  if (existing) return existing;

  const resolved = await resolveOrgFor(email);
  if (!resolved) {
    const org = await db.prepare(`SELECT primary_domain FROM orgs LIMIT 1`).first<any>();
    throw new HttpError(
      403,
      `Notesanity is limited to ${org?.primary_domain ?? "this school"}. Ask your Notesanity admin to add your domain.`,
    );
  }
  const id = uid();
  await db
    .prepare(
      `INSERT INTO users (id, org_id, email, name, role, is_admin, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, resolved.orgId, email, name?.trim() || email, resolved.role, resolved.isAdmin, now(), now())
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
  const address = normalise(email);
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
  const address = normalise(email);
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
  const address = normalise(raw);
  const kind = purpose === "reset" ? "reset" : "magic";
  if (!address.includes("@")) throw new HttpError(400, "Enter a valid email address.");

  // Only send when the address could actually sign in, but never say which.
  const user = await db.prepare(`SELECT id FROM users WHERE email = ?`).bind(address).first();
  const allowed = user ? true : Boolean(await resolveOrgFor(address).catch(() => null));

  if (allowed) {
    const token = await issueToken(address, kind);
    const link = `${appOrigin(c)}/api/auth/magic/callback?token=${token}`;
    const subject = kind === "reset" ? "Reset your Notesanity password" : "Your Notesanity sign-in link";
    const line =
      kind === "reset"
        ? "Use the link below to set a new password."
        : "Use the link below to sign in. It works once and expires in 20 minutes.";
    try {
      await mailer.send({
        to: address,
        subject,
        text: `${line}\n\n${link}\n\nIf you didn't ask for this, you can ignore it.`,
        html:
          `<p style="font-family:system-ui,sans-serif;font-size:16px;color:#20302C">${line}</p>` +
          `<p><a href="${link}" style="display:inline-block;background:#7FD1AE;color:#20302C;` +
          `font-family:system-ui,sans-serif;font-weight:700;padding:12px 20px;border-radius:999px;` +
          `text-decoration:none">${kind === "reset" ? "Set a new password" : "Sign in to Notesanity"}</a></p>` +
          `<p style="font-family:system-ui,sans-serif;font-size:14px;color:#5b6b66">` +
          `The link expires in 20 minutes. If you didn't ask for this, you can ignore it.</p>`,
      });
    } catch (err) {
      console.error("magic link send failed", err);
    }
  }

  // Same answer either way.
  return c.json({ ok: true, sent: true });
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
 * Sign out of everything in one hop: drop the local session, then hand off to
 * Fling's own sign-out so a Google session is cleared too. The header links
 * here rather than to either one individually.
 */
app.get("/api/auth/leave", handler(async (c) => {
  const raw = c.req.header("Cookie") ?? "";
  const match = raw.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  if (match) await db.prepare(`DELETE FROM sessions WHERE id = ?`).bind(match[1]).run();
  clearSessionCookie(c);
  return c.redirect("/api/auth/signout", 302);
}));

/** Which sign-in methods this account already has, for the Settings screen. */
app.get("/api/auth/methods", handler(async (c) => {
  const userId = await localSessionUserId(c);
  if (!userId) return c.json({ password: false, local: false });
  const cred = await db.prepare(`SELECT user_id FROM credentials WHERE user_id = ?`).bind(userId).first();
  return c.json({ password: !!cred, local: true });
}));
