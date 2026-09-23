import { auth, currentScope, db } from "../platform";
import type { Context } from "hono";

export const uid = () => crypto.randomUUID();

/**
 * The same shape of id as `uid()`, made by the database — for one statement
 * that inserts a row per student (`INSERT … SELECT`), where there is no chance
 * to call `uid()` per row. A random v4 UUID, so nothing reading ids can tell
 * the two apart.
 */
export const SQL_UUID = `(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) ||
  substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))))`;

/**
 * Injected by routes/auth.ts at import time. Keeping it as a hook rather than a
 * direct import avoids a cycle: auth.ts already depends on this module.
 */
let localSessionResolver: ((c: Context) => Promise<AppUser | null>) | null = null;
export function setLocalSessionResolver(fn: (c: Context) => Promise<AppUser | null>) {
  localSessionResolver = fn;
}
const resolveLocalSession = (c: Context) => (localSessionResolver ? localSessionResolver(c) : Promise.resolve(null));
export const now = () => new Date().toISOString();

export interface AppUser {
  id: string;
  org_id: string;
  email: string;
  name: string;
  picture: string | null;
  role: "teacher" | "student" | "pending";
  is_admin: number;
  last_seen_at?: string | null;
  /** Platform owner — sees and edits across every school. */
  is_superadmin?: number;
  /**
   * Set only while a superadmin is impersonating this account for support —
   * the superadmin's own user id. Present means the request is read-only
   * (see `handler()`'s write guard below) no matter which route it hits.
   */
  impersonated_by?: string;
}

export interface Org {
  id: string;
  name: string;
  primary_domain: string;
  teacher_domains: string;
  student_domains: string;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Route params are typed as possibly-undefined; every caller here requires one. */
export function param(c: Context, name: string): string {
  const value = c.req.param(name);
  if (!value) throw new HttpError(400, `Missing ${name} parameter`);
  return value;
}

const domainOf = (email: string) => email.split("@")[1]?.toLowerCase() ?? "";
const csv = (s: string) =>
  s.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);

/**
 * Find the school an email domain belongs to.
 *
 * This is the whole of multi-tenancy. Every school was previously resolved as
 * "whichever row comes back first", which is correct only while exactly one
 * school exists — with two, sign-in picked between them by storage order and a
 * teacher at the second one was refused outright.
 *
 * `primary_domain` is UNIQUE, so the common case is an indexed lookup. The
 * additional teacher/student domains are comma-separated in a column, so they
 * need a scan — bounded by the number of schools, which is small, and only
 * reached when the primary lookup misses.
 */
export async function orgForDomain(domain: string): Promise<Org | null> {
  if (!domain) return null;
  const primary = await db
    .prepare(`SELECT * FROM orgs WHERE lower(primary_domain) = ?`)
    .bind(domain)
    .first<Org>();
  if (primary) return primary;

  // Wrapped in commas at both ends so "school.edu" can't match "myschool.edu".
  const needle = `%,${domain},%`;
  return await db
    .prepare(
      `SELECT * FROM orgs
        WHERE ',' || lower(replace(teacher_domains, ' ', '')) || ',' LIKE ?
           OR ',' || lower(replace(student_domains, ' ', '')) || ',' LIKE ?
        LIMIT 1`,
    )
    .bind(needle, needle)
    .first<Org>();
}

/**
 * Look up a user by email, scoped to one school.
 *
 * A plain `WHERE email = ?` finds the row regardless of which school it
 * belongs to — fine for sign-in, where the email is the whole identity, but
 * wrong for anything a teacher does from inside their own class (importing a
 * roster, inviting a student, adding a co-teacher). Those call sites need to
 * know "does this email belong to *my* school", not just "does it exist
 * anywhere", or a teacher can silently enroll or grant class access to a
 * user who belongs to a different school entirely.
 */
