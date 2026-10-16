/**
 * What a saved page is made of.
 *
 * A library entry is a *snapshot*, not a reference to the page it came from.
 * Editing the original afterwards doesn't reach back into the library, and
 * deleting the notebook it came from doesn't empty it — which is the whole
 * point of saving a page you intend to use again next year.
 *
 * The fields and the teacher's markup ride along as JSON rather than as rows in
 * `fields`/`page_annotations`, because nothing ever queries into them: an entry
 * is only ever written whole and read whole. Rows would mean three tables to
 * keep in step and garbage collect, for no question they could answer.
 */

/** Enough for a career's worth of worksheets; a bound on runaway growth, not a product limit. */
export const MAX_LIBRARY_PAGES = 500;

/** A field as it sits in the library — the `fields` row minus its ids. */
export interface LibraryField {
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  options: string;
  prompt: string;
  content: string;
  /** A library-owned copy of the original's media, or null when it had none. */
  media_key: string | null;
}

/**
 * A key is unique only within its prefix, so the whole path is flattened rather
 * than just its last segment.
 */
const flatten = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, "-").slice(-100);

/**
 * Where a library copy of a source document lives.
 *
 * Derived from the source key rather than from the entry, so every page saved
 * out of the same PDF shares one copy. A teacher pulling ten worksheets out of
 * one scanned packet would otherwise store that packet ten times — and wait for
 * a 25 MB round trip on each save instead of only the first.
 */
export const libraryAssetKey = (ownerId: string, sourceKey: string) =>
  `library/${ownerId}/assets/${flatten(sourceKey)}`;

/** Field media is per-field and small, so it needs no sharing. */
export const libraryMediaKey = (ownerId: string, sourceKey: string) =>
  `library/${ownerId}/media/${flatten(sourceKey)}`;
