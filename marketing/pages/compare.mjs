import { layout } from "../layout.mjs";
import { BETA_FREE, PLANS, dollars } from "../../src/shared/plans.mjs";

/**
 * How Notesanity compares with the tools a teacher already knows.
 *
 * A comparison page is only worth anything if a teacher who uses one of these
 * tools reads their own column and nods. So: every claim about another
 * product comes from that company's own site, checked on the date below; where
 * their site doesn't say, the cell says what we found ("no documented …")
 * rather than guessing; and each product gets credit for what it does better.
 *
 * Deliberately left out, because it changes too fast or couldn't be pinned
 * down: other products' prices in dollars (some are sale prices, some are
 * quote-only), claims about offline use, and anything about a feature we
 * could only prove by its absence. Check this page again before changing a
 * cell — and date the change.
 */

const CHECKED = "September 24, 2026";

const PRODUCTS = ["Notesanity", "Kami", "OneNote Class Notebook", "Google Classroom", "Notability"];

const ROWS = [
  [
    "What it is",
    "A notebook for a whole class: build it, hand it out, grade it.",
    "Document annotation that works inside the LMS a school already has.",
    "A shared notebook for a class, part of Microsoft 365.",
    "Google's class and assignment hub.",
    "A personal note-taking app with AI study tools.",
  ],
  [
    "Every student gets their own copy",
    "Yes — one press. Add a page later and the same press updates every copy.",
    "Yes, assigned through your LMS. Its Google Classroom connection is on the paid plan.",
    "Yes — Distribute Page or Section, or attach a page to a Teams assignment.",
    "Yes — “Make a copy for each student” on a Drive file.",
    "No class distribution documented; files are shared or exported by hand.",
  ],
  [
    "Handwriting with a stylus",
    "Yes, pressure-sensitive with palm rejection, in the browser.",
    "Yes, in the browser and Chrome extension.",
    "Yes, in its apps and on the web.",
    "On the Android and iOS apps only, per Google's help center.",
    "Yes — it's what Notability is known for.",
  ],
  [
    "Answer spaces on the worksheet",
    "Text, checkbox, dropdown, audio and image answers, placed on the page by the teacher.",
    "Text boxes and voice or video comments added to the document.",
    "Type or write anywhere on the page.",
    "Typing in Docs, Slides and Sheets; not in PDF fields.",
    "Type and write anywhere; audio recording synced to notes.",
  ],
  [
    "Assign particular pages, with a due date",
    "Yes — pick the pages that make up the task and set a due date.",
    "Due dates come from your LMS.",
    "Due dates through Teams Assignments.",
    "Due dates built in, set per assignment.",
    "No assignments documented.",
  ],
  [
    "Grade on the student's page",
    "Yes — in your own layer, with a comment and a grade. Return it, or reopen it.",
    "Yes, in Class View. Grades sync to Google Classroom, Canvas and Schoology.",
    "Yes — ink and comment on the page; the grade goes in Teams.",
    "Grades and rubrics built in; marking on the work in the mobile apps.",
    "No grading documented.",
  ],
  [
    "Connects to an LMS",
    "Google Classroom: posts assignments and sends grades back. No other LMS yet.",
    "Google Classroom, Canvas, Schoology, Teams and D2L.",
    "Teams; Canvas, Schoology, Blackboard, Brightspace and Moodle through the Microsoft 365 LTI.",
    "It is the LMS.",
    "No LMS connection documented.",
  ],
  [
    "Where it runs",
    "Any modern browser — iPad, Chromebook, Windows, Mac. Nothing to install.",
    "Browser and Chrome extension. On iPad, in the browser.",
    "Web, Windows, Mac, iPad, Android and Chromebook.",
    "Web, Android and iOS.",
    "iPad, iPhone, Mac, Windows, Android and web.",
  ],
  [
    "Cost",
    BETA_FREE
      ? `Free during the beta. Then a Free plan, and Pro at ${dollars(PLANS.pro.priceCents)}/year.`
      : `A Free plan, and Pro at ${dollars(PLANS.pro.priceCents)}/year.`,
    "A free Basic plan, a paid Teacher plan, and school or district pricing by quote.",
    "Free for eligible schools with Office 365 Education.",
    "Free for qualifying schools; paid Workspace for Education editions add features.",
    "A free starter plan and paid plans; free for schools through an admin request.",
  ],
];

const table = () => `
<div class="cmp-scroll" tabindex="0" role="region" aria-label="Comparison table, scrolls sideways">
  <table class="cmp">
    <caption class="sr-only">Notesanity compared with Kami, OneNote Class Notebook, Google Classroom and Notability</caption>
    <thead>
      <tr><th scope="col"><span class="sr-only">Feature</span></th>${PRODUCTS.map((p, i) => `<th scope="col"${i === 0 ? ' class="us"' : ""}>${p}</th>`).join("")}</tr>
    </thead>
    <tbody>
      ${ROWS.map(
        ([label, ...cells]) =>
          `<tr><th scope="row">${label}</th>${cells.map((c, i) => `<td${i === 0 ? ' class="us"' : ""}>${c}</td>`).join("")}</tr>`,
      ).join("\n      ")}
    </tbody>
  </table>
</div>`;

const versus = (name, strengths, choose, us) => `
  <div class="card">
    <h3>Notesanity and ${name}</h3>
    <p class="small"><b>Where ${name} is stronger.</b> ${strengths}</p>
    <p class="small"><b>Choose ${name} if</b> ${choose}</p>
    <p class="small" style="margin:0"><b>Choose Notesanity if</b> ${us}</p>
  </div>`;

