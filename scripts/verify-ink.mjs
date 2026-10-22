/**
 * Does every ink row still have its ink?
 *
 * Strokes live in R2 and only the row describing them lives in D1, so the two
 * can in principle drift: an object written without its row landing, a row
 * pointing at an object that was swept. This walks every `layers` row and
 * checks the pair, which is the one guarantee worth being able to re-establish
 * on demand — the data is handwriting, and there is no other copy of it.
 *
 * Read-only. Safe to run against production whenever, and worth running right
 * after `025_ink_to_r2` and again before `026` blanks the D1 fallback.
 *
 *   node scripts/verify-ink.mjs            # remote (production)
 *   node scripts/verify-ink.mjs --local    # the local dev database
 */

import { execFileSync } from "node:child_process";

const LOCAL = process.argv.includes("--local");
const WHERE = LOCAL ? "--local" : "--remote";
const BUCKET = "notesanity-assets";

/** An empty layer serializes to 35 characters; must match HAS_INK_BYTES in lib/ink.ts. */
const HAS_INK_BYTES = 40;

function d1(sql) {
  const raw = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "notesanity", WHERE, "--json", "--command", sql],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  return JSON.parse(raw.slice(raw.indexOf("[")))[0].results ?? [];
}

/** null when the object isn't there, which is a finding rather than an error. */
function r2(key) {
  try {
    return execFileSync(
      "npx",
      ["wrangler", "r2", "object", "get", `${BUCKET}/${key}`, WHERE, "--pipe"],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch {
    return null;
  }
}

const rows = d1(
  `SELECT l.id, l.page_id, l.kind, l.rev, l.byte_length, LENGTH(l.data) AS d1_len,
          l.instance_id, i.notebook_id
     FROM layers l JOIN instances i ON i.id = l.instance_id
    ORDER BY l.id`,
);

console.log(`${rows.length} layer rows\n`);

const problems = [];
let withInk = 0, empty = 0, fallback = 0;

for (const r of rows) {
  const key = `notebooks/${r.notebook_id}/ink/${r.instance_id}/${r.page_id}-${r.kind}.json`;

  if (r.byte_length === 0) {
    // Nothing stored. Legitimate for a page erased back to blank, and also the
    // shape of a row the backfill never reached — the D1 payload tells them
    // apart, since an empty layer is 35 characters and real ink is more.
    if (r.d1_len > HAS_INK_BYTES) {
      problems.push(`${r.id}: byte_length 0 but D1 still holds ${r.d1_len} bytes — backfill missed it`);
    } else {
      empty++;
    }
    continue;
  }

  const body = r2(key);
  if (body === null) {
    // Before `026` this is survivable — the read path falls back to D1 — so
    // it's only fatal once that column has been blanked.
    if (r.d1_len > 0) { fallback++; continue; }
    problems.push(`${r.id}: no object at ${key}, and no D1 fallback left`);
    continue;
  }

  if (body.length !== r.byte_length) {
    problems.push(`${r.id}: byte_length says ${r.byte_length}, object is ${body.length}`);
    continue;
  }

  let parsed;
  try { parsed = JSON.parse(body); } catch {
    problems.push(`${r.id}: object is not valid JSON`);
    continue;
  }
  if (!Array.isArray(parsed.s)) {
    problems.push(`${r.id}: object has no stroke array`);
    continue;
  }
  if (typeof parsed.rev === "number" && parsed.rev > r.rev) {
    problems.push(`${r.id}: object is at rev ${parsed.rev}, ahead of the row's ${r.rev}`);
    continue;
  }
  withInk++;
}

console.log(`  ${withInk} verified against R2`);
console.log(`  ${empty} empty (no object expected)`);
if (fallback) console.log(`  ${fallback} still reading from the D1 fallback — do not run 026 yet`);

if (problems.length) {
  console.log(`\n${problems.length} problem${problems.length === 1 ? "" : "s"}:`);
  for (const p of problems) console.log(`  ${p}`);
  process.exit(1);
}
console.log("\nEvery layer accounted for.");
