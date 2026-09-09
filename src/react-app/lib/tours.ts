/**
 * The guided tours, and what each step points at.
 *
 * A tour is keyed by role and place — `teacher.class` and `student.class` are
 * tours of the same screen for two people who can do entirely different things
 * on it. Keying by role rather than writing one tour with conditions also means
 * a student promoted to teacher is shown around again, which is exactly when
 * someone needs it.
 *
 * Steps point at real controls by `data-tour` attribute rather than by
 * coordinates, so a button that moves stays pointed at, and a button that is
 * removed takes its step with it: a step whose target isn't on screen is
 * skipped rather than pointing at nothing. That is also how one tour covers a
 * phone and a desktop — where a control collapses into a menu, the step names
 * both anchors and the first one actually on screen wins.
 *
 * Copy rules, learned from the help center: say what the control is *for*, not
 * what it is. "Read it out and students join themselves" beats "this is the
 * join code". Two sentences at most; anyone reading a third has stopped
 * listening.
 */

export type TourPlace = "home" | "class" | "notebook";

export interface TourStep {
  /**
   * `data-tour` value(s) to point at. The first one present *and visible* wins,
   * which is how a step survives a control collapsing into a menu on a phone.
   * A step with no target is a plain card in the middle — an opener or a
   * sign-off, not a thing to look at.
   */
  target?: string | string[];
  title: string;
  body: string;
}

export const TOURS: Record<string, TourStep[]> = {
  // ---------------------------------------------------------------- teacher
  "teacher.home": [
    {
      title: "Welcome to Notesanity",
      body:
        "Thirty seconds on where everything lives. You can skip it now and start it again " +
        "any time from Settings.",
    },
    {
      target: ["nav-classes", "nav-classes-mobile"],
      title: "Everything sits in a class",
      body:
        "Notebooks, assignments and your roster all belong to a class, so this is where most " +
        "days start.",
    },
    {
      target: "new-class",
      title: "Make your first class",
      body:
        "A name and a section is all it takes. You get a join code straight away that students " +
        "can use themselves.",
    },
    {
      target: "import-classroom",
      title: "Already in Google Classroom?",
      body: "Bring a course across with its roster instead of typing the names in again.",
    },
    {
      target: ["nav-assignments", "nav-assignments-mobile"],
      title: "Everything you've set, in one list",
      body:
        "Assignments across all your classes, with how many students have handed in and how " +
        "many you've graded.",
    },
    {
      target: ["nav-settings", "nav-settings-mobile"],
      title: "Your account, and these guides",
      body:
        "Sign out, check your role, and — if you're a school admin — open the admin console. " +
        "You can replay any of these guides from here.",
    },
  ],

  "teacher.class": [
    {
      target: "class-tabs",
      title: "Three views of one class",
      body:
        "Notebooks are what you build, assignments are what you set, and the roster is who's in " +
        "the room.",
    },
    {
      target: "join-code",
      title: "How students get in",
      body:
        "Read the code out and they join themselves. If it gets out of the room, generate a new " +
        "one — the students already in stay in.",
    },
    {
      target: "notebook-actions",
      title: "Start a notebook",
      body:
        "Bring in a PDF, a Word file or a slide deck, pick something out of Google Drive, or " +
        "start on blank paper and choose the ruling.",
    },
    {
      target: "class-customize",
      title: "Make it recognizable",
      body: "A cover, a color and an emoji, so the right class is obvious at a glance.",
    },
    {
      target: "class-student-notebooks",
      title: "Notebooks students make",
      body:
        "Anything a student starts in this class shows up here. You can read them; you can't " +
        "write in them, and they're never assigned.",
    },
  ],

  "teacher.notebook": [
    {
      target: "nb-fields",
      title: "Ask for an answer",
      body:
        "Pick a box and drag it onto the page where you want it — typing, a checkbox, a " +
        "dropdown, a picture or a recording.",
    },
    {
      target: "nb-annotate",
      title: "Write on the page yourself",
      body:
        "Annotate gives you a pen for the notebook itself: a worked example, an arrow, a " +
        "heading in your own handwriting.",
    },
    {
      target: ["nb-add-pages", "nb-more"],
      title: "More paper, any time",
      body:
        "Add another document's worth of pages, or blank paper in the ruling you want — lined, " +
        "graph, dot grid, staves.",
    },
    {
      target: ["nb-rail", "nb-pages-button"],
      title: "Pages and sections",
      body:
        "Reorder, rename or archive pages here, and group them into sections so \"the practice " +
        "set\" means something.",
    },
    {
      target: "nb-publish",
      title: "Send it to your students",
      body:
        "Publishing gives every student their own copy. Publish again after a change and their " +
        "work stays exactly where they put it.",
    },
  ],

  // ---------------------------------------------------------------- student
  "student.home": [
    {
      title: "Welcome to Notesanity",
      body:
        "Half a minute on where things are. You can skip it and start it again later from " +
        "Settings.",
    },
    {
      target: ["nav-work", "nav-work-mobile"],
      title: "This is your whole day",
      body: "Your assignments, your classes and your own notebooks are all on this one screen.",
    },
    {
      target: "join-class",
      title: "Joining a class",
      body:
        "Your teacher reads out a six-character code. Type it in once and the class stays on " +
        "your list.",
    },
    {
      target: "my-notebooks",
      title: "Notebooks of your own",
      body:
        "Start on lined, graph or dot paper, or bring in a PDF to write on. These are yours — " +
        "nobody can assign anything to them.",
    },
    {
      target: "assignment-tabs",
      title: "To do, handed in, graded",
      body:
        "Work moves along these three as you go. Anything due soonest is at the top of To do.",
    },
    {
      target: ["nav-settings", "nav-settings-mobile"],
      title: "Your account, and this guide",
      body: "Your name, your school, and a way to run these guides again if you want them.",
    },
  ],

  "student.class": [
    {
      target: "class-tabs",
      title: "Inside a class",
      body:
        "What your teacher has set, the notebooks they've shared, and anything you've started " +
        "yourself.",
    },
    {
      target: "class-notebooks",
      title: "Notebooks from your teacher",
      body: "Open one to read it or write in it. Assignments are made out of these pages.",
    },
    {
      target: "class-my-notebook",
      title: "Your own notebook for this class",
      body:
        "Notes that live with the class rather than with you. Your teacher can read them, but " +
        "can't write in them or grade them.",
    },
  ],

  "student.notebook": [
    {
      target: "ink-tools",
      title: "Pick something to write with",
      body:
        "Pen, highlighter, eraser, typed text or a stamp. The eraser can take a whole stroke, " +
        "or rub out only the bit you drag across.",
    },
    {
      target: "finger-draw",
      title: "Finger or stylus",
      body:
        "With a stylus, leave this on \"Finger scrolls\" and you can rest your hand on the " +
        "screen. Without one, switch it so your finger draws.",
    },
    {
      target: ["nb-rail", "nb-pages-button"],
      title: "Moving between pages",
      body: "Every page in the notebook is here — tap one to jump to it.",
    },
    {
      target: "turn-in",
      title: "Handing it in",
      body:
        "Turning it in locks these pages so your teacher can grade them. You can take it back " +
        "until they start.",
    },
  ],
};

/** The tour to run for a role in a place, or `null` where there isn't one. */
export function tourKey(role: string | undefined, place: TourPlace): string | null {
  if (role !== "teacher" && role !== "student") return null;
  const key = `${role}.${place}`;
  return TOURS[key] ? key : null;
}
