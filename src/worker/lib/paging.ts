/**
 * Shared paging/search machinery for the two admin consoles — the superadmin
 * one in routes/admin.ts and the per-school one in routes/org-admin.ts. Both
 * need identical windowing and search behavior; lifted here once rather than
 * kept as two copies that would otherwise drift apart.
 */
import { db } from "../platform";

const PAGE_DEFAULT = 100;
const PAGE_MAX = 500;

export function paging(c: any): { limit: number; offset: number; q: string } {
  const url = new URL(c.req.url);
  // An absent parameter has to be caught before Number(), which reads both null
  // and "" as 0 and would otherwise turn "no limit given" into a limit of zero.
  const asInt = (raw: string | null, fallback: number) => {
    if (raw === null || raw.trim() === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
  };
  return {
    limit: Math.min(PAGE_MAX, Math.max(1, asInt(url.searchParams.get("limit"), PAGE_DEFAULT))),
    offset: asInt(url.searchParams.get("offset"), 0),
    q: (url.searchParams.get("q") ?? "").trim().slice(0, 100),
  };
}

/** A case-insensitive contains-match across the columns worth searching. */
export function search(q: string, columns: string[]): { where: string; params: string[] } {
  if (!q) return { where: "", params: [] };
  const like = `%${q}%`;
  return {
    where: `WHERE (${columns.map((col) => `${col} LIKE ?`).join(" OR ")})`,
    params: columns.map(() => like),
  };
}

/**
 * Run one windowed query and its matching count.
 *
 * The count uses the same FROM and WHERE as the page, so the total someone
 * reads always describes the rows they are actually looking through.
 *
 * `scope` is a bare SQL condition (no leading `WHERE`/`AND`) ANDed onto the
 * free-text search clause — the org-scoped console uses it to pin every
 * query to the caller's own `org_id`, which a free-text search box has no
 * way to express.
 */
export async function page(
  c: any,
  opts: {
    select: string; from: string; searchable: string[]; order: string;
    scope?: { condition: string; params: unknown[] };
  },
) {
  const { limit, offset, q } = paging(c);
  const searched = search(q, opts.searchable);

  const conditions = [
    opts.scope?.condition,
    searched.where ? searched.where.replace(/^WHERE /, "") : null,
  ].filter((c): c is string => Boolean(c));
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const params = [...(opts.scope?.params ?? []), ...searched.params];

  const rows = await db
    .prepare(`SELECT ${opts.select} FROM ${opts.from} ${where} ORDER BY ${opts.order} LIMIT ? OFFSET ?`)
    .bind(...params, limit, offset)
    .all<any>();

  const counted = await db
    .prepare(`SELECT COUNT(*) AS n FROM ${opts.from} ${where}`)
    .bind(...params)
    .first<{ n: number }>();

  return c.json({ rows: rows.results ?? [], total: counted?.n ?? 0, limit, offset });
}
