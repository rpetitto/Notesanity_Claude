#!/usr/bin/env node
/**
 * Builds the getting-started guide as a template, through the app's own API.
 *
 *   NOTESANITY_URL=http://localhost:8787 NOTESANITY_COOKIE='notesanity_session=…' node scripts/build-guide.mjs
 *
 * It makes a NEW template each run (it never edits an existing one), in the
 * account the cookie belongs to. After it runs, open the template, polish it
 * in the editor like any notebook, and choose "Make this the teacher guide"
 * from its ⋯ menu on the Notebooks page. Every teacher who hasn't had the guide
 * then gets a copy of that template, once.
 *
 * The words below are a first draft, written to match the app's real button
 * names as of 2026-10-16. Edit them in the editor afterwards; this script is
 * only how the first version gets made.
 *
 * Text blocks render at a fixed 15px whatever the zoom, so each block's
 * height is estimated generously from its text: a block too short clips.
 */

const BASE = (process.env.NOTESANITY_URL || "http://localhost:8787").replace(/\/$/, "");
const COOKIE = process.env.NOTESANITY_COOKIE || "";
if (!COOKIE) {
  console.error("Set NOTESANITY_COOKIE to a signed-in session cookie (name=value).");
  process.exit(1);
}

async function api(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", cookie: COOKIE },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

// --- Layout --------------------------------------------------------------
// Letter paper, in page units. One column with comfortable margins.
const W = 612, H = 792, X = 48, COL = W - X * 2;

/** A rough height for a block of rich text at 15px, so nothing clips. */
function heightOf(html, width = COL) {
  let h = 8;
  for (const m of html.matchAll(/<(h1|h2|h3|p|li)>([\s\S]*?)<\/\1>/g)) {
    // List items sit 1.4em in; bold runs a little wider than regular text.
    const room = m[1] === "li" ? width - 24 : width;
    const perLine = Math.max(20, Math.floor(room / 6.9));
    const plain = m[2].replace(/<[^>]+>/g, "");
    const boldChars = [...m[2].matchAll(/<strong>([^<]*)<\/strong>/g)].reduce((n, b) => n + b[1].length, 0);
    const size = { h1: 22.5, h2: 18.75, h3: 16.5 }[m[1]] ?? 15;
    const chars = plain.length + boldChars * 0.08;
    const lines = Math.max(1, Math.ceil((chars * size) / 15 / perLine));
    h += lines * size * 1.4 + (m[1] === "li" ? 2 : size * 0.5);
  }
  // Each list adds its own bottom margin.
  h += (html.match(/<\/(ul|ol)>/g) ?? []).length * 8;
  return Math.ceil(h * 1.12) + 8;
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const b = (s) => `<strong>${esc(s)}</strong>`;
const p = (s) => `<p>${s}</p>`;
const h1 = (s) => `<h1>${esc(s)}</h1>`;
const h2 = (s) => `<h2>${esc(s)}</h2>`;
const ul = (items) => `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
const ol = (items) => `<ol>${items.map((i) => `<li>${i}</li>`).join("")}</ol>`;
const tryIt = (s) => `<h3>Try it</h3>${s}`;

/*
 * Each page: a label, its section, and a list of blocks laid top to bottom.
 * A block is rich text (string) or an element: { field: {...}, h } placed at
 * the current position, or { gap } for empty room to write in.
 */
const SECTIONS = { start: "Start here", grade: "Assign and grade", more: "Going further", school: "For families and admins" };

const PAGES = [
  {
    label: "Welcome", group: SECTIONS.start,
    blocks: [
      h1("Welcome to Notesanity") +
      p("This notebook shows you Notesanity by having you use it. Every page has one thing to try, right on the page. It's yours: write on it, add to it, and delete it when you're done.") +
      p(`${b("Start here")} takes about ten minutes and covers everything you need for a first lesson. The other sections are there when you want them.`) +
      ul([
        `Move between pages with the page list on the left, or the arrows above the page.`,
        `The toolbar across the top holds the writing tools. ${b("Add page")} and ${b("Add element")} sit at its left.`,
        `Want a fresh copy later? ${b("Settings")} → ${b("Get the latest guide")}.`,
      ]) +
      tryIt(p(`Pick the ${b("Pen")} in the toolbar and write your name on the line below.`)),
      { gap: 20 },
      p("Your name: ______________________________________________"),
    ],
  },
  {
    label: "Write on the page", group: SECTIONS.start,
    blocks: [
      h1("Pen, highlighter and eraser") +
      p(`These work with a mouse, a trackpad, a finger or a stylus. On an iPad with an Apple Pencil, your palm can rest on the screen.`) +
      tryIt(ol([
        `Choose the ${b("Pen")} and circle the word ${b("powerhouse")} below.`,
        `Choose ${b("Highlight")} and run it across the whole sentence.`,
        `Choose the ${b("Eraser")}, then press the small ▾ under it and pick ${b("Part of a stroke")}. Rub out half of your circle.`,
        `Changed your mind? Press ${b("Undo")} (the curved arrow) at the right of the toolbar.`,
      ])),
      { gap: 10 },
      h2("The mitochondria is the powerhouse of the cell."),
      { gap: 20 },
      p(`What you write on a page of yours is a draft for students until you publish. They see it only after you press ${b("Publish to students")} or ${b("Update student notebooks")}.`),
    ],
  },
  {
    label: "Text, stamps and shapes", group: SECTIONS.start,
    blocks: [
      h1("Text, stamps and shapes") +
      tryIt(ol([
        `Choose ${b("Text")} and tap anywhere below. Type a sentence. Drag instead of tapping to make a box of a set width.`,
        `Choose ${b("Stamp")} and tap to place a star. The ▾ under it has more stamps.`,
        `Choose ${b("Shapes")} and drag to draw an arrow from your sentence to your stamp.`,
        `Choose ${b("Select")}, then drag your stamp somewhere else.`,
      ])) +
      p(`Right-click anything on the page (on a tablet, press and hold it) for options like ${b("Duplicate")} and ${b("Delete")}.`),
      { gap: 280 },
    ],
  },
  {
    label: "Add pages", group: SECTIONS.start,
    blocks: [
      h1("Add pages") +
      p(`${b("Add page")}, at the left of the toolbar, is every way to add a page:`) +
      ul([
        `${b("Blank paper…")} — lined, graph, dot grid, music staves and more.`,
        `${b("From a file…")} — a PDF, Word or PowerPoint file you already have. Each page of the file becomes a page here, and its web links keep working.`,
        `${b("From Google Drive…")} — the same, straight from your Drive.`,
        `${b("From your library…")} — a page you've saved to reuse.`,
        `${b("Copy of this page")} — with every box on it.`,
      ]) +
      tryIt(ol([
        `Press ${b("Add page")} → ${b("Blank paper…")}, choose graph paper and add one page after this one.`,
        `In the page list on the left, right-click your new page (or press and hold it) and choose ${b("Delete")}.`,
      ])),
    ],
  },
  {
    label: "Answer boxes", group: SECTIONS.start,
    blocks: [
      h1("Boxes students fill in") +
      p(`Lay boxes over your worksheet where answers go. Students type, tick or choose; you see every answer when you grade. ${b("Add element")} has them all: ${b("Text box")}, ${b("Checkbox")}, ${b("Dropdown")}, ${b("Prompt")}, ${b("Image upload")} and ${b("Audio")}.`) +
      p("Here's one of each of the first three:"),
      { field: { type: "text", w: 220, h: 26, label: "Type here" }, h: 34 },
      { field: { type: "checkbox", w: 22, h: 22, label: "I read the instructions" }, h: 30 },
      { field: { type: "choice", w: 200, h: 26, label: "Pick one", options: ["Mitochondria", "Nucleus", "Ribosome"] }, h: 38 },
      p(`On an uploaded worksheet, ${b("Add element")} → ${b("Find blanks on this page")} puts a box on every blank line and empty cell for you.`) +
      tryIt(p(`Choose ${b("Add element")} → ${b("Text box")} and drag a box over the blank line below.`)),
      { gap: 8 },
      p("The capital of France is ____________________________."),
    ],
  },
  {
    label: "Push to a class", group: SECTIONS.start,
    blocks: [
      h1("Hand it out") +
      p(`You're in a ${b("template")}: a notebook you build once and hand to as many classes as you like. When it's ready:`) +
      ol([
        `Go to ${b("Notebooks")}, find the template under ${b("Templates")}, and press its ${b("⋯")}.`,
        `Choose ${b("Push to classes…")} and tick your classes. Each gets its own copy, as a draft.`,
        `Open a class's copy and press ${b("Publish to students")}. Every student in the class gets their own notebook. Students who join later get one too.`,
      ]) +
      p(`Added pages to the template later? Its ${b("⋯")} → ${b("Send updates")} adds just the new pages and boxes to every class. Nothing students wrote is touched.`) +
      p(`A notebook made inside a class skips the template step: it has its own ${b("Publish to students")} button at the top right.`) +
      tryIt(p(`Push this guide to one of your classes. You'll use that copy on the next pages. (Don't publish it to real students unless you want them to see it.)`)),
    ],
  },
  {
    label: "Make an assignment", group: SECTIONS.grade,
    blocks: [
      h1("Make an assignment") +
      p("An assignment is some pages of a class notebook, a due date, and how you'll grade it.") +
      ol([
        `In a class notebook, tick the pages in the page list on the left.`,
        `In the bar that appears, press ${b("Create assignment")}.`,
        `Give it a title and a due date, and choose how to grade it: points, a letter, or complete/incomplete.`,
        `If the class came from Google Classroom, leave ${b("Also post to Google Classroom")} ticked.`,
      ]) +
      p(`You can also start one from a class's ${b("Assignments")} tab with ${b("New assignment")}. Teach several sections from one template? ${b("Also assign in")} gives the same assignment to each.`),
    ],
  },
  {
    label: "See it as a student", group: SECTIONS.grade,
    blocks: [
      h1("See it the way a student will") +
      p(`Before you hand anything out, check what students get. Press the ${b("⋯")} next to the notebook's title and choose ${b("Preview as a student")}.`) +
      ul([
        `It's the student's screen: their tools, their boxes, nothing of yours they shouldn't see.`,
        `Anything you've written but not yet published shows too, so you can check it before it goes out.`,
        `Nothing you do in the preview is saved.`,
      ]) +
      tryIt(p(`Open ${b("Preview as a student")}, go to the ${b("Answer boxes")} page, and type an answer into the box you made.`)),
    ],
  },
  {
    label: "Grade", group: SECTIONS.grade,
    blocks: [
      h1("Grade where the work is") +
      p(`Open an assignment and press ${b("Grade")}. Students are on the left, the assigned pages next to them, and the student's work in the middle.`) +
      ul([
        `Write on their page with the ${b("Pen")}, add a ${b("Stamp")}, or use ${b("Comment")} to pin a note exactly where it belongs.`,
        `Point at anything a student wrote or typed to see when they did it. The ${b("History")} button shows everything, in order.`,
        `Enter the grade and a comment, then ${b("Save grade")} to keep it private, or ${b("Save & return")} to give it back now.`,
        `${b("Return all graded")} gives back everything you've graded at once. Grades go to Google Classroom too, if the assignment's there.`,
      ]) +
      p(`To try it, push this guide to a class, publish it, and have a student (or a second account of yours) write on a page.`),
    ],
  },
  {
    label: "Google Classroom", group: SECTIONS.grade,
    blocks: [
      h1("Keep Google Classroom") +
      p("Notesanity works alongside Classroom rather than replacing it.") +
      ul([
        `${b("New class")} → ${b("Import from Google Classroom")} brings a course across with its roster.`,
        `${b("Also post to Google Classroom")} on an assignment posts it there with a link back here.`,
        `When a student turns work in here, it's turned in on Classroom too, with a link to their work attached.`,
        `Grades you return here show up in Classroom's gradebook.`,
      ]) +
      p("Google asks you, and each student, for permission once."),
    ],
  },
  {
    label: "Links and text", group: SECTIONS.more,
    blocks: [
      h1("Text blocks and links") +
      p(`${b("Add element")} → ${b("Text")} makes a block for headings, instructions or a reading passage, with bold, lists and links. This page is made of them.`) +
      p(`${b("Add element")} → ${b("Link")} makes something students tap to open a website. Choose ${b("A button")} for blank space, or ${b("An outline over the page")} to make words already on a worksheet open a link.`) +
      p("Here's a button:"),
      { field: { type: "link", w: 230, h: 30, label: "Open the help center", content: "https://notesanity.com/help", options: ["button"] }, h: 40 },
      tryIt(p(`Add a link button below that opens a website you use in class. Then try it in ${b("Preview as a student")}.`)),
    ],
  },
  {
    label: "Page library", group: SECTIONS.more,
    blocks: [
      h1("Reuse pages") +
      p("The weekly warm-up, the lab write-up frame, the exit ticket: save it once and drop it into any notebook.") +
      ul([
        `Right-click a page in the page list and choose ${b("Save to library")}.`,
        `${b("Add page")} → ${b("From your library…")} puts a saved page into this notebook.`,
        `The ${b("Library")} tab at the top keeps them. ${b("Add to notebooks")} on a saved page adds it to several notebooks at once, shown to students or kept as a draft.`,
      ]) +
      tryIt(p(`Save this page to your library, then find it in the ${b("Library")} tab.`)),
    ],
  },
  {
    label: "Present", group: SECTIONS.more,
    blocks: [
      h1("Show it on the projector") +
      p(`${b("View")} → ${b("Present")} fills the screen with just the pages. Use the arrow keys to move between them.`) +
      p(`Press ${b("Annotate")} to write over the page while you teach, to work an example or circle a word. That writing is like a whiteboard marker: it's gone when you stop presenting, and students never get it.`) +
      tryIt(p(`Present this page and annotate the sentence below.`)),
      { gap: 10 },
      h2("Photosynthesis turns light into food."),
    ],
  },
  {
    label: "Templates", group: SECTIONS.more,
    blocks: [
      h1("Build once, teach every section") +
      p(`Teach the same unit to several classes? Make it a template from ${b("Notebooks")} → ${b("New template")}, then push it to each class.`) +
      ul([
        `Each class gets its own copy. Change one class's copy and the others stay as they are.`,
        `Add pages to the template later and ${b("Send updates")} adds only what's new to every copy.`,
        `Templates don't count toward the Free plan's notebook limit.`,
      ]),
    ],
  },
  {
    label: "Families", group: SECTIONS.school,
    blocks: [
      h1("Let families see the work") +
      p(`A parent or guardian can follow their child's notebooks, assignments and returned grades, to look at but never change.`) +
      ol([
        `Open a class, go to ${b("Roster")}, and press ${b("Families")}.`,
        `Every student has a family code. Email it, copy the link, or ${b("Print codes to send home")} for a slip per student.`,
        `A parent who signs in with the code sees only their own child.`,
      ]) +
      p("Your school's admin can turn family access off for the whole school."),
    ],
  },
  {
    label: "For school admins", group: SECTIONS.school,
    blocks: [
      h1("If you run Notesanity for your school") +
      p(`A school admin has an ${b("Admin")} page:`) +
      ul([
        `See everyone at your school and change whether they're a teacher or a student.`,
        `Set which email domains belong to teachers and which to students, so new people sign in to the right place.`,
        `Turn family access on or off, and see which families are linked.`,
      ]) +
      p(`Questions, or setting up a whole school? Use the contact page on notesanity.com.`),
      { field: { type: "link", w: 200, h: 30, label: "Contact us", content: "https://notesanity.com/contact", options: ["button"] }, h: 40 },
    ],
  },
];

