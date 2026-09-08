import { layout } from "../layout.mjs";

const feature = (title, body) => `
  <div class="card">
    <h3>${title}</h3>
    <p class="small quiet" style="margin-bottom:0">${body}</p>
  </div>`;

export default () =>
  layout({
    path: "/",
    title: "Notesanity",
    description:
      "Interactive notebooks for classrooms. Teachers build notebooks from PDFs or blank paper, students write in them with a pencil or a keyboard, and teachers mark the work in place.",
    body: `
<section style="padding-top:64px">
  <div class="wrap">
    <p class="eyebrow">For teachers and their classes</p>
    <h1>The notebook your class already uses,<br>with the paperwork taken out.</h1>
    <p class="lede">
      Build a notebook from a PDF, a Google Doc, or blank paper. Send it to your class.
      Students write on it with a stylus or a keyboard, hand it in, and you mark it on the
      same page they wrote on — no scanning, no printing, no folder of downloads.
    </p>
    <p style="margin-top:28px;display:flex;gap:12px;flex-wrap:wrap">
      <a class="btn btn-primary" href="/?signin=1">Start free</a>
      <a class="btn" href="/help">See how it works</a>
    </p>
    <p class="small quiet">
      <span class="beta">Beta</span>
      &nbsp;Free for every school while we're in beta — see <a href="/pricing">pricing</a>.
    </p>
  </div>
</section>

<section style="padding-top:8px">
  <div class="wrap">
    <div class="grid grid-3">
      ${feature("Start from anything", `
        Upload a PDF, a Word file or a slide deck and it becomes a notebook. Or start from
        blank paper — lined, graph, dot grid, music staves, isometric — and choose how many
        pages you want.`)}
      ${feature("Built for a stylus", `
        Pressure-sensitive ink, a highlighter that snaps straight along a line of text, and
        an eraser that takes a whole stroke or just the part you drag over. Palm rejection
        means a hand resting on the screen doesn't draw.`)}
      ${feature("Ask for more than ink", `
        Drop text boxes, checkboxes, dropdowns, prompts, image uploads and audio recordings
        onto a page. A student can answer a question by talking to it.`)}
      ${feature("Mark where the work is", `
        Annotate a student's page in your own colour, leave a comment, and return it with a
        grade. Hover any mark to see when it was made.`)}
      ${feature("Nothing gets lost", `
        Work is saved as it's written and mirrored locally first, so a dropped Wi-Fi
        connection doesn't cost a lesson. It syncs when the network comes back.`)}
      ${feature("Their own notebooks too", `
        Students can keep their own notebooks — for a class, or entirely private. You can
        read the ones in your class; you can't write in them, and they're never assigned.`)}
    </div>
  </div>
</section>

<section>
  <div class="wrap narrow">
    <p class="eyebrow">How a lesson goes</p>
    <h2>Three steps, and then it's just a notebook.</h2>
    <div class="grid" style="gap:16px;margin-top:24px">
      <div class="card"><h3>1 · Build it</h3><p class="small quiet" style="margin:0">
        Bring in a worksheet or start from blank paper. Add prompts and answer boxes where you
        want them. Group pages into sections so "the practice set" means something.</p></div>
      <div class="card"><h3>2 · Assign it</h3><p class="small quiet" style="margin:0">
        Pick the pages that make up the task, set a due date, and publish. Every student gets
        their own copy. Adding a student later backfills their work automatically.</p></div>
      <div class="card"><h3>3 · Mark it</h3><p class="small quiet" style="margin:0">
        Open the roster, move between students, and write on their page. Return it with a
        grade and a comment — or reopen it if they need another go.</p></div>
    </div>
  </div>
</section>

<section>
  <div class="wrap">
    <div class="card" style="background:var(--mint)">
      <h2 style="margin-bottom:10px">Free for your whole school while we're in beta.</h2>
      <p style="margin-bottom:20px">
        No card, no seat count, no trial clock. We're building this with teachers, and the
        fastest way to help is to use it and tell us what breaks.
      </p>
      <p style="margin:0;display:flex;gap:12px;flex-wrap:wrap">
        <a class="btn" href="/?signin=1">Start free</a>
        <a class="btn" href="mailto:support@notesanity.com">Talk to us</a>
      </p>
    </div>
  </div>
</section>`,
  });
