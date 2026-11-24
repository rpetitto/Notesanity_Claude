// The landing page's screen recording, made from the real app with a made-up class.
//
//   npm run build && tests/e2e/run.sh demo
//
// Regenerate it whenever the screens it shows change: a recording of an app in
// beta goes stale, and this keeps "stale" one command away from "current". The
// class, the students and their answers are invented here, so no real person
// ever appears in it.
//
// Writes public/media/demo.mp4 and public/media/demo-poster.jpg (ffmpeg needed).
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const [B, OUT = "public/media"] = process.argv.slice(2);
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
  return call;
}

// ---- a worksheet worth looking at, printed to PDF by the browser itself ----
const PROBLEMS = [
  ["1", "½ + ¼", ["3/4"]],
  ["2", "⅓ + ⅓", ["2/3"]],
  ["3", "⅖ + ⅕", ["3/5"]],
  ["4", "⅜ + ⅛", ["1/2", "4/8"]],
  ["5", "⅙ + 2⁄6", ["1/2", "3/6"]],
];
const ROW0 = 250, ROW = 92; // css px on a 816×1056 page
const worksheet = `<!doctype html><html><head><style>
  @page{size:letter;margin:0} body{margin:0;font-family:Helvetica,Arial,sans-serif;color:#1f2a27}
  .page{position:relative;width:816px;height:1056px}
  h1{position:absolute;left:72px;top:56px;margin:0;font-size:34px}
  .sub{position:absolute;left:72px;top:104px;font-size:17px;color:#55615d}
  .name{position:absolute;left:72px;top:150px;font-size:16px}
  .name span{display:inline-block;width:260px;border-bottom:1.5px solid #8a9692;margin-left:8px}
  .q{position:absolute;left:72px;font-size:26px}
  .q b{display:inline-block;width:40px;color:#2E7D6B}
  .blank{position:absolute;left:480px;width:200px;border-bottom:1.5px solid #8a9692}
  .explain{position:absolute;left:72px;top:${ROW0 + ROW * 5 + 10}px;font-size:19px}
  .box{position:absolute;left:72px;top:${ROW0 + ROW * 5 + 48}px;width:672px;height:150px;border:1.5px solid #8a9692;border-radius:10px}
</style></head><body><div class="page">
  <h1>Adding fractions</h1>
  <div class="sub">Same denominators, then different ones. Simplify if you can.</div>
  <div class="name">Name <span></span></div>
  ${PROBLEMS.map(([n, q], i) => `<div class="q" style="top:${ROW0 + ROW * i}px"><b>${n}.</b>${q} =</div><div class="blank" style="top:${ROW0 + ROW * i + 34}px"></div>`).join("")}
  <div class="explain"><b style="color:#2E7D6B">6.</b> How did you find a common denominator in number 1?</div>
  <div class="box"></div>
</div></body></html>`;

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const pdf = await (async () => {
  const pg = await b.newPage();
  await pg.setContent(worksheet);
  const out = await pg.pdf({ format: "Letter", printBackground: true });
  await pg.close();
  return out;
})();

// ---- the class ----
const PW = "correct-horse-battery";
const T = session();
await T("POST", "/api/auth/password/register", { email: "rivera@example.edu", password: PW, name: "Ms. Rivera", door: "teacher" });
await T("PATCH", "/api/org", { name: "Lincoln Middle School", teacherDomains: "example.edu", studentDomains: "students.example.edu" });
for (const tour of ["teacher.home", "teacher.class", "teacher.notebook"]) await T("POST", "/api/me/tours", { tour, status: "dismissed" });
const cls = (await T("POST", "/api/classes", { name: "Math 6 · Period 2" })).class;
const f = new FormData();
f.append("file", new Blob([pdf], { type: "application/pdf" }), "fractions.pdf");
f.append("title", "Fractions practice");
const nb = (await T("POST", `/api/classes/${cls.id}/notebooks`, f, true)).notebook.id;
await T("POST", `/api/notebooks/${nb}/pages`, { pages: [{ sourceIndex: 0, width: 612, height: 792 }] });
const page = (await T("GET", `/api/notebooks/${nb}`)).pages[0].id;
const pt = (px) => px * 0.75;
const fields = [];
for (let i = 0; i < PROBLEMS.length; i++) {
  const y = pt(ROW0 + ROW * i + 4);
  const id = (await T("POST", `/api/notebooks/${nb}/fields`, { pageId: page, type: "text", x: pt(480), y, w: pt(200), h: pt(34), label: `${PROBLEMS[i][1]} =` })).field.id;
  await T("PATCH", `/api/notebooks/${nb}/fields/${id}`, { answerKey: { accept: PROBLEMS[i][2] } });
  fields.push(id);
}
const explain = (await T("POST", `/api/notebooks/${nb}/fields`, { pageId: page, type: "text", x: pt(80), y: pt(ROW0 + ROW * 5 + 56), w: pt(656), h: pt(134), label: "How did you find a common denominator?" })).field.id;
await T("POST", `/api/notebooks/${nb}/publish`, {});
const code = (await T("GET", `/api/classes/${cls.id}`)).class.joinCode;
const quiz = (await T("POST", `/api/classes/${cls.id}/assignments`, {
  title: "Fractions practice", notebookId: nb, pageIds: [page], status: "active", grading: "points", pointsMax: 10,
  dueAt: new Date(Date.now() + 86400_000).toISOString(),
})).assignment.id;