const CSS = `
<style>
.cmp-scroll{overflow-x:auto;border:3px solid var(--pine);border-radius:22px;background:var(--white);
  box-shadow:4px 4px 0 0 var(--pine);margin-top:28px}
.cmp-scroll:focus-visible{outline:3px solid var(--mint);outline-offset:3px}
.cmp{border-collapse:separate;border-spacing:0;width:100%;min-width:960px;font-size:15px;line-height:1.45}
.cmp th,.cmp td{text-align:left;vertical-align:top;padding:14px 16px;border-bottom:1px solid var(--line)}
.cmp tbody tr:last-child th,.cmp tbody tr:last-child td{border-bottom:0}
.cmp thead th{font-family:var(--display);font-size:16px;font-weight:700;background:var(--oat);border-bottom:3px solid var(--pine)}
.cmp tbody th{font-family:var(--display);font-weight:700;width:180px}
/* The row labels stay put while the table scrolls sideways on a phone. */
.cmp th[scope="row"],.cmp thead th:first-child{position:sticky;left:0;background:var(--white);z-index:1;
  box-shadow:1px 0 0 var(--line)}
.cmp thead th:first-child{background:var(--oat)}
.cmp .us{background:rgba(127,209,174,.18)}
.cmp thead th.us{background:var(--mint)}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.cmp-note{margin-top:14px}
@media(max-width:560px){.cmp{min-width:820px;font-size:14px}.cmp th,.cmp td{padding:12px}.cmp tbody th{width:104px}}
</style>`;

export default () =>
  layout({
    path: "/compare",
    title: "Notesanity compared with Kami, OneNote, Google Classroom and Notability",
    description:
      "An honest comparison of Notesanity with Kami, OneNote Class Notebook, Google Classroom and Notability — what each does, where each is stronger, and which to choose.",
    body: `
${CSS}
<section style="padding-top:56px">
  <div class="wrap narrow">
    <p class="eyebrow">Compare</p>
    <h1>How Notesanity compares.</h1>
    <p class="lede">
      You probably already use one of these, and each is good at something. Here's what they do,
      where they're stronger than we are, and where Notesanity fits — a notebook the whole class
      writes in, from handing out a worksheet to handing back a grade.
    </p>
  </div>
</section>

<section style="padding-top:0">
  <div class="wrap">
    ${table()}
    <p class="small quiet cmp-note">
      Checked on ${CHECKED} against each company's own website and help pages. Products change
      often — if something here is out of date, <a href="/contact">tell us</a> and we'll correct it.
      Notesanity is in beta; everything in its column works today.
    </p>
  </div>
</section>

<section>
  <div class="wrap">
    <h2>One at a time</h2>
    <div class="grid grid-2" style="gap:16px;margin-top:20px">
      ${versus(
        "Kami",
        `It's been in classrooms for years and connects to five LMSs with grades passed back. It has
         read-aloud, a dictionary, math tools and AI-graded questions, works with Office files, and
         has an offline mode.`,
        `your school runs on Canvas or Schoology, or you want its accessibility and math tools on
         the documents you already hand out.`,
        `you want the notebook, the assignment and the grade in one place without a paid
         integration, with answer spaces that are part of the page and pages grouped into a
         notebook the class keeps.`,
      )}
      ${versus(
        "OneNote Class Notebook",
        `It's free for eligible schools, has native apps on every platform, works offline in the
         Windows app, and brings Immersive Reader, dictation and a math assistant. If your school
         lives in Teams, it's already there.`,
        `your school is on Microsoft 365 and Teams, and your students have school Microsoft
         accounts.`,
        `you teach from worksheets. A PDF becomes pages to write on, with answer spaces where you
         put them — on the web, Microsoft's own help notes that an inserted PDF can arrive as an
         attachment rather than a page.`,
      )}
      ${versus(
        "Google Classroom",
        `It's free, it's where most classes already are, and it holds the roster, the stream,
         Drive, and grades that can go on to a student information system.`,
        `you need a place for the class to live. That isn't a choice against Notesanity — the two
         work together.`,
        `you want students to write on the worksheet itself from a Chromebook or a laptop. Classroom's
         own drawing tools are in its mobile apps only. Notesanity posts its assignments to
         Classroom and sends grades back to your Classroom gradebook.`,
      )}
      ${versus(
        "Notability",
        `It's a mature, native app with some of the best handwriting on an iPad, recordings synced
         to notes, handwriting search, and AI study tools.`,
        `you want a personal notebook — for your own planning, or for students taking their own
         notes.`,
        `you're running a class. Notability has no documented rosters, assignments or grading;
         Notesanity is built around handing work out to a class and getting it back.`,
      )}
    </div>
  </div>
</section>

<section>
  <div class="wrap narrow">
    <div class="card" style="background:var(--mint)">
      <h2 style="margin-bottom:10px">See it with your own worksheet.</h2>
      <p style="margin-bottom:20px">
        ${BETA_FREE
          ? "Free for every teacher while we're in beta — no card and no trial clock."
          : "Start on the Free plan — no card and no trial clock."}
        Bring the handout you'd have printed tomorrow.
      </p>
      <p style="margin:0;display:flex;gap:12px;flex-wrap:wrap">
        <a class="btn" href="/?signin=1">Start free</a>
        <a class="btn" href="/pricing">See pricing</a>
      </p>
    </div>
    <p class="small quiet" style="margin-top:24px">
      Kami, OneNote, Microsoft 365, Microsoft Teams, Google Classroom, Google Workspace and
      Notability are trademarks of their respective owners. Notesanity isn't affiliated with or
      endorsed by any of them.
    </p>
  </div>
</section>
`,
  });
