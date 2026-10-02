/**
 * Export the Fling production database as SQL that D1 can replay.
 *
 * Fling's CLI can only run queries, so the dump is built here: read every row
 * of every application table and emit INSERTs for it. Written as a one-off
 * migration tool rather than something maintained — it exists to move this
 * data once, and to be re-runnable while that is being verified.
 *
 * `_migrations` is deliberately NOT carried across, and there are two ways to
 * get the order wrong — I made the second mistake, so both are written down.
 *
 * Import it into an empty database and the runner is told all seventeen have
 * run, so it creates no tables: an import that reports success and leaves
 * nothing behind it.
 *
 * Build the schema by hand without recording those seventeen as applied, and
 * the runner does the opposite — it runs them all against data that is already
 * there. Three of them are data migrations, not schema ones, and
 * `008_brand_accents` duly rewrote four rows' accent colours after they had
 * been correctly imported.
 *
 * The only safe order is: let the migrations build the schema themselves, on an
 * empty database, so `_migrations` is populated as a side effect of the work it
 * describes. Then import this data. Then nothing re-runs, because the runner
 * can see what has already happened.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const OUT = process.argv[2] ?? "/tmp/fling-export.sql";

/** Ask production for something, as JSON. */
function query(sql) {
  const raw = execFileSync(
    "npx",
    ["fling", "--cli", "--prod", "db", "sql", sql, "--json"],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  // The CLI prints its own banner lines around the JSON, so take the payload.
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1) throw new Error(`No JSON in response to: ${sql}\n${raw.slice(0, 400)}`);
  const parsed = JSON.parse(raw.slice(start, end + 1));
  return parsed.results ?? parsed.rows ?? [];
}

/** SQLite literal for a value coming back from JSON. */
function literal(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  // Everything else is text. Escaping quotes is the whole job; the values here
  // include JSON ink layers, which are full of them.
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** Vendor scaffolding that has no counterpart on the new platform. */
const SKIP = new Set(["_migrations", "_workflow_events", "example"]);

const tables = query(
  `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name`,
)
  .map((r) => r.name)
  .filter((t) => !SKIP.has(t));

const lines = [
  "-- Notesanity: Fling production data, exported for Cloudflare D1.",
  "PRAGMA defer_foreign_keys = true;",
  "",
];

const counts = {};
for (const table of tables) {
  const rows = query(`SELECT * FROM "${table}"`);
  counts[table] = rows.length;
  if (rows.length === 0) continue;

  lines.push(`-- ${table}: ${rows.length} row${rows.length === 1 ? "" : "s"}`);
  const columns = Object.keys(rows[0]);
  const colList = columns.map((c) => `"${c}"`).join(", ");
  for (const row of rows) {
    const values = columns.map((c) => literal(row[c])).join(", ");
    // INSERT OR REPLACE so a partial import can simply be run again.
    lines.push(`INSERT OR REPLACE INTO "${table}" (${colList}) VALUES (${values});`);
  }
  lines.push("");
}

writeFileSync(OUT, lines.join("\n"));

console.log(`wrote ${OUT}`);
for (const t of tables) console.log(`  ${String(counts[t]).padStart(6)}  ${t}`);
console.log(`  ${String(Object.values(counts).reduce((a, b) => a + b, 0)).padStart(6)}  TOTAL`);
