// The live class view: every student's page as they work on it.
//   npx wrangler dev --port 8799 --persist-to <fresh dir> --var AUTH_DEV_LINKS:1
//   node tests/e2e/live.mjs http://localhost:8799 tests/e2e/fixtures/two-pages.pdf <screenshot dir>
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const [B, PDF, SHOTS = "/tmp/live-shots"] = process.argv.slice(2);
mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (n, ok, d = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  call.status = async (m, p) => (await fetch(B + p, { method: m, headers: { cookie } })).status;
  return call;
}

const PW = "correct-horse-battery";
const T = session();
await T("POST", "/api/auth/password/register", { email: "lee@example.edu", password: PW, name: "Ms. Lee", door: "teacher" });
await T("PATCH", "/api/org", { teacherDomains: "example.edu", studentDomains: "students.example.edu" });
const cls = (await T("POST", "/api/classes", { name: "Period 1" })).class;
const f = new FormData();
f.append("file", new Blob([readFileSync(PDF)], { type: "application/pdf" }), "w.pdf");
f.append("title", "Unit 1");
const nb = (await T("POST", `/api/classes/${cls.id}/notebooks`, f, true)).notebook.id;
await T("POST", `/api/notebooks/${nb}/pages`, { pages: [{ sourceIndex: 0, width: 612, height: 792 }, { sourceIndex: 1, width: 612, height: 792 }] });
const pages = (await T("GET", `/api/notebooks/${nb}`)).pages;
const P1 = pages[0].id, P2 = pages[1].id;
const q1 = (await T("POST", `/api/notebooks/${nb}/fields`, { pageId: P1, type: "text", x: 80, y: 100, w: 200, h: 28 })).field.id;
const q2 = (await T("POST", `/api/notebooks/${nb}/fields`, { pageId: P2, type: "text", x: 80, y: 100, w: 200, h: 28 })).field.id;
await T("POST", `/api/notebooks/${nb}/publish`, {});
const code = (await T("GET", `/api/classes/${cls.id}`)).class.joinCode;

const st = {};
for (const [email, name] of [["ann@students.example.edu", "Ann Avery"], ["ben@students.example.edu", "Ben Brooks"], ["cal@students.example.edu", "Cal Cole"]]) {
  const S = session();
  await S("POST", "/api/auth/password/register", { email, password: PW, name, door: "student" });
  await S("POST", "/api/classes/join", { code });
  st[name.split(" ")[0]] = { S, id: (await S("GET", "/api/me")).user.id };
}
const { Ann, Ben, Cal } = st;
const type = (S, fieldId, value) => S("PUT", `/api/notebooks/${nb}/values`, { values: [{ fieldId, value }] });
const ink = (S, pageId, rev = 0) => S("PUT", `/api/notebooks/${nb}/layers/${pageId}`, {
  kind: "student", rev,
  data: JSON.stringify({ v: 1, s: [{ t: "p", c: "#20302C", w: 3, p: [100, 300, 0.5, 200, 340, 0.5, 300, 310, 0.5] }], x: [], e: [], c: [] }),
});

// Who may watch.
{
  check("a student can't watch the class", await Ann.S.status("GET", `/api/notebooks/${nb}/live`) === 403);
  const O = session();
  await O("POST", "/api/auth/password/register", { email: "out@elsewhere.org", password: PW, name: "Other", door: "teacher" });
  const os = await O.status("GET", `/api/notebooks/${nb}/live`);
  check("a teacher from another school can't either", os === 403 || os === 404, String(os));
  const tpl = (await T("POST", "/api/my/templates", { title: "T", pages: 1, pattern: "lined-college", color: "#9EC5E8" })).notebook.id;
  check("a template has no class to watch", await T.status("GET", `/api/notebooks/${tpl}/live`) === 400);
}

await ink(Ann.S, P1);
await type(Ann.S, q1, "forty-two");
await type(Ben.S, q2, "on page two");

