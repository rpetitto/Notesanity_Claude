// Answer keys, checking by question, and scores that become grades.
//   npx wrangler dev --port 8799 --persist-to <fresh dir> --var AUTH_DEV_LINKS:1
//   node tests/e2e/answers.mjs http://localhost:8799 tests/e2e/fixtures/two-pages.pdf <screenshot dir>
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const [B, PDF, SHOTS = "/tmp/answers-shots"] = process.argv.slice(2);
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
f.append("title", "Unit 1");
const nb = (await T("POST", `/api/classes/${cls.id}/notebooks`, f, true)).notebook.id;
await T("POST", `/api/notebooks/${nb}/pages`, { pages: [{ sourceIndex: 0, width: 612, height: 792 }, { sourceIndex: 1, width: 612, height: 792 }] });
const pages = (await T("GET", `/api/notebooks/${nb}`)).pages;
const P1 = pages[0].id, P2 = pages[1].id;

// Four boxes on page 1, top to bottom; one on page 2 that no assignment covers.
const box = async (body) => (await T("POST", `/api/notebooks/${nb}/fields`, { pageId: P1, x: 80, w: 160, h: 28, ...body })).field.id;
const q1 = await box({ type: "text", y: 100, label: "2 + 2" });
const q2 = await box({ type: "choice", y: 160, label: "Sky colour", options: ["Red", "Blue"] });
const q3 = await box({ type: "checkbox", y: 220, w: 20, h: 20, label: "Agree" });
const q4 = await box({ type: "text", y: 280, label: "Explain" });
const qOther = (await T("POST", `/api/notebooks/${nb}/fields`, { pageId: P2, type: "text", x: 80, y: 100, w: 160, h: 28 })).field.id;
await T("PATCH", `/api/notebooks/${nb}/fields/${q1}`, { answerKey: { accept: ["4", "four"] } });
await T("PATCH", `/api/notebooks/${nb}/fields/${q2}`, { answerKey: { accept: ["Blue"] }, points: 2 });
await T("PATCH", `/api/notebooks/${nb}/fields/${q3}`, { answerKey: { checked: true } });
await T("PATCH", `/api/notebooks/${nb}/fields/${qOther}`, { answerKey: { accept: ["x"] } });
await T("POST", `/api/notebooks/${nb}/publish`, {});
const code = (await T("GET", `/api/classes/${cls.id}`)).class.joinCode;

const st = {};
for (const [email, name] of [["ann@students.example.edu", "Ann Avery"], ["ben@students.example.edu", "Ben Brooks"], ["cal@students.example.edu", "Cal Cole"]]) {
  const S = session();
  await S("POST", "/api/auth/password/register", { email, password: PW, name, door: "student" });
  await S("POST", "/api/classes/join", { code });
  st[name.split(" ")[0]] = { S, id: (await S("GET", "/api/me")).user.id, name };
}
const { Ann, Ben, Cal } = st;

{
  const t = await T("GET", `/api/notebooks/${nb}`);
  check("the teacher's notebook carries each box's key and points", t.fields.find((x) => x.id === q2)?.answer_key === JSON.stringify({ accept: ["Blue"] }) && t.fields.find((x) => x.id === q2)?.points === 2);
  const raw = await Ann.S.text(`/api/notebooks/${nb}`);
  check("a student's notebook never mentions an answer key", !raw.includes("answer_key") && !raw.includes("Blue\"]"), raw.slice(0, 80));
}

// The work.
const typed = (S, values) => S("PUT", `/api/notebooks/${nb}/values`, { values: Object.entries(values).map(([fieldId, value]) => ({ fieldId, value })) });
await typed(Ann.S, { [q1]: "4", [q2]: "Blue", [q3]: "1", [q4]: "Because it is." });
await typed(Ben.S, { [q1]: "Four.", [q2]: "Red" });
// Cal writes the first answer with a pen, inside the first box.
await Cal.S("PUT", `/api/notebooks/${nb}/layers/${P1}`, {
  kind: "student", rev: 0,
  data: JSON.stringify({ v: 1, s: [{ t: "p", c: "#20302C", w: 2, p: [100, 110, 0.5, 120, 118, 0.5, 140, 108, 0.5, 160, 116, 0.5] }], x: [], e: [], c: [] }),
});
{
  const raw = await Ann.S.text(`/api/notebooks/${nb}/work?pages=${P1}`);
  check("a student's own work never carries a key", !raw.includes("answer_key"));
}

