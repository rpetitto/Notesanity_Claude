import { layout } from "../layout.mjs";
import { BETA_FREE } from "../../src/shared/plans.mjs";
import { lessonLoop } from "./lesson-loop.mjs";

/**
 * The landing page.
 *
 * The hero does two things a static page usually can't: it rotates the noun in
 * the headline, and it shows the product rather than describing it.
 *
 * The rotating word is typed over a real one. `notebooks` is in the HTML, so a
 * crawler, a link preview, and anyone without JavaScript read a complete
 * headline; the script only takes over afterwards.
 *
 * It sits at the end of its line by design. The first attempt kept it mid-
 * sentence and reserved the width of the longest word so the rest of the line
 * wouldn't jump — which worked, and then pushed "your class" onto a line of its
 * own on every screen narrow enough to matter. Ending the line instead means a
 * changing width disturbs nothing at all, and the only thing that moves is the
 * caret, which is what a caret is for.
 *
 * The art is HTML and CSS rather than a screenshot. Screenshots of an app in
 * beta are stale within a fortnight, they carry real student names, and they
 * cost a download; these panels are a few kilobytes, stay sharp on any screen,
 * and can be corrected in the same commit as the feature they depict.
 */

const feature = (title, body) => `
  <div class="card">
    <h3>${title}</h3>
    <p class="small quiet" style="margin-bottom:0">${body}</p>
  </div>`;

