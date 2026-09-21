import { chromium } from "playwright";
const [SESSION, URL, OUT, W = "1280", tab = "", H = "300"] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await b.newContext({ viewport: { width: Number(W), height: 900 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: "notesanity_session", value: SESSION, domain: "127.0.0.1", path: "/" }]);
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
await p.goto(URL, { waitUntil: "networkidle" });
await p.waitForTimeout(1200);
if (tab) { await p.click(`[role=tab][title*="${tab}"]`); await p.waitForTimeout(600); }
const sw = await p.evaluate(() => document.documentElement.scrollWidth);
await p.screenshot({ path: OUT, clip: { x: 0, y: 0, width: Number(W), height: Number(H) } });
console.log(`${OUT}: scrollWidth=${sw} (viewport ${W})${errs.length ? " errors: " + errs.join("; ") : ""}`);
await b.close();
