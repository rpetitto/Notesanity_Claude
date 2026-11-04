// "Send a copy to a colleague": a link that adds a copy of a notebook, and never anyone's work.
//   npx wrangler dev --port 8799 --persist-to <fresh dir> --var AUTH_DEV_LINKS:1
//   node tests/e2e/share.mjs http://localhost:8799 tests/e2e/fixtures/two-pages.pdf <screenshot dir>
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const [B, PDF, SHOTS = "/tmp/share-shots"] = process.argv.slice(2);
mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (n, ok, d = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`); };

function session() {
  let cookie = "";
  const call = async (m, p, body, isForm) => {
    const r = await fetch(B + p, { method: m, headers: isForm ? { cookie } : { "content-type": "application/json", cookie }, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
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
  call.text = async (p) => (await fetch(B + p, { headers: { cookie } })).text();
  return call;
}

const PW = "correct-horse-battery";
const T = session();
await T("POST", "/api/auth/password/register", { email: "lee@example.edu", password: PW, name: "Ms. Lee", door: "teacher" });
await T("PATCH", "/api/org", { teacherDomains: "example.edu", studentDomains: "students.example.edu" });
const cls = (await T("POST", "/api/classes", { name: "Period 1" })).class;
const f = new FormData();
f.append("file", new Blob([readFileSync(PDF)], { type: "application/pdf" }), "w.pdf");
f.append("title", "Fractions unit");
const nb = (await T("POST", `/api/classes/${cls.id}/notebooks`, f, true)).notebook.id;
await T("POST", `/api/notebooks/${nb}/pages`, { pages: [{ sourceIndex: 0, width: 612, height: 792 }, { sourceIndex: 1, width: 612, height: 792 }] });
const pages = (await T("GET", `/api/notebooks/${nb}`)).pages;
const q1 = (await T("POST", `/api/notebooks/${nb}/fields`, { pageId: pages[0].id, type: "text", x: 80, y: 100, w: 160, h: 28, label: "Half of 8" })).field.id;
await T("POST", `/api/notebooks/${nb}/fields`, { pageId: pages[1].id, type: "text", x: 80, y: 100, w: 160, h: 28, label: "Explain" });
await T("PATCH", `/api/notebooks/${nb}/fields/${q1}`, { answerKey: { accept: ["4"] }, points: 2 });
await T("POST", `/api/notebooks/${nb}/publish`, {});
const code = (await T("GET", `/api/classes/${cls.id}`)).class.joinCode;

const S = session();
await S("POST", "/api/auth/password/register", { email: "ann@students.example.edu", password: PW, name: "Ann Avery", door: "student" });
await S("POST", "/api/classes/join", { code });
await S("PUT", `/api/notebooks/${nb}/values`, { values: [{ fieldId: q1, value: "a student's private answer" }] });
await S("PUT", `/api/notebooks/${nb}/layers/${pages[0].id}`, { kind: "student", rev: 0, data: JSON.stringify({ v: 1, s: [{ t: "p", c: "#20302C", w: 3, p: [100, 300, 0.5, 200, 340, 0.5] }], x: [], e: [], c: [] }) });

// Making the link.
check("a student can't share a class notebook", await S.status("POST", `/api/notebooks/${nb}/share`, {}) === 403);
const made = (await T("POST", `/api/notebooks/${nb}/share`, {})).share;
check("the teacher gets a link", /\/share\/[A-Za-z0-9_-]{20,}$/.test(made.url), made.url);
const again = (await T("POST", `/api/notebooks/${nb}/share`, {})).share;
check("asking again gives the same link, not a second one", again.token === made.token);

// What the link shows to anyone.
{
  const raw = await (await fetch(`${B}/api/shares/${made.token}`)).text();
  const s = JSON.parse(raw).share;
  check("signed out, the link says what it is and who sent it", s.title === "Fractions unit" && s.from === "Ms. Lee" && s.pages === 2 && s.boxes === 2 && s.keyed === 1, raw);
  check("…and nothing else: no ids, no email", !raw.includes(nb) && !raw.includes("lee@example.edu"));
  check("a made-up link opens nothing", (await fetch(`${B}/api/shares/aaaaaaaaaaaaaaaaaaaaaaaa`)).status === 404);
}

// Adding a copy.
const O = session();
await O("POST", "/api/auth/password/register", { email: "kim@elsewhere.org", password: PW, name: "Mr. Kim", door: "teacher" });
check("a student can't add a copy", await S.status("POST", `/api/shares/${made.token}/copy`, {}) === 403);
check("a colleague can't see or stop the owner's link", [403, 404].includes(await O.status("GET", `/api/notebooks/${nb}/share`)) && [403, 404].includes(await O.status("DELETE", `/api/notebooks/${nb}/share`)));
const copyId = (await O("POST", `/api/shares/${made.token}/copy`, {})).notebook.id;
{
  const c = await O("GET", `/api/notebooks/${copyId}`);
  check("a teacher at another school gets their own template", c.notebook.kind === "template" && c.isTeacher === true, c.notebook.kind);
  check("with every page and box", c.pages.length === 2 && c.fields.length === 2);
  check("and the answer key and points", c.fields.find((x) => x.label === "Half of 8")?.answer_key === JSON.stringify({ accept: ["4"] }) && c.fields.find((x) => x.label === "Half of 8")?.points === 2);
  check("its pages are its own files, not pointers into the original", c.pages.every((p) => p.asset_key.startsWith(`notebooks/${copyId}/`)), c.pages[0].asset_key);
  const asset = await fetch(`${B}/api/notebooks/${copyId}/asset?key=${encodeURIComponent(c.pages[0].asset_key)}`, { headers: { cookie: O.cookie() } });
  check("…which open for the new owner", asset.ok && (asset.headers.get("content-type") ?? "").includes("pdf"));
  const all = await O.text(`/api/my/teaching-notebooks`);
  check("none of the student's work comes with it", !all.includes("private answer") && !(await O.text(`/api/notebooks/${copyId}`)).includes("private answer"));
  check("the colleague still can't open the original", [403, 404].includes(await O.status("GET", `/api/notebooks/${nb}`)));
  await O("PATCH", `/api/notebooks/${copyId}/fields/${c.fields[0].id}`, { label: "Changed in the copy" });
  check("changing the copy leaves the original alone", (await T("GET", `/api/notebooks/${nb}`)).fields.every((x) => x.label !== "Changed in the copy"));
  check("the owner sees how many have added it", (await T("GET", `/api/notebooks/${nb}/share`)).share.copies === 1);
}

// Stopping.
{
  await T("DELETE", `/api/notebooks/${nb}/share`);
  check("stopping sharing switches the link off", (await fetch(`${B}/api/shares/${made.token}`)).status === 404 && await O.status("POST", `/api/shares/${made.token}/copy`, {}) === 404);
  check("copies already made stay", (await O("GET", `/api/notebooks/${copyId}`)).pages.length === 2);
  const fresh = (await T("POST", `/api/notebooks/${nb}/share`, {})).share;
  check("sharing again makes a new link", fresh.token !== made.token);
  const tpl = (await T("POST", "/api/my/templates", { title: "Gone soon", pages: 1, pattern: "lined-college", color: "#9EC5E8" })).notebook.id;
  const ts = (await T("POST", `/api/notebooks/${tpl}/share`, {})).share;
  await T("DELETE", `/api/templates/${tpl}`);
  check("a deleted notebook's link opens nothing", (await fetch(`${B}/api/shares/${ts.token}`)).status === 404);
}

// In the browser.
for (const tour of ["teacher.home", "teacher.class", "teacher.notebook"]) await T("POST", "/api/me/tours", { tour, status: "dismissed" });
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  { const [n, v] = T.cookie().split("="); await ctx.addCookies([{ name: n, value: v, url: B }]); }
  const p = await ctx.newPage();
  p.setDefaultTimeout(10000);
  p.on("pageerror", (e) => { errors.push(e.message); console.log("pageerror:", e.message); });
  await T("DELETE", `/api/notebooks/${nb}/share`);
  await p.goto(`${B}/notebooks/${nb}/edit`);
  await p.locator('[data-tour="nb-more"] button').first().click();
  await p.getByRole("menuitem", { name: /Send a copy to a colleague/ }).click();
  const dialog = p.getByRole("dialog");
  await dialog.getByRole("button", { name: "Make a link" }).click();
  await dialog.locator("#share-url").waitFor();
  const url = await dialog.locator("#share-url").inputValue();
  check("the editor's menu makes a link", /\/share\//.test(url), url);
  check("…and says no student work goes with it", /No student work goes with it/.test(await dialog.innerText()));
  await p.screenshot({ path: `${SHOTS}/share-dialog.png` });
  await ctx.close();

  // A colleague with no account opens it.
  const N = session();
  const ctx2 = await b.newContext({ viewport: { width: 390, height: 844 } });
  const q = await ctx2.newPage();
  q.setDefaultTimeout(10000);
  q.on("pageerror", (e) => { errors.push(e.message); console.log("pageerror:", e.message); });
  await q.goto(url);
  const card = q.locator("[data-testid=share-card]");
  await card.waitFor();
  check("signed out, the link shows what was sent", /Ms\. Lee sent you a notebook/i.test(await card.innerText()) && /Fractions unit/.test(await card.innerText()));
  await q.screenshot({ path: `${SHOTS}/share-signed-out.png` });
  await q.getByRole("button", { name: "Sign up free to add it" }).click();
  await q.waitForTimeout(500);
  check("signing up from it goes in as a teacher", await q.locator("text=/teacher/i").count() > 0);
  // They finish signing up by email link, which lands on "/", not back on the share page.
  await N("POST", "/api/auth/password/register", { email: "pat@another.org", password: PW, name: "Pat Teacher", door: "teacher" });
  { const [n, v] = N.cookie().split("="); await ctx2.addCookies([{ name: n, value: v, url: B }]); }
  for (const tour of ["teacher.home", "teacher.class", "teacher.notebook"]) await N("POST", "/api/me/tours", { tour, status: "dismissed" });
  await q.goto(`${B}/`);
  await q.waitForURL(/\/share\//);
  check("after signing in, they're brought back to the link", q.url() === url, q.url());
  await q.getByRole("button", { name: "Add to my notebooks" }).click();
  await q.waitForURL(/\/notebooks\/.+\/edit/);
  const added = q.url().split("/notebooks/")[1].split("/")[0];
  check("adding it opens their own copy in the editor", (await N("GET", `/api/notebooks/${added}`)).notebook.kind === "template");
  await q.goto(`${B}/`);
  await q.waitForTimeout(800);
  check("…and the link doesn't follow them around afterwards", !q.url().includes("/share/"), q.url());
  await ctx2.close();
}

check("no page errors", errors.length === 0, errors.join(" | "));
await b.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