/** Handwriting, drawn as paths — a suggestion of writing rather than lorem. */
const scribble = (paths, color = "#20302C", width = 2.2) =>
  paths
    .map(
      (d) =>
        `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join("");

const HERO_ART = `
<div class="hero-art" aria-hidden="true">

  <!-- back: the notebook, and the fact that it reaches everyone at once -->
  <div class="panel panel-a">
    <div class="panel-bar">
      <span class="dotrow"><i></i><i></i><i></i></span>
      <span class="panel-title">Cell Structure</span>
      <span class="chip chip-quiet">24 pages</span>
    </div>
    <div class="paper">
      <svg viewBox="0 0 240 74" class="ink">
        ${scribble([
          "M14 22c14-6 26 4 40-2s24-8 38-3 22 6 34 1",
          "M14 44c18-5 30 3 46-1s28-6 40-2",
          "M14 66c12-4 22 3 34 0s20-5 30-2 18 4 28 1",
        ])}
      </svg>
    </div>
    <div class="panel-foot">
      <span class="small">Sent to 28</span>
      <span class="faces"><i>AM</i><i>JT</i><i>RK</i><i>+25</i></span>
    </div>
  </div>

  <!-- middle: a teacher's marks sitting on top of a student's work -->
  <div class="panel panel-b">
    <div class="panel-bar">
      <span class="panel-title">Ade&nbsp;M. · Page&nbsp;3</span>
      <span class="chip chip-mint">Annotating</span>
    </div>
    <div class="paper paper-grid">
      <svg viewBox="0 0 240 108" class="ink">
        ${scribble([
          "M16 30c12-7 22 5 34-1s22-7 33-2",
          "M16 52c16-4 26 4 40 0s24-5 34-1",
        ])}
        ${scribble(["M120 26c10 8 16 18 18 30", "M138 56c8-14 20-24 34-30"], "#A3341F", 3)}
        ${scribble(["M158 78l10 10 20-24"], "#A3341F", 3.4)}
      </svg>
      <span class="tooltip">Ms. Petitto · 2:14&nbsp;pm</span>
    </div>
  </div>

  <!-- front: what the student gets back -->
  <div class="panel panel-c">
    <div class="panel-bar">
      <span class="chip chip-mint">Graded &amp; returned</span>
      <span class="score">18<span class="of">/20</span></span>
    </div>
    <p class="feedback">
      “Nice work on Q3 — check your units in Q5.”
    </p>
  </div>

</div>`;

const HERO_CSS = `
<style>
/* ---- hero layout ---- */
.hero{display:grid;gap:40px;align-items:center}
.hero h1{font-size:clamp(30px,4.2vw,44px)}
@media(min-width:1000px){.hero{grid-template-columns:minmax(0,1fr) minmax(0,460px);gap:48px}}

/* ---- the panels ---- */
.hero-art{position:relative;min-height:330px;margin-top:8px}
@media(min-width:1000px){.hero-art{min-height:420px;margin-top:0}}
.panel{position:absolute;background:var(--white);border:3px solid var(--pine);border-radius:18px;
  box-shadow:5px 5px 0 0 var(--pine);overflow:hidden}
.panel-bar{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:2px solid var(--line);background:var(--oat)}
.panel-title{font-family:var(--display);font-weight:700;font-size:14px;white-space:nowrap}
.chip{font-family:var(--display);font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;
  padding:3px 9px;border-radius:999px;border:2px solid var(--pine);white-space:nowrap}
.chip-mint{background:var(--mint)}
.chip-quiet{background:transparent;border-color:rgba(32,48,44,.3);color:var(--quiet)}
.dotrow{display:flex;gap:4px}
.dotrow i{width:8px;height:8px;border-radius:999px;background:rgba(32,48,44,.22)}
.paper{position:relative;background:#fff;padding:10px 0}
/* The ruling is drawn, not an image, so it stays sharp and weighs nothing. */
.paper::before{content:"";position:absolute;inset:0;
  background:repeating-linear-gradient(to bottom,transparent 0 21px,rgba(32,48,44,.13) 21px 22px)}
.paper-grid::before{background:
  repeating-linear-gradient(to bottom,transparent 0 21px,rgba(32,48,44,.10) 21px 22px),
  repeating-linear-gradient(to right,transparent 0 21px,rgba(32,48,44,.07) 21px 22px)}
.ink{position:relative;display:block;width:100%;height:auto}
.panel-foot{display:flex;align-items:center;gap:8px;padding:8px 12px;border-top:2px solid var(--line);background:var(--oat)}
.panel-foot .small{font-size:12px;color:var(--quiet)}
.faces{display:flex}
.faces i{width:22px;height:22px;margin-right:-6px;border-radius:999px;border:2px solid var(--pine);background:var(--mint);
  font-family:var(--display);font-size:9px;font-weight:700;font-style:normal;display:flex;align-items:center;justify-content:center}
.faces i:last-child{background:var(--oat);color:var(--quiet)}
.tooltip{position:absolute;right:10px;bottom:8px;background:var(--pine);color:var(--oat);
  font-family:var(--display);font-size:11px;font-weight:700;padding:4px 9px;border-radius:999px;white-space:nowrap}
.score{margin-left:auto;font-family:var(--display);font-size:22px;font-weight:700;line-height:1}
.score .of{font-size:13px;color:var(--quiet)}
.feedback{margin:0;padding:12px 14px;font-size:14px;line-height:1.45;color:var(--pine)}

/* Placement. Percentages so the stack keeps its shape as the column narrows. */
.panel-a{left:0;top:0;width:66%;transform:rotate(-4deg)}
.panel-b{right:0;top:21%;width:66%;transform:rotate(3deg);z-index:2}
.panel-c{left:6%;bottom:0;width:60%;transform:rotate(-2deg);z-index:3}
@media(max-width:520px){
  .panel-a{width:76%}
  .panel-b{width:76%;top:20%}
  .panel-c{width:70%;left:2%}
  .hero-art{min-height:300px}
}
</style>`;

/**
 * The four steps, each with a small drawing of what that step looks like.
 *
 * Drawn rather than screenshotted for the same reasons as the hero, and kept
 * deliberately schematic: a page, a stack of copies, a check mark. They are
 * there to make the steps scannable at a glance, not to be read — which is why
 * they carry no words a translation would need and are hidden from screen
 * readers entirely. The heading beside each one already says it.
 */

export default () =>
  layout({
    path: "/",
    title: "Notesanity",
    description:
      "Turn the worksheet you already made into a digital notebook. Every student gets their own copy to write on, and you grade it on the page — no printing.",
    body: `
${HERO_CSS}
<section style="padding-top:56px">
  <div class="wrap hero">
    <div>
      <p class="eyebrow">For teachers and their classes</p>
      <h1>Hand it out, hand it in.<br>Nothing printed.</h1>
      <p class="lede">
        Paperless that doesn't make more work. Turn the handout you already have into a
        digital notebook, hand every student their own copy, assign only the pages due
        this week, and grade it without a stack to carry home. Keep your files, keep
        your gradebook.
      </p>
      <p style="margin-top:28px;display:flex;gap:12px;flex-wrap:wrap">
        <a class="btn btn-primary" href="/?signin=1">Start free</a>
        <a class="btn" href="/help">See how it works</a>
      </p>
      <p class="small quiet">
        ${BETA_FREE
          ? `<span class="beta">Beta</span>&nbsp;Free while we're in beta, with a full semester's notice before that changes — see <a href="/pricing">pricing</a>.`
          : `Free to start, Pro when you outgrow it — see <a href="/pricing">pricing</a>.`}
      </p>
    </div>
    ${HERO_ART}
  </div>
</section>

<section style="padding-top:8px">
  <div class="wrap">
    <div class="grid grid-3">
      ${feature("Start from anything", `
        Upload a PDF, a Word file or a slide deck and it becomes a notebook, links and all. Or start from
        blank paper — lined, graph, dot grid, music staves, isometric — and choose how many
        pages you want.`)}
      ${feature("Built for a stylus", `
        Pressure-sensitive ink, a highlighter that snaps straight along a line of text, and
        an eraser that takes a whole stroke or just the part you drag over. Palm rejection
        means a hand resting on the screen doesn't draw.`)}
      ${feature("Ask for more than ink", `
        Drop text boxes, checkboxes, dropdowns, prompts, image uploads and audio recordings
        onto a page. A student can answer a question by talking to it.`)}
      ${feature("Grade where the work is", `
        Annotate a student's page in your own color, leave a comment, and return it with a
        grade. Hover any mark to see when it was made.`)}
      ${feature("Nothing gets lost", `
        Work is saved as it's written and mirrored locally first, so a dropped Wi-Fi
        connection doesn't cost a lesson. Every stroke, typed note and comment carries the
        time it was made, and answers, hand-ins and grades are logged as they happen.`)}
      ${feature("Their own notebooks too", `
        Students can keep their own notebooks — for a class, or entirely private. You can read
        the ones in your class, and write on any page a student opens to you. Never more than
        that: their writing stays theirs, and none of it is assigned.`)}
    </div>
    <p class="small quiet" style="margin:24px 0 0">
      Coming from Kami, OneNote or Google Classroom?
      <a href="/compare">See how Notesanity compares</a>.
    </p>
  </div>
</section>

<section>
  <div class="wrap">
    <p class="eyebrow">How a lesson goes</p>
    <h2>Four steps, and then it's just a notebook.</h2>
    ${lessonLoop([
      {
        title: "1 · Build it",
        caption: "Bring in a worksheet, a Drive file or blank paper. Add answer boxes where you want them.",
        body: `Bring in a worksheet or start from blank paper. Add prompts and answer boxes where you
         want them. Group pages into sections so "the practice set" means something.`,
      },
      {
        title: "2 · Push it",
        caption: "One press gives every student their own copy. Add a page later, and the same press updates them all.",
        body: `One press sends it to the class, and every student gets their own copy. Fix a typo or
         add a page next week and the same press updates every copy — their writing stays
         exactly where they put it.`,
      },
      {
        title: "3 · Assign it",
        caption: "Not every notebook is homework. When one is, pick its pages and set a due date.",
        body: `Not every notebook is homework. When one is, pick the pages that make up the task and
         set a due date — those pages come back to you to be graded. A student who joins late
         gets caught up automatically.`,
      },
      {
        title: "4 · Grade it",
        caption: "Move through the class, write on each student's page, and return it with a grade.",
        body: `Open the roster, move between students, and write on their page. Return it with a
         grade and a comment — or reopen it if they need another go.`,
      },
    ])}
  </div>
</section>

<section>
  <div class="wrap">
    <div class="card" style="background:var(--mint)">
      <h2 style="margin-bottom:10px">${BETA_FREE
        ? "Free for your whole school while we're in beta."
        : "Free to start. Simple plans when you're ready."}</h2>
      <p style="margin-bottom:20px">
        ${BETA_FREE
          ? "No card, no seat count, no trial clock. We're building this with teachers, and the fastest way to help is to use it and tell us what breaks."
          : "One teacher can start today for nothing. A department or a whole school buys on an invoice, and we switch it on."}
      </p>
      <p style="margin:0;display:flex;gap:12px;flex-wrap:wrap">
        <a class="btn" href="/?signin=1">Start free</a>
        <a class="btn" href="/contact">Talk to us</a>
      </p>
    </div>
  </div>
</section>

`,
  });