const make = async (title, grading, extra = {}) => (await T("POST", `/api/classes/${cls.id}/assignments`, {
  title, notebookId: nb, pageIds: [P1], status: "active", grading, pointsMax: 20, ...extra,
})).assignment.id;
const quiz = await make("Quiz", "points");

// Who may look.
{
  check("a student can't open the check sheet", await Ann.S.status("GET", `/api/assignments/${quiz}/check`) === 403);
  check("…or mark an answer", await Ann.S.status("POST", `/api/assignments/${quiz}/marks`, { studentId: Ann.id, fieldId: q4, correct: true }) === 403);
  check("…or read classmates' ink", await Ann.S.status("GET", `/api/assignments/${quiz}/page-ink?pageId=${P1}`) === 403);
  check("…or turn scores into grades", await Ann.S.status("POST", `/api/assignments/${quiz}/apply-scores`, {}) === 403);
  const O = session();
  await O("POST", "/api/auth/password/register", { email: "out@elsewhere.org", password: PW, name: "Other Teacher", door: "teacher" });
  const os = await O.status("GET", `/api/assignments/${quiz}/check`);
  check("a teacher from another school can't open it", os === 403 || os === 404, String(os));
}

const sheet = async (a = quiz) => T("GET", `/api/assignments/${a}/check`);
const score = (s, who) => s.students.find((x) => x.student.id === who.id).score;
{
  const s = await sheet();
  check("the sheet lists the assignment's boxes in reading order", s.fields.map((x) => x.id).join() === [q1, q2, q3, q4].join(), s.fields.map((x) => x.label).join(" | "));
  check("a box with no key doesn't count until someone is marked on it", s.fields.find((x) => x.id === q4).counted === false && s.fields.find((x) => x.id === q1).counted === true);
  const ann = s.students.find((x) => x.student.id === Ann.id);
  check("the key decides: Ann has everything right, 4 of 4 points", ann.answers[q1].auto === true && ann.answers[q2].auto === true && ann.answers[q3].auto === true && score(s, Ann).earned === 4 && score(s, Ann).possible === 4, JSON.stringify(score(s, Ann)));
  check("\"Four.\" matches a key of \"four\"; Red isn't Blue; blank isn't ticked", score(s, Ben).earned === 1, JSON.stringify(score(s, Ben)));
  check("Cal typed nothing: nothing answered", score(s, Cal).answered === 0 && score(s, Cal).earned === 0);
}
{
  const ink = await T("GET", `/api/assignments/${quiz}/page-ink?pageId=${P1}`);
  check("the page's ink comes back for whoever wrote on it", !!ink.ink[Cal.id] && !ink.ink[Ann.id], Object.keys(ink.ink).length + " students");
  check("a page outside the assignment is refused", await T.status("GET", `/api/assignments/${quiz}/page-ink?pageId=${P2}`) === 404);
}

