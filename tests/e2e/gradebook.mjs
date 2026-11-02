// The teacher gradebook: names down, assignments across, scores in between.
//   npx wrangler dev --port 8799 --persist-to <fresh dir> --var AUTH_DEV_LINKS:1
//   node tests/e2e/gradebook.mjs http://localhost:8799 tests/e2e/fixtures/two-pages.pdf <screenshot dir>
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const [B, PDF, SHOTS = "/tmp/gradebook-shots"] = process.argv.slice(2);
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
await T("POST", `/api/notebooks/${nb}/publish`, {});
const pages = (await T("GET", `/api/notebooks/${nb}`)).pages;
const code = (await T("GET", `/api/classes/${cls.id}`)).class.joinCode;

const students = {};
for (const [email, name] of [["mike@students.example.edu", "Mike Anderson"], ["renee@students.example.edu", "Renee Flaherty"], ["dale@students.example.edu", "Dale Gross"]]) {
  const S = session();
  await S("POST", "/api/auth/password/register", { email, password: PW, name, door: "student" });
  await S("POST", "/api/classes/join", { code });
  students[name] = { S, id: (await S("GET", "/api/me")).user.id };
}

const day = 86400_000;
const make = async (title, extra) => (await T("POST", `/api/classes/${cls.id}/assignments`, {
  title, notebookId: nb, pageIds: [pages[0].id], status: "active", ...extra,
})).assignment.id;
const quiz = await make("Fractions quiz", { grading: "points", pointsMax: 20, dueAt: new Date(Date.now() - 3 * day).toISOString() });
const hw = await make("Reading log", { grading: "complete", pointsMax: 10, dueAt: new Date(Date.now() - 1 * day).toISOString() });
const essay = await make("Essay draft", { grading: "points", pointsMax: 100, dueAt: new Date(Date.now() + 5 * day).toISOString() });
const vocab = await make("Vocab check", { grading: "letter", pointsMax: 10, dueAt: new Date(Date.now() + 2 * day).toISOString() });

const grade = (a, who, body) => T("POST", `/api/assignments/${a}/grade`, { studentId: students[who].id, ...body });
await grade(quiz, "Mike Anderson", { points: 18 });
await grade(quiz, "Renee Flaherty", { points: 10 });       // under 60%
await grade(hw, "Mike Anderson", { complete: true });
await grade(hw, "Renee Flaherty", { complete: false });
await grade(vocab, "Mike Anderson", { letter: "B" });       // 85
await grade(vocab, "Renee Flaherty", { letter: "F" });      // 59, under 60%
await students["Dale Gross"].S("POST", `/api/assignments/${essay}/submit`, {}); // handed in, not graded
// Dale has nothing on the quiz or the reading log, both past due → missing.

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
{ const [n, v] = T.cookie().split("="); await ctx.addCookies([{ name: n, value: v, url: B }]); }
const p = await ctx.newPage();
p.setDefaultTimeout(8000);
const errors = [];
p.on("pageerror", (e) => { errors.push(e.message); console.log("pageerror:", e.message); });
await p.goto(`${B}/classes/${cls.id}/gradebook`);
await p.locator("[data-testid=gradebook]").waitFor();
for (const l of ["Skip", "Skip tour"]) { const x = p.getByRole("button", { name: l, exact: true }); if (await x.count()) await x.first().click().catch(() => {}); }

const table = p.locator("[data-testid=gradebook]");
const headers = await table.locator("thead th").allInnerTexts();
check("first columns are Student and Average", headers[0].trim() === "Student" && headers[1].trim() === "Average", JSON.stringify(headers.slice(0, 2)));
check("an assignment column per assignment", headers.length === 2 + 4, String(headers.length));
check("newest assignment first", /Essay draft/.test(headers[2]) && /Vocab check/.test(headers[3]) && /Fractions quiz/.test(headers[5]), headers.slice(2).map((h) => h.split("\n")[1]).join(" | "));
check("each column shows date, title and max", /·/.test(headers[5]) && /Fractions quiz/.test(headers[5]) && /Max: 20/.test(headers[5]), headers[5].replace(/\n/g, " / "));
check("complete/incomplete and letter columns say so", /Complete/.test(headers[4]) && /Letter/.test(headers[3]));

