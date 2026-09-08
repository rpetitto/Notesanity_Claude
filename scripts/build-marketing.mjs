/**
 * Render the marketing pages to static HTML alongside the built app.
 *
 * Runs after `vite build`, writing into the same directory Vite produced, so
 * Cloudflare serves both from one assets binding: `/pricing` finds
 * `pricing.html` and never reaches the Worker, while `/classes` finds no file
 * and falls through to the app.
 *
 * The landing page is written as `landing.html` rather than `index.html`
 * precisely because `index.html` is the app's shell — the Worker decides which
 * of the two `/` should be, based on whether the visitor is signed in.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import landing from "../marketing/pages/landing.mjs";
import help from "../marketing/pages/help.mjs";
import pricing from "../marketing/pages/pricing.mjs";
import terms from "../marketing/pages/terms.mjs";
import privacy from "../marketing/pages/privacy.mjs";
import status from "../marketing/pages/status.mjs";

const OUT = "dist/client";

const PAGES = [
  ["landing.html", landing],
  ["help.html", help],
  ["pricing.html", pricing],
  ["terms.html", terms],
  ["privacy.html", privacy],
  ["status.html", status],
];

let total = 0;
for (const [file, render] of PAGES) {
  const html = render();
  const path = join(OUT, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, html);
  total += html.length;
  console.log(`  ${String(Math.round(html.length / 1024)).padStart(3)} KB  ${file}`);
}

/**
 * A sitemap and robots file, because these pages exist to be found. Both are
 * generated from the same list so a new page can't be added and then quietly
 * left out of the index.
 */
const urls = ["/", "/help", "/pricing", "/privacy", "/terms", "/status"];
writeFileSync(
  join(OUT, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>https://notesanity.com${u === "/" ? "" : u}</loc></url>`).join("\n") +
    `\n</urlset>\n`,
);

// The app's own routes have nothing to offer a crawler and some of them are
// per-student, so they are kept out of the index deliberately.
writeFileSync(
  join(OUT, "robots.txt"),
  `User-agent: *\nAllow: /$\nAllow: /help\nAllow: /pricing\nAllow: /privacy\nAllow: /terms\nAllow: /status\n` +
    `Disallow: /api/\nDisallow: /classes\nDisallow: /notebooks\nDisallow: /assignments\nDisallow: /work\n` +
    `Disallow: /settings\nDisallow: /admin\n\nSitemap: https://notesanity.com/sitemap.xml\n`,
);

console.log(`  marketing: ${PAGES.length} pages, ${Math.round(total / 1024)} KB total, plus sitemap and robots`);
