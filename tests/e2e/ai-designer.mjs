// Design a page with AI, end to end, against the free stand-in.
//   npx wrangler dev --port 8799 --persist-to <fresh dir> --var AI_STANDIN:1 --var AUTH_DEV_LINKS:1
//   node tests/e2e/ai-designer.mjs http://localhost:8799 tests/e2e/fixtures/two-pages.pdf <screenshot dir>
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const [B, PDF, SHOTS] = process.argv.slice(2);
const results = []; const check = (n, ok, d = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
function session() { let cookie = ""; const call = async (m, p, body, isForm, raw) => { const r = await fetch(B + p, { method: m, headers: isForm ? { cookie } : { "content-type": "application/json", cookie }, body: body ? (isForm ? body : JSON.stringify(body)) : undefined }); const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0]; const t = await r.text(); if (p === "/api/auth/password/register" && r.ok) { const link = JSON.parse(t).devLink; if (!link) throw new Error("No sign-up link: run wrangler dev with --var AUTH_DEV_LINKS:1"); const fr = await fetch(link, { redirect: "manual", headers: { cookie } }); const sc2 = fr.headers.get("set-cookie"); if (sc2) cookie = sc2.split(";")[0]; } let j; try { j = JSON.parse(t); } catch { j = t; } if (raw) return { status: r.status, body: j }; if (!r.ok) throw new Error(`${m} ${p} ${r.status} ${t}`); return j; }; call.cookie = () => cookie; return call; }

const T = session();
await T("POST", "/api/auth/password/register", { email: "lee@example.edu", password: "correct-horse-battery", name: "Ms. Lee" });
await T("PATCH", "/api/org", { teacherDomains: "example.edu", studentDomains: "students.example.edu" });
const cls = (await T("POST", "/api/classes", { name: "Period 1" })).class;
await T("PATCH", `/api/classes/${cls.id}`, { level: "5th", subject: "Math" });
const f = new FormData(); f.append("file", new Blob([readFileSync(PDF)], { type: "application/pdf" }), "w.pdf"); f.append("title", "Fractions");
const nb = (await T("POST", `/api/classes/${cls.id}/notebooks`, f, true)).notebook.id;
await T("POST", `/api/notebooks/${nb}/pages`, { pages: [{ sourceIndex: 0, width: 612, height: 792 }, { sourceIndex: 1, width: 612, height: 792 }] });
const firstPages = (await T("GET", `/api/notebooks/${nb}`)).pages;
const S = session();
await S("POST", "/api/auth/password/register", { email: "sam@students.example.edu", password: "correct-horse-battery", name: "Sam", door: "student" });
const T2 = session();
await T2("POST", "/api/auth/password/register", { email: "kim@example.edu", password: "correct-horse-battery", name: "Mr. Kim" });

// ---- API: allowance and refusals
let al = await T("GET", `/api/ai/allowance?notebookId=${nb}`);
check("free teacher: 1 AI page a month, even in the beta", al.limit === 1 && al.remaining === 1 && al.paid === false, JSON.stringify(al));
check("allowance carries the class's grade and subject", al.grade === "5th" && al.subject === "Math");
check("designer is available locally (stand-in)", al.available === true);
let r = await S("POST", "/api/ai/designs", { notebookId: nb, kind: "exit", description: "x", pageCount: 1 }, false, true);
check("a student can't use the designer", r.status === 403, String(r.status));
r = await T2("POST", "/api/ai/designs", { notebookId: nb, kind: "exit", description: "x", pageCount: 1 }, false, true);
check("another teacher can't design into Lee's notebook", r.status === 403 || r.status === 404, String(r.status));
r = await T("POST", "/api/ai/designs", { notebookId: nb, kind: "exit", description: "x", pageCount: 2 }, false, true);
check("asking for more pages than are left is refused with the limit code", r.status === 403 && r.body.code === "ai_limit" && /1 AI page left/.test(r.body.error), JSON.stringify(r.body));
r = await T("POST", "/api/ai/designs", { notebookId: nb, kind: "exit", description: "fractions [stand-in: fail]", pageCount: 1 }, false, true);
al = await T("GET", `/api/ai/allowance`);
check("a failed design hands its page back", r.status === 503 && al.remaining === 1, `${r.status} ${al.remaining}`);
r = await T("POST", "/api/ai/designs", { notebookId: nb, kind: "exit", description: "", pageCount: 1 }, false, true);
check("an empty description is refused", r.status === 400);
r = await T("POST", "/api/ai/designs", { notebookId: nb, kind: "exit", description: "x", pageCount: 1, sourceFile: { mediaType: "text/html", data: "PGgxPg==" } }, false, true);
check("only PDFs and photos are accepted as source", r.status === 400);

