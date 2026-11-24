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
 *
 * The one recording below the fold answers those three objections another
 * way: `scripts/record-demo.mjs` makes it from the running app with an
 * invented class (run it again when those screens change), it is a third of a
 * megabyte, and it isn't fetched until someone scrolls to it.
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

/** One row of "the usual way" against this one. */
const contrast = (usual, here) => `
  <li><span class="usual">${usual}</span><span class="here">${here}</span></li>`;

const PAGE_CSS = `
<style>
.contrast{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.contrast li{display:grid;gap:6px;padding:14px 16px;border:3px solid var(--pine);border-radius:18px;background:var(--white)}
@media(min-width:760px){.contrast li{grid-template-columns:1fr 1fr;gap:24px;align-items:center}}
.contrast .usual{color:var(--quiet);text-decoration:line-through;text-decoration-color:rgba(163,52,31,.55);text-decoration-thickness:2px}
.contrast .here{font-weight:700}
.contrast .here::before{content:"✓ ";color:#2E7D6B}
.contrast-head{display:none}
@media(min-width:760px){.contrast-head{display:grid;grid-template-columns:1fr 1fr;gap:24px;padding:0 19px 4px}}
.demo{margin:0;border:3px solid var(--pine);border-radius:22px;overflow:hidden;box-shadow:4px 4px 0 0 var(--pine);background:var(--white)}
.demo video{display:block;width:100%;height:auto;aspect-ratio:1200/750;background:var(--oat)}
.demo figcaption{padding:12px 16px;border-top:2px solid var(--line);font-size:16px;color:var(--quiet)}
.privacy-points{margin:12px 0 0;padding-left:20px}
.privacy-points li{margin:6px 0}
</style>`;

/**
 * Fetched only once it's nearly on screen, played only for people who haven't
 * asked their system to cut down on motion — they get the controls instead.
 */
