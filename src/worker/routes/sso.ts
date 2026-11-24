import type { Context } from "hono";
import { app, currentEnv, db } from "../platform";
import { handler, HttpError, orgForDomain, param, throttle } from "../lib/session";
import { SUPERADMIN_EMAILS } from "../schema";
import { domainOf, findOrCreateUser, joinWithCode, normalize, readIntent, startSession, type Intent } from "./auth";

/**
 * Sign in with Clever or ClassLink.
 *
 * Both are OpenID Connect: we send the browser to the provider, it comes back
 * with a code, and the code is exchanged — with our client secret, server to
 * server — for an ID token the provider signed. The token's email is matched
 * to an account the same way every other sign-in is (`findOrCreateUser`), so
 * the provider is a way to prove an address, not a different kind of account.
 *
 * The rule that keeps schools apart: a district's say-so counts only for
 * addresses on its own school's domains. A sign-in is accepted when
 *
 *   - the email's domain is one a school here has claimed,
 *   - that school's admin linked this provider, with this district or tenant,
 *   - the provider's token names that same district or tenant,
 *
 * and never for a superadmin, whose address is no school's to vouch for.
 * Without the second and third, any district on Clever could sign in as
 * anyone, at any school, by putting their address in its own directory.
 *
 * Configured by secrets: CLEVER_CLIENT_ID / CLEVER_CLIENT_SECRET and
 * CLASSLINK_CLIENT_ID / CLASSLINK_CLIENT_SECRET. The redirect URI to register
 * with each is `{origin}/api/auth/sso/{clever|classlink}/callback`. Locally,
 * `SSO_STANDIN=1` swaps the provider for a page on this server that asks which
 * account to be — no network, nothing signed — on localhost only.
 */

interface Provider {
  label: string;
  issuer: string;
  authorize: string;
  token: string;
  userinfo: string;
  jwks: string;
  /** The claim naming the district or tenant, in order of preference. */
  tenantClaims: string[];
  /** The org column an admin's link is kept in. */
  column: "clever_district_id" | "classlink_tenant_id";
  idVar: string;
  secretVar: string;
}

const PROVIDERS: Record<string, Provider> = {
  clever: {
    label: "Clever",
    issuer: "https://clever.com",
    authorize: "https://clever.com/oauth/authorize",
    token: "https://clever.com/oauth/tokens",
    userinfo: "https://api.clever.com/userinfo",
    jwks: "https://clever.com/oauth/certs",
    tenantClaims: ["district_id"],
    column: "clever_district_id",
    idVar: "CLEVER_CLIENT_ID",
    secretVar: "CLEVER_CLIENT_SECRET",
  },
  classlink: {
    label: "ClassLink",
    issuer: "https://launchpad.classlink.com",
    authorize: "https://launchpad.classlink.com/oauth2/v2/auth",
    token: "https://launchpad.classlink.com/oauth2/v2/token",
    userinfo: "https://nodeapi.classlink.com/v2/my/profileinfo",
    jwks: "https://launchpad.classlink.com/oauth2/v2/jwks",
    tenantClaims: ["classLink_tenant_id_string", "classLink_tenant_id"],
    column: "classlink_tenant_id",
    idVar: "CLASSLINK_CLIENT_ID",
    secretVar: "CLASSLINK_CLIENT_SECRET",
  },
};

const STATE_COOKIE = "notesanity_sso";
const STATE_MINUTES = 10;

const env = () => currentEnv() as Record<string, string | undefined>;

function standin(c: Context): boolean {
  const host = new URL(c.req.url).hostname;
  return env().SSO_STANDIN === "1" && (host === "localhost" || host === "127.0.0.1");
}

function credentials(p: Provider) {
  const id = env()[p.idVar] ?? "";
  const secret = env()[p.secretVar] ?? "";
  return id && secret ? { id, secret } : null;
}

const enabled = (c: Context, key: string) => !!PROVIDERS[key] && (standin(c) || !!credentials(PROVIDERS[key]));

function provider(c: Context): [string, Provider] {
  const key = param(c, "provider");
  const p = PROVIDERS[key];
  if (!p) throw new HttpError(404, "Unknown sign-in provider");
  if (!enabled(c, key)) throw new HttpError(503, `${p.label} sign-in isn't switched on here yet.`);
  return [key, p];
}

