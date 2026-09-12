import { auth, db } from "../platform";
import type { Context } from "hono";

export const uid = () => crypto.randomUUID();

/**
 * Injected by routes/auth.ts at import time. Keeping it as a hook rather than a
 * direct import avoids a cycle: auth.ts already depends on this module.
 */
let localSessionResolver: ((c: Context) => Promise<string | null>) | null = null;
export function setLocalSessionResolver(fn: (c: Context) => Promise<string | null>) {
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
  /** Platform owner — sees and edits across every school. */
  is_superadmin?: number;
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

/**
 * Resolve the signed-in Google account to a Notesanity user row.
 *
 * The very first person to sign in bootstraps the org from their own email
 * domain and becomes its admin + a teacher. Everyone after that must share one
 * of the org's configured domains, which is what keeps the app scoped to a
 * single school without any manual provisioning step.
 */
export async function currentUser(c: Context): Promise<AppUser | null> {
  // A local session (email/password or magic link) is authoritative on its own;
  // Google sign-in remains available alongside it.
  const localId = await resolveLocalSession(c);
  if (localId) {
    const row = await db.prepare(`SELECT * FROM users WHERE id = ?`).bind(localId).first<AppUser>();
    if (row) {
      await db.prepare(`UPDATE users SET last_seen_at = ? WHERE id = ?`).bind(now(), row.id).run();
      return row;
    }
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
    await db
      .prepare(
        `INSERT INTO api_log (id, method, path, status, duration_ms, message, user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        uid(), c.req.method, url.pathname, status, Math.round(Date.now() - startedAt),
        message.slice(0, 500), (c.get("userId") as string) ?? null, now(),
      )
      .run();
    await db
      .prepare(`DELETE FROM api_log WHERE id NOT IN (SELECT id FROM api_log ORDER BY created_at DESC LIMIT ${API_LOG_KEEP})`)
      .run();
  } catch (err) {
    console.error("api log failed", err);
  }
}

export function handler(fn: (c: Context) => Promise<Response>) {
  return async (c: Context) => {
    const startedAt = Date.now();
    try {
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