const rows = await table.locator("tbody tr").allInnerTexts();
check("names go down, surname first, in surname order", /Anderson, Mike/.test(rows[0]) && /Flaherty, Renee/.test(rows[1]) && /Gross, Dale/.test(rows[2]), rows.map((r) => r.split("\t")[0]).join(" | "));
const cell = (row, col) => table.locator("tbody tr").nth(row).locator("td").nth(col);
// Columns: 0 Average, 1 Essay, 2 Vocab (letter), 3 Reading log (complete), 4 Quiz.
check("Mike's average counts a B as 85 out of 100: (18 + 10 + 85) / (20 + 10 + 100) = 86.9%", (await cell(0, 0).innerText()).trim() === "86.9%", await cell(0, 0).innerText());
check("Renee's: (10 + 0 + 59) / 130 = 53.1%, flagged", (await cell(1, 0).innerText()).trim() === "53.1%" && /a3341f/.test(await cell(1, 0).getAttribute("class")));
check("a low score is flagged", /a3341f/.test(await cell(1, 4).getAttribute("class")) && (await cell(1, 4).innerText()).trim() === "10");
check("an F is flagged like any score under 60%, a B isn't", /a3341f/.test(await cell(1, 2).getAttribute("class")) && !/a3341f/.test(await cell(0, 2).getAttribute("class")));
check("a ticked complete shows ✓", (await cell(0, 3).innerText()).trim() === "✓");
check("handed in but not graded says To grade", (await cell(2, 1).innerText()).trim() === "To grade");
check("past due with nothing handed in says Missing", (await cell(2, 4).innerText()).trim() === "Missing" && (await cell(2, 3).innerText()).trim() === "Missing");
check("not due yet and not handed in is blank", (await cell(0, 1).innerText()).trim() === "" && (await cell(2, 2).innerText()).trim() === "");
const summary = await p.locator("[data-testid=gb-summary]").innerText();
check("the summary counts what needs attention", /3 students · 4 assignments/.test(summary) && /1 to grade/.test(summary) && /2 missing/.test(summary), summary.replace(/\n/g, " "));
const foot = await table.locator("tfoot tr").allInnerTexts();
check("class average and median rows", /Class average/.test(foot[0]) && /Class median/.test(foot[1]) && /14/.test(foot[0]), foot.map((f) => f.replace(/\t/g, " ")).join(" | "));
check("the letter column's class average is the mean of 85 and 59", /\b72%/.test(foot[0]), foot[0].replace(/\t/g, " "));
{
  const csv = await (await fetch(`${B}/api/classes/${cls.id}/gradebook.csv`, { headers: { cookie: T.cookie() } })).text();
  const mike = csv.split("\n").find((l) => l.startsWith("Mike Anderson"));
  check("the CSV has the same average, letters included", /^Student,Email,Average %/.test(csv) && mike?.split(",")[2] === "86.9", mike);
}
// The student's own page counts returned grades the same way.
await T("POST", `/api/assignments/${quiz}/return`, { all: true });
await T("POST", `/api/assignments/${hw}/return`, { all: true });
await T("POST", `/api/assignments/${vocab}/return`, { all: true });
const mine = await students["Mike Anderson"].S("GET", `/api/classes/${cls.id}/my-grades`);
check("a student's own total uses the same rule", mine.totals?.percent === 87 && mine.totals?.earned === 113 && mine.totals?.possible === 130, JSON.stringify(mine.totals));
const href = await cell(2, 1).locator("a").getAttribute("href");
check("a score opens that student's work on that assignment", href === `/assignments/${essay}?student=${students["Dale Gross"].id}`, href);
check("a column header opens the assignment", (await table.locator("thead th").nth(2).locator("a").getAttribute("href")) === `/assignments/${essay}`);
await p.screenshot({ path: `${SHOTS}/gradebook.png` });

const phone = await b.newContext({ viewport: { width: 375, height: 740 } });
{ const [n, v] = T.cookie().split("="); await phone.addCookies([{ name: n, value: v, url: B }]); }
const pp = await phone.newPage();
await pp.goto(`${B}/classes/${cls.id}/gradebook`);
await pp.locator("[data-testid=gradebook]").waitFor();
check("phone: the page doesn't scroll sideways; the table scrolls inside its frame", !(await pp.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
await pp.screenshot({ path: `${SHOTS}/gradebook-phone.png` });

check("no page errors", errors.length === 0, errors.join(" | "));
await b.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
