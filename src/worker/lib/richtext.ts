/**
 * Sanitising teacher-authored rich text.
 *
 * A rich text block is markup written by one person and rendered in everyone
 * else's browser, which makes it an injection boundary — a teacher account, or
 * anything that gets hold of one, must not be able to run script in a pupil's
 * session. So the markup is cleaned on the way *in* and stored clean: the
 * database never holds anything we wouldn't be willing to render.
 *
 * The rule is an allowlist, and it fails closed. A tag that isn't listed is
 * dropped (its text is kept, as text); an attribute that isn't listed is
 * dropped; a URL that isn't plainly http/https/mailto is dropped. Exotic input
 * may come out mangled — that is the intended trade, since the alternative to
 * mangling is trusting it.
 */

/** Tags a teacher may use. Deliberately small: structure and emphasis, no style. */
const ALLOWED_TAGS = new Set([
  "p", "br", "strong", "b", "em", "i", "u", "s", "sub", "sup",
  "ul", "ol", "li", "h1", "h2", "h3", "blockquote", "a",
]);

/** Only `a` carries an attribute, and only this one. */
const ALLOWED_HREF = /^(https?:\/\/|mailto:)/i;

/** Tags whose *content* is code, not text, and so must go with them. */
const VOID_CONTENT_TAGS = new Set(["script", "style", "iframe", "object", "embed", "template"]);

const escapeText = (s: string) =>
  s.replace(/&(?!(?:#\d+|#x[0-9a-f]+|[a-z]+);)/gi, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const escapeAttr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const MAX_RICHTEXT_BYTES = 32 * 1024;

export function sanitizeRichText(input: string): string {
  if (!input) return "";
  // Drop script/style/iframe wholesale — content included — before anything
  // else, so their bodies never survive as visible text.
  let html = input;
  for (const tag of VOID_CONTENT_TAGS) {
    html = html.replace(new RegExp(`<${tag}\\b[\\s\\S]*?(?:</${tag}\\s*>|$)`, "gi"), "");
  }
  // Comments can hide markup from a naive reader; they carry nothing we want.
  html = html.replace(/<!--[\s\S]*?(?:-->|$)/g, "");

  let out = "";
  let cursor = 0;
  // No whitespace is allowed between `<` and the name, matching how a browser
  // parses: `a < b` is prose, not the start of a tag, and must survive as prose.
  const tagPattern = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let m: RegExpExecArray | null;

  while ((m = tagPattern.exec(html)) !== null) {
    out += escapeText(html.slice(cursor, m.index));
    cursor = m.index + m[0].length;

    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    if (!ALLOWED_TAGS.has(name)) continue; // text around it is kept; the tag is not

    if (closing) {
      if (name !== "br") out += `</${name}>`;
      continue;
    }
    if (name === "br") {
      out += "<br>";
      continue;
    }
    if (name === "a") {
      const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[3] ?? "");
      const url = (href?.[1] ?? href?.[2] ?? href?.[3] ?? "").trim();
      // A link that doesn't survive validation still renders — as an anchor
      // without a destination, rather than silently losing the teacher's words.
      out += ALLOWED_HREF.test(url)
        ? `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer nofollow">`
        : "<a>";
      continue;
    }
    out += `<${name}>`;
  }
  out += escapeText(html.slice(cursor));
  return out.slice(0, MAX_RICHTEXT_BYTES);
}
