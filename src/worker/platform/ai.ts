/**
 * Designing worksheet pages with a language model.
 *
 * Same shape as email and billing: the application asks for a page design and
 * this file decides who draws it. Today that is Anthropic's Claude, reached
 * with ANTHROPIC_API_KEY (a Worker secret, never in wrangler.jsonc). Locally,
 * and in tests, AI_STANDIN=1 swaps in a stand-in that lays out a plain page
 * from the request without calling anyone, so the whole flow runs and can be
 * tested for free.
 *
 * What goes out is only what the teacher typed or attached for this page: the
 * description, grade, subject, and the source material they chose. Nothing
 * about their students, their classes or their other notebooks is sent.
 *
 * The model returns each page as SVG plus the rectangles where students
 * answer, in page points. The browser turns the SVG into a PDF page and the
 * rectangles into answer boxes; nothing here touches storage.
 */

import Anthropic from "@anthropic-ai/sdk";
import { currentEnv } from "./context";

export type AiPageKind = "reading" | "vocabulary" | "organizer" | "math" | "lab" | "exit" | "custom";

export interface AiSourceFile {
  /** application/pdf, image/png, image/jpeg, image/webp or image/gif. */
  mediaType: string;
  /** Base64, without a data: prefix. */
  data: string;
}

export interface AiPageRequest {
  kind: AiPageKind;
  description: string;
  grade: string;
  subject: string;
  pageCount: number;
  pageWidth: number;
  pageHeight: number;
  sourceText?: string;
  sourceFile?: AiSourceFile;
}

export interface AiAnswer {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "text" | "checkbox";
  label: string;
}

export interface AiPage {
  svg: string;
  answers: AiAnswer[];
}

export interface AiDesign {
  title: string;
  pages: AiPage[];
}

/** A failure worth showing the teacher as it is, with the status to send. */
export class AiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const AI_MODEL = "claude-opus-5-5";

/** Who would draw a page right now, or null when nobody is set up to. */
export function aiProvider(): "claude" | "standin" | null {
  const env = currentEnv() as Record<string, unknown>;
  if (env.AI_STANDIN === "1" || env.AI_STANDIN === 1) return "standin";
  if (typeof env.ANTHROPIC_API_KEY === "string" && env.ANTHROPIC_API_KEY) return "claude";
  return null;
}

/**
 * Design `req.pageCount` pages. With `previous` and an `instruction`, change
 * that design as asked rather than starting over.
 */
export async function designPages(req: AiPageRequest, previous?: AiDesign, instruction?: string): Promise<AiDesign> {
  const provider = aiProvider();
  if (!provider) throw new AiError(503, "Designing pages with AI isn't switched on yet.");
  const raw = provider === "standin" ? standIn(req, previous, instruction) : await askClaude(req, previous, instruction);
  return checked(raw, req);
}

// ---------------------------------------------------------------- the prompt

const KINDS: Record<AiPageKind, string> = {
  reading: "Reading with questions: a short passage (or an excerpt of the teacher's source), then comprehension questions with room to answer.",
  vocabulary: "Vocabulary practice: terms with space for a definition, a sentence, and/or a sketch box; or matching and fill-in-the-blank.",
  organizer: "Graphic organizer: a Venn diagram, T-chart, KWL chart, concept map, flow chart, cause-and-effect or similar, with labeled spaces to fill in.",
  math: "Math practice: numbered problems with room to show work and a clear answer space; use number lines, grids or tables where they help.",
  lab: "Lab sheet: question, hypothesis, materials, procedure, a data table, and analysis questions.",
  exit: "Exit ticket: a short check for understanding, a handful of quick items, fitting comfortably on a page.",
  custom: "Whatever the teacher describes.",
};

