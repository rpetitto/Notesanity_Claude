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
    "September 24, 2026",
    "A simpler toolbar, links that work, a menu for everything on a page, a page comparing Notesanity with the tools you already know, and what the Free plan will include after the beta.",
    [
      ["better", "<b>One toolbar instead of three tabs.</b> Building a notebook no longer means switching between Pages, Fields and Annotate. Everything you put on a page is under two buttons: <b>Add page</b> (blank paper, a file, Google Drive, your library or a copy of this page, after this page or at the end) and <b>Add element</b> (your own text, pictures and links, and the boxes, checkboxes, dropdowns, prompts, uploads and recordings students fill in). Pick one, then tap the page to place it at a standard size or drag to size it; Escape cancels. The pen, highlighter and the rest sit beside them, with <b>Select</b> for moving and changing things."],
      ["new", "<b>Write on the page while you present.</b> Press <b>Annotate</b> in the presenting controls and the writing tools come up over the page, for working an example in front of the class. It's a whiteboard marker: undo and redo work, the writing stays as you turn pages, and it's gone when you stop presenting. Nothing is saved or sent to students. Press Annotate again to put the tools away and leave the writing up."],
      ["better", "<b>Colors and sizes where the tool is.</b> Picking a tool opens its colors and sizes, and they close as soon as you start writing; tap the tool again, or the <b>▾</b> beside it, to bring them back. Every color has a name and a check when it's chosen, so you don't have to tell green from blue by sight, and each tool remembers its own color and size. Zoom, presenting, previewing as a student and <b>Draw with my finger</b> are under <b>View</b>; on a phone, the tools that don't fit are under <b>More</b>, so nothing scrolls sideways."],
      ["better", "<b>The toolbar works from the keyboard and with a screen reader.</b> Tab reaches it once, the arrow keys move along it, and every tool says what it is and whether it's the one in hand."],
      ["new", "<b>A menu for everything on a page.</b> Right-click anything, or press and hold it with a finger, for what you can do with it. Your own writing, notes and stamps: change the color or size, duplicate, delete, and see when you wrote them. Anyone else's marks: when they were made, and when you're grading, <b>Comment here</b>. Links: open or copy. Blank paper: start a note. In the editor, every box has <b>Duplicate</b> and <b>Delete</b>, and a selected box or mark gets a <b>…</b> button with the same menu. The pen never opens it, and neither does a finger while <b>Draw with my finger</b> is on."],
      ["new", "<b>Page actions on a tablet.</b> Rename, duplicate, save to library, hide and delete a page by pressing and holding it in the page list, or with its <b>…</b> button. They were only on a mouse hover before, so an iPad couldn't reach them."],
      ["better", "<b>Deleting a box can be undone.</b> Delete a box from the menu, the side panel or the Delete key, and an Undo appears for a few seconds; the box comes back with every answer students typed into it. <b>Delete</b> and <b>Ctrl+D</b> (<b>⌘D</b>) now work on a selected box or mark."],
      ["fixed", "<b>A press no longer nudges a box.</b> Selecting a box in the editor moved it with the slightest wobble and saved the new spot; now it only moves once you actually drag. A right-click no longer grabs a box or a mark to drag it."],
      ["new", "<b>The links in your worksheets work.</b> Upload a PDF, Word or PowerPoint file and its web and email links stay where they were, ready for a student to tap. They open in a new tab. A notebook made before today kept only the words; choose <b>Add element</b> &rarr; <b>Link</b> and it offers to put that page's links back."],
      ["new", "<b>Add a link of your own.</b> <b>Link</b>, next to Text and Picture under <b>Add element</b>, makes anything on the page open a website: drag over the words or picture and paste the address. Text blocks have a link button too."],
      ["fixed", "<b>Students see the notes, stamps and comments you publish on a page.</b> Only your pen and highlighter lines reached them: typed notes, stamps and comment pins added on top of the page were published but never shown. Every student now sees them, and can read them but not move or change them."],
      ["fixed", "<b>With the pen picked up, tapping an answer box puts the cursor in it.</b> The tap drew a dot on the page instead, so typing an answer meant switching tools first. A tap now opens a link, too, and a stroke that starts on a box or a link still writes."],
      ["new", "<b>How Notesanity compares.</b> A new <a href=\"/compare\">comparison page</a> sets Notesanity beside Kami, OneNote Class Notebook, Google Classroom and Notability — what each does, where each is stronger than we are, and which to choose — with every claim about another product checked against that company's own site and dated."],
      ["better", "<b>The Free plan's limits, set out ahead of time.</b> When paid plans arrive, the Free plan will include five class notebooks at a time and up to 35 students in each class. Nothing changes during the beta: every class and notebook stays open, and you'll get a full semester's notice before any limit applies. Archived notebooks never count, nothing is ever deleted, and Pro has no limit on either. See <a href=\"/pricing\">pricing</a>."],
    ],
  ],
  [
    "September 23, 2026",
    "A Notebooks tab with templates, documents straight into the library, and a presenting mode.",
    [
      ["new", "<b>Build a notebook once, use it in every class.</b> The new <b>Notebooks</b> tab lists everything you teach from, filtered by class \u2014 and holds <b>templates</b>: notebooks that belong to you rather than to a class. Push a template into any class you teach and it arrives as a draft, ready to publish there. Add pages or answer boxes to the template later and press <b>Send updates</b>: every class gets what's new. Nothing already in a class is changed \u2014 a page you renamed for one section, a box you moved, work students have done \u2014 only added to. A typo fixed in the template is fixed in the classes by hand, on purpose."],
      ["new", "<b>Bring a document straight into your page library.</b> On the Library page, <b>Add pages</b> takes a PDF, Word or PowerPoint file (or one from Google Drive), shows you every page, and saves the ones you tick \u2014 the two worksheets you wanted, not the twelve pages of answer key behind them. No notebook needed in between."],
      ["new", "<b>Present a notebook.</b> A <b>Present</b> button beside the zoom menu shows just the pages, full screen, for a projector or a screen share: one page at a time with the arrow keys, or the whole notebook scrolling. Your unsent writing is included, so what's on the wall is what you're looking at. Nothing done there is saved."],
      ["better", "<b>More room for the page.</b> The tool row tucks away with the arrow at its right end (the tabs stay, and picking one brings it back), and the page list beside the page folds to a sliver with the arrow at its top. Both remember how you left them."],
      ["better", "<b>A notebook opens on the Pages tab</b>, where every notebook starts, rather than on Answer boxes."],
      ["better", "<b>Push to several classes at once — and several templates at once.</b> A template's menu has one <b>Push to classes…</b> instead of a line for every class you teach. Tick as many classes as you like; the ones that already have it are shown and left alone. To send a whole unit, press <b>Select</b> above your templates, tick the ones you want, and push them together."],
      ["better", "<b>Built for a whole school writing at once.</b> Saving ink or typed answers, opening a notebook, joining a class, publishing, setting an assignment and pushing a template now ask the database a small, fixed number of questions instead of one or more per page, per student or per class. An autosave went from thirteen trips to the database to about four, and publishing to a class of thirty from sixty-nine to four, so the app stays quick when every class in a building is working at the same time."],
      ["fixed", "<b>Pressing Push or Send updates twice can't make duplicates.</b> Two pushes of the same template into a class that arrived together could make two copies, and two update runs at once could add a page twice. Now there is only ever one of each."],
      ["fixed", "<b>The contact form sends every time.</b> If the page's script hadn't run — blocked, switched off, or the button pressed before the page finished loading — sending the form showed an error and the message never reached us. It now goes through either way and says so on the page. If you wrote to us in the last week and haven't heard back, please send it again or email <a href=\"mailto:support@notesanity.com\">support@notesanity.com</a>."],
      ["fixed", "<b>The arrow on a dropdown menu no longer crowds its edge.</b> It sat hard against the border on some menus; every dropdown now has the same arrow with room around it."],
    ],
  ],
  [
    "September 21, 2026",
    "A tidier editor, Google Classroom assignments, spoken comments, saved phrases, read aloud, shapes, and blanks found on scans.",
    [
      ["better", "<b>The notebook editor's tools are now three tabs.</b> <b>Pages</b> adds paper and puts a block of text or a picture of yours on a page; <b>Answer boxes</b> is everything a student fills in, with <b>Find blanks</b> beside it; <b>Annotate</b> is your pen. One row of tools under them, each tool with its name on it, and nothing to scroll sideways for any more \u2014 on a phone the row wraps instead. Everything is where it was in spirit; it just isn't all on screen at once."],
      ["new", "<b>Post an assignment to Google Classroom.</b> If your class came from Classroom, creating an assignment now offers to post it there too. It appears in that course with a link that takes each student straight to the pages, with your due date on it. Grade the work here, return it, and the grades go back to your Classroom gradebook."],
      ["better", "<b>Classroom grades carry across where they can.</b> Points and complete/incomplete go back as numbers, which is all Classroom accepts \u2014 a letter grade stays in Notesanity, and the assignment posts ungraded there. A grade can only go back to an assignment Notesanity posted, because Google doesn't let one app change another's work."],
      ["new", "<b>Read a page out loud.</b> Every page now has a <b>Read aloud</b> button above it. It reads the worksheet in order, and says \"blank\" where there's a line to fill in, so a student who reads slowly can listen instead. Nothing to install and nothing to turn on."],
      ["fixed", "<b>Find fields understands tables now.</b> It used to offer one long box across a whole row of a table, and on a slide-style worksheet it could drop boxes over the title of a section. It now reads the table's own lines, offers one box per <em>empty</em> cell, and leaves the header row, the row labels, section frames and pictures alone. The same goes for a scanned table."],
      ["better", "<b>Find fields now works on a scanned worksheet.</b> It used to read the document's own text, so a worksheet you photographed or scanned had nothing to find. It now looks at the page itself and picks out the ruled lines, which is what the blanks actually are on a scan."],
      ["new", "<b>Saved phrases.</b> The sentences you write on every third paper are now one tap away. Write a comment, press <b>Save this phrase</b>, and it's offered inside every comment box from then on — in your own classes, next term, next year. The ones you reach for most rise to the top on their own."],
      ["new", "<b>Say it instead of typing it.</b> Open a comment while marking and there's now a <b>Say it instead</b> button: record a few seconds out loud and it's pinned to that spot on the page for the student to play back. Faster to give than typing, and a lot warmer to receive. You can still add written text alongside it."],
      ["new", "<b>Shapes.</b> A new tool in the annotation toolbar draws a line, an arrow, a box or a circle. Drag to place one, and use a line as an underline or a strikethrough. A shape behaves like anything else you draw: rub it out with the eraser, or pick it up to move, resize and turn it."],
      ["better", "<b>Finding the blanks in a worksheet stays free for everyone.</b> When the beta ends, Pro will be about making last year's work pay off again: unlimited notebooks and the page library. Nothing you need to teach this week goes behind it. You'll get a full semester's notice before anything changes."],
    ],
  ],
  [
    "September 18, 2026",
    "Pinch zooms the page, and worksheets fill themselves in.",
    [
      ["new", "<b>See your notebook the way your class will.</b> <b>Preview as a student</b>, in a notebook's ··· menu, opens it exactly as a student gets it — your writing on the pages, your answer boxes ready to fill in. It includes writing you haven't sent yet, so you can check a page before you publish it. Nothing you type or draw in a preview is saved, and it never touches a real student's notebook."],
      ["new", "<b>Find the blanks in a worksheet for you.</b> Open a page you made from a PDF and press <b>Find fields</b>: Notesanity reads the document and offers an answer box for every fill-in line it finds, and a checkbox for every tick box. They appear as dashed outlines first — tap any one to skip it — and nothing is added to the page until you say so. It reads the document's own text, so a worksheet you scanned as a picture has nothing to find."],
      ["better", "<b>On a phone or tablet, pinching zooms the page, not the app.</b> Two fingers on a page make that page bigger or smaller around the spot under your fingers, and the toolbar's zoom menu shows where you landed. The header and toolbars stay put. Before, a pinch scaled the whole screen the way it would on any website, and the buttons went with it."],
      ["fixed", "With finger drawing on, starting a pinch no longer leaves a dot where the first finger touched down."],
    ],
  ],
  [
    "September 17, 2026",
    "Tap and type.",
    [
      ["new", "<b>Just tap and type.</b> With <b>Scroll only</b> up, tap anywhere on the paper and start typing — a note appears right there and grows with what you write, up to the edge of the page. No need to pick the Text tool first. The note is like any other mark afterwards: tap it to select, then move, resize or turn it."],
      ["better", "<b>The notebook editor fits a phone.</b> The top bar is two tidy rows on a phone — the title with the notebook menu, then Add, Annotate and Publish — instead of three ragged ones with the title squeezed between buttons. Nothing changes on a laptop."],
      ["better", "<b>The Text tool taps or draws.</b> A tap puts down a note that sizes itself to your text; a drag draws a box of the width you want, which is what a teacher setting up an answer area on an assignment page is usually after. Resizing a self-sizing note with a handle pins its width."],
    ],
  ],
  [
    "September 15, 2026",
    "Lower prices, and annotations you can pick up and move.",
    [
      ["better", "<b>Prices are lower.</b> Pro is $49 a year instead of $59, and Department is $499 a year for 20 Pro seats instead of $649. School stays $999. Nothing changes for you today — everything is still free while we're in beta, and you'll still get a full semester's notice before that ends. See <a href=\"/pricing\">pricing</a>."],
      ["new", "<b>Select an annotation to move, resize or rotate it.</b> Tap a pen stroke, stamp or typed note and it gets a box with handles: drag the box to move it, a corner or edge to resize, the handle above to turn it. Tapping one while the annotation tools are put away opens them for you with that mark already selected."],
      ["new", "<b>Your page library has its own tab</b> in the top navigation, next to Assignments, where you can rename or remove saved pages. Saving to the library now happens from the toolbar that appears when you check pages, and saves every checked page at once."],
      ["better", "Adding a library page offers <b>After the current page</b> first, and a page you've just saved shows up in the library right away rather than after a refresh."],
      ["better", "The three ways to start a notebook are one <b>New notebook</b> button now, the same shape as New assignment."],
      ["better", "A class's student notebooks are a list sorted by most recently updated, with a filter by student, instead of a wall of cards."],
      ["better", "The Plan card in Settings describes the plan you're on and links to the pricing page."],
      ["better", "<b>A student's New notebook works like a teacher's.</b> The same three ways in — blank paper, a file on this device, or Google Drive — from one button in My notebooks. A blank one starts at 10 pages instead of 50; change it before you create if you want more."],
      ["fixed", "A teacher who joined a colleague's class as a student saw a \"You don't teach this class\" error on the Grades tab. It now shows their grades, and says so plainly when nothing has been graded yet. Each class card now carries a small <b>Teaching</b> or <b>Enrolled</b> tag, and the class page says when you're a student in it rather than its teacher."],
    ],
  ],
  [
    "September 14, 2026",
    "A page library, a real admin panel for school admins, and a couple of places another school shouldn't have been visible.",
    [
      ["better", "Page thumbnails now show what's been written on them. In a notebook you see your own markup; while grading you see the student's work and your marking, so scanning the rail tells you which pages have been worked on without opening any of them."],
      ["new", "<b>Pricing is published.</b> Free, Pro, Department and School are on the <a href=\"/pricing\">pricing page</a> now, with the real prices shown — and everything stays free for everyone while we're in beta. When that changes, schools get a full semester's notice first."],
      ["new", "<b>Save a page to your library and use it again.</b> Any page — the Monday warm-up, a lab write-up frame, an exit ticket — can be saved from the page list, then dropped into any other notebook from <b>Add pages</b> &rarr; <b>Page library</b>. Its answer boxes and your own markup come with it. The saved copy is independent: editing or even deleting the notebook it came from leaves it untouched."],
      ["new", "<b>School admins now have their own admin panel.</b> Open Admin from Settings to manage your people, see your sign-in email delivery, and look over your school's notebooks, assignments and grades — without needing platform-wide access."],
      ["fixed", "Importing a Google Classroom roster, inviting a student by email, or adding a co-teacher by email could silently pull in someone who already had an account at a different school. Those cases are now called out by name instead."],
      ["fixed", "A school admin's sign-in email log showed activity from every school on the platform, not just their own. It's scoped to your school now."],
    ],
  ],
  [
    "September 13, 2026",
    "A clearer grading screen, real undo on a notebook, and a way back out of a mistake.",
    [
      ["new", "The grading screen puts your roster on the left, where you actually start — pick a student, then a page, then look at it. The old scattered row of icon buttons is now two clear controls: step through students, and choose whether a page stays put while you do or scrolls with each one."],
      ["new", "Undo and redo now work while you're writing on a notebook itself (Annotate), not just while grading — the buttons were there before but did nothing."],
      ["new", "<b>Discard unsent writing</b>, in a published notebook's menu. If you've written on pages since the last update and change your mind, this throws it away and puts every page back to what students already have. Nothing already sent is touched."],
      ["better", "Picking pages for an assignment is paginated now instead of showing every page in the notebook at once — a hundred-page notebook no longer means a hundred thumbnails on one screen."],
    ],
  ],
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