// --- Build ------------------------------------------------------------------
const tpl = (await api("POST", "/api/my/templates", {
  title: "Getting started with Notesanity", pages: PAGES.length, pattern: "blank", color: "#4A8C6F",
})).notebook.id;
const pages = (await api("GET", `/api/notebooks/${tpl}`)).pages;
if (pages.length !== PAGES.length) throw new Error(`expected ${PAGES.length} pages, got ${pages.length}`);

for (let i = 0; i < PAGES.length; i++) {
  const spec = PAGES[i];
  const pageId = pages[i].id;
  await api("PATCH", `/api/notebooks/${tpl}/pages/${pageId}`, { label: spec.label, groupName: spec.group });
  let y = 48;
  for (const block of spec.blocks) {
    if (typeof block === "string") {
      const h = heightOf(block);
      await api("POST", `/api/notebooks/${tpl}/fields`, { pageId, type: "richtext", x: X, y, w: COL, h, content: block, label: "", options: [] });
      y += h + 6;
    } else if (block.gap) {
      y += block.gap;
    } else if (block.field) {
      const f = block.field;
      await api("POST", `/api/notebooks/${tpl}/fields`, {
        pageId, x: X, y, w: f.w, h: f.h, type: f.type, label: f.label ?? "", content: f.content ?? "", options: f.options ?? [], prompt: "",
      });
      y += block.h;
    }
    if (y > H - 24) console.warn(`  page ${i + 1} (${spec.label}) runs past the bottom: y=${Math.round(y)}`);
  }
  console.log(`page ${i + 1}/${PAGES.length}: ${spec.label} (bottom at ${Math.round(y)} of ${H})`);
}
console.log(`\nDone: ${BASE}/notebooks/${tpl}/edit`);
console.log(`Then on Notebooks, its ⋯ → "Make this the teacher guide".`);