// ---- UI: the whole loop on a desktop
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
{ const [n, v] = T.cookie().split("="); await ctx.addCookies([{ name: n, value: v, url: B }]); }
const p = await ctx.newPage(); p.setDefaultTimeout(8000);
const errors = []; p.on("pageerror", (e) => { errors.push(e.message); console.log("pageerror:", e.message); });
await p.goto(`${B}/notebooks/${nb}/edit`); await p.waitForTimeout(2500);
for (const l of ["Skip", "Skip tour"]) { const x = p.getByRole("button", { name: l, exact: true }); if (await x.count()) await x.first().click().catch(() => {}); }
const t0 = Date.now();
await p.getByRole("button", { name: "Add page" }).first().click();
const item = p.getByRole("menuitem", { name: /Design with AI/ });
check("Add page offers Design with AI, marked Pro", (await item.count()) === 1 && /Pro/.test(await item.innerText()));
await item.click();
const dlg = p.getByRole("dialog", { name: "Design a page with AI" });
await dlg.getByTestId("ai-allowance").waitFor();
check("the dialog says how many are left", /1 of 1 AI page left this month/.test(await dlg.getByTestId("ai-allowance").innerText()));
check("grade and subject come from the class", (await dlg.getByLabel("Grade").inputValue()) === "5th" && (await dlg.getByLabel("Subject").inputValue()) === "Math");
check("Exit ticket is the starting kind", await dlg.getByRole("radio", { name: "Exit ticket" }).isChecked());
check("Design waits for a description", await dlg.getByRole("button", { name: "Design it" }).isDisabled());
check("This page is offered as source on a document page", (await dlg.getByRole("radio", { name: "This page" }).count()) === 1);
await dlg.getByLabel("What should it include?").fill("exit ticket on adding fractions with unlike denominators, 4 problems");
await dlg.getByRole("radio", { name: "Text I paste" }).check({ force: true });
await dlg.getByLabel("Source text").fill("Find a common denominator first.");
check("says what is sent to the AI", /Nothing about your students is/.test(await dlg.innerText()));
const reqP = p.waitForRequest((q) => q.url().endsWith("/api/ai/designs") && q.method() === "POST");
await dlg.getByRole("button", { name: "Design it" }).click();
const sent = JSON.parse((await reqP).postData());
check("the request carries the form and the pasted source", sent.kind === "exit" && sent.grade === "5th" && sent.sourceText === "Find a common denominator first." && sent.insertAfterPageId === firstPages[0].id, JSON.stringify({ ...sent, description: undefined }));
await dlg.getByTestId("ai-preview-page").first().waitFor({ timeout: 15000 });
check("preview: one page", (await dlg.getByTestId("ai-preview-page").count()) === 1);
check("preview: a box on each of the 4 answer lines", (await dlg.getByTestId("ai-answer-box").count()) === 4);
check("preview: the page image loads", await dlg.locator("img").first().evaluate((i) => i.complete && i.naturalWidth > 0));
await p.screenshot({ path: `${SHOTS}/ai-preview.png` });
al = await T("GET", `/api/ai/allowance`);
check("designing spent the free page", al.remaining === 0);
await dlg.getByLabel("Show answer boxes (4)").uncheck();
check("answer boxes can be hidden to see the page plainly", (await dlg.getByTestId("ai-answer-box").count()) === 0);
await dlg.getByLabel("Show answer boxes (4)").check();

await dlg.getByLabel("Change something").fill("one word problem");
const resP = p.waitForResponse((q) => /\/refine$/.test(q.url()));
await dlg.getByRole("button", { name: "Change it" }).click();
const refined = await (await resP).json();
check("refining sends the change and gets a redrawn page", refined.design?.pages?.[0]?.svg.includes("Changed: one word problem"));
await dlg.getByText("9 left for this design").waitFor();
check("refining is free and counted per design", (await T("GET", `/api/ai/allowance`)).remaining === 0);

await dlg.getByRole("button", { name: "Add to notebook" }).click();
await dlg.waitFor({ state: "detached", timeout: 15000 });
const secs = (Date.now() - t0) / 1000;
await p.waitForTimeout(1200);
const toasts = await p.locator("[data-sonner-toast]").allInnerTexts();
check("toast: Added 1 page", toasts.some((x) => /Added 1 page/.test(x)), toasts.join(" | "));
const after = await T("GET", `/api/notebooks/${nb}`);
const added = after.pages[1];
check("the page lands after the page on screen", after.pages.length === 3 && added.id !== firstPages[1].id && after.pages[2].id === firstPages[1].id);
const af = after.fields.filter((x) => x.page_id === added.id);
check("it carries the 4 answer boxes, as text boxes, on the lines", af.length === 4 && af.every((x) => x.type === "text" && x.w > 300 && x.h === 24), JSON.stringify(af.map((x) => [x.type, x.x, x.y, x.w, x.h])));
const pdfRes = await fetch(`${B}/api/notebooks/${nb}/asset?key=${encodeURIComponent(added.asset_key)}`, { headers: { cookie: T.cookie() } });
const pdfBytes = Buffer.from(await pdfRes.arrayBuffer());
check("its background is a real PDF the notebook owns", pdfRes.ok && pdfBytes.slice(0, 5).toString() === "%PDF-" && added.asset_key.startsWith(`notebooks/${nb}/`));
check("the PDF draws its words in a real font, not as a picture", /Item 4|Helvetica/.test(pdfBytes.toString("latin1")));
check("the editor opens the new page", /2\s*(of|\/)\s*3/.test(await p.locator("body").innerText()) || (await p.locator(`[data-page-id="${added.id}"]`).count()) > 0);
check(`the whole loop runs well under two minutes (${secs.toFixed(0)}s with the stand-in)`, secs < 120);
await p.screenshot({ path: `${SHOTS}/ai-added.png` });

