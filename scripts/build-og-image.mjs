/**
 * Render the social preview card to a PNG.
 *
 * Every page points at /og.png, and a link preview is often the first thing a
 * teacher sees of Notesanity — a shared link with a broken image reads as a
 * dead product. Drawing it here rather than exporting one by hand means the
 * card is regenerated with the brand it actually uses, and a change to the
 * wording is a change to this file rather than a trip through a design tool.
 *
 * Run as part of `npm run build`. It needs the browser Playwright already uses
 * for testing; if that is unavailable the build continues without it, because
 * a missing preview image should not stop a deploy.
 */

import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const OUT = join("dist/client", "og.png");
const CHROME = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const PINE = "#20302C", MINT = "#7FD1AE", OAT = "#F4EFE6";

const CARD = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700&family=Nunito:wght@400;600&display=swap">
<style>
  *{box-sizing:border-box;margin:0}
  body{width:1200px;height:630px;background:${OAT};color:${PINE};
       font-family:Nunito,system-ui,sans-serif;display:flex;flex-direction:column;
       justify-content:center;padding:70px 78px;position:relative;overflow:hidden}
  h1{font-family:'Space Grotesk',system-ui,sans-serif;font-size:68px;line-height:1.04;
     letter-spacing:-.02em;max-width:13ch}
  p{font-size:27px;line-height:1.4;color:#5b6b66;max-width:24ch;margin-top:22px}
  .brand{display:flex;align-items:center;gap:14px;margin-bottom:38px}
  .brand span{font-family:'Space Grotesk',system-ui,sans-serif;font-size:36px;font-weight:700}
  .chip{align-self:flex-start;margin-top:32px;display:inline-flex;align-items:center;gap:10px;
        border:3px solid ${PINE};background:${MINT};border-radius:999px;padding:10px 22px;
        font-family:'Space Grotesk',system-ui,sans-serif;font-weight:700;font-size:22px}
  /* The same paper-and-ink motif the site uses, so a shared link looks like the
     page it opens rather than a generic banner. */
  .paper{position:absolute;right:-40px;top:96px;width:470px;height:400px;background:#fff;
         border:4px solid ${PINE};border-radius:26px;box-shadow:9px 9px 0 0 ${PINE};
         transform:rotate(-5deg);overflow:hidden}
  .rule{position:absolute;inset:0;background:repeating-linear-gradient(
        to bottom,transparent 0 38px,rgba(32,48,44,.14) 38px 40px)}
</style></head><body>
  <div class="brand">
    <svg width="46" height="46" viewBox="0 0 64 64" fill="none">
      <g stroke="${PINE}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <rect x="10" y="12" width="40" height="40" rx="10" fill="${OAT}" transform="rotate(-10 30 32)"/>
        <rect x="18" y="14" width="38" height="40" rx="10" fill="${MINT}"/>
        <path d="M27 34.5 33 40.5 46 27" stroke-width="4"/>
      </g>
    </svg>
    <span>Notesanity</span>
  </div>
  <h1>Interactive notebooks for classrooms.</h1>
  <p>Build them from anything. Students write on them. You grade in place.</p>
  <div class="chip">Free for schools in beta</div>
  <div class="paper"><div class="rule"></div>
    <svg viewBox="0 0 470 400" width="470" height="400">
      <g fill="none" stroke="${PINE}" stroke-width="5" stroke-linecap="round">
        <path d="M46 78c30-14 54 10 84-4s50-16 78-6"/>
        <path d="M46 158c36-10 62 8 96-2s56-12 82-4"/>
        <path d="M46 238c26-8 46 6 70 0s42-10 62-4"/>
      </g>
      <g fill="none" stroke="#A3341F" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
        <path d="M250 296l26 26 52-62"/>
      </g>
    </svg>
  </div>
</body></html>`;

if (!existsSync(CHROME)) {
  console.log("  og.png: skipped (no browser available)");
  process.exit(0);
}

const { chromium } = await import("playwright");
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(CARD, { waitUntil: "load" });
// Give the webfonts a moment; a card rendered in a fallback face is off-brand
// in the one place the brand gets seen most.
await page.waitForTimeout(1200);
const png = await page.screenshot({ type: "png" });
await browser.close();

writeFileSync(OUT, png);
console.log(`  og.png: ${Math.round(png.length / 1024)} KB`);
