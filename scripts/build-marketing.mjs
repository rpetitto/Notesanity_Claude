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
import changelog from "../marketing/pages/changelog.mjs";
import contact from "../marketing/pages/contact.mjs";

const OUT = "dist/client";

const PAGES = [
  ["landing.html", landing],
  ["help.html", help],
  ["pricing.html", pricing],
  ["terms.html", terms],
  ["privacy.html", privacy],
  ["status.html", status],
  ["changelog.html", changelog],
  ["contact.html", contact],
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
const urls = ["/", "/help", "/pricing", "/privacy", "/terms", "/status", "/changelog", "/contact"];
const TODAY = new Date().toISOString().slice(0, 10);
// Priority is a hint about relative importance within this site, not a ranking
// lever: the front page and the help center earn more of a crawler's attention
// than the terms do.
const PRIORITY = { "/": "1.0", "/help": "0.9", "/pricing": "0.8", "/contact": "0.7" };
writeFileSync(
  join(OUT, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map(
        (u) =>
          `  <url><loc>https://notesanity.com${u === "/" ? "/" : u}</loc>` +
          `<lastmod>${TODAY}</lastmod>` +
          `<priority>${PRIORITY[u] ?? "0.5"}</priority></url>`,
      )
      .join("\n") +
    `\n</urlset>\n`,
);

/**
 * robots.txt, with the AI crawlers named explicitly.
 *
 * The distinction that matters is between crawlers that *train* on a page and
 * crawlers that *answer questions with it*. Being cited in an AI answer is
 * discovery, and the bots that do it — OAI-SearchBot, PerplexityBot,
 * Claude-SearchBot — are welcomed here. The training crawlers are welcomed too,
 * deliberately: for a product nobody has heard of, being in the answer at all
 * is worth more than withholding a marketing page from a training set. That is
 * a business call and easily reversed by moving a name into a Disallow block.
 *
 * The app's own routes are shut to everything. They are per-student, they need
 * a session, and they have nothing to offer an index.
 */
const APP_PATHS = ["/api/", "/classes", "/notebooks", "/assignments", "/work", "/settings", "/admin"];
const disallow = APP_PATHS.map((p) => `Disallow: ${p}`).join("\n");
const allow = urls.map((u) => `Allow: ${u === "/" ? "/$" : u}`).join("\n");

writeFileSync(
  join(OUT, "robots.txt"),
  [
    "# Notesanity — https://notesanity.com",
    "",
    "User-agent: *",
    allow,
    disallow,
    "",
    "# Answer engines: welcome. Being cited is how a small product gets found.",
    ...["OAI-SearchBot", "PerplexityBot", "Claude-SearchBot", "Google-Extended", "Applebot-Extended"].flatMap(
      (bot) => [`User-agent: ${bot}`, "Allow: /", disallow, ""],
    ),
    "# Training crawlers: also welcome, for now. See the comment in",
    "# scripts/build-marketing.mjs before changing this.",
    ...["GPTBot", "ClaudeBot", "CCBot", "Bytespider", "meta-externalagent"].flatMap(
      (bot) => [`User-agent: ${bot}`, "Allow: /", disallow, ""],
    ),
    `Sitemap: https://notesanity.com/sitemap.xml`,
    "",
  ].join("\n"),
);

console.log(`  marketing: ${PAGES.length} pages, ${Math.round(total / 1024)} KB total, plus sitemap and robots`);
