import { layout } from "../layout.mjs";

/**
 * The help center.
 *
 * Written from what the app actually does today, not from what it might do —
 * a help page that describes a feature which isn't there costs more support
 * time than it saves. Video and longer documentation are planned to sit
 * alongside these, which is why each answer is short and self-contained rather
 * than one long tour.
 */

const qa = (q, a) => `
  <details class="card" style="margin-bottom:12px">
    <summary style="cursor:pointer;font-family:var(--display);font-size:18px;font-weight:700;list-style:none">${q}</summary>
    <div style="margin-top:12px" class="quiet">${a}</div>
  </details>`;

/** Every Q&A on the page, collected as it renders, for the FAQ schema. */
const ALL = [];

const group = (title, items) => (ALL.push(...items), `
  <h2 id="${title.toLowerCase().replace(/[^a-z]+/g, "-")}">${title}</h2>
  ${items.map(([q, a]) => qa(q, a)).join("")}`);

const stripTags = (html) =>
  String(html).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

export default () => {
  // The body is built first: `group()` fills ALL as it renders, so the schema
  // below is generated from exactly the questions the page shows. They cannot
  // drift, because one is a function of the other.
  const body = BODY();
  return layout({
    schema: {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: ALL.map(([q, a]) => ({
        "@type": "Question",
        name: stripTags(q),
        acceptedAnswer: { "@type": "Answer", text: stripTags(a) },
      })),
    },
    path: "/help",
    title: "Help center",
    description:
      "Answers about building notebooks, assigning work, grading, students' own notebooks, sign-in and offline behavior in Notesanity.",
    body,
  });
};

