/**
 * Design a page with AI.
 *
 * A teacher describes a page; the model lays it out; the teacher looks at it,
 * refines it in plain words, and adds it. Adding goes through the ordinary
 * routes — the browser turns the design into a PDF, uploads it as a notebook
 * asset, creates the pages and places the answer boxes — so nothing here
 * writes to a notebook.
 *
 * The allowance is pages per calendar month, counted when a new design is
 * made (that is when the model is paid for), handed back if the design fails,
 * and not spent again by refining or retrying the same design.
 */

import { app, db } from "../platform";
import { aiProvider, designPages, AiError, type AiDesign, type AiPageKind, type AiPageRequest, type AiSourceFile } from "../platform/ai";
import { handler, now, uid, requireTeacher, HttpError, param, type AppUser } from "../lib/session";
import { planForUser } from "../lib/plans";
import { notebookAccess, requireNotebookTeacher } from "./notebooks";
import { AI_PAGES_FREE, AI_PAGES_PAID } from "../../shared/plans.mjs";

const KINDS: AiPageKind[] = ["reading", "vocabulary", "organizer", "math", "lab", "exit", "custom"];
const MAX_PAGES = 3;
const MAX_REFINEMENTS = 10;
const MAX_DESCRIPTION = 2000;
const MAX_SOURCE_TEXT = 30_000;
/** Base64 runs a third larger than the file: about 10MB of PDF or photo. */
const MAX_SOURCE_BASE64 = 14_000_000;
const SOURCE_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"];
/** Designs are scratch work; a week is long enough to come back to one. */
const KEEP_DESIGNS_MS = 7 * 24 * 3600 * 1000;

const month = () => now().slice(0, 7);

async function allowanceFor(user: AppUser) {
  const plan = await planForUser(user);
  const limit = plan.tier === "free" ? AI_PAGES_FREE : AI_PAGES_PAID;
  const row = await db
    .prepare(`SELECT pages FROM ai_usage WHERE user_id = ? AND month = ?`)
    .bind(user.id, month())
    .first<{ pages: number }>();
  const used = row?.pages ?? 0;
  return { used, limit, remaining: Math.max(0, limit - used), paid: plan.tier !== "free" };
}

/**
 * Take `pages` from this month's allowance, or nothing at all. One statement,
 * so two designs started at once can't both squeeze under the limit.
 */
