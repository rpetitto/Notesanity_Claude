/**
 * Links on a page.
 *
 * A `link` field is a region of the page that opens an address. It carries no
 * words of its own: it sits over the words or the picture it names, which the
 * page already shows. That is exactly the shape of a link in a PDF, which is
 * why one field type serves both ways a link arrives — a teacher drags one out
 * in the editor, or an uploaded file brings its own, read out of the PDF's link
 * annotations in the browser and handed over alongside the page sizes.
 *
 * `content` holds the address and `label` the words it covers, which is what a
 * screen reader announces and what the editor calls it.
 */

import { normalizeLink } from "../../shared/links.mjs";
import { sanitizeRichText } from "./richtext";
import { HttpError } from "./session";

/** Far more than any real worksheet has; a bound on a malformed file, not a product limit. */
export const MAX_LINKS_PER_PAGE = 100;
const MAX_LINK_LABEL = 200;

/**
 * What a field's `content` column holds, by type.
 *
 * Rich text is markup and goes through the sanitiser. A link is an address
 * and must not: the sanitiser escapes `&` for HTML, which is right inside
 * markup and corrupts a bare URL. Everything else has no content.
 *
 * An empty link is allowed — it is what exists between dragging the box out
 * and typing the address into it — and renders as nothing a student can press.
 */
export function fieldContent(type: string, raw: unknown): string {
  if (type === "link") {
    if (raw === undefined || raw === null || (typeof raw === "string" && !raw.trim())) return "";
    const href = normalizeLink(raw);
    if (!href) {
      throw new HttpError(400, "A link needs a web address (like khanacademy.org/…) or an email address (mailto:…).");
    }
    return href;
  }
  return sanitizeRichText(typeof raw === "string" ? raw : "");
}

/** A link's words, as a label: plain text, one line, bounded. */
export function linkLabel(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, MAX_LINK_LABEL) : "";
}

export interface KeptLink {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  content: string;
}

/**
 * The links worth keeping from one imported page.
 *
 * They come from a file, not from a person, so one we won't keep is dropped
 * rather than refused: failing a forty-page upload over one odd annotation
 * would lose the pages to save a link. Boxes are clamped to the page, because
 * annotation rectangles in real files overhang the edge by a point or two.
 */
export function importedLinks(page: { width: number; height: number; links?: unknown }): KeptLink[] {
  const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  if (!Array.isArray(page.links) || !finite(page.width) || !finite(page.height)) return [];
  const out: KeptLink[] = [];
  const seen = new Set<string>();
  for (const raw of page.links.slice(0, MAX_LINKS_PER_PAGE)) {
    const l = (raw ?? {}) as Record<string, unknown>;
    const href = normalizeLink(l.url);
    if (!href || !finite(l.x) || !finite(l.y) || !finite(l.w) || !finite(l.h)) continue;
    const x = Math.max(0, l.x);
    const y = Math.max(0, l.y);
    const w = Math.min(page.width, l.x + l.w) - x;
    const h = Math.min(page.height, l.y + l.h) - y;
    if (w < 2 || h < 2) continue;
    // Some writers emit the same annotation twice; one press should open one tab.
    const key = `${Math.round(x)}:${Math.round(y)}:${Math.round(w)}:${Math.round(h)}:${href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ x, y, w, h, label: linkLabel(l.label), content: href });
  }
  return out;
}
