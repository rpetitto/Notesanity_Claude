// Print or download pages: the dialog, what lands on paper, and the teacher's switch.
//   npx wrangler dev --port 8799 --persist-to <fresh dir> --var AUTH_DEV_LINKS:1
//   node tests/e2e/print.mjs http://localhost:8799 <state dir, unused> tests/e2e/fixtures/two-pages.pdf <screenshot dir>
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const [B, STATE, PDF, SHOTS] = process.argv.slice(2);
const results = []; const check = (n, ok, d = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
function session() { let cookie = ""; const call = async (m, p, body, isForm) => { const r = await fetch(B + p, { method: m, headers: isForm ? { cookie } : { "content-type": "application/json", cookie }, body: body ? (isForm ? body : JSON.stringify(body)) : undefined }); const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0]; const t = await r.text(); if (p === "/api/auth/password/register" && r.ok) { const link = JSON.parse(t).devLink; if (!link) throw new Error("No sign-up link: run wrangler dev with --var AUTH_DEV_LINKS:1"); const fr = await fetch(link, { redirect: "manual", headers: { cookie } }); const sc2 = fr.headers.get("set-cookie"); if (sc2) cookie = sc2.split(";")[0]; } if (!r.ok) throw new Error(`${m} ${p} ${r.status} ${t}`); try { return JSON.parse(t); } catch { return t; } }; call.cookie = () => cookie; return call; }

const T = session();
await T("POST", "/api/auth/password/register", { email: "lee@example.edu", password: "correct-horse-battery", name: "Ms. Lee" });
await T("PATCH", "/api/org", { teacherDomains: "example.edu", studentDomains: "students.example.edu" });
const cls = (await T("POST", "/api/classes", { name: "Period 1" })).class;
const f = new FormData(); f.append("file", new Blob([readFileSync(PDF)], { type: "application/pdf" }), "w.pdf"); f.append("title", "Unit 1");
const nb = (await T("POST", `/api/classes/${cls.id}/notebooks`, f, true)).notebook.id;
await T("POST", `/api/notebooks/${nb}/pages`, { pages: [{ sourceIndex: 0, width: 612, height: 792 }, { sourceIndex: 1, width: 612, height: 792 }] });
await T("POST", `/api/notebooks/${nb}/pages/blank`, { pattern: "lined-wide", color: "#9BB8D3", count: 1 });
const pages = (await T("GET", `/api/notebooks/${nb}`)).pages;
// Answer boxes on page 3 (blank paper, so the only ink there is ours), text on page 2.
const TEXT = { x: 60, y: 300, w: 400, h: 40 };
const textId = (await T("POST", `/api/notebooks/${nb}/fields`, { pageId: pages[2].id, type: "text", ...TEXT, label: "Answer" })).field.id;
const boxId = (await T("POST", `/api/notebooks/${nb}/fields`, { pageId: pages[2].id, type: "checkbox", x: 60, y: 400, w: 24, h: 24, label: "Done" })).field.id;
const RT = { x: 60, y: 120, w: 400, h: 160 };
const rtId = (await T("POST", `/api/notebooks/${nb}/fields`, { pageId: pages[2].id, type: "richtext", ...RT, label: "Text" })).field.id;
await T("PATCH", `/api/notebooks/${nb}/fields/${rtId}`, { content: "<h2>Warm up</h2><p>Read the passage <b>twice</b>, then answer.</p><ul><li>First thing</li><li>Second thing</li></ul>" });
await T("POST", `/api/notebooks/${nb}/publish`, {});
const S = session();
await S("POST", "/api/auth/password/register", { email: "sam@students.example.edu", password: "correct-horse-battery", name: "Sam", door: "student" });
await S("POST", "/api/classes/join", { code: (await T("GET", `/api/classes/${cls.id}`)).class.joinCode });
const sw = await S("GET", `/api/notebooks/${nb}/work`);
await S("PUT", `/api/notebooks/${nb}/values`, { values: [{ fieldId: textId, value: "My typed answer 42" }, { fieldId: boxId, value: "1" }] });
check("work carries the print switch, on by default", sw.notebook.allowExport === true);

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];
async function open(sess, path, vw = 1280, vh = 900) {
  const ctx = await b.newContext({ viewport: { width: vw, height: vh }, acceptDownloads: true });
  await ctx.addInitScript(() => { window.__prints = []; window.print = () => { window.__prints.push(document.querySelectorAll("#print-root img").length); }; });
  { const [n, v] = sess.cookie().split("="); await ctx.addCookies([{ name: n, value: v, url: B }]); }
  const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  p.on("pageerror", (e) => { errors.push(e.message); console.log("pageerror:", e.message); });
  await p.goto(B + path); await p.waitForTimeout(2500);
  for (const l of ["Skip", "Skip tour"]) { const x = p.getByRole("button", { name: l, exact: true }); if (await x.count()) await x.first().click().catch(() => {}); }
  return p;
}
/** Dark pixels inside a page-unit box of printed sheet `i` (rendered at 2x). */
const inkIn = (p, i, box) => p.evaluate(async ({ i, box }) => {
  const img = document.querySelectorAll("#print-root img")[i];
  await img.decode();
  const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(box.x * 2, box.y * 2, box.w * 2, box.h * 2).data;
  let n = 0; for (let k = 0; k < d.length; k += 4) if (d[k] + d[k + 1] + d[k + 2] < 250) n++;
  return n;
}, { i, box });
const dialogOf = (p) => p.getByRole("dialog", { name: "Print or download" });
const prints = (p) => p.evaluate(() => window.__prints.slice());

