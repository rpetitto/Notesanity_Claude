/**
 * What counts as a link a student can be sent to.
 *
 * One rule, read by the worker (which is the authority: nothing else is
 * stored), by the editor (so a teacher sees the address it will actually
 * save while typing it), and by the PDF import (so a file's links are
 * filtered before they are sent at all). It is the same rule rich text
 * already applies to its anchors: http, https or mailto, and nothing else —
 * a `javascript:` or `file:` link in an uploaded worksheet is not something
 * to put under a pupil's finger.
 */

/** Long enough for any real address, including tracked ones; a bound, not a style rule. */
export const MAX_LINK_LENGTH = 2048;

/**
 * The address as it will be stored, or null when it isn't one.
 *
 * A bare domain ("khanacademy.org/…", "www.pbs.org") is what people type
 * and paste, so it is read as https rather than refused. Anything with some
 * other scheme is refused rather than guessed at.
 */
export function normalizeLink(input) {
  if (typeof input !== "string") return null;
  let s = input.trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    // No scheme. Only something shaped like a host becomes https — a stray
    // word must not turn into "https://homework".
    if (!/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#]|$)/i.test(s)) return null;
    s = `https://${s}`;
  }
  let url;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (url.protocol === "mailto:") return url.pathname.includes("@") ? url.href.slice(0, MAX_LINK_LENGTH) : null;
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname.includes(".") && url.hostname !== "localhost") return null;
  return url.href.length > MAX_LINK_LENGTH ? null : url.href;
}

/** "khanacademy.org" for a web address, the address itself for mail — how a link is named when it has no words of its own. */
export function linkHost(href) {
  try {
    const url = new URL(href);
    if (url.protocol === "mailto:") return url.pathname;
    return url.hostname.replace(/^www\./, "");
  } catch {
    return href;
  }
}