// Marking.
{
  await T("POST", `/api/assignments/${quiz}/marks`, { studentId: Ann.id, fieldId: q4, correct: true });
  let s = await sheet();
  check("marking an unkeyed box makes it count for everyone", s.fields.find((x) => x.id === q4).counted && score(s, Ann).possible === 5 && score(s, Ann).earned === 5, JSON.stringify(score(s, Ann)));
  check("…and the rest of the class shows as still to check on it", score(s, Ben).pending === 1);
  await T("POST", `/api/assignments/${quiz}/marks`, { studentIds: [Ben.id, Cal.id], fieldId: q4, correct: false });
  s = await sheet();
  check("a group is marked in one go", score(s, Ben).pending === 0 && score(s, Cal).pending === 0);
  await T("POST", `/api/assignments/${quiz}/marks`, { studentId: Cal.id, fieldId: q1, correct: true });
  s = await sheet();
  check("a handwritten answer can be marked right over the key", s.students.find((x) => x.student.id === Cal.id).answers[q1].mark === true && score(s, Cal).earned === 1);
  await T("POST", `/api/assignments/${quiz}/marks`, { studentId: Ben.id, fieldId: q1, correct: false });
  await T("POST", `/api/assignments/${quiz}/marks`, { studentId: Ben.id, fieldId: q1, correct: null });
  s = await sheet();
  check("clearing a mark goes back to the key", s.students.find((x) => x.student.id === Ben.id).answers[q1].mark === null && score(s, Ben).earned === 1);

  check("a box on a page the assignment doesn't cover can't be marked", await T.status("POST", `/api/assignments/${quiz}/marks`, { studentId: Ann.id, fieldId: qOther, correct: true }) === 404);
  const O = session();
  await O("POST", "/api/auth/password/register", { email: "zed@students.example.edu", password: PW, name: "Zed Outsider", door: "student" });
  const zed = (await O("GET", "/api/me")).user.id;
  check("a student outside the class can't be marked, even in a group", await T.status("POST", `/api/assignments/${quiz}/marks`, { studentIds: [Ann.id, zed], fieldId: q4, correct: false }) === 404);
  s = await sheet();
  check("…and nobody in that group was marked", s.students.find((x) => x.student.id === Ann.id).answers[q4].mark === true);
}

// Scores into grades.
{
  await T("POST", `/api/assignments/${quiz}/grade`, { studentId: Ben.id, points: 7 });
  const r = await T("POST", `/api/assignments/${quiz}/apply-scores`, {});
  const rows = (await T("GET", `/api/assignments/${quiz}`)).rows;
  const g = (who) => rows.find((x) => x.student.id === who.id).grade.points;
  check("scores become points out of the assignment's maximum: 5/5 → 20, 1/5 → 4", g(Ann) === 20 && g(Cal) === 4, `${g(Ann)} ${g(Cal)}`);
  check("a grade already given is kept", g(Ben) === 7 && r.skipped.graded === 1, JSON.stringify(r));
  await T("POST", `/api/assignments/${quiz}/return`, { studentId: Ann.id });
  const r2 = await T("POST", `/api/assignments/${quiz}/apply-scores`, { overwrite: true });
  const rows2 = (await T("GET", `/api/assignments/${quiz}`)).rows;
  check("replacing grades replaces Ben's 7 with his 4", rows2.find((x) => x.student.id === Ben.id).grade.points === 4);
  check("returned work is never regraded", r2.skipped.returned === 1 && rows2.find((x) => x.student.id === Ann.id).grade.points === 20, JSON.stringify(r2));
}
{
  const vocab = await make("Vocab", "letter");
  await T("POST", `/api/assignments/${vocab}/marks`, { studentIds: [Ann.id, Ben.id, Cal.id], fieldId: q4, correct: false });
  const r = await T("POST", `/api/assignments/${vocab}/apply-scores`, {});
  const rows = (await T("GET", `/api/assignments/${vocab}`)).rows;
  const l = (who) => rows.find((x) => x.student.id === who.id).grade.letter;
  check("on a letter assignment: 4/5 is a B, 1/5 an F", l(Ann) === "B" && l(Ben) === "F", `${l(Ann)} ${l(Ben)}`);
  check("marks belong to one assignment: Cal's handwriting isn't marked here, so the key says wrong and he's graded too", l(Cal) === "F" && r.applied === 3, JSON.stringify(r));
  const done = await make("Done?", "complete");
  check("a complete/incomplete assignment won't take scores", await T.status("POST", `/api/assignments/${done}/apply-scores`, {}) === 400);
  const blank = await make("Nothing yet", "points");
  const rb = await T("POST", `/api/assignments/${blank}/apply-scores`, {});
  check("someone who answered nothing is left for the teacher, not given a zero", rb.skipped.blank === 1 && rb.applied === 2, JSON.stringify(rb));
}