export async function findUserInOrg(email: string, orgId: string): Promise<AppUser | null> {
  return db.prepare(`SELECT * FROM users WHERE email = ? AND org_id = ?`).bind(email, orgId).first<AppUser>();
}

/** Which role a domain implies within its school; "pending" when it says nothing. */
export function roleForDomain(org: Org, domain: string): AppUser["role"] {
  if (csv(org.teacher_domains ?? "").includes(domain)) return "teacher";
  if (csv(org.student_domains ?? "").includes(domain)) return "student";
  return "pending";
}

/** True when no school exists yet, so the next sign-in bootstraps one. */
export async function noOrgsYet(): Promise<boolean> {
  const any = await db.prepare(`SELECT id FROM orgs LIMIT 1`).first<{ id: string }>();
  return !any;
}

// ---- superadmin impersonation ----------------------------------------

export const IMPERSONATE_COOKIE = "notesanity_impersonate";
export const IMPERSONATE_MINUTES = 30;

export function setImpersonateCookie(c: Context, id: string) {
  const secure = new URL(c.req.url).protocol === "https:";
  c.header(
    "Set-Cookie",
    `${IMPERSONATE_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${IMPERSONATE_MINUTES * 60}${secure ? "; Secure" : ""}`,
    { append: true },
  );
}

export function clearImpersonateCookie(c: Context) {
  const secure = new URL(c.req.url).protocol === "https:";
  c.header(
    "Set-Cookie",
    `${IMPERSONATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`,
    { append: true },
  );
}

export interface ImpersonationInfo {
  id: string;
  superadminId: string;
  targetUserId: string;
  reason: string;
  expiresAt: string;
}

/**
 * Resolve the impersonation cookie to an active session row, if any.
 *
 * "Active" means not ended and not past its own expiry — checked here rather
 * than trusted from the cookie, since the cookie is only a pointer to the
 * row that's the actual source of truth (and the audit trail).
 */