// ---- Student
let p = await open(S, `/notebooks/${nb}`);
await p.getByRole("button", { name: "Print or download" }).click();
let dlg = dialogOf(p);
check("student: the dialog opens with the page in view chosen", await dlg.getByRole("radio", { name: /This page \(page \d\)/ }).isChecked());
check("student: offers all pages and a range", (await dlg.getByRole("radio", { name: "All pages (3)" }).count()) === 1 && (await dlg.getByLabel("Page numbers").count()) === 1);
check("student: writing is included by default", await dlg.getByRole("checkbox", { name: /Include your writing and answers/ }).isChecked());
await dlg.getByLabel("Page numbers").fill("9");
await dlg.getByRole("button", { name: /^Print/ }).click();
check("student: an impossible range says what's possible", /This notebook has pages 1 to 3/.test(await dlg.innerText()));
await dlg.getByLabel("Page numbers").fill("3");
await dlg.getByRole("button", { name: /^Print/ }).click();
await dlg.waitFor({ state: "detached", timeout: 15000 });
check("student: printing page 3 sends one sheet to the printer", JSON.stringify(await prints(p)) === "[1]", JSON.stringify(await prints(p)));
await p.emulateMedia({ media: "print" });
check("while printing pages, only the sheets print", await p.evaluate(() => getComputedStyle(document.getElementById("root")).display === "none" && getComputedStyle(document.getElementById("print-root")).display === "block"));
await p.evaluate(() => window.dispatchEvent(new Event("afterprint")));
check("afterwards, printing from the browser's menu prints the screen again", await p.evaluate(() => !document.getElementById("print-root") && getComputedStyle(document.getElementById("root")).display !== "none"));
await p.emulateMedia({ media: "screen" });
// The sheets were cleaned up with afterprint, so print page 3 again to measure it.
await p.getByRole("button", { name: "Print or download" }).click();
dlg = dialogOf(p);
await dlg.getByLabel("Page numbers").fill("3");
await dlg.getByRole("button", { name: /^Print/ }).click();
await dlg.waitFor({ state: "detached", timeout: 15000 });
const withAnswer = await inkIn(p, 0, TEXT);
const withTick = await inkIn(p, 0, { x: 60, y: 400, w: 24, h: 24 });
const rtInk = await inkIn(p, 0, RT);
check("student: the typed answer is on the printed page", withAnswer > 300, `${withAnswer} dark px`);
check("student: the teacher's text block is on the printed page", rtInk > 1500, `${rtInk} dark px`);
await p.screenshot({ path: `${SHOTS}/print-student.png` });
{ const data = await p.evaluate(async () => { const img = document.querySelector("#print-root img"); const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext("2d").drawImage(img, 0, 0); return c.toDataURL("image/png").split(",")[1]; }); (await import("node:fs")).writeFileSync(`${SHOTS}/printed-sheet.png`, Buffer.from(data, "base64")); }
// Blank version: same page with writing off.
await p.getByRole("button", { name: "Print or download" }).click();
dlg = dialogOf(p);
await dlg.getByLabel("Page numbers").fill("3");
await dlg.getByRole("checkbox", { name: /Include your writing/ }).uncheck();
await dlg.getByRole("button", { name: /^Print/ }).click();
await dlg.waitFor({ state: "detached", timeout: 15000 });
const blankAnswer = await inkIn(p, 0, TEXT);
const blankTick = await inkIn(p, 0, { x: 60, y: 400, w: 24, h: 24 });
check("student: with writing off, the answer and tick are gone but the page isn't", blankAnswer < withAnswer / 4 && blankTick < withTick && (await inkIn(p, 0, RT)) > 1500, `${blankAnswer} vs ${withAnswer}; tick ${blankTick} vs ${withTick}`);
// All pages, as a PDF.
await p.getByRole("button", { name: "Print or download" }).click();
dlg = dialogOf(p);
await dlg.getByRole("radio", { name: "All pages (3)" }).check();
check("student: Print names the count", /Print 3 pages/.test(await dlg.getByRole("button", { name: /^Print/ }).innerText()));
const dlP = p.waitForEvent("download", { timeout: 30000 });
await dlg.getByRole("button", { name: "Download PDF" }).click();
const dl = await dlP;
const pdf = readFileSync(await dl.path()).toString("latin1");
const pageCount = (pdf.match(/\/Type\s*\/Page\b(?!s)/g) || []).length;
check("student: Download PDF gives every page", pdf.startsWith("%PDF-") && pageCount === 3 && dl.suggestedFilename() === "Unit 1.pdf", `${pageCount} pages, ${dl.suggestedFilename()}`);
// Ctrl+P opens the dialog rather than printing the app.
await p.keyboard.press("Control+p");
check("student: Ctrl+P opens Print or download", await dialogOf(p).isVisible());
await dialogOf(p).getByRole("button", { name: "Cancel" }).click();
// Phone
const pp = await open(S, `/notebooks/${nb}`, 375, 740);
await pp.getByRole("button", { name: "Print or download" }).click();
const box = await dialogOf(pp).boundingBox();
check("phone: the dialog fits with no sideways scroll", box.width <= 375 && !(await pp.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
await pp.screenshot({ path: `${SHOTS}/print-phone.png` });

// ---- Teacher: the editor
const t = await open(T, `/notebooks/${nb}/edit`);
await t.getByRole("button", { name: "Notebook actions" }).click();
check("editor: Notebook actions has Print or download and the student switch", (await t.getByRole("menuitem", { name: /Print or download/ }).count()) === 1 && (await t.getByRole("menuitem", { name: /Stop students printing and downloading/ }).count()) === 1);
await t.getByRole("menuitem", { name: /Print or download/ }).click();
dlg = dialogOf(t);
check("editor: includes the teacher's markup, not answers", (await dlg.getByRole("checkbox", { name: /Include your markup/ }).count()) === 1);
await dlg.getByRole("button", { name: "Cancel" }).click();
await t.getByRole("checkbox", { name: "Select page 3" }).check();
await t.getByRole("toolbar", { name: "Selected pages" }).getByRole("button", { name: "Print" }).click();
check("editor: one selected page defaults to that page, not the one on screen", await dialogOf(t).getByRole("radio", { name: "Selected pages (1)" }).isChecked());
await dialogOf(t).getByRole("button", { name: "Cancel" }).click();
await t.getByRole("checkbox", { name: "Select page 3" }).uncheck();
await t.getByRole("checkbox", { name: "Select page 2" }).check();
await t.getByRole("checkbox", { name: "Select page 3" }).check();
await t.getByRole("toolbar", { name: "Selected pages" }).getByRole("button", { name: "Print" }).click();
dlg = dialogOf(t);
check("editor: from the selection bar, Selected pages (2) is chosen", await dlg.getByRole("radio", { name: "Selected pages (2)" }).isChecked());
await dlg.getByRole("button", { name: /^Print/ }).click();
await dlg.waitFor({ state: "detached", timeout: 15000 });
check("editor: two sheets to the printer", JSON.stringify(await prints(t)) === "[2]", JSON.stringify(await prints(t)));
check("editor: the text block prints, the student's answer doesn't", (await inkIn(t, 1, RT)) > 1500 && (await inkIn(t, 1, TEXT)) < withAnswer / 4);
await t.keyboard.press("Escape");
await t.getByRole("button", { name: "Notebook actions" }).click();
await t.getByRole("menuitem", { name: /Stop students printing and downloading/ }).click();
await t.waitForTimeout(1200);
check("editor: the switch turns it off for students", (await T("GET", `/api/notebooks/${nb}`)).notebook.allowExport === false && (await S("GET", `/api/notebooks/${nb}/work`)).notebook.allowExport === false);
await t.getByRole("button", { name: "Notebook actions" }).click();
check("editor: and offers to turn it back on", (await t.getByRole("menuitem", { name: /Let students print and download/ }).count()) === 1);
await t.keyboard.press("Escape");

// ---- Student, switched off
const p2 = await open(S, `/notebooks/${nb}`);
check("student: no Print button when the teacher has switched it off", (await p2.getByRole("button", { name: "Print or download" }).count()) === 0);
await p2.keyboard.press("Control+p");
await p2.waitForTimeout(300);
check("student: Ctrl+P doesn't open it either", (await dialogOf(p2).count()) === 0);

// ---- Teacher: a student's work, still printable to the teacher
const sid = sw.student.id;
const tw = await open(T, `/classes/${cls.id}/students/${sid}/notebooks/${nb}`);
await tw.getByRole("button", { name: "Print or download" }).click();
dlg = dialogOf(tw);
check("teacher: printing a student's work names the student", (await dlg.getByRole("checkbox", { name: /Include Sam's writing and answers/ }).count()) === 1);
await dlg.getByLabel("Page numbers").fill("3");
await dlg.getByRole("button", { name: /^Print/ }).click();
await dlg.waitFor({ state: "detached", timeout: 15000 });
check("teacher: Sam's typed answer is on the sheet", (await inkIn(tw, 0, TEXT)) > 300);

// Back on
await T("PATCH", `/api/notebooks/${nb}`, { allowExport: true });
check("the switch turns back on", (await S("GET", `/api/notebooks/${nb}/work`)).notebook.allowExport === true);
check("no page errors", errors.length === 0, errors.join(" | "));
await b.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