const ROSTER = [
  ["Avery Chen", ["3/4", "2/3", "3/5", "1/2", "1/2"], "Four is a multiple of two, so I made the half into quarters."],
  ["Ben Okafor", ["3/4", "2/3", "3/5", "4/8", "3/6"], "I doubled the top and bottom of 1/2."],
  ["Carmen Diaz", [null, "2/3", "3/5", "1/2", "1/2"], "I drew a picture."],
  ["Dev Patel", ["2/6", "2/6", "3/10", "4/16", "3/12"], "I added the tops and the bottoms."],
  ["Ella Brooks", ["3/4", "2/3", "3/5", "1/2", "1/2"], "Quarters, because 2 goes into 4."],
  ["Finn Larsen", ["0.75", "2/3", "3/5", "1/2", "0.5"], "Turned them into decimals."],
];
const students = [];
for (const [name, answers, why] of ROSTER) {
  const S = session();
  const email = `${name.split(" ")[0].toLowerCase()}@students.example.edu`;
  await S("POST", "/api/auth/password/register", { email, password: PW, name, door: "student" });
  await S("POST", "/api/classes/join", { code });
  students.push({ S, name, answers, why, id: (await S("GET", "/api/me")).user.id });
}
const type = (s, i) => s.answers[i] && s.S("PUT", `/api/notebooks/${nb}/values`, { values: [{ fieldId: fields[i], value: s.answers[i] }] });

// Carmen writes "3/4" with a pen instead of typing it.
const hand = (() => {
  const x0 = pt(500), y0 = pt(ROW0 + 4);
  const s = (pts) => ({ t: "p", c: "#20302C", w: 2.4, p: pts.flatMap(([x, y]) => [x0 + x, y0 + y, 0.55]) });
  return JSON.stringify({ v: 1, s: [
    s([[0, 4], [6, 0], [12, 3], [10, 9], [4, 12], [12, 15], [12, 21], [5, 24], [0, 21]]),
    s([[20, 24], [30, 0]]),
    s([[40, 0], [36, 14], [48, 14]]), s([[45, 6], [45, 24]]),
  ], x: [], e: [], c: [] });
})();

// ---- recording ----
const raw = mkdtempSync(join(tmpdir(), "demo-"));
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: raw, size: { width: 1440, height: 900 } } });
{ const [n, v] = T.cookie().split("="); await ctx.addCookies([{ name: n, value: v, url: B }]); }
// Big tiles, so what students type can be read in the recording.
await ctx.addInitScript(() => { try { localStorage.setItem("notesanity:liveSize", "large"); } catch { /* none */ } });
const p = await ctx.newPage();
p.setDefaultTimeout(15000);

// 1. The class fills in, live.
const started = Date.now();
await p.goto(`${B}/notebooks/${nb}/live`);
await p.locator("[data-testid=live-tile]").first().waitFor();
await sleep(800);
for (let round = 0; round < 5; round++) {
  for (const s of students) await type(s, round);
  if (round === 0) await students[2].S("PUT", `/api/notebooks/${nb}/layers/${page}`, { kind: "student", rev: 0, data: hand });
  await sleep(1500);
}
for (const s of students) await s.S("PUT", `/api/notebooks/${nb}/values`, { values: [{ fieldId: explain, value: s.why }] });
await sleep(4500);

// 2. Check by question: the key has decided most of it.
await p.goto(`${B}/assignments/${quiz}/check?q=${fields[0]}`);
await p.locator("[data-testid=answer-group]").first().waitFor();
const posterAt = (Date.now() - started) / 1000 + 1.2;
await sleep(2600);
const blank = p.locator("[data-testid=answer-group]").filter({ hasText: "Nothing typed" });
await blank.scrollIntoViewIfNeeded();
await blank.locator("canvas").first().waitFor();
await sleep(1600);
await blank.locator("[data-testid=answer-student]").first().getByRole("button", { name: "Right" }).click();
await sleep(1600);
await p.evaluate(() => document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" }));
await sleep(900);
await p.getByRole("button", { name: /Question 4/ }).click();
await p.locator("[data-testid=answer-group]").first().waitFor();
await sleep(2600);

// 3. Scores become grades.
await p.getByRole("button", { name: "Make grades from scores" }).click();
await sleep(1800);
await p.getByRole("dialog").getByRole("button", { name: /Grade \d+ students/ }).click();
await sleep(2000);

// 4. And there they are in the gradebook.
await p.goto(`${B}/classes/${cls.id}/gradebook`);
await p.locator("[data-testid=gradebook]").waitFor();
await sleep(3200);

await ctx.close();
await b.close();

// ---- encode: H.264 plays everywhere; small enough to be worth a scroll ----
const webm = readdirSync(raw).find((n) => n.endsWith(".webm"));
mkdirSync(OUT, { recursive: true });
const mp4 = join(OUT, "demo.mp4");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", join(raw, webm), "-vf", "scale=1200:-2,fps=24",
  "-c:v", "libx264", "-preset", "slow", "-crf", "30", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", `${mp4}.tmp.mp4`]);
renameSync(`${mp4}.tmp.mp4`, mp4);
// The poster is the moment the point is made: a class's answers, already checked.
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(posterAt), "-i", mp4, "-frames:v", "1", "-q:v", "4", join(OUT, "demo-poster.jpg")]);
rmSync(raw, { recursive: true, force: true });
console.log(`wrote ${mp4} and ${join(OUT, "demo-poster.jpg")}`);