const SYSTEM = `You design printable classroom worksheet pages for Notesanity, where students fill them in on a tablet or laptop, writing with a stylus or typing into answer boxes laid over the page.

You return JSON matching the schema: a short title for the design, and one entry per page, each with the page as a complete SVG document and the list of answer areas on it.

THE SVG
- Root: <svg xmlns="http://www.w3.org/2000/svg" width="W" height="H" viewBox="0 0 W H"> with the W and H you are given (PDF points; 72 per inch). First child: a white <rect> covering the page.
- Only these elements: svg, g, rect, line, circle, ellipse, polyline, polygon, path, text, tspan, defs, clipPath, title. No images, no foreignObject, no scripts, no style elements, no CSS classes, no external references, no filters, no gradients, no patterns, no markers. Put styling in attributes (fill, stroke, stroke-width, stroke-dasharray, font-size, font-weight, text-anchor).
- Every text element uses font-family="Helvetica, Arial, sans-serif". Body text 12–13pt, never below 11pt. Title 20–24pt bold. Section headings 14–15pt bold.
- SVG text never wraps by itself. Break every paragraph into lines yourself with <tspan x="..." dy="..."> and keep each line inside its column: at size S, Helvetica averages about 0.5×S points per character (0.56×S bold), so a line may hold at most (column width) ÷ (0.5×S) characters. Line height 1.35×S. Leave 40pt margins on every side. Nothing may overlap or run off the page; when content won't fit, cut it or move it to the next page rather than shrinking text.
- Ink colors only: text #1f2a27; rules, outlines and grid lines #8a9692 or lighter; an optional pale fill #eef5f1 behind a heading band or table header. It must print well in black and white.

ANSWER AREAS
- Draw every place a student answers: a rule to write on (a line, stroke #8a9692), a box (a rect with a light outline), a table cell, a blank in a sentence, or a small square or circle to mark for a multiple-choice option.
- List each one in "answers" with x, y, w, h in the same coordinates, covering exactly where the student's writing goes. For a rule at height Y from X1 to X2, use x=X1, y=Y−22, w=X2−X1, h=24. For a box, its inside. For a multi-line response area of several rules, one answer covering all of them. kind is "checkbox" only for a mark-one-option square or circle (then about 14×14), "text" otherwise. label is a few words saying what goes there, like "1. Answer" or "Venn: both".
- Never put an answer area on top of printed text. Never fill one in.
- No Name, Date or Period lines: Notesanity already knows who is writing.

DIAGRAMS
- Simple drawn diagrams only: organizers, number lines, coordinate grids, tables, flow charts, labeled-blank diagrams built from basic shapes. No pictures of people, animals or objects, no clip art, no decorative icons.

CONTENT
- Accurate, at the stated grade level, in plain wording a student of that age reads easily.
- Questions and problems only. Never include answers, worked solutions or an answer key.
- When source material is attached, build the page from it: quote it faithfully and keep it short enough to fit. Otherwise write original material.
- Do exactly the number of pages asked for, each a complete, well-balanced page: use the space, but never crowd it.`;

function describe(req: AiPageRequest): string {
  const lines = [
    `Page type: ${KINDS[req.kind]}`,
    `Grade: ${req.grade || "not given"}`,
    `Subject: ${req.subject || "not given"}`,
    `Pages: ${req.pageCount}`,
    `Page size: W=${req.pageWidth}, H=${req.pageHeight}`,
    "",
    "The teacher's description:",
    req.description,
  ];
  if (req.sourceText) lines.push("", "Source material (pasted by the teacher):", req.sourceText);
  if (req.sourceFile) lines.push("", "Source material: the attached document.");
  return lines.join("\n");
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "pages"],
  properties: {
    title: { type: "string" },
    pages: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["svg", "answers"],
        properties: {
          svg: { type: "string" },
          answers: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["x", "y", "w", "h", "kind", "label"],
              properties: {
                x: { type: "number" },
                y: { type: "number" },
                w: { type: "number" },
                h: { type: "number" },
                kind: { type: "string", enum: ["text", "checkbox"] },
                label: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
};

// ---------------------------------------------------------------- Claude

async function askClaude(req: AiPageRequest, previous?: AiDesign, instruction?: string): Promise<AiDesign> {
  const env = currentEnv() as Record<string, unknown>;
  const client = new Anthropic({ apiKey: String(env.ANTHROPIC_API_KEY), maxRetries: 2 });

  const first: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (req.sourceFile) {
    first.push(
      req.sourceFile.mediaType === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: req.sourceFile.data } }
        : {
            type: "image",
            source: {
              type: "base64",
              media_type: req.sourceFile.mediaType as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
              data: req.sourceFile.data,
            },
          },
    );
  }
  first.push({ type: "text", text: describe(req) });

  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: first }];
  if (previous && instruction) {
    messages.push(
      { role: "assistant", content: JSON.stringify(previous) },
      {
        role: "user",
        content: `Change that design: ${instruction}\n\nKeep everything else as it was unless the change needs it. Return the whole design again, ${req.pageCount} page${req.pageCount === 1 ? "" : "s"}.`,
      },
    );
  }

  let message: Anthropic.Beta.BetaMessage;
  try {
    const stream = client.beta.messages.stream({
      model: AI_MODEL,
      // Room for thinking plus three pages of SVG; only what is used is billed.
      max_tokens: 64000,
      // A declined request is re-run on Anthropic's recommended fallback model
      // inside the same call, instead of coming back as a refusal.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      // The instructions are the same for every page, so they're cached.
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages,
    });
    message = await stream.finalMessage();
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) throw new AiError(429, "The page designer is busy right now. Try again in a minute.");
    if (err instanceof Anthropic.AuthenticationError) throw new AiError(503, "The page designer isn't set up correctly. Let support know.");
    if (err instanceof Anthropic.BadRequestError) {
      console.error("AI page design rejected:", err.message);
      throw new AiError(400, "That source material couldn't be read. Try a smaller PDF, a photo, or pasted text.");
    }
    if (err instanceof Anthropic.APIError) {
      console.error("AI page design failed:", err.status, err.message);
      throw new AiError(503, "The page designer couldn't be reached. Try again in a moment.");
    }
    throw err;
  }

  if (message.stop_reason === "refusal") {
    throw new AiError(422, "The designer wouldn't make that page. Try describing it differently.");
  }
  if (message.stop_reason === "max_tokens") {
    throw new AiError(422, "That design ran too long. Try fewer pages or a shorter description.");
  }
  const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  try {
    return JSON.parse(text) as AiDesign;
  } catch {
    console.error("AI page design returned unreadable JSON:", text.slice(0, 500));
    throw new AiError(502, "The design came back garbled. Try again.");
  }
}