export async function activeImpersonation(c: Context): Promise<ImpersonationInfo | null> {
  const raw = c.req.header("Cookie") ?? "";
  const match = raw.match(new RegExp(`(?:^|;\\s*)${IMPERSONATE_COOKIE}=([^;]+)`));
  if (!match) return null;
  const row = await db
    .prepare(`SELECT * FROM impersonation_sessions WHERE id = ?`)
    .bind(match[1])
    .first<any>();
  if (!row || row.ended_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return { id: row.id, superadminId: row.superadmin_id, targetUserId: row.target_user_id, reason: row.reason, expiresAt: row.expires_at };
}

/**
 * Resolve the signed-in Google account to a Notesanity user row.
 *
 * The very first person to sign in bootstraps the org from their own email
 * domain and becomes its admin + a teacher. Everyone after that must share one
 * of the org's configured domains, which is what keeps the app scoped to a
 * single school without any manual provisioning step.
 */
export function currentUser(c: Context): Promise<AppUser | null> {
  // Asked for more than once in some requests (a route and the helpers it
  // calls); resolved once. Keyed on the request's context, so it can't leak
  // from one request to another.
  let user = resolved.get(c);
  if (!user) {
    user = resolveUser(c);
    resolved.set(c, user);
  }
  return user;
}
const resolved = new WeakMap<Context, Promise<AppUser | null>>();

/**
 * Note that someone was here — at most every few minutes, and after the
 * response rather than before it. Writing it on every request was a write per
 * request, and every write waits its turn for the one database.
 */
const SEEN_EVERY_MS = 5 * 60_000;
function touchLastSeen(user: AppUser) {
  const last = user.last_seen_at ? new Date(user.last_seen_at).getTime() : 0;
  if (Date.now() - last < SEEN_EVERY_MS) return;
  const write = db.prepare(`UPDATE users SET last_seen_at = ? WHERE id = ?`).bind(now(), user.id).run();
  currentScope().ctx.waitUntil(write.catch(() => {}));
}

async function resolveUser(c: Context): Promise<AppUser | null> {
  // Impersonation overrides everything else — while it's active, the request
  // is the target user (read-only; see handler()'s write guard) regardless
  // of whose real cookie is also sitting in the browser.
  const impersonation = await activeImpersonation(c);
  if (impersonation) {
    const row = await db.prepare(`SELECT * FROM users WHERE id = ?`).bind(impersonation.targetUserId).first<AppUser>();
    if (row) return { ...row, impersonated_by: impersonation.superadminId };
  }

  // A local session (email/password or magic link) is authoritative on its own;
  // Google sign-in remains available alongside it.
  const local = await resolveLocalSession(c);
  if (local) {
    touchLastSeen(local);
    return local;
  }

  const account = await auth.user(c);
  if (!account?.email) return null;

  const email = account.email.toLowerCase();
  const existing = await db
    .prepare(`SELECT * FROM users WHERE email = ?`)
    .bind(email)
    .first<AppUser>();

  if (existing) {
    await db
      .prepare(`UPDATE users SET name = ?, picture = ?, last_seen_at = ? WHERE id = ?`)
      .bind(account.name ?? existing.name, account.picture ?? existing.picture, now(), existing.id)
      .run();
    return { ...existing, name: account.name ?? existing.name };
  }

  const domain = domainOf(email);
  if (!domain) throw new HttpError(403, "Your account has no email domain.");

  const org = await orgForDomain(domain);

  // Bootstrap: the first ever sign-in creates the school and becomes its
  // admin. Once any school exists an unrecognized domain is refused rather
  // than quietly starting another one — a new district is provisioned
  // deliberately, not by whoever happens to sign in next.
  if (!org && (await noOrgsYet())) {
    const orgId = uid();
    await db
      .prepare(
        `INSERT INTO orgs (id, name, primary_domain, teacher_domains, student_domains, created_at)
         VALUES (?, ?, ?, '', '', ?)`,
      )
      .bind(orgId, domain, domain, now())
      .run();
    const userId = uid();
    await db
      .prepare(
        `INSERT INTO users (id, org_id, email, name, picture, role, is_admin, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, 'teacher', 1, ?, ?)`,
      )
      .bind(userId, orgId, email, account.name ?? email, account.picture ?? null, now(), now())
      .run();
    return {
      id: userId, org_id: orgId, email, name: account.name ?? email,
      picture: account.picture ?? null, role: "teacher", is_admin: 1,
    };
  }

  // No school claims this domain. The message deliberately doesn't name any
  // school — with several tenants, telling a stranger which ones exist leaks
  // the customer list.
  if (!org) {
    throw new HttpError(
      403,
      `Your account (${email}) isn't on a domain any school here has approved — ask your Notesanity admin to add it.`,
    );
  }

  // Role by domain when the school separates staff and student domains,
  // otherwise the user picks on first run.
  const role = roleForDomain(org, domain);

  const userId = uid();
  await db
    .prepare(
      `INSERT INTO users (id, org_id, email, name, picture, role, is_admin, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .bind(userId, org.id, email, account.name ?? email, account.picture ?? null, role, now(), now())
    .run();

  return {
    id: userId, org_id: org.id, email, name: account.name ?? email,
    picture: account.picture ?? null, role, is_admin: 0,
  };
}

export async function requireUser(c: Context): Promise<AppUser> {
  const user = await currentUser(c);
  if (!user) throw new HttpError(401, "Not signed in");
  return user;
}

export async function requireTeacher(c: Context): Promise<AppUser> {
  const user = await requireUser(c);
  if (user.role !== "teacher") throw new HttpError(403, "Teacher access required");
  return user;
}

/** Throws unless the user teaches this class. */
export async function requireClassTeacher(c: Context, classId: string): Promise<AppUser> {
  const user = await requireUser(c);
  const cls = await db
    .prepare(`SELECT * FROM classes WHERE id = ?`)
    .bind(classId)
    .first<any>();
  if (!cls) throw new HttpError(404, "Class not found");
  if (cls.owner_id === user.id) return user;
  const enrolled = await db
    .prepare(`SELECT id FROM enrollments WHERE class_id = ? AND user_id = ? AND role = 'teacher' AND status = 'active'`)
    .bind(classId, user.id)
    .first();
  if (!enrolled) throw new HttpError(403, "You don't teach this class");
  return user;
}

/** Throws unless the user teaches this class or is an active student in it. */
export async function requireClassMember(c: Context, classId: string): Promise<{ user: AppUser; isTeacher: boolean }> {
  const user = await requireUser(c);
  const cls = await db.prepare(`SELECT * FROM classes WHERE id = ?`).bind(classId).first<any>();
  if (!cls) throw new HttpError(404, "Class not found");
  if (cls.owner_id === user.id) return { user, isTeacher: true };
  const enrolled = await db
    .prepare(`SELECT role FROM enrollments WHERE class_id = ? AND user_id = ? AND status = 'active'`)
    .bind(classId, user.id)
    .first<{ role: string }>();
  if (!enrolled) throw new HttpError(403, "You're not in this class");
  return { user, isTeacher: enrolled.role === "teacher" };
}

/** Wrap a handler so thrown HttpErrors become clean JSON responses. */
/**
 * Record a request that went wrong.
 *
 * Only failures. A row per successful call would put a database write in front
 * of every page of every notebook, which costs more than it explains — and the
 * questions people actually ask are about what broke.
 */
const API_LOG_KEEP = 500;

async function logApiFailure(c: Context, status: number, message: string, startedAt: number) {
  try {
    const url = new URL(c.req.url);
    // Best-effort — a failure here (an expired token, a request that was
    // never signed in) just means the row logs without a user/org, which is
    // fine: most of those are sign-in refusals that already name the domain
    // in the message text.
    const user = await currentUser(c).catch(() => null);
    await db
      .prepare(
        `INSERT INTO api_log (id, method, path, status, duration_ms, message, user_id, org_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        uid(), c.req.method, url.pathname, status, Math.round(Date.now() - startedAt),
        message.slice(0, 500), user?.id ?? null, user?.org_id ?? null, now(),
      )
      .run();
    await db
      .prepare(`DELETE FROM api_log WHERE id NOT IN (SELECT id FROM api_log ORDER BY created_at DESC LIMIT ${API_LOG_KEEP})`)
      .run();
  } catch (err) {
    console.error("api log failed", err);
  }
}

/**
 * Paths a request may still write to while impersonating — just enough to
 * end the session. Nothing else needs an exception: impersonation is a
 * read-only lens on the app, on purpose.
 */
const IMPERSONATION_WRITE_ALLOWLIST = new Set(["/api/admin/impersonate/end"]);

export function handler(fn: (c: Context) => Promise<Response>) {
  return async (c: Context) => {
    const startedAt = Date.now();
    try {
      if (c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.method !== "OPTIONS") {
        const impersonation = await activeImpersonation(c);
        if (impersonation && !IMPERSONATION_WRITE_ALLOWLIST.has(new URL(c.req.url).pathname)) {
          throw new HttpError(403, "You're viewing as this user for support — nothing can be changed while impersonating.");
        }
      }
      const res = await fn(c);
      // Handlers can also fail by returning a status rather than throwing.
      if (res.status >= 400) await logApiFailure(c, res.status, "", startedAt);
      return res;
    } catch (err: any) {
      if (err instanceof HttpError) {
        await logApiFailure(c, err.status, err.message, startedAt);
        return c.json({ error: err.message }, err.status as any);
      }
      console.error("Unhandled error:", err?.stack || err);
      await logApiFailure(c, 500, err?.message ?? "Server error", startedAt);
      return c.json({ error: err?.message ?? "Server error" }, 500);
    }
  };
}