const DEMO_SCRIPT = `
<script>
(() => {
  const v = document.querySelector("[data-demo]");
  if (!v) return;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (still) { v.controls = true; v.removeAttribute("autoplay"); }
  const load = () => { if (!v.src) { v.src = v.dataset.demo; if (!still) v.play().catch(() => { v.controls = true; }); } };
  if (!("IntersectionObserver" in window)) return load();
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); load(); } }, { rootMargin: "300px" });
  io.observe(v);
})();
</script>`;

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
      "One notebook holds the whole class set. Hand out the worksheet you already have, watch it fill in, check it a question at a time, and send the grades to Google Classroom — no printing.",
    body: `
${HERO_CSS}
${PAGE_CSS}
<section style="padding-top:56px">
  <div class="wrap hero">
    <div>
      <p class="eyebrow">For teachers and their classes</p>
      <h1>Hand it out, hand it in.<br>Nothing printed.</h1>
      <p class="lede">
        Going paperless usually means thirty copies in thirty students' folders, and grading by
        opening every one. Notesanity keeps the whole class set in one notebook: hand out the
        worksheet you already have, watch it fill in, check it a question at a time, and send the
        grades to Classroom. Keep your files, your Classroom and your gradebook.
      </p>
      <p style="margin-top:28px;display:flex;gap:12px;flex-wrap:wrap">
        <a class="btn btn-primary" href="/?signin=1">Start free</a>
        <a class="btn" href="#see-it">See it work</a>
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
    <p class="eyebrow">Why it finally sticks</p>
    <h2>The whole class set, in one place.</h2>
    <p class="lede" style="margin-bottom:20px">
      A PDF tool and an assignment post get a worksheet onto screens. Everything after that — finding
      each copy, grading it, getting the grade back — is still yours to stitch together. Here it's one
      loop.
    </p>
    <div class="contrast-head small quiet" aria-hidden="true"><span>The usual way</span><span>In Notesanity</span></div>
    <ul class="contrast">
      ${contrast("Thirty copies, one in each student's Drive", "One notebook, with every student's copy in it")}
      ${contrast("Find out who was stuck when it's handed in", "Watch every page fill in, live, from the front of the room")}
      ${contrast("Open each file and read question 1 thirty times", "Check question 1 for the whole class at once — the answer key has done the easy part")}
      ${contrast("Copy every grade into Classroom by hand", "Post the assignment to Classroom from here, and returned grades land in its gradebook")}
    </ul>
    <p class="small quiet" style="margin:16px 0 0">
      Coming from Kami, OneNote or Google Classroom on its own?
      <a href="/compare">See how Notesanity compares</a>.
    </p>
  </div>
</section>

<section id="see-it">
  <div class="wrap">
    <p class="eyebrow">See it work</p>
    <h2>Thirty seconds of a worksheet coming back.</h2>
    <figure class="demo">
      <video data-demo="/media/demo.mp4" poster="/media/demo-poster.jpg" muted loop playsinline controls preload="none"
        width="1200" height="750"
        aria-label="A class's worksheet pages filling in live; checking the first question with answers grouped and already marked, including one written by hand; turning scores into grades; and the gradebook."></video>
      <figcaption>
        A made-up class of six, in the app as it is today: the live view, Check by question with
        one answer written by hand, scores turned into grades, and the gradebook.
      </figcaption>
    </figure>
  </div>
</section>

<section>
  <div class="wrap">
    <p class="eyebrow">What's in it</p>
    <h2>Everything a worksheet needs, and nothing it doesn't.</h2>
    <div class="grid grid-3">
      ${feature("Start from anything", `
        Upload a PDF, a Word file or a slide deck and it becomes a notebook, links and all. Start from
        blank paper — lined, graph, dot grid, staves. Or describe a page and <b>Design with AI</b> draws
        it, with the answer boxes placed and a draft answer key.`)}
      ${feature("Check it question by question", `
        Give a box an answer key and every student's answer arrives already marked, identical answers
        grouped together. Overrule any of them, see the ones written by hand, and turn the scores into
        grades in one press.`)}
      ${feature("See the whole room", `
        <b>Live</b> shows every student's page as they work, refreshed every few seconds. The student
        who stopped writing ten minutes ago stands out before the bell, not after it.`)}
      ${feature("Built for a stylus", `
        Pressure-sensitive ink, a highlighter that snaps straight along a line of text, an eraser that
        takes a stroke or just part of it, and palm rejection. <b>Read aloud</b> reads a page's printed
        words to a student who needs them.`)}
      ${feature("Ask for more than ink", `
        Drop text boxes, checkboxes, dropdowns, prompts, image uploads and audio recordings onto a page.
        A student can answer a question by talking to it.`)}
      ${feature("Grades where you keep them", `
        A gradebook that reads like one — students down, assignments across, letter grades counted in
        the averages — and a CSV download. Post an assignment to Google Classroom and returned grades
        land in its gradebook too.`)}
      ${feature("Share it with your team", `
        Build a template once and push it to every section; later changes go out with one press.
        <b>Send a copy to a colleague</b> gives another teacher their own copy, answer key and all, and
        never your students' work.`)}
      ${feature("Families follow along", `
        Send a family code home and a parent or guardian sees their own child's notebooks, assignments
        and returned grades — to look at, never to change.`)}
      ${feature("Nothing gets lost", `
        Work is saved as it's written and mirrored on the device first, so a dropped Wi-Fi connection
        doesn't cost a lesson. Need paper anyway? Print or download any pages, writing included.`)}
    </div>
  </div>
</section>

<section>
  <div class="wrap">
    <p class="eyebrow">How a lesson goes</p>
    <h2>Four steps, and then it's just a notebook.</h2>
    ${lessonLoop([
      {
        title: "1 · Build it",
        caption: "Bring in a worksheet, a Drive file or blank paper. Add answer boxes, and a key if you like.",
        body: `Bring in a worksheet or start from blank paper. Add prompts and answer boxes where you
         want them, with an answer key on the ones that have a right answer. Group pages into
         sections so "the practice set" means something.`,
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
         set a due date — one student can have their own — and those pages come back to you to be
         graded. A student who joins late gets caught up automatically.`,
      },
      {
        title: "4 · Grade it",
        caption: "Check each question across the class, or write on each student's page, and return it with a grade.",
        body: `Check the class a question at a time, with the key's marks to start from, or move
         between students and write on their page. Return it with a grade and a comment — or
         reopen it if they need another go.`,
      },
    ])}
  </div>
</section>

<section>
  <div class="wrap">
    <div class="card">
      <p class="eyebrow" style="margin-bottom:6px">Student privacy</p>
      <h2 style="margin-bottom:10px">Your students' work stays your school's.</h2>
      <ul class="privacy-points">
        <li>We don't sell data, show ads, or use trackers, and we don't train AI on student work.</li>
        <li>Design with AI sees only what you type or attach for that page — never a name, an answer or a grade.</li>
        <li>A copy you send a colleague carries your pages and your answer key, never your students.</li>
      </ul>
      <p style="margin:16px 0 0">
        Need your district's student data privacy agreement signed? <a href="/contact">Send it to us</a> and
        we'll sign it. The details are in the <a href="/privacy">privacy notice</a>, written for FERPA and COPPA.
      </p>
    </div>
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
${DEMO_SCRIPT}
`,
  });
