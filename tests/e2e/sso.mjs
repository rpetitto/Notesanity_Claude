// Clever and ClassLink sign-in, against the local stand-in for both providers.
//   npx wrangler dev --port 8799 --persist-to <fresh dir> --var AUTH_DEV_LINKS:1 --var SSO_STANDIN:1
//   node tests/e2e/sso.mjs http://localhost:8799 <screenshot dir>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const [B, SHOTS = "/tmp/sso-shots"] = process.argv.slice(2);
mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (n, ok, d = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`); };

function session() {
  let cookie = "";
  const call = async (m, p, body) => {
    const r = await fetch(B + p, { method: m, headers: { "content-type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    const t = await r.text();
    if (!r.ok) throw new Error(`${m} ${p} ${r.status} ${t}`);
    const j = t ? JSON.parse(t) : {};
    if (p === "/api/auth/password/register") {
      const fr = await fetch(j.devLink, { redirect: "manual", headers: { cookie } });
      const sc2 = fr.headers.get("set-cookie");
      if (sc2) cookie = sc2.split(";")[0];
    }
    return j;
  };
  call.cookie = () => cookie;
  call.status = async (m, p, body) => (await fetch(B + p, { method: m, headers: { "content-type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined })).status;
  return call;
}

/**
 * The whole round trip, the way a browser makes it: start, the provider's
 * screen (the stand-in), back to our callback. Returns where it ended up and
 * the session cookie, if one was set.
 */
async function ssoSignIn(provider, who, { door = "teacher", tamperState = false } = {}) {
  const jar = new Map();
  const take = (r) => {
    for (const c of r.headers.getSetCookie?.() ?? []) {
      const [kv] = c.split(";");
      const [k, v] = kv.split("=");
      if (v) jar.set(k, v); else jar.delete(k);
    }
  };
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  let r = await fetch(`${B}/api/auth/sso/${provider}/start?door=${door}`, { redirect: "manual" });
  take(r);
  let loc = r.headers.get("location") ?? "";
  if (!loc.includes("/standin")) return { ended: loc, cookie: jar.get("notesanity_session") };
  const u = new URL(loc, B);
  const q = new URLSearchParams({ state: u.searchParams.get("state"), nonce: u.searchParams.get("nonce"), email: who.email, name: who.name ?? "", tenant: who.tenant ?? "", role: who.role ?? "teacher", verified: who.verified === false ? "0" : "1" });
  r = await fetch(`${B}/api/auth/sso/${provider}/standin?${q}`, { redirect: "manual", headers: { cookie: cookieHeader() } });
  loc = r.headers.get("location") ?? "";
  if (tamperState) loc = loc.replace(/state=[^&]+/, "state=forged");
  r = await fetch(new URL(loc, B), { redirect: "manual", headers: { cookie: cookieHeader() } });
  take(r);
  return { ended: r.headers.get("location") ?? "", cookie: jar.get("notesanity_session") };
}
const meWith = async (cookie) => (await (await fetch(`${B}/api/me`, { headers: { cookie: `notesanity_session=${cookie}` } })).json()).user;

const PW = "correct-horse-battery";
const T = session();
await T("POST", "/api/auth/password/register", { email: "lee@example.edu", password: PW, name: "Ms. Lee", door: "teacher" });
await T("PATCH", "/api/org", { teacherDomains: "example.edu", studentDomains: "students.example.edu" });
const lee = (await T("GET", "/api/me")).user;

check("the sign-in page is told both are available", JSON.stringify(await (await fetch(`${B}/api/auth/sso/config`)).json()) === JSON.stringify({ clever: true, classlink: true }));

{
  const r = await ssoSignIn("clever", { email: "kim@example.edu", tenant: "D1" });
  check("before the school links a district, nobody signs in through it", r.ended.includes("auth_error=sso_not_linked") && !r.cookie, r.ended);
}

// Linking.
{
  const X = session();
  await X("POST", "/api/auth/password/register", { email: "pat@example.edu", password: PW, name: "Pat", door: "teacher" });
  check("a teacher who isn't the school's admin can't link a district", await X.status("PATCH", "/api/org", { cleverDistrictId: "D1" }) === 403);
  const solo = session();
  await solo("POST", "/api/auth/password/register", { email: "solo@gmail.com", password: PW, name: "Solo", door: "teacher" });
  check("a personal classroom can't link one", await solo.status("PATCH", "/api/org", { cleverDistrictId: "D1" }) === 403);
  check("an ID with odd characters is refused", await T.status("PATCH", "/api/org", { cleverDistrictId: "<script>" }) === 400);
  await T("PATCH", "/api/org", { cleverDistrictId: "D1", classlinkTenantId: "T7" });
  const org = await T("GET", "/api/org");
  check("the admin links Clever and ClassLink", org.cleverDistrictId === "D1" && org.classlinkTenantId === "T7");
  check("a teacher can't read the links", (await X("GET", "/api/org")).cleverDistrictId === undefined);
}

// Signing in.
{
  const r = await ssoSignIn("clever", { email: "kim@example.edu", name: "Kim Park", tenant: "D1" });
  const kim = r.cookie && await meWith(r.cookie);
  check("a new teacher at the school signs in with Clever", r.ended === "/" && kim?.role === "teacher" && kim?.name === "Kim Park", r.ended);
  const kimOrg = await (await fetch(`${B}/api/org`, { headers: { cookie: `notesanity_session=${r.cookie}` } })).json();
  const leeOrg = await T("GET", "/api/org");
  check("…into the school that owns the address", !!kimOrg.name && kimOrg.name === leeOrg.name && kimOrg.primaryDomain === leeOrg.primaryDomain, `${kimOrg.name} / ${leeOrg.name}`);
  const again = await ssoSignIn("clever", { email: "lee@example.edu", tenant: "D1" });
  check("someone with an account lands in that same account", again.cookie && (await meWith(again.cookie)).id === lee.id);
  const student = await ssoSignIn("classlink", { email: "ann@students.example.edu", name: "Ann Avery", tenant: "T7", role: "student" });
  const ann = student.cookie && await meWith(student.cookie);
  check("a student signs in with ClassLink as a student", ann?.role === "student", student.ended);
  const asTeacher = await ssoSignIn("classlink", { email: "ben@students.example.edu", tenant: "T7", role: "teacher" });
  check("a student address can't become a teacher, whatever the provider says", asTeacher.ended.includes("sso_not_allowed") && !asTeacher.cookie, asTeacher.ended);
}

// Everything that must not work.
{
  const wrong = await ssoSignIn("clever", { email: "lee@example.edu", tenant: "D9" });
  check("another district can't vouch for this school's addresses", wrong.ended.includes("sso_not_linked") && !wrong.cookie);
  const offDomain = await ssoSignIn("clever", { email: "someone@elsewhere.org", tenant: "D1" });
  check("an address on no school's domain is refused", offDomain.ended.includes("sso_not_linked") && !offDomain.cookie);
  const owner = await ssoSignIn("clever", { email: "robert.petitto@woodward.edu", tenant: "D1" });
  check("no district can sign in as a platform admin", owner.ended.includes("sso_not_linked") && !owner.cookie);
  const unverified = await ssoSignIn("clever", { email: "kim@example.edu", tenant: "D1", verified: false });
  check("an email the provider hasn't confirmed is refused", unverified.ended.includes("sso_no_email") && !unverified.cookie);
  const forged = await ssoSignIn("clever", { email: "kim@example.edu", tenant: "D1" }, { tamperState: true });
  check("a callback that isn't the one we started is refused", forged.ended.includes("sso_expired") && !forged.cookie, forged.ended);
  const family = await ssoSignIn("clever", { email: "kim@example.edu", tenant: "D1" }, { door: "family" });
  check("the family door doesn't use district sign-in", family.ended.includes("sso_family"));
  const launched = await fetch(`${B}/api/auth/sso/clever/callback?code=from-portal`, { redirect: "manual" });
  check("a launch from the district's portal starts a proper sign-in", (launched.headers.get("location") ?? "").endsWith("/api/auth/sso/clever/start"));
  check("an unknown provider is a 404", (await fetch(`${B}/api/auth/sso/okta/start`, { redirect: "manual" })).status === 404);
}

// In the browser.
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  p.setDefaultTimeout(10000);
  p.on("pageerror", (e) => { errors.push(e.message); console.log("pageerror:", e.message); });
  await p.goto(`${B}/?signin=1`);
  await p.getByText("Teacher", { exact: true }).first().click();
  const clever = p.getByRole("link", { name: "Continue with Clever" });
  await clever.waitFor();
  check("the sign-in page offers Clever and ClassLink", await p.getByRole("link", { name: "Continue with ClassLink" }).count() === 1);
  await p.screenshot({ path: `${SHOTS}/sign-in.png` });
  await clever.click();
  await p.locator("input[name=email]").fill("sam@example.edu");
  await p.locator("input[name=name]").fill("Sam Ortiz");
  await p.locator("input[name=tenant]").fill("D1");
  await p.getByRole("button", { name: "Continue" }).click();
  await p.waitForURL((u) => !u.pathname.startsWith("/api/"));
  await p.waitForTimeout(1500);
  const me = await p.evaluate(async () => (await (await fetch("/api/me")).json()).user);
  check("…and signing in through it lands in the app as that teacher", me?.email === "sam@example.edu" && me?.role === "teacher", JSON.stringify(me)?.slice(0, 100));
  await ctx.close();

  const ctx2 = await b.newContext({ viewport: { width: 390, height: 844 } });
  const q = await ctx2.newPage();
  q.on("pageerror", (e) => { errors.push(e.message); console.log("pageerror:", e.message); });
  await q.goto(`${B}/?auth_error=sso_not_linked`);
  const alert = q.getByRole("alert");
  await alert.waitFor();
  check("a refused sign-in says why, in words", /hasn't linked that district/.test(await alert.innerText()));
  await ctx2.close();
}

check("no page errors", errors.length === 0, errors.join(" | "));
await b.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
