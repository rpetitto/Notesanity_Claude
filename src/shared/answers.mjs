/**
 * Answer keys: what a box's right answer is, and whether an answer matches.
 *
 * Read by the worker (to check work and suggest a score) and by the SPA (to
 * show a teacher, box by box, what the key decided). A key lives on the box as
 * JSON and is never sent to students:
 *
 * - text and prompt boxes: `{ accept: ["4", "four"] }` — any of these.
 * - dropdowns: `{ accept: ["Mitochondria"] }` — the right option(s).
 * - checkboxes: `{ checked: true }` — ticked is right (or `false`: left blank).
 *
 * Matching forgives what a teacher grading by hand would: case, spacing,
 * trailing punctuation, quotes, and — where both sides are numbers — the way
 * the number is written (0.5, .5, 1/2, 1,000, $5). Anything subtler is the
 * teacher's call, which is why every mark can be overridden.
 */

export const KEYABLE = new Set(["text", "prompt", "choice", "checkbox"]);

/** The key stored on a box, or null when it has none (or it can't be read). */
export function parseKey(type, raw) {
  if (!raw || !KEYABLE.has(type)) return null;
  let k;
  try { k = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return null; }
  if (!k || typeof k !== "object") return null;
  if (type === "checkbox") return typeof k.checked === "boolean" ? { checked: k.checked } : null;
  const accept = Array.isArray(k.accept) ? k.accept.map((a) => String(a ?? "").trim()).filter(Boolean).slice(0, 50) : [];
  return accept.length ? { accept } : null;
}

/** A key as it's stored: clean JSON, or "" for none. */
export function serializeKey(type, key) {
  const k = parseKey(type, key);
  return k ? JSON.stringify(k) : "";
}

/**
 * An answer as matching sees it — the form two answers share when the check
 * would treat them alike. Also how the check view groups identical answers.
 */
export const normalizeAnswer = (s) => normalize(s);

const normalize = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[‘’“”"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s.,;:!?]+|[\s.,;:!?]+$/g, "");

/** A number written any of the usual ways, or null if it isn't one. */
function asNumber(s) {
  const t = String(s ?? "").trim().replace(/^\$/, "").replace(/,/g, "").replace(/\s+/g, " ");
  if (!t) return null;
  const mixed = /^(-?\d+) (\d+)\/(\d+)$/.exec(t);
  if (mixed) {
    const [w, n, d] = [Number(mixed[1]), Number(mixed[2]), Number(mixed[3])];
    return d ? Math.sign(w || 1) * (Math.abs(w) + n / d) : null;
  }
  const frac = /^(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/.exec(t);
  if (frac) return Number(frac[2]) ? Number(frac[1]) / Number(frac[2]) : null;
  return /^-?(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : null;
}

/**
 * Does this answer match the box's key? true or false, or null when the box
 * has no key. An empty answer is wrong, not unknown: the question was there.
 */
export function checkAnswer(type, rawKey, value) {
  const key = parseKey(type, rawKey);
  if (!key) return null;
  if (type === "checkbox") return (value === "1") === key.checked;
  const v = String(value ?? "");
  if (!v.trim()) return false;
  if (type === "choice") return key.accept.some((a) => normalize(a) === normalize(v));
  const n = asNumber(v);
  return key.accept.some((a) => {
    if (normalize(a) === normalize(v)) return true;
    const m = asNumber(a);
    return n !== null && m !== null && Math.abs(n - m) <= 1e-9 * Math.max(1, Math.abs(m));
  });
}

/** A percentage as the letter it earns: the usual 90/80/70/60 cut-offs. */
export function letterFor(percent) {
  if (percent >= 90) return "A";
  if (percent >= 80) return "B";
  if (percent >= 70) return "C";
  if (percent >= 60) return "D";
  return "F";
}
