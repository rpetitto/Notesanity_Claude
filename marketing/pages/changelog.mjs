import { layout } from "../layout.mjs";

/**
 * What changed, written for the people it changed for.
 *
 * Entries describe what a teacher or student can now do, not what was
 * refactored — "the eraser can rub out part of a stroke" rather than "split
 * stroke point arrays on erase". Internal work earns a line only when someone
 * would notice it: a save being fifteen times smaller is worth saying, a
 * renamed module is not.
 *
 * Backfilled from the project history, so the dates are real release dates.
 */

const TONE = {
  new: { label: "New", bg: "rgba(127,209,174,.35)" },
  better: { label: "Improved", bg: "rgba(175,194,216,.35)" },
  fixed: { label: "Fixed", bg: "rgba(227,192,168,.4)" },
};

const tag = (k) =>
  `<span style="display:inline-block;padding:2px 9px;border-radius:999px;border:2px solid var(--pine);
    background:${TONE[k].bg};font-family:var(--display);font-size:12px;font-weight:700;letter-spacing:.05em;
    text-transform:uppercase;white-space:nowrap">${TONE[k].label}</span>`;

const entry = ([kind, text]) => `
  <li style="display:flex;gap:12px;margin-bottom:12px;align-items:flex-start">
    <span style="flex-shrink:0;padding-top:2px">${tag(kind)}</span>
    <span>${text}</span>
  </li>`;

const release = (date, summary, items) => `
  <section style="padding:0 0 44px">
    <h2 id="${date.toLowerCase().replace(/[^a-z0-9]+/g, "-")}" style="margin-bottom:6px">${date}</h2>
    ${summary ? `<p class="quiet" style="margin-bottom:18px">${summary}</p>` : ""}
    <ul style="list-style:none;padding:0;margin:0">${items.map(entry).join("")}</ul>
  </section>`;