// Keys travel with the boxes.
{
  await T("POST", `/api/notebooks/${nb}/fields/bulk`, { pageId: P2, fields: [
    { type: "text", x: 80, y: 300, w: 160, h: 28, label: "AI 1", answerKey: { accept: ["12"] } },
    { type: "text", x: 80, y: 360, w: 160, h: 28, label: "AI 2" },
  ] });
  const t = await T("GET", `/api/notebooks/${nb}`);
  check("a box placed with a drafted key keeps it; one without has none", t.fields.find((x) => x.label === "AI 1")?.answer_key === JSON.stringify({ accept: ["12"] }) && t.fields.find((x) => x.label === "AI 2")?.answer_key === "");

  const tpl = (await T("POST", "/api/my/templates", { title: "Keyed", pages: 1, pattern: "lined-college", color: "#9EC5E8" })).notebook.id;
  const tp = (await T("GET", `/api/notebooks/${tpl}`)).pages[0].id;
  const tf = (await T("POST", `/api/notebooks/${tpl}/fields`, { pageId: tp, type: "text", x: 50, y: 50, w: 100, h: 24 })).field.id;
  await T("PATCH", `/api/notebooks/${tpl}/fields/${tf}`, { answerKey: { accept: ["early"] }, points: 3 });
  const copy = (await T("POST", `/api/templates/${tpl}/push`, { classId: cls.id })).notebook.id;
  const cf = (await T("GET", `/api/notebooks/${copy}`)).fields[0];
  check("pushing a template copies its keys and points", cf.answer_key === JSON.stringify({ accept: ["early"] }) && cf.points === 3);
  const tf2 = (await T("POST", `/api/notebooks/${tpl}/fields`, { pageId: tp, type: "text", x: 50, y: 120, w: 100, h: 24 })).field.id;
  await T("POST", `/api/templates/${tpl}/sync`, {});
  await T("PATCH", `/api/notebooks/${tpl}/fields/${tf2}`, { answerKey: { accept: ["later"] } });
  const list = await T("GET", "/api/my/teaching-notebooks");
  const pending = list.notebooks.find((n) => n.id === tpl).copies[0].pendingKeys;
  check("a key added to the template afterwards shows as an update to send", pending === 1, String(pending));
  const sync = await T("POST", `/api/templates/${tpl}/sync`, {});
  const cf2 = (await T("GET", `/api/notebooks/${copy}`)).fields.find((x) => x.answer_key.includes("later"));
  check("…and sending updates carries it to the class copy", sync.keysAdded === 1 && !!cf2, JSON.stringify(sync));
}

// In the browser — with the guided tours already behind this teacher.
for (const tour of ["teacher.home", "teacher.class", "teacher.notebook"]) await T("POST", "/api/me/tours", { tour, status: "dismissed" });
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
{ const [n, v] = T.cookie().split("="); await ctx.addCookies([{ name: n, value: v, url: B }]); }
const p = await ctx.newPage();
p.setDefaultTimeout(10000);
const errors = [];
p.on("pageerror", (e) => { errors.push(e.message); console.log("pageerror:", e.message); });
const skipTours = async () => { for (const l of ["Skip", "Skip tour"]) { const x = p.getByRole("button", { name: l, exact: true }); if (await x.count()) await x.first().click().catch(() => {}); } };

// The editor: a box's key in its settings.
{
  await p.goto(`${B}/notebooks/${nb}/edit`);
  await p.locator(`[data-field-box="${q4}"]`).first().waitFor();
  await skipTours();
  await p.locator(`[data-field-box="${q4}"]`).first().click();
  const keyPanel = p.locator("[data-testid=answer-key]").first();
  await keyPanel.waitFor();
  check("a text box's settings offer an answer key", await keyPanel.isVisible());
  await keyPanel.getByLabel("Accepted answers").fill("because\nas it is");
  await p.getByRole("button", { name: "Save", exact: true }).first().click();
  await p.waitForTimeout(800);
  const t = await T("GET", `/api/notebooks/${nb}`);
  check("saving it stores one accepted answer per line", t.fields.find((x) => x.id === q4)?.answer_key === JSON.stringify({ accept: ["because", "as it is"] }), t.fields.find((x) => x.id === q4)?.answer_key);
  await p.screenshot({ path: `${SHOTS}/editor-key.png` });
}