const BODY = () => `
<section>
  <div class="wrap narrow">
    <p class="eyebrow">Help center</p>
    <h1>How Notesanity works</h1>
    <p class="lede">
      Short answers to the questions we're asked most. Walkthrough videos and fuller
      documentation are on the way; if something here doesn't cover it,
      <a href="mailto:support@notesanity.com">email us</a> and we'll answer and add it.
    </p>

    ${group("Getting started", [
      [
        "How do I sign in?",
        `Three ways: <b>Continue with Google</b> using your school account, a
         <b>sign-in link</b> emailed to you, or an email and password. They all reach the same
         account — the address is what identifies you, not the method.`,
      ],
      [
        "Why hasn't my sign-in link arrived?",
        `Check your spam folder first. School mail systems filter unfamiliar senders hard, and
         Notesanity is a new sender. If you administer your school's email, allowlisting
         <b>notesanity.com</b> fixes it for everyone at once. Signing in with Google avoids email
         entirely and is the most reliable route at a school.`,
      ],
      [
        "Can I see the walkthrough again?",
        `Yes. The short tours that appear the first time you open your home screen, a class or a
         notebook can be started over under <b>Settings</b> &rarr; <b>Guided tours</b>. Skipping
         one only hides it until you ask for it back.`,
      ],
      [
        "How is Notesanity different from Kami, OneNote or Google Classroom?",
        `Notesanity keeps the whole loop in one place: build a notebook from a worksheet, give every
         student their own copy, assign pages, and grade on the page they wrote on. The
         <a href="/compare">comparison page</a> goes product by product, including where each is
         stronger.`,
      ],
      [
        "Who can create an account?",
        `Only addresses on a domain your school has approved. The first person to sign in sets
         the school up; after that an admin decides which domains count as staff and which as
         students, from the <b>Admin</b> page.`,
      ],
    ])}

    ${group("Building notebooks", [
      [
        "What can I turn into a notebook?",
        `A PDF, a Word document or a PowerPoint deck — the last two are converted through your
         own Google Drive, so the file never passes through us as anything but a PDF. You can
         also pick a file straight out of Drive, or start from blank paper.`,
      ],
      [
        "Can I reuse a page in another notebook?",
        `Yes — that's the page library. Hover a page in the page list and choose <b>Save to your page
         library</b>, then add it to any other notebook from the <b>Pages</b> tab &rarr; <b>Library</b>.
         Its answer boxes and your own markup come across; nobody's work does. The saved copy stands on
         its own, so changing or deleting the original notebook doesn't touch it.`,
      ],
      [
        "Can I use one notebook in several classes?",
        `Yes \u2014 make it a <b>template</b>. On the <b>Notebooks</b> tab, <b>New template</b> builds a
         notebook that belongs to you rather than to a class. <b>Push to classes…</b> in its menu puts it
         into as many of your classes as you tick, each as a draft for you to publish there. To push several
         templates together, press <b>Select</b> above them first. When you add pages or answer boxes to the template
         later, <b>Send updates</b> gives every class the new material. It only ever adds: a page you
         changed in one class, or work students have done there, is never overwritten, and a change to
         something already in the classes has to be made in each class.`,
      ],
      [
        "Can I put a whole document into my page library?",
        `Yes. On the Library page, <b>Add pages</b> takes a PDF, Word or PowerPoint file, or one from
         Google Drive, shows you every page in it, and saves the ones you tick. Each becomes its own entry,
         named after the file and its page number, which you can rename afterwards.`,
      ],
      [
        "Can I show a notebook on the projector?",
        `Press <b>Present</b>, next to the zoom menu in a notebook. It goes full screen with only the
         pages showing \u2014 one at a time with the arrow keys, or the whole notebook scrolling \u2014 and
         includes writing you haven't sent to students yet. Nothing you do while presenting is saved.
         Escape brings the editor back.`,
      ],
      [
        "What blank paper is there?",
        `Lined (wide or college), graph, dot grid, music staves, engineering, isometric, a
         coordinate plane, or plain blank — in eight rule colors, and you choose how many
         pages, up to 100. You can add more pages at any time.`,
      ],
      [
        "What can I put on a page?",
        `Text boxes, checkboxes, dropdowns, prompts with an answer area, image uploads and audio
         recordings for students to fill in — plus rich text and pictures of your own that are
         part of the page rather than something to answer.`,
      ],
      [
        "How does a notebook reach my students?",
        `Press <b>Publish to students</b> and every student in the class gets their own copy.
         Change something later — a typo, an extra page — and <b>Update student notebooks</b>
         sends the change to all of them at once; their writing stays exactly where they put it.
         Publishing is separate from assigning: a notebook can sit with a class to be written in
         without ever being homework.`,
      ],
      [
        "What's the difference between archiving and deleting?",
        `Archiving puts something away and keeps everything: a notebook leaves the class, a class
         leaves everyone's list, and all the work inside stays exactly as it was. You can bring
         either back. Deleting is permanent — which is why a notebook can only be deleted before
         it's published, and deleting a class asks you to type its name first.`,
      ],
      [
        "Can I get a notebook out as a file?",
        `Yes — <b>Export</b> in a notebook gives you a PDF, either downloaded or saved straight to
         your Google Drive. It's every page as it looks on screen, with the writing on it.
         Students can export their own notebooks the same way.`,
      ],
      [
        "Can students see a notebook I'm still building?",
        `No. A notebook is a draft until you press <b>Publish to students</b>, and a draft is yours
         alone — it isn't listed in the class, can't be opened by a link, and can't be set as an
         assignment. Publish it when it's ready and the class gets it.`,
      ],
      [
        "Can I reorganize pages after students have started?",
        `Yes. Pages carry a permanent identity, so renaming, regrouping and reordering them
         doesn't disturb work already written on them. Inserting a page inside a section keeps
         it in that section.`,
      ],
    ])}

    ${group("Assigning and grading", [
      [
        "How do I set work?",
        `Publish the notebook to the class first, then create an assignment over it: choose which
         of its pages the task covers and set a due date. Those pages are the ones that come back
         to you to be graded. A student who joins later is caught up automatically, and you're
         asked which past assignments should apply to them.`,
      ],
      [
        "Can I post an assignment to Google Classroom?",
        `Yes, when the class came from Classroom \u2014 import it with <b>New class</b> and the
         link is made for you. Creating an assignment then offers <b>Also post to Google
         Classroom</b>: it appears in that course with your due date and a link that takes each
         student straight to the pages. Google asks your permission the first time, and saving
         a draft posts nothing.`,
      ],
      [
        "Do grades go back to Google Classroom?",
        `For an assignment you posted from here, yes: returning the work sends the grade to your
         Classroom gradebook. Only an assignment Notesanity posted can take a grade \u2014 Google
         doesn't let one app change another's \u2014 so one you made in Classroom by hand can't.
         Points and complete/incomplete go across as numbers; a letter grade stays here, because
         Classroom only accepts numbers. If a student never pressed <b>Turn in</b> in Classroom,
         the grade waits in your Classroom gradebook until you return it there.`,
      ],
      [
        "How do I grade?",
        `Open the assignment. Your roster is on the left — pick a student, then a page — and you
         write on their page in your own layer, so your marks and their work never mix. Add a
         comment, set a grade, and return it.`,
      ],
      [
        "Can I undo a mistake I made writing on a notebook?",
        `Yes — the undo and redo buttons in the toolbar work while you're annotating a notebook
         (not just while grading), and go back through everything you've drawn since you opened
         the page.`,
      ],
      [
        "I changed my mind about something I wrote on a published notebook. Can I undo it?",
        `If you haven't sent it yet, yes — open the notebook's \u2022\u2022\u2022 menu and choose
         <b>Discard unsent writing</b>. It throws away everything you've written since the last
         update and puts every page back to what your students already have. Nothing already sent
         to them is touched.`,
      ],
      [
        "Can a student change work after handing it in?",
        `No. Handing in freezes the pages, and they stay frozen after grading, so nothing can be
         altered after it's been graded. You can reopen a piece if a student needs another go —
         the grade you already gave is kept.`,
      ],
      [
        "What does a returned grade look like to me?",
        `Once returned, the grade panel becomes a record rather than a form: the save buttons are
         hidden and the fields are locked. Reopening it puts it back in play.`,
      ],
    ])}

    ${group("Students' own notebooks", [
      [
        "Can students make their own notebooks?",
        `Yes, two kinds. A <b>personal</b> notebook sits outside every class and nobody else can
         see it. A notebook made <b>inside a class</b> sits alongside the coursework and the
         teacher of that class can read it.`,
      ],
      [
        "What can a teacher do with a student's own notebook?",
        `Read it — and write on any page the student has opened to them. Nothing else: a teacher
         can't change what the student wrote, add pages, or set the notebook as an assignment,
         and classmates can't see it at all.`,
      ],
      [
        "How do I let my teacher write on a page?",
        `Open your notebook and choose <b>Let your teacher write</b> at the top, then tick the
         pages you want. Their writing goes on top of yours in their own color, they can't change
         what you wrote, and unticking a page closes it again.`,
      ],
      [
        "Can students name and organize their own pages?",
        `In their own notebooks, yes: pages can be renamed and grouped into sections. In a
         notebook their teacher built, the pages belong to the teacher.`,
      ],
    ])}

    ${group("Writing and drawing", [
      [
        "Does it work with a stylus?",
        `It's built for one. Ink is pressure-sensitive, and a hand resting on the screen won't
         draw while a stylus is in use. There's a toggle for whether a finger scrolls the page
         or draws on it — scrolling is the default.`,
      ],
      [
        "What does the highlighter do differently?",
        `If it recognizes that you're highlighting along a line of text it snaps the stroke
         straight, so a highlight looks deliberate rather than hand-wobbled.`,
      ],
      [
        "What's the difference between the two erasers?",
        `<b>Quick</b> removes a whole stroke wherever you touch it — fastest for clearing a
         mistake. <b>Manual</b> rubs out only the part you drag over, for fixing one letter
         without redrawing the word.`,
      ],
      [
        "What happens if the Wi-Fi drops?",
        `Work is written to the device first and sent to the server behind it, retrying until it
         lands. A dropped connection mid-lesson doesn't lose the page; it syncs when the network
         returns. The toolbar tells you which state you're in.`,
      ],
    ])}

    ${group("Accounts and data", [
      [
        "How do I manage my school's settings and people?",
        `From the <b>Admin</b> page, if you're a school admin — it's in the navigation once you
         have admin rights. It covers your approved sign-in domains, everyone at your school,
         your sign-in email delivery, and a read-only look at your school's notebooks,
         assignments and grades. It only shows your own school — an admin can't see another
         school's people or work.`,
      ],
      [
        "Is there a limit on how many notebooks I can make?",
        `Not during the beta. When paid plans arrive, the Free plan will allow five class notebooks
         at a time and 35 students in each class — archived notebooks don't count, nothing is ever
         deleted, and you'll have a full semester's notice first. Pro has no limit on either. See <a href="/pricing">pricing</a> for what's coming.`,
      ],
      [
        "Who can see a student's work?",
        `The student, and the teachers of the class it belongs to. Not other students. Personal
         notebooks are visible only to the student who made them.`,
      ],
      [
        "Can we export our work?",
        `A notebook can be exported to PDF from inside it. If you need a bulk export of a whole
         school's data, email <a href="mailto:support@notesanity.com">support@notesanity.com</a>
         and we'll arrange it.`,
      ],
      [
        "How do we delete an account or a school's data?",
        `Email <a href="mailto:support@notesanity.com">support@notesanity.com</a> from a school
         address. See the <a href="/privacy">privacy notice</a> for what we hold and how long.`,
      ],
    ])}

    <div class="card" style="margin-top:32px;background:var(--mint)">
      <h3>Still stuck?</h3>
      <p style="margin-bottom:0">
        Email <a href="mailto:support@notesanity.com">support@notesanity.com</a>. We're a small
        team and we answer our own support, so tell us what you were doing and what happened.
        If something looks broken platform-wide, <a href="/status">the status page</a> is checked
        live rather than updated by hand.
      </p>
    </div>
  </div>
</section>`;