const RELEASES = [
  [
    "September 12, 2026",
    "Tidying up: archiving, duplicating, clearing and exporting.",
    [
      ["new", "<b>Archive a notebook or a whole class.</b> Archiving a notebook puts it away for the class — nobody's work is lost and you can bring it back. Archiving a class takes its notebooks, assignments and grades with it; students keep read-only access from a new <b>Archived classes</b> section, so last term's notes are still there to read."],
      ["new", "<b>Delete a notebook or a class.</b> A notebook can be deleted while it's still a draft; once students have copies it can only be archived, because deleting it would delete their writing too. Deleting a class asks you to type its name, because it takes everything."],
      ["new", "<b>Duplicate a page</b>, with its answer boxes and your own ink, from the icon beside the page name — or several at once from the selection bar."],
      ["new", "<b>Clear page</b>, on the eraser. It takes every stroke, note and stamp off the page and empties the answer boxes without removing the boxes themselves."],
      ["new", "<b>Export a notebook</b> as a PDF — download it, or save it straight to your Google Drive. Teachers and students both."],
      ["new", "A class can carry a description, room, section, level, year and subject. Google Classroom fills in what it knows on import."],
    ],
  ],
  [
    "September 11, 2026",
    "A sign-in fix, and a notebook nobody should have seen yet.",
    [
      ["fixed", "<b>Students could see notebooks their teacher hadn't published.</b> A class notebook still in draft was listed in the class and could be opened. Drafts are now the teacher's alone until they press Publish — and an assignment can't be set over one, which was the third way in."],
      ["fixed", "Signing in with Google failed for some people with &ldquo;Google sign-in was dismissed&rdquo; even when nothing had been dismissed. The button now opens Google's account chooser directly instead of relying on a prompt the browser is free to refuse."],
      ["better", "When Google sign-in genuinely can't run, the message says why and what to do — whether you're signed out of Google, a browser setting is blocking it, or Google has stopped offering the prompt on this site."],
    ],
  ],
  [
    "September 9, 2026",
    "A short walkthrough, and a way to ask your teacher to write on a page.",
    [
      ["new", "The first time you open your home screen, a class, or a notebook, a short guided tour points out what each button does. Teachers and students get different ones, because they're looking at different things. Skip it or finish it and it won't come back — and you can start all of them over from <b>Settings</b> if you want another look."],
      ["new", "A student can open pages of their own class notebook to their teacher. Choose <b>Let your teacher write</b>, tick the pages, and the teacher gets a pen on those pages and no others. They still can't change what the student wrote, and unticking closes a page again."],
      ["better", "Adding pages to a notebook is one button. <b>Add pages</b> now asks where they're coming from — blank paper, a file off your machine, or something in your Google Drive. Pulling a file out of Drive straight into a notebook you're already building is new; before, Drive could only start a new one."],
      ["better", "Dragging a page to a new place in a notebook shows it there straight away instead of waiting for the save. Saving the new order is also one request now rather than one per page, so a fifty-page notebook rearranges in about the time a five-page one used to."],
    ],
  ],
  [
    "September 8, 2026",
    "Notesanity moved to its own infrastructure, and got a website.",
    [
      ["new", "A public website: this changelog, a <a href='/help'>help center</a>, <a href='/pricing'>pricing</a>, and a <a href='/status'>status page</a> that checks the service live rather than being updated by hand."],
      ["better", "Notesanity now runs on its own infrastructure at notesanity.com, which we control end to end. Sign-in emails now come from <b>notesanity.com</b> instead of a platform address, and the old three-a-minute cap on sending is gone — a class of twenty-five invitations now goes out in about a minute rather than thirteen."],
      ["better", "Signing in with Google no longer depends on anything outside Notesanity, and works the same as a sign-in link or a password."],
      ["fixed", "Signing out showed an error page instead of returning you to the front page."],
    ],
  ],
  [
    "August 24, 2026",
    "Erasing, students' own notebooks, and a save bug that could lose a stroke.",
    [
      ["new", "The eraser has two modes. <b>Quick</b> removes a whole stroke wherever you touch it; <b>Manual</b> rubs out only the part you drag over, so you can fix one letter without redrawing the word."],
      ["new", "Students can keep their own notebook inside a class. Their teacher can read it; nobody can write in it, and it is never assigned."],
      ["new", "Students can name and group the pages of their own notebooks into sections."],
      ["new", "Teachers can build a notebook from a file already in Google Drive, without downloading it first."],
      ["new", "Blank notebooks now take a paper style and a page count separately, so you can have eight pages of music staves instead of a fixed thirty."],
      ["new", "Schools are recognized by email domain, so more than one school can use Notesanity without seeing each other."],
      ["better", "A grade that has already gone back to a student no longer offers to be re-saved. Reopening the work puts it back in play, and keeps the grade you already gave."],
      ["better", "Saving ink is about fifteen times smaller. Adding a stroke to a full page used to rewrite the whole page; now it rewrites a fraction of it."],
      ["better", "Opening an assignment for a large class is much faster — the whole roster is fetched at once rather than student by student."],
      ["fixed", "A save that was refused could retry forever, showing “Offline — retrying” when the network was fine."],
      ["fixed", "A stroke drawn while a save was in flight could be dropped and never saved."],
      ["fixed", "“Offline” now means offline. Other failures say what they actually are instead of sending you to check your Wi-Fi."],
    ],
  ],
  [
    "August 23, 2026",
    "",
    [
      ["fixed", "Pages scrolled sideways on phones and on iPads held upright. Several screens were affected, including the notebook editor, where more than half the page could be off-screen."],
    ],
  ],
  [
    "August 17, 2026",
    "Notebooks that don't start from a document.",
    [
      ["new", "Start a notebook from blank paper — lined, graph, dot grid, music staves, engineering, isometric or a coordinate plane — instead of uploading a document."],
      ["new", "Students can keep personal notebooks outside any class, and export them to PDF."],
      ["new", "A console for platform administrators covering accounts, notebooks, assignments, grades and errors."],
      ["new", "Sign-in email delivery is now visible, so an administrator can see whether a link was actually sent."],
      ["fixed", "Students invited to a class were never actually emailed."],
    ],
  ],
  [
    "August 14, 2026",
    "The largest release so far: what a page can ask for, and how a teacher responds to it.",
    [
      ["new", "Pages can carry prompts with answer areas, image uploads and audio recordings — a student can answer a question by talking to it."],
      ["new", "Teachers can place their own rich text and pictures on a page, as part of the page rather than something to answer."],
      ["new", "Sign in with an email and password, or a link sent to your address, alongside Google."],
      ["new", "Teachers can insert blank pages into an existing notebook, choosing the ruling and the rule color."],
      ["new", "The highlighter snaps level when it recognizes you are highlighting along a line of text."],
      ["new", "The select tool moves your own ink, text and stamps after you have drawn them."],
      ["new", "Named sections, and a history you can hover any mark to see."],
      ["new", "Handed-in work is locked, so it cannot be changed after a teacher has seen it."],
      ["better", "A brand of its own — typography, color and layout applied across the app and its emails, which had been plain enough to look like spam."],
      ["better", "Working on an iPad gives the page far more room; the toolbars used to take half the screen."],
      ["better", "Progress is reported as whether a student has started and when they last worked, rather than a fraction that counted the wrong things."],
      ["better", "Field settings have an explicit Save and Cancel instead of saving as you type."],
      ["fixed", "Signing up with a password always failed — the password hashing exceeded a platform limit that only appeared once deployed."],
      ["fixed", "Students could not add text boxes; the stamp, text and comment tools were being swallowed by the page."],
      ["fixed", "Audio recordings were rejected by the server, and the audio field covered the page content underneath it."],
      ["fixed", "Tapping a text box, an image or an audio field with a pen selected drew a dot on it instead of opening it."],
    ],
  ],
];

export default () =>
  layout({
    path: "/changelog",
    title: "Changelog",
    description:
      "What's new in Notesanity — features, improvements and fixes, newest first.",
    body: `
<section style="padding-bottom:16px">
  <div class="wrap narrow">
    <p class="eyebrow">Changelog</p>
    <h1>What's new</h1>
    <p class="lede">
      Notesanity is in beta and changes often. Everything that affects what you can do is listed
      here, newest first.
    </p>
  </div>
</section>

<div class="wrap narrow">
  ${RELEASES.map(([d, s, items]) => release(d, s, items)).join("")}

  <div class="card" style="margin-bottom:56px">
    <h3>Something you'd like to see?</h3>
    <p class="small quiet" style="margin-bottom:0">
      Most of what's above came from teachers telling us what got in their way. Email
      <a href="mailto:support@notesanity.com">support@notesanity.com</a> — we read all of it.
    </p>
  </div>
</div>`,
  });
