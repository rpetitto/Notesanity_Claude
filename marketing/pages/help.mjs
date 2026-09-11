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
        "Who can create an account?",
        `Only addresses on a domain your school has approved. The first person to sign in sets
         the school up; after that an admin decides which domains count as staff and which as
         students, under <b>Settings</b>.`,
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
        "How do I grade?",
        `Open the assignment and move through the roster. You write on the student's page in your
         own layer — your marks and their work never mix. Add a comment, set a grade, and
         return it.`,
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