const b64url = {
  encode: (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  bytes: (s: string) => {
    const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
    return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  },
  decode: (s: string) => new TextDecoder().decode(b64url.bytes(s)),
};

const random = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");

const redirectUri = (c: Context, key: string) => `${new URL(c.req.url).origin}/api/auth/sso/${key}/callback`;

function setStateCookie(c: Context, value: string, maxAge: number) {
  const secure = new URL(c.req.url).protocol === "https:";
  // Lax, so it comes back on the provider's top-level redirect to us.
  c.header("Set-Cookie", `${STATE_COOKIE}=${value}; Path=/api/auth/sso; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`, { append: true });
}

function readStateCookie(c: Context) {
  const m = (c.req.header("Cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${STATE_COOKIE}=([^;]+)`));
  if (!m) return null;
  const [state, nonce, key, intent] = m[1].split(".");
  if (!state || !nonce || !key) return null;
  let parsed: Intent = {};
  try { parsed = readIntent(JSON.parse(b64url.decode(intent ?? ""))); } catch { /* none */ }
  return { state, nonce, key, intent: parsed };
}

/** Back to the sign-in page with a reason it can explain. */
const fail = (c: Context, reason: string) => {
  setStateCookie(c, "", 0);
  return c.redirect(`/?auth_error=sso_${reason}`, 302);
};

/** Which providers the sign-in page should offer. */
app.get("/api/auth/sso/config", handler(async (c) => {
  return c.json({ clever: enabled(c, "clever"), classlink: enabled(c, "classlink") });
}));

/** Start: remember who's asking (and why), then off to the provider. */
app.get("/api/auth/sso/:provider/start", handler(async (c) => {
  const [key, p] = provider(c);
  const q = c.req.query();
  const intent = readIntent(q);
  // Clever and ClassLink are school identities; a family account comes from a family code.
  if (intent.door === "family") return fail(c, "family");
  const state = random();
  const nonce = random();
  setStateCookie(c, [state, nonce, key, b64url.encode(JSON.stringify(intent))].join("."), STATE_MINUTES * 60);
  if (standin(c)) {
    return c.redirect(`/api/auth/sso/${key}/standin?state=${state}&nonce=${nonce}`, 302);
  }
  const url = new URL(p.authorize);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", credentials(p)!.id);
  url.searchParams.set("redirect_uri", redirectUri(c, key));
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  return c.redirect(url.toString(), 302);
}));

/**
 * The local stand-in for the provider's own sign-in screen: say which account
 * to be, and come back with a "code" that simply carries those claims. Only
 * ever answers on localhost with SSO_STANDIN=1.
 */
app.get("/api/auth/sso/:provider/standin", handler(async (c) => {
  if (!standin(c)) throw new HttpError(404, "Not found");
  const [key, p] = provider(c);
  const q = c.req.query();
  if (q.email) {
    const claims: Record<string, unknown> = {
      iss: p.issuer, sub: `standin-${q.email}`, email: q.email, email_verified: q.verified !== "0",
      given_name: q.name ?? "", family_name: "", nonce: q.nonce ?? "",
      user_type: q.role || "teacher", classLink_role: q.role === "student" ? "Student" : "Teacher",
      [p.tenantClaims[0]]: q.tenant ?? "",
    };
    return c.redirect(`/api/auth/sso/${key}/callback?state=${encodeURIComponent(q.state ?? "")}&code=standin.${b64url.encode(JSON.stringify(claims))}`, 302);
  }
  const field = (name: string, label: string, value = "") =>
    `<label style="display:block;margin:12px 0 4px">${label}</label><input name="${name}" value="${value}" style="font-size:16px;padding:8px;width:100%;box-sizing:border-box">`;
  return c.html(`<!doctype html><meta name="viewport" content="width=device-width"><title>${p.label} (stand-in)</title>
    <body style="font-family:system-ui;max-width:420px;margin:40px auto;padding:0 16px">
    <h1>${p.label} stand-in</h1><p>Local testing only: who should ${p.label} say you are?</p>
    <form method="get">
      <input type="hidden" name="state" value="${(q.state ?? "").replace(/[^A-Za-z0-9_-]/g, "")}">
      <input type="hidden" name="nonce" value="${(q.nonce ?? "").replace(/[^A-Za-z0-9_-]/g, "")}">
      ${field("email", "Email")}${field("name", "Name")}${field("tenant", p.column === "clever_district_id" ? "District ID" : "Tenant ID")}${field("role", "Role (teacher or student)", "teacher")}
      <button style="margin-top:16px;font-size:16px;padding:10px 16px">Continue</button>
    </form></body>`);
}));

/** Verify an RS256 ID token against the provider's published keys. */
async function verifyIdToken(p: Provider, token: string, clientId: string, nonce: string): Promise<Record<string, any>> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed");
  const header = JSON.parse(b64url.decode(parts[0])) as { kid?: string; alg?: string };
  if (header.alg !== "RS256") throw new Error("alg");
  const jwks = await fetch(p.jwks).then((r) => r.json() as Promise<{ keys: (JsonWebKey & { kid?: string })[] }>);
  const jwk = jwks.keys.find((k) => k.kid === header.kid) ?? (jwks.keys.length === 1 ? jwks.keys[0] : undefined);
  if (!jwk) throw new Error("kid");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url.bytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new Error("signature");
  const claims = JSON.parse(b64url.decode(parts[1])) as Record<string, any>;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  // Signed by the provider is not enough: issued to us, for this sign-in, and recently.
  if (claims.iss !== p.issuer) throw new Error("iss");
  if (!aud.includes(clientId)) throw new Error("aud");
  if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now() - 60_000) throw new Error("exp");
  if (claims.nonce !== undefined && claims.nonce !== nonce) throw new Error("nonce");
  return claims;
}

/** Trade the code for the provider's signed account of who this is. */
async function exchange(c: Context, key: string, p: Provider, code: string, nonce: string): Promise<Record<string, any>> {
  const cred = credentials(p)!;
  const res = await fetch(p.token, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${btoa(`${cred.id}:${cred.secret}`)}`,
      accept: "application/json",
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri(c, key) }).toString(),
  });
  if (!res.ok) throw new Error(`token ${res.status}`);
  const tokens = await res.json() as { id_token?: string; access_token?: string };
  if (!tokens.id_token) throw new Error("no id_token");
  const claims = await verifyIdToken(p, tokens.id_token, cred.id, nonce);
  // An address the token leaves out may be in the profile; the district still comes from the signed token.
  if (!claims.email && tokens.access_token) {
    const info: Record<string, any> = await fetch(p.userinfo, { headers: { authorization: `Bearer ${tokens.access_token}` } })
      .then((r) => (r.ok ? r.json() as Promise<Record<string, any>> : {}))
      .catch(() => ({}));
    claims.email = info.email ?? info.Email;
    if (claims.email_verified === undefined) claims.email_verified = info.email_verified;
  }
  return claims;
}

/** What the provider says this person is here, when it says. */
function doorFromClaims(claims: Record<string, any>): "teacher" | "student" | undefined {
  const role = String(claims.user_type ?? claims.classLink_role ?? "").toLowerCase();
  if (!role) return undefined;
  return role === "student" ? "student" : "teacher";
}

app.get("/api/auth/sso/:provider/callback", handler(async (c) => {
  const [key, p] = provider(c);
  await throttle(c, "loose", "sso");
  const q = c.req.query();
  if (q.error) return fail(c, "cancelled");
  const saved = readStateCookie(c);
  // Launched from the district's portal (no sign-in of ours to finish): start one,
  // which the provider completes straight away for someone already signed in there.
  if (!q.state && q.code) return c.redirect(`/api/auth/sso/${key}/start`, 302);
  if (!saved || saved.key !== key || saved.state !== q.state || !q.code) return fail(c, "expired");

  let claims: Record<string, any>;
  try {
    if (q.code.startsWith("standin.")) {
      if (!standin(c)) return fail(c, "failed");
      claims = JSON.parse(b64url.decode(q.code.slice("standin.".length)));
      if (claims.nonce !== saved.nonce) return fail(c, "failed");
    } else {
      claims = await exchange(c, key, p, q.code, saved.nonce);
    }
  } catch (e) {
    console.log(`sso ${key}: ${(e as Error).message}`);
    return fail(c, "failed");
  }

  const address = normalize(String(claims.email ?? ""));
  if (!address || !address.includes("@")) return fail(c, "no_email");
  if (claims.email_verified === false || claims.email_verified === "false") return fail(c, "no_email");
  if (SUPERADMIN_EMAILS.includes(address)) return fail(c, "not_linked");

  // The school that owns this address's domain — by the domain itself, never a fallback.
  const org = await orgForDomain(domainOf(address));
  if (!org) return fail(c, "not_linked");
  const linked = await db.prepare(`SELECT ${p.column} AS tenant FROM orgs WHERE id = ?`).bind(org.id).first<{ tenant: string }>();
  const tenant = p.tenantClaims.map((k) => claims[k]).find((v) => v !== undefined && v !== null && String(v) !== "");
  if (!linked?.tenant || tenant === undefined || String(tenant) !== linked.tenant) return fail(c, "not_linked");

  const existing = await db.prepare(`SELECT id, org_id, is_superadmin FROM users WHERE email = ?`).bind(address).first<{ id: string; org_id: string; is_superadmin: number }>();
  if (existing && (existing.org_id !== org.id || existing.is_superadmin)) return fail(c, "not_linked");

  const intent: Intent = { ...saved.intent, door: doorFromClaims(claims) ?? saved.intent.door };
  const name = [claims.given_name, claims.family_name].filter(Boolean).join(" ").trim() || undefined;
  let user: any;
  try {
    user = await findOrCreateUser(address, name, intent);
  } catch (e) {
    if (e instanceof HttpError && e.status === 403) return fail(c, "not_allowed");
    throw e;
  }
  if (user.org_id !== org.id || user.is_superadmin) return fail(c, "not_linked");
  if (name && (!user.name || user.name === address)) {
    await db.prepare(`UPDATE users SET name = ? WHERE id = ?`).bind(name, user.id).run();
  }
  await joinWithCode(user, intent).catch(() => { /* a stale class code shouldn't stop the sign-in */ });
  setStateCookie(c, "", 0);
  await startSession(c, user.id);
  return c.redirect("/", 302);
}));
