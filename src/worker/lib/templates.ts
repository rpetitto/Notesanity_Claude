/**
 * Starting points for a notebook with no source document.
 *
 * A template is just a recipe — how many pages, which ruling, what colour —
 * built with the same blank-page machinery a teacher already uses to insert
 * pages one at a time. Nothing is stored per template; picking one is a
 * shorthand for "make me these pages".
 *
 * Page counts are the real thing being chosen. A hundred lined pages is a
 * notebook for a term; fifty engineering pages is a lab book. Sizes are US
 * Letter, matching the default for an empty notebook elsewhere.
 */

export interface NotebookTemplate {
  key: string;
  label: string;
  description: string;
  pages: number;
  pattern: string;
  color: string;
  /** Who is offered this when starting something new. */
  audience: "teacher" | "student" | "both";
}

export const TEMPLATES: NotebookTemplate[] = [
  {
    key: "lined-100", label: "Lined notebook", description: "100 college-ruled pages",
    pages: 100, pattern: "lined-college", color: "#B6BEBB", audience: "both",
  },
  {
    key: "lined-wide-60", label: "Wide-ruled notebook", description: "60 wide-ruled pages",
    pages: 60, pattern: "lined-wide", color: "#B6BEBB", audience: "both",
  },
  {
    key: "engineering-50", label: "Engineering notebook", description: "50 gridded pages with a border",
    pages: 50, pattern: "engineering", color: "#AFC2D8", audience: "both",
  },
  {
    key: "graph-50", label: "Graph notebook", description: "50 quarter-inch grid pages",
    pages: 50, pattern: "graph", color: "#AFC2D8", audience: "both",
  },
  {
    key: "dot-80", label: "Dot grid journal", description: "80 dot-grid pages",
    pages: 80, pattern: "dot", color: "#B6BEBB", audience: "both",
  },
  {
    key: "planner-40", label: "Weekly planner", description: "40 lined pages for planning",
    pages: 40, pattern: "lined-wide", color: "#BFE8D6", audience: "student",
  },
  {
    key: "music-30", label: "Music manuscript", description: "30 pages of staves",
    pages: 30, pattern: "music", color: "#B6BEBB", audience: "both",
  },
  {
    key: "sketch-40", label: "Sketchbook", description: "40 blank pages",
    pages: 40, pattern: "blank", color: "#B6BEBB", audience: "both",
  },
  {
    key: "isometric-30", label: "Isometric pad", description: "30 triangular-grid pages",
    pages: 30, pattern: "isometric", color: "#AFC2D8", audience: "both",
  },
  {
    key: "coordinate-30", label: "Graphing pad", description: "30 coordinate planes",
    pages: 30, pattern: "coordinate", color: "#AFC2D8", audience: "both",
  },
];

/**
 * Guards how many pages one request may create, template or not.
 *
 * Matches the ceiling the new-notebook dialogue offers: the client stopping at
 * a hundred is a courtesy, this is the rule. More pages are added from inside
 * the notebook, which is a separate limit.
 */
export const MAX_TEMPLATE_PAGES = 100;

export const templateFor = (key: string) => TEMPLATES.find((t) => t.key === key) ?? null;