// Grading: the score against the key, offered as the grade.
const fresh = await make("Fresh quiz", "points");
{
  await p.goto(`${B}/assignments/${fresh}?student=${Ben.id}`);
  const ks = p.locator("[data-testid=key-score]").first();
  await ks.waitFor();
  const txt = await ks.innerText();
  // Ben left the last box blank, which now has a key (set in the editor above): wrong, not to check.
  check("the grade panel shows the student's score against the key", /1 of 5 points/.test(txt) && !/still to check/.test(txt), txt.replace(/\n/g, " "));
  await ks.getByRole("button", { name: /Use 4 \/ 20 as the grade/ }).click();
  check("…and offers it as the grade", await p.locator("input[type=number]").first().inputValue() === "4");
  check("grading links to Check by question", await p.getByRole("link", { name: "Check by question" }).count() > 0);
}

// Check by question.
{
  await p.goto(`${B}/assignments/${fresh}/check?q=${q1}`);
  await p.locator("[data-testid=answer-group]").first().waitFor();
  const groups = await p.locator("[data-testid=answer-group]").allInnerTexts();
  check("answers to a question are gathered into groups, blank last", groups.length === 3 && /“4”/.test(groups[0] + groups[1]) && /“Four.”/.test(groups[0] + groups[1]) && /Nothing typed/.test(groups[2]), groups.map((g) => g.split("\n")[0]).join(" | "));
  check("the key has already decided the typed ones", groups.slice(0, 2).every((g) => /Right/.test(g)));
  const blank = p.locator("[data-testid=answer-group]").nth(2);
  await blank.locator("canvas").first().waitFor();
  check("a student who wrote by hand shows up with a crop of what they wrote", await blank.locator("canvas").count() === 1 && /Cal Cole/.test(await blank.innerText()));
  await p.screenshot({ path: `${SHOTS}/check-q1.png`, fullPage: true });
  await blank.locator("[data-testid=answer-student]").first().getByRole("button", { name: "Right" }).click();
  await p.waitForTimeout(800);
  const s = await sheet(fresh);
  check("marking them right from the crop saves", s.students.find((x) => x.student.id === Cal.id).answers[q1].mark === true);

  await p.goto(`${B}/assignments/${fresh}/check?q=${q4}`);
  await p.locator("[data-testid=answer-group]").first().waitFor();
  const benGroup = p.locator("[data-testid=answer-group]").filter({ hasText: "Nothing typed" });
  await benGroup.getByRole("group", { name: /Mark everyone/ }).getByRole("button", { name: "Wrong" }).click();
  await p.waitForTimeout(800);
  const s2 = await sheet(fresh);
  check("a whole group is marked with one press", [Ben, Cal].every((w) => s2.students.find((x) => x.student.id === w.id).answers[q4].mark === false));

  await p.getByRole("button", { name: "Make grades from scores" }).click();
  const dialog = p.getByRole("dialog");
  await dialog.waitFor();
  const dtext = await dialog.innerText();
  check("making grades says who's ready", /3 students ready to grade/.test(dtext), dtext.replace(/\n/g, " "));
  await dialog.getByRole("button", { name: /Grade 3 students/ }).click();
  await p.waitForTimeout(1000);
  const rows = (await T("GET", `/api/assignments/${fresh}`)).rows;
  check("…and grades them", rows.every((r) => r.graded) && rows.find((r) => r.student.id === Ann.id).grade.points === 16, rows.map((r) => r.grade.points).join(","));
}

check("no page errors", errors.length === 0, errors.join(" | "));
await b.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