// ---------------------------------------------------------------- stand-in

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * A plain but real page: a title, the description, and numbered items each
 * with a rule to answer on. Deterministic, so tests can count its boxes; a
 * refinement adds a line quoting the instruction, so tests can see it landed.
 */
function standIn(req: AiPageRequest, previous?: AiDesign, instruction?: string): AiDesign {
  // Lets a test see what happens when the model fails.
  if (req.description.includes("[stand-in: fail]")) throw new AiError(503, "The page designer couldn't be reached. Try again in a moment.");
  const W = req.pageWidth;
  const H = req.pageHeight;
  const changes = previous && instruction ? [instruction] : [];
  const title = req.description.split(/[.,\n]/)[0].slice(0, 60).trim() || "Practice page";
  const items = Math.max(1, Math.min(8, Number(/(\d+)\s*(problems|questions|items)/i.exec(req.description)?.[1] ?? 4)));
  const pages: AiPage[] = [];
  for (let p = 0; p < req.pageCount; p++) {
    const parts: string[] = [`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`];
    const answers: AiAnswer[] = [];
    parts.push(`<text x="40" y="70" font-family="Helvetica, Arial, sans-serif" font-size="22" font-weight="bold" fill="#1f2a27">${esc(title)}${req.pageCount > 1 ? ` (${p + 1})` : ""}</text>`);
    let y = 100;
    for (const line of [`${req.subject || "Class"} · ${req.grade || "Any grade"}`, ...changes.map((c) => `Changed: ${c}`)]) {
      parts.push(`<text x="40" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="12" fill="#1f2a27">${esc(line.slice(0, 80))}</text>`);
      y += 20;
    }
    y += 20;
    const gap = Math.min(80, (H - 60 - y) / items);
    for (let i = 0; i < items; i++) {
      parts.push(`<text x="40" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="#1f2a27">${i + 1}. Item ${i + 1}</text>`);
      const ry = y + 36;
      parts.push(`<line x1="60" y1="${ry}" x2="${W - 40}" y2="${ry}" stroke="#8a9692" stroke-width="1"/>`);
      answers.push({ x: 60, y: ry - 22, w: W - 100, h: 24, kind: "text", label: `${i + 1}. Answer` });
      y += gap;
    }
    pages.push({
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join("")}</svg>`,
      answers,
    });
  }
  return { title, pages };
}

// ---------------------------------------------------------------- checking

/** Anything that could run or reach out, which no worksheet needs. */
const FORBIDDEN = /<\s*(script|foreignObject|image|iframe|style|use|a)\b|\son[a-z]+\s*=|javascript:|(?:xlink:)?href\s*=\s*["'](?!#)|url\(\s*["']?(?!#)/i;

/**
 * Trust nothing about the shape of what came back: the browser draws these
 * pages, so a design is kept only when every page is plainly an SVG with
 * nothing active in it, and answer boxes are clipped to the page or dropped.
 */
function checked(design: AiDesign, req: AiPageRequest): AiDesign {
  const pages = Array.isArray(design?.pages) ? design.pages.slice(0, req.pageCount) : [];
  if (!pages.length) throw new AiError(502, "The design came back empty. Try again.");
  const W = req.pageWidth;
  const H = req.pageHeight;
  const ok = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  return {
    title: String(design.title ?? "").slice(0, 120) || "AI page",
    pages: pages.map((p) => {
      const svg = String(p?.svg ?? "").trim();
      if (!/^<svg[\s>]/i.test(svg) || !/<\/svg>\s*$/i.test(svg) || FORBIDDEN.test(svg)) {
        throw new AiError(502, "The design came back in a form Notesanity can't use. Try again.");
      }
      const answers = (Array.isArray(p.answers) ? p.answers : [])
        .filter((a) => a && [a.x, a.y, a.w, a.h].every(ok) && a.w > 2 && a.h > 2)
        .map((a) => {
          const x = Math.max(0, Math.min(a.x, W - 4));
          const y = Math.max(0, Math.min(a.y, H - 4));
          return {
            x, y,
            w: Math.min(a.w, W - x),
            h: Math.min(a.h, H - y),
            kind: a.kind === "checkbox" ? ("checkbox" as const) : ("text" as const),
            label: String(a.label ?? "").slice(0, 80),
          };
        })
        .slice(0, 120);
      return { svg, answers };
    }),
  };
}