// At the limit, free
await p.getByRole("button", { name: "Add page" }).first().click();
await p.getByRole("menuitem", { name: /Design with AI/ }).click();
await dlg.getByTestId("ai-allowance").waitFor();
await p.waitForTimeout(300);
const limitText = await dlg.innerText();
check("at the limit: says so and offers Pro", /used your free AI page/.test(limitText) && (await dlg.getByRole("link", { name: "Upgrade to Pro for more" }).count()) === 1, limitText.slice(0, 300));
check("at the limit: the link goes to pricing", (await dlg.getByRole("link", { name: "Upgrade to Pro for more" }).getAttribute("href")) === "/pricing");
await dlg.getByLabel("What should it include?").fill("more fractions");
check("at the limit: Design stays off", await dlg.getByRole("button", { name: "Design it" }).isDisabled());
await p.screenshot({ path: `${SHOTS}/ai-limit.png` });
await dlg.getByRole("button", { name: "Cancel" }).click();

// Phone
const pctx = await b.newContext({ viewport: { width: 375, height: 740 }, deviceScaleFactor: 2 });
{ const [n, v] = T.cookie().split("="); await pctx.addCookies([{ name: n, value: v, url: B }]); }
const pp = await pctx.newPage(); pp.setDefaultTimeout(8000);
await pp.goto(`${B}/notebooks/${nb}/edit`); await pp.waitForTimeout(2500);
for (const l of ["Skip", "Skip tour"]) { const x = pp.getByRole("button", { name: l, exact: true }); if (await x.count()) await x.first().click().catch(() => {}); }
await pp.getByRole("button", { name: "Add page" }).first().click();
await pp.getByRole("menuitem", { name: /Design with AI/ }).click();
const pd = pp.getByRole("dialog", { name: "Design a page with AI" });
await pd.getByTestId("ai-allowance").waitFor();
const hs = await pp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
const box = await pd.boundingBox();
check("phone: the dialog fits with no sideways scroll", !hs && box.width <= 375, JSON.stringify(box));
await pp.screenshot({ path: `${SHOTS}/ai-phone.png` });

// ---- Paid: a comped Pro gets 50
const A = session();
await A("POST", "/api/auth/password/register", { email: "r.petitto@gmail.com", password: "correct-horse-battery", name: "Robert" });
const org = (await A("GET", "/api/admin/orgs?limit=50")).rows.find((o) => o.primary_domain === "example.edu");
await A("POST", `/api/admin/orgs/${org.id}/plan`, { plan: "pro", reason: "test", seatEmail: "lee@example.edu" });
al = await T("GET", `/api/ai/allowance`);
check("a comped Pro teacher gets the paid allowance", al.limit === 50 && al.remaining === 49 && al.paid, JSON.stringify(al));
const d3 = await T("POST", "/api/ai/designs", { notebookId: nb, kind: "math", description: "two-step equations, 6 problems", pageCount: 3 });
check("three pages at once", d3.design.pages.length === 3 && d3.design.pages.every((x) => x.answers.length === 6));
check("three pages spend three", (await T("GET", `/api/ai/allowance`)).remaining === 46);
r = await T2("POST", `/api/ai/designs/${d3.id}/refine`, { instruction: "x" }, false, true);
check("nobody else can refine your design", r.status === 404);
let last;
for (let i = 0; i < 10; i++) last = await T("POST", `/api/ai/designs/${d3.id}/refine`, { instruction: i % 2 ? "" : `change ${i}` });
check("ten changes allowed", last.refinementsLeft === 0);
r = await T("POST", `/api/ai/designs/${d3.id}/refine`, { instruction: "one more" }, false, true);
check("the eleventh is refused, kindly", r.status === 429 && /start a new design/i.test(r.body.error), JSON.stringify(r.body));
check("none of it spent pages", (await T("GET", `/api/ai/allowance`)).remaining === 46);

check("no page errors", errors.length === 0, errors.join(" | "));
await b.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