let first;
{
  first = await T("GET", `/api/notebooks/${nb}/live`);
  check("the first answer brings the whole roster", first.students?.length === 3, String(first.students?.length));
  const a = first.updates.find((u) => u.studentId === Ann.id);
  const b = first.updates.find((u) => u.studentId === Ben.id);
  check("each student who has started comes with their latest page", a?.pageId === P1 && b?.pageId === P2);
  check("…its ink", !!a?.ink && JSON.parse(a.ink).s.length === 1);
  check("…and what's typed on it", a?.values[q1] === "forty-two" && b?.values[q2] === "on page two");
  check("someone who hasn't started has no tile update", !first.updates.some((u) => u.studentId === Cal.id));
}
{
  await sleep(20);
  const quiet = await T("GET", `/api/notebooks/${nb}/live?since=${encodeURIComponent(first.serverTime)}&count=3`);
  check("a quiet class sends nothing on the next poll", quiet.updates.length === 0 && quiet.students === undefined, JSON.stringify(quiet).slice(0, 120));
  await type(Cal.S, q1, "hello");
  const next = await T("GET", `/api/notebooks/${nb}/live?since=${encodeURIComponent(quiet.serverTime)}&count=3`);
  check("the next poll carries only who changed", next.updates.length === 1 && next.updates[0].studentId === Cal.id && next.updates[0].values[q1] === "hello");
  await type(Ann.S, q2, "moved on");
  const moved = await T("GET", `/api/notebooks/${nb}/live?since=${encodeURIComponent(next.serverTime)}&count=3`);
  const a = moved.updates.find((u) => u.studentId === Ann.id);
  check("moving to another page moves the tile, with that page's work", a?.pageId === P2 && a?.values[q2] === "moved on" && a.ink === null, JSON.stringify(a));
  const pinned = await T("GET", `/api/notebooks/${nb}/live?page=${P1}`);
  const ap = pinned.updates.find((u) => u.studentId === Ann.id);
  check("pinning a page shows everyone on that page", pinned.updates.every((u) => u.pageId === P1) && !!ap?.ink && ap.values[q1] === "forty-two");
  check("a page from another notebook can't be pinned", await T.status("GET", `/api/notebooks/${nb}/live?page=nope`) === 404);
}

// In the browser.
for (const tour of ["teacher.home", "teacher.class", "teacher.notebook"]) await T("POST", "/api/me/tours", { tour, status: "dismissed" });
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
{ const [n, v] = T.cookie().split("="); await ctx.addCookies([{ name: n, value: v, url: B }]); }
const p = await ctx.newPage();
p.setDefaultTimeout(10000);
const errors = [];
p.on("pageerror", (e) => { errors.push(e.message); console.log("pageerror:", e.message); });

await p.goto(`${B}/notebooks/${nb}/edit`);
await p.getByRole("link", { name: "Live", exact: true }).click();
await p.locator("[data-testid=live-tile]").first().waitFor();
check("the editor's Live button opens the live view", p.url().endsWith(`/notebooks/${nb}/live`));
check("a tile for every student", await p.locator("[data-testid=live-tile]").count() === 3);
const summary = () => p.locator("[data-testid=live-summary]").innerText();
check("the summary counts who's working", /3 writing now · 3 of 3 started/.test(await summary()), await summary());
const tile = (who) => p.locator(`[data-testid=live-tile][data-student="${who.id}"]`);
check("a tile shows what the student typed", /moved on/.test(await tile(Ann).innerText()) && /Page 2/.test(await tile(Ann).innerText()), (await tile(Ann).innerText()).replace(/\n/g, " "));
await p.screenshot({ path: `${SHOTS}/live.png` });

await type(Ben.S, q1, "fresh answer");
await p.waitForFunction((id) => document.querySelector(`[data-student="${id}"]`)?.textContent?.includes("fresh answer"), Ben.id, { timeout: 12000 }).catch(() => {});
check("new work appears on its own within a few seconds", /fresh answer/.test(await tile(Ben).innerText()) && /Page 1/.test(await tile(Ben).innerText()));

await p.locator("#live-page").selectOption(P1);
await p.waitForTimeout(1500);
check("pinning page 1 shows everyone's page 1", (await p.locator("[data-testid=live-tile]").allInnerTexts()).every((t) => /Page 1/.test(t)) && /forty-two/.test(await tile(Ann).innerText()));

await tile(Cal).locator("a").click();
await p.waitForURL(/\/students\//);
check("a tile opens that student's notebook at that page", p.url().includes(`/students/${Cal.id}/notebooks/${nb}?page=${P1}`), p.url());

check("no page errors", errors.length === 0, errors.join(" | "));
await b.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