async function spend(userId: string, pages: number, limit: number): Promise<boolean> {
  const m = month();
  if (pages > limit) return false;
  const res = await db
    .prepare(
      `INSERT INTO ai_usage (user_id, month, pages, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, month) DO UPDATE SET pages = pages + excluded.pages, updated_at = excluded.updated_at
       WHERE ai_usage.pages + excluded.pages <= ?`,
    )
    .bind(userId, m, pages, now(), limit)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

async function refund(userId: string, pages: number) {
  await db
    .prepare(`UPDATE ai_usage SET pages = MAX(0, pages - ?), updated_at = ? WHERE user_id = ? AND month = ?`)
    .bind(pages, now(), userId, month())
    .run();
}

/** The paper the new pages will be printed on: the page they go after, or the notebook's first. */
async function paperFor(notebookId: string, afterPageId?: string | null) {
  const row = afterPageId
    ? await db.prepare(`SELECT width, height FROM pages WHERE id = ? AND notebook_id = ?`).bind(afterPageId, notebookId)
        .first<{ width: number; height: number }>()
    : await db.prepare(`SELECT width, height FROM pages WHERE notebook_id = ? AND archived = 0 ORDER BY seq LIMIT 1`).bind(notebookId)
        .first<{ width: number; height: number }>();
  return { pageWidth: Math.round(row?.width ?? 612), pageHeight: Math.round(row?.height ?? 792) };
}

/** The teacher's source material, checked; never stored. */
function sourceFrom(body: { sourceText?: unknown; sourceFile?: unknown }) {
  const sourceText = typeof body.sourceText === "string" ? body.sourceText.trim() : "";
  if (sourceText.length > MAX_SOURCE_TEXT) throw new HttpError(400, "That's more text than one design can use. Paste a shorter passage.");
  let sourceFile: AiSourceFile | undefined;
  const f = body.sourceFile as Partial<AiSourceFile> | undefined;
  if (f) {
    if (typeof f.mediaType !== "string" || !SOURCE_TYPES.includes(f.mediaType)) {
      throw new HttpError(400, "Attach a PDF or a photo (PNG, JPEG, WebP or GIF).");
    }
    if (typeof f.data !== "string" || !f.data || f.data.length > MAX_SOURCE_BASE64 || !/^[A-Za-z0-9+/=]+$/.test(f.data.slice(0, 200))) {
      throw new HttpError(400, "That file is too large. Attach one under 10MB.");
    }
    sourceFile = { mediaType: f.mediaType, data: f.data };
  }
  return { sourceText: sourceText || undefined, sourceFile };
}

function aiFailure(c: any, err: unknown) {
  if (err instanceof AiError) return c.json({ error: err.message }, err.status as any);
  throw err;
}

/** What the designer would do for this teacher right now, and the class's grade and subject to start from. */
app.get("/api/ai/allowance", handler(async (c) => {
  const user = await requireTeacher(c);
  const allowance = await allowanceFor(user);
  let grade = "";
  let subject = "";
  const notebookId = c.req.query("notebookId");
  if (notebookId) {
    const cls = await db
      .prepare(`SELECT c.level, c.subject FROM notebooks n JOIN classes c ON c.id = n.class_id WHERE n.id = ? AND n.owner_id = ?`)
      .bind(notebookId, user.id)
      .first<{ level: string; subject: string }>();
    grade = cls?.level ?? "";
    subject = cls?.subject ?? "";
  }
  return c.json({ ...allowance, available: !!aiProvider(), grade, subject });
}));

/** Start a design. Spends its pages from the month's allowance. */
app.post("/api/ai/designs", handler(async (c) => {
  const user = await requireTeacher(c);
  const body = await c.req.json<{
    notebookId?: string; insertAfterPageId?: string | null;
    kind?: string; description?: string; grade?: string; subject?: string; pageCount?: number;
    sourceText?: string; sourceFile?: AiSourceFile;
  }>();
  const { nb } = requireNotebookTeacher(await notebookAccess(c, String(body.notebookId ?? "")));

  const kind = KINDS.includes(body.kind as AiPageKind) ? (body.kind as AiPageKind) : "custom";
  const description = String(body.description ?? "").trim();
  if (!description) throw new HttpError(400, "Describe the page you want");
  if (description.length > MAX_DESCRIPTION) throw new HttpError(400, "Keep the description under 2,000 characters");
  const pageCount = Math.floor(Number(body.pageCount ?? 1));
  if (!(pageCount >= 1 && pageCount <= MAX_PAGES)) throw new HttpError(400, `Ask for 1 to ${MAX_PAGES} pages`);

  if (!aiProvider()) throw new HttpError(503, "Designing pages with AI isn't switched on yet.");

  const req: AiPageRequest = {
    kind, description, pageCount,
    grade: String(body.grade ?? "").trim().slice(0, 40),
    subject: String(body.subject ?? "").trim().slice(0, 60),
    ...(await paperFor(nb.id, body.insertAfterPageId)),
    ...sourceFrom(body),
  };

  const allowance = await allowanceFor(user);
  if (!(await spend(user.id, pageCount, allowance.limit))) {
    return c.json({
      error: allowance.remaining > 0
        ? `You have ${allowance.remaining} AI page${allowance.remaining === 1 ? "" : "s"} left this month. Ask for fewer pages.`
        : allowance.paid
          ? "You've used this month's AI pages. They come back on the 1st."
          : "You've used your free AI page this month. Upgrade to Pro for more.",
      code: "ai_limit",
      ...allowance,
    }, 403);
  }

  let design: AiDesign;
  try {
    design = await designPages(req);
  } catch (err) {
    await refund(user.id, pageCount);
    return aiFailure(c, err);
  }

  const id = uid();
  const { sourceFile, ...kept } = req;
  await db.batch([
    db.prepare(`DELETE FROM ai_designs WHERE user_id = ? AND created_at < ?`)
      .bind(user.id, new Date(Date.now() - KEEP_DESIGNS_MS).toISOString()),
    db.prepare(
      `INSERT INTO ai_designs (id, user_id, notebook_id, request, result, refinements, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    ).bind(id, user.id, nb.id, JSON.stringify({ ...kept, hadFile: !!sourceFile }), JSON.stringify(design), now(), now()),
  ]);
  return c.json({ id, design, refinementsLeft: MAX_REFINEMENTS, allowance: await allowanceFor(user) });
}));

/**
 * Change a design in plain words, or (with no instruction) try it again from
 * the start. Free: the allowance was spent when the design was made. The
 * source material is the browser's to send again; it was never stored.
 */
app.post("/api/ai/designs/:id/refine", handler(async (c) => {
  const user = await requireTeacher(c);
  const row = await db
    .prepare(`SELECT * FROM ai_designs WHERE id = ? AND user_id = ?`)
    .bind(param(c, "id"), user.id)
    .first<{ id: string; request: string; result: string; refinements: number }>();
  if (!row) throw new HttpError(404, "That design has expired. Start a new one.");
  if (row.refinements >= MAX_REFINEMENTS) {
    throw new HttpError(429, "That's as many changes as one design gets. Add it and edit it, or start a new design.");
  }
  if (!aiProvider()) throw new HttpError(503, "Designing pages with AI isn't switched on yet.");

  const body = await c.req.json<{ instruction?: string; sourceText?: string; sourceFile?: AiSourceFile }>();
  const instruction = String(body.instruction ?? "").trim();
  if (instruction.length > 1000) throw new HttpError(400, "Keep the change under 1,000 characters");
  const stored = JSON.parse(row.request) as AiPageRequest & { hadFile?: boolean };
  const { hadFile: _hadFile, ...base } = stored;
  const req: AiPageRequest = { ...base, ...sourceFrom(body) };

  // Claim the refinement before the slow part, so two at once can't both
  // slip in under the cap.
  const claimed = await db
    .prepare(`UPDATE ai_designs SET refinements = refinements + 1, updated_at = ? WHERE id = ? AND refinements < ?`)
    .bind(now(), row.id, MAX_REFINEMENTS)
    .run();
  if (!(claimed.meta?.changes ?? 0)) throw new HttpError(429, "That's as many changes as one design gets.");

  let design: AiDesign;
  try {
    design = instruction ? await designPages(req, JSON.parse(row.result) as AiDesign, instruction) : await designPages(req);
  } catch (err) {
    await db.prepare(`UPDATE ai_designs SET refinements = MAX(0, refinements - 1) WHERE id = ?`).bind(row.id).run();
    return aiFailure(c, err);
  }
  await db.prepare(`UPDATE ai_designs SET result = ?, updated_at = ? WHERE id = ?`).bind(JSON.stringify(design), now(), row.id).run();
  return c.json({ id: row.id, design, refinementsLeft: MAX_REFINEMENTS - row.refinements - 1 });
}));
