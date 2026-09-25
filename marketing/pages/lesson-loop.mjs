/**
 * "How a lesson goes", animated.
 *
 * One loop of the whole thing: a notebook built from a file, a Drive file and
 * blank paper; pushed to four students, each getting their own copy; two of its
 * pages assigned with a due date while the students write; then graded one
 * student at a time, each page sent to the back of the stack when it's done.
 *
 * Each step's description is part of the picture, so the stage works on its
 * own — clipped for a social post, it still says what's happening. The drawing
 * pauses at the end of each step long enough to read it. The fuller wording
 * is in the page as an ordinary list: a crawler, a screen reader and a reader
 * without JavaScript get that, and the stage stays hidden for the last of them
 * rather than showing an empty frame.
 *
 * Wide where there's room, with the words in a column beside the pages; on a
 * phone the vertical layout, words above. Drawn in script because the stack
 * reorders itself and every move shares one clock. All motion is an
 * exponential in-and-out. Reduced motion gets a single still frame.
 *
 * The same drawing, with a square layout too, is kept as a standalone page for
 * exporting to social; this module is its landing-page copy.
 */

/**
 * @param {{ title: string, caption: string, body: string }[]} steps  the four, in order.
 *   `caption` is what the animation shows; `body` is the fuller text in the list.
 */
export const lessonLoop = (steps) => `
<style>
.ll{margin-top:24px}
.ll-stage{position:relative;container-type:inline-size;margin-inline:auto;aspect-ratio:16/9;
  border:3px solid var(--pine);border-radius:22px;background:var(--white);box-shadow:6px 6px 0 0 var(--pine);
  overflow:hidden;display:none}
.ll.ll-on .ll-stage{display:block}
.ll-stage.ll-f-vertical{aspect-ratio:9/16;max-width:min(430px,100%)}
.ll-svg{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none}
.ll-label{position:absolute;left:clamp(16px,4.5cqw,30px);right:clamp(16px,4.5cqw,30px);opacity:0;pointer-events:none}
.ll-label-title{margin:0 0 10px;font-family:var(--display);font-weight:700;letter-spacing:-.02em;line-height:1.1}
.ll-label-body{margin:0;color:var(--quiet);line-height:1.45}
/* Wide: the words get their own column on the left, the pages the rest. */
.ll-f-wide .ll-label{max-width:33%;top:clamp(18px,5cqw,52px)}
.ll-f-wide .ll-label-title{font-size:clamp(18px,3.4cqw,34px)}
.ll-f-wide .ll-label-body{font-size:clamp(13px,2.05cqw,20px)}
.ll-f-vertical .ll-label{max-width:88%;top:clamp(18px,6cqw,30px)}
.ll-f-vertical .ll-label-title{font-size:clamp(22px,7.4cqw,32px);margin-bottom:6px}
.ll-f-vertical .ll-label-body{font-size:clamp(15px,4.4cqw,19px);line-height:1.4;max-width:26ch}
.ll-rail{position:absolute;left:clamp(16px,4.5cqw,30px);right:clamp(16px,4.5cqw,30px);bottom:clamp(14px,3.5cqw,24px);
  display:flex;gap:8px;pointer-events:none}
.ll-track{flex:1;height:5px;border-radius:999px;background:var(--line);overflow:hidden}
.ll-fill{height:100%;width:0;background:var(--pine);border-radius:999px}
.ll-toggle{position:absolute;top:clamp(10px,3cqw,18px);right:clamp(10px,3cqw,18px);width:44px;height:44px;
  border-radius:999px;border:2px solid var(--pine);background:var(--oat);color:var(--pine);
  display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;z-index:2}
.ll-toggle:focus-visible{outline:3px solid var(--mint);outline-offset:2px}
.ll-toggle svg{width:16px;height:16px}
.ll-toggle .ll-play{display:none}
.ll-paused .ll-toggle .ll-pause{display:none}
.ll-paused .ll-toggle .ll-play{display:block}
@media(prefers-reduced-motion:reduce){.ll-toggle{display:none}}

/* Without the script, the steps are the section. With it, they stay in the
   page for screen readers and search, and the stage speaks for itself. */
.ll-steps{list-style:none;margin:0;padding:0;display:grid;gap:12px;grid-template-columns:1fr}
@media(min-width:620px){.ll-steps{grid-template-columns:1fr 1fr}}
.ll-step{background:var(--white);border:3px solid var(--pine);border-radius:22px;padding:18px 20px;box-shadow:4px 4px 0 0 var(--pine)}
.ll-step h3{margin:0 0 6px;font-size:19px}
.ll-step p{margin:0}
.ll.ll-on .ll-steps{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
</style>

<div class="ll" id="ll">
  <div class="ll-stage ll-f-wide" id="ll-stage">
    <button class="ll-toggle" id="ll-toggle" type="button" aria-pressed="false" aria-label="Pause the animation">
      <svg class="ll-pause" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M7 5v14M17 5v14"/></svg>
      <svg class="ll-play" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4 20 12 7 20Z"/></svg>
    </button>
    <svg class="ll-svg" id="ll-svg" viewBox="0 0 800 450" aria-hidden="true">
      <defs>
        <pattern id="ll-dots" width="34" height="34" patternUnits="userSpaceOnUse">
          <circle cx="3" cy="3" r="1.6" fill="#20302C" opacity=".08"/>
        </pattern>
      </defs>
      <rect id="ll-dotfield" width="800" height="450" fill="url(#ll-dots)"/>
      <g id="ll-calendar"></g>
      <g id="ll-master"></g>
      <g id="ll-students"></g>
      <g id="ll-sources"></g>
    </svg>
    ${steps
      .map(
        (s) => `<div class="ll-label" aria-hidden="true">
      <p class="ll-label-title">${s.title}</p>
      <p class="ll-label-body">${s.caption}</p>
    </div>`,
      )
      .join("")}
    <div class="ll-rail" aria-hidden="true">
      ${steps.map(() => `<div class="ll-track"><div class="ll-fill"></div></div>`).join("")}
    </div>
  </div>

  <ol class="ll-steps">
    ${steps
      .map(
        (s) => `<li class="ll-step">
      <h3>${s.title}</h3>
      <p class="small quiet">${s.body}</p>
    </li>`,
      )
      .join("")}
  </ol>
</div>

<script>${SCRIPT}</script>`;

const SCRIPT = String.raw`
(function () {
  "use strict";
  var root = document.getElementById("ll");
  if (!root || !window.requestAnimationFrame) return;
  var NS = "http://www.w3.org/2000/svg";
  var PINE = "#20302C", MINT = "#7FD1AE", OAT = "#F4EFE6", RED = "#A3341F";

  /* ------------------------------------------------------------ timing */
  // One clock, 19.4s. Every move is an exponential in-and-out.
  var T = 19.4;
  // Pauses in the drawing, in drawing time, so each step's description stays
  // up long enough to read: after the notebook is built, after the copies
  // land, after the students have written. The clock runs in real time; the
  // drawing reads a remapped time that stands still through each pause.
  var HOLDS = [{ at: 4.3, len: 1.2 }, { at: 7.0, len: 2.4 }, { at: 11.15, len: 1.4 }];
  function animT(r) {
    var acc = 0;
    for (var h = 0; h < HOLDS.length; h++) {
      if (r < HOLDS[h].at + acc) return r - acc;
      if (r < HOLDS[h].at + acc + HOLDS[h].len) return HOLDS[h].at;
      acc += HOLDS[h].len;
    }
    return r - acc;
  }
  function realT(a) {
    var acc = 0;
    HOLDS.forEach(function (h) { if (h.at < a) acc += h.len; });
    return a + acc;
  }
  var TR = realT(T);
  var STEPS = [
    { s: 0,    e: 4.4 },   // Build: three sources, one notebook
    { s: 4.4,  e: 7.8 },   // Push
    { s: 7.8,  e: 11.2 },  // Assign: pick pages, due date, they write
    { s: 11.2, e: T }      // Grade, and the reset at the end
  ];
  var SRC_AT = [0.2, 1.05, 1.9]; // when each source tile appears
  var ASIDE = 4.65;              // the notebook steps aside for the push
  var FLY = 5.3;                 // first student copy leaves
  var LEAVE = 11.2;              // the notebook leaves for grading
  var CYC0 = 12.65;              // first grade in the stack
  var C = 1.45;                  // one card: mark it, score it, send it back
  var MOVE_AT = 0.7;             // within a cycle: when the front card starts to leave
  var MOVE_LEN = 0.72;
  var RESET_AT = 18.75;

  /* ----------------------------------------------------------- layouts */
  // Where everything sits in each format, in that format's own viewBox.
  var ROW_R = [-6, -2, 2, 6];
  var LAYOUTS = {
    wide: {
      w: 800, h: 450,
      build: { x: 528, y: 240, s: 0.95, r: 0 },
      side:  { x: 385, y: 245, s: 0.62, r: 0 },
      tiles: [{ x: 350, y: 152 }, { x: 350, y: 240 }, { x: 350, y: 328 }],
      slots: [
        { x: 565, y: 178, s: 0.6, r: -4 }, { x: 670, y: 178, s: 0.6, r: 3 },
        { x: 565, y: 322, s: 0.6, r: 2 },  { x: 670, y: 322, s: 0.6, r: -3 }
      ],
      cal: { x: 755, from: 300, to: 252 },
      stack: { x: 525, y: 262, s: 1, dx: 20, dy: 16 },
      out: { dx: 190, dy: -6, s: 0.98, r: 12 }
    },
    vertical: {
      w: 450, h: 800,
      build: { x: 190, y: 485, s: 1.2, r: 0 },
      side:  { x: 150, y: 322, s: 0.62, r: 0 },
      tiles: [{ x: 100, y: 268 }, { x: 205, y: 268 }, { x: 310, y: 268 }],
      slots: [
        { x: 128, y: 508, s: 0.72, r: -4 }, { x: 322, y: 508, s: 0.72, r: 3 },
        { x: 128, y: 670, s: 0.72, r: 2 },  { x: 322, y: 670, s: 0.72, r: -3 }
      ],
      cal: { x: 350, from: 376, to: 330 },
      stack: { x: 170, y: 500, s: 1.1, dx: 18, dy: 16 },
      out: { dx: 158, dy: 10, s: 1.08, r: 12 }
    }
  };
  var L = LAYOUTS.wide;

  function expo(x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    return x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2;
  }
  function raw(t, a, b) { return t <= a ? 0 : t >= b ? 1 : (t - a) / (b - a); }
  function seg(t, a, b) { return expo(raw(t, a, b)); }
  function lerp(a, b, p) { return a + (b - a) * p; }
  function lerpP(A, B, p) {
    return { x: lerp(A.x, B.x, p), y: lerp(A.y, B.y, p), s: lerp(A.s, B.s, p), r: lerp(A.r, B.r, p) };
  }
  function tf(P) { return "translate(" + P.x.toFixed(2) + " " + P.y.toFixed(2) + ") rotate(" + P.r.toFixed(2) + ") scale(" + Math.max(P.s, 0.0001).toFixed(4) + ")"; }
  // Scale an element about its own point, with no reliance on CSS transform-origin.
  function popAt(cx, cy, s) { return "translate(" + cx + " " + cy + ") scale(" + Math.max(s, 0.0001).toFixed(4) + ") translate(" + (-cx) + " " + (-cy) + ")"; }
  function show(node, o) { node.setAttribute("opacity", Math.max(0, Math.min(1, o)).toFixed(3)); }
  // Depth 0 is the front of the stack; deeper cards sit up and to the right.
  function stackPos(d) {
    var S = L.stack;
    return { x: S.x + d * S.dx, y: S.y - d * S.dy, s: S.s * (1 - d * 0.07), r: d * 2 };
  }
  function outPos() { return { x: L.stack.x + L.out.dx, y: L.stack.y + L.out.dy, s: L.out.s, r: L.out.r }; }

  function el(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function txt(parent, x, y, size, str, fill, weight) {
    var n = el("text", { x: x, y: y, "text-anchor": "middle", "dominant-baseline": "middle", "font-family": "Space Grotesk, sans-serif", "font-weight": weight || 700, "font-size": size, fill: fill || PINE }, parent);
    n.textContent = str;
    return n;
  }
  function check(parent, cx, cy, r) {
    var g = el("g", {}, parent);
    el("circle", { cx: cx, cy: cy, r: r, fill: MINT, stroke: PINE, "stroke-width": 2.5 }, g);
    var k = r / 15;
    el("path", { d: "M" + (cx - 7 * k) + " " + cy + " L" + (cx - 2 * k) + " " + (cy + 6 * k) + " L" + (cx + 8 * k) + " " + (cy - 7 * k), stroke: PINE, "stroke-width": 3.5 * Math.max(k, 0.7), fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" }, g);
    return g;
  }

  /* ------------------------------------------------------ the notebook */
  // Three pages from three places, and a page strip beside them — the same
  // list a teacher sees down the side of the editor.
  var masterG = document.getElementById("ll-master");
  function sheet(parent, dx, dy) {
    var g = el("g", {}, parent);
    el("rect", { x: -89 + dx, y: -109 + dy, width: 190, height: 230, rx: 20, fill: PINE }, g);
    el("rect", { x: -95 + dx, y: -115 + dy, width: 190, height: 230, rx: 20, fill: OAT, stroke: PINE, "stroke-width": 3 }, g);
    return g;
  }
  var sheet3 = sheet(masterG, 18, -18);   // blank, ruled
  var sheet2 = sheet(masterG, 9, -9);     // from Drive
  var front = sheet(masterG, 0, 0);       // the worksheet, from a file
  el("path", { d: "M-60 -85 Q-40 -95 -20 -85 T20 -85 T60 -85", stroke: PINE, "stroke-width": 4, fill: "none", "stroke-linecap": "round" }, front);
  el("path", { d: "M-60 -58 L45 -58", stroke: PINE, "stroke-width": 4, "stroke-linecap": "round" }, front);
  el("path", { d: "M-60 50 L50 50 M-60 72 L30 72", stroke: PINE, "stroke-width": 3, "stroke-linecap": "round", opacity: 0.35 }, front);
  var masterBox = el("rect", { x: -60, y: -19, width: 115, height: 45, rx: 10, fill: MINT, stroke: PINE, "stroke-width": 3 }, front);

  var strip = el("g", {}, masterG);
  var THUMB_Y = [-72, 0, 72];
  var thumbs = THUMB_Y.map(function (y, i) {
    var g = el("g", {}, strip);
    el("rect", { x: 131, y: y - 25, width: 44, height: 56, rx: 7, fill: PINE }, g);
    el("rect", { x: 128, y: y - 28, width: 44, height: 56, rx: 7, fill: OAT, stroke: PINE, "stroke-width": 2.5 }, g);
    if (i === 0) {
      el("path", { d: "M136 " + (y - 16) + " q4 -3 8 0 t8 0 t8 0 t8 0", stroke: PINE, "stroke-width": 2, fill: "none", "stroke-linecap": "round" }, g);
      el("rect", { x: 136, y: y - 4, width: 28, height: 12, rx: 3, fill: MINT, stroke: PINE, "stroke-width": 1.5 }, g);
    } else if (i === 1) {
      el("path", { d: "M136 " + (y - 17) + " L160 " + (y - 17), stroke: PINE, "stroke-width": 2.5, "stroke-linecap": "round" }, g);
      el("rect", { x: 136, y: y - 10, width: 28, height: 22, rx: 3, fill: MINT, stroke: PINE, "stroke-width": 1.5 }, g);
      el("path", { d: "M139 " + (y + 9) + " l7 -9 l5 5 l4 -4 l6 8 z", fill: PINE }, g);
    } else {
      for (var k = 0; k < 4; k++) el("path", { d: "M136 " + (y - 14 + k * 9) + " L164 " + (y - 14 + k * 9), stroke: PINE, "stroke-width": 1.5, "stroke-linecap": "round", opacity: 0.45 }, g);
    }
    var tick = check(g, 172, y - 26, 10);
    return { g: g, tick: tick };
  });

  var countPill = el("g", {}, masterG);
  el("rect", { x: -40, y: 131, width: 88, height: 28, rx: 14, fill: PINE }, countPill);
  el("rect", { x: -44, y: 127, width: 88, height: 28, rx: 14, fill: "#fff", stroke: PINE, "stroke-width": 2.5 }, countPill);
  txt(countPill, 0, 142, 14, "3 pages");

  /* -------------------------------------------------------- the sources */
  // A file, a Google Drive file, blank paper. Drive is drawn as a plain
  // cloud with its name, not Google's own mark.
  var sourcesG = document.getElementById("ll-sources");
  function tile(label) {
    var g = el("g", {}, sourcesG);
    el("rect", { x: -28, y: -34, width: 64, height: 74, rx: 12, fill: PINE }, g);
    el("rect", { x: -32, y: -38, width: 64, height: 74, rx: 12, fill: "#fff", stroke: PINE, "stroke-width": 2.5 }, g);
    txt(g, 0, 22, 12, label);
    return g;
  }
  var tFile = tile("File");
  el("path", { d: "M-13 -28 L5 -28 L13 -20 L13 8 L-13 8 Z", fill: OAT, stroke: PINE, "stroke-width": 2, "stroke-linejoin": "round" }, tFile);
  el("path", { d: "M5 -28 L5 -20 L13 -20", fill: "none", stroke: PINE, "stroke-width": 2, "stroke-linejoin": "round" }, tFile);
  txt(tFile, 0, -5, 9, "PDF", RED);
  var tDrive = tile("Drive");
  el("path", { d: "M-15 4 a8 8 0 0 1 1 -16 a11 11 0 0 1 21 -3 a8 8 0 0 1 8 11 a6 6 0 0 1 -3 8 z", fill: MINT, stroke: PINE, "stroke-width": 2, "stroke-linejoin": "round" }, tDrive);
  var tBlank = tile("Blank");
  el("rect", { x: -12, y: -28, width: 24, height: 34, rx: 3, fill: OAT, stroke: PINE, "stroke-width": 2 }, tBlank);
  el("path", { d: "M-7 -19 L7 -19 M-7 -12 L7 -12 M-7 -5 L7 -5", stroke: PINE, "stroke-width": 1.5, "stroke-linecap": "round", opacity: 0.5 }, tBlank);
  var tiles = [tFile, tDrive, tBlank];

  /* ------------------------------------------------------------ calendar */
  var calG = document.getElementById("ll-calendar");
  el("rect", { x: -34, y: -25, width: 68, height: 52, rx: 9, fill: PINE }, calG);
  el("rect", { x: -30, y: -29, width: 68, height: 52, rx: 9, fill: "#fff", stroke: PINE, "stroke-width": 2.5 }, calG);
  el("rect", { x: -30, y: -29, width: 68, height: 16, rx: 8, fill: MINT, stroke: PINE, "stroke-width": 2.5 }, calG);
  el("line", { x1: -16, y1: -34, x2: -16, y2: -24, stroke: PINE, "stroke-width": 3, "stroke-linecap": "round" }, calG);
  el("line", { x1: 20, y1: -34, x2: 20, y2: -24, stroke: PINE, "stroke-width": 3, "stroke-linecap": "round" }, calG);
  txt(calG, 4, 6, 15, "Fri");

  /* ------------------------------------------------------ the four students */
  var STUDENTS = [
    { initials: "AM", score: "18/20" },
    { initials: "JT", score: "20/20" },
    { initials: "KL", score: "16/20" },
    { initials: "RS", score: "19/20" }
  ];
  var CHECK_LEN = 160, SCRIBBLE_LEN = 120;
  var studentsG = document.getElementById("ll-students");
  var cards = STUDENTS.map(function (st) {
    var g = el("g", {}, studentsG);
    // Their whole notebook came across: two more pages behind this one.
    // They step away once the copies are gathered for grading, where four
    // stacked notebooks would read as a dozen loose sheets.
    var extras = el("g", {}, g);
    el("rect", { x: -63, y: -104.5, width: 150, height: 185, rx: 16, fill: OAT, stroke: PINE, "stroke-width": 2.5 }, extras);
    el("rect", { x: -69, y: -98.5, width: 150, height: 185, rx: 16, fill: OAT, stroke: PINE, "stroke-width": 2.5 }, extras);
    el("rect", { x: -71, y: -88.5, width: 150, height: 185, rx: 16, fill: PINE }, g);
    el("rect", { x: -75, y: -92.5, width: 150, height: 185, rx: 16, fill: OAT, stroke: PINE, "stroke-width": 3 }, g);
    // The student's name, so it reads as their copy rather than the teacher's.
    el("rect", { x: -64, y: -82, width: 42, height: 24, rx: 12, fill: "#fff", stroke: PINE, "stroke-width": 2.5 }, g);
    txt(g, -43, -69, 13, st.initials);
    el("path", { d: "M-50 -40 Q-35 -48 -20 -40 T10 -40 T40 -40", stroke: PINE, "stroke-width": 3.5, fill: "none", "stroke-linecap": "round" }, g);
    el("path", { d: "M-50 -20 L35 -20", stroke: PINE, "stroke-width": 3.5, "stroke-linecap": "round" }, g);
    el("rect", { x: -50, y: -4, width: 95, height: 38, rx: 9, fill: MINT, stroke: PINE, "stroke-width": 3 }, g);
    // Their answer, written into the box.
    var scribble = el("path", { d: "M-42 15 q7 -10 14 0 t14 0 t14 0 t14 0 t14 0", stroke: PINE, "stroke-width": 3, fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round", "stroke-dasharray": SCRIBBLE_LEN, "stroke-dashoffset": SCRIBBLE_LEN }, g);
    // Assigned.
    var badge = check(g, 58, -76, 15);
    // Which page is being graded.
    var tab = el("g", {}, g);
    el("rect", { x: 22, y: -84, width: 42, height: 24, rx: 12, fill: "#fff", stroke: PINE, "stroke-width": 2.5 }, tab);
    txt(tab, 43, -71, 12, "p. 1");
    // Graded.
    var mark = el("path", { d: "M-48 4 L-12 40 L52 -36", stroke: RED, "stroke-width": 10, fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round", "stroke-dasharray": CHECK_LEN, "stroke-dashoffset": CHECK_LEN }, g);
    var pill = el("g", {}, g);
    el("rect", { x: 10, y: 60, width: 64, height: 28, rx: 14, fill: PINE }, pill);
    el("rect", { x: 6, y: 56, width: 64, height: 28, rx: 14, fill: MINT, stroke: PINE, "stroke-width": 2.5 }, pill);
    txt(pill, 38, 71, 15, st.score);
    var spark = el("g", {}, g);
    el("rect", { x: -6, y: 48, width: 9, height: 9, rx: 2, fill: MINT, stroke: PINE, "stroke-width": 1.5, transform: "rotate(45 -1.5 52.5)" }, spark);
    el("rect", { x: 74, y: 44, width: 8, height: 8, rx: 2, fill: PINE, transform: "rotate(45 78 48)" }, spark);
    el("rect", { x: 70, y: 92, width: 7, height: 7, rx: 2, fill: MINT, stroke: PINE, "stroke-width": 1.5, transform: "rotate(45 73.5 95.5)" }, spark);
    return { g: g, extras: extras, scribble: scribble, badge: badge, tab: tab, mark: mark, pill: pill, spark: spark };
  });

  /* ------------------------------------------------------------ render */
  var labels = Array.prototype.slice.call(root.querySelectorAll(".ll-label"));
  var rails = Array.prototype.slice.call(root.querySelectorAll(".ll-fill"));
  var lastOrder = "";

  function render(r) {
    // Captions and progress run on real time, so they keep moving through a pause.
    STEPS.forEach(function (st, k) {
      var s0 = realT(st.s), e0 = realT(st.e);
      var inP = seg(r, s0 + 0.05, s0 + 0.5);
      var outP = seg(r, e0 - 0.5, e0 - 0.05);
      labels[k].style.opacity = (inP * (1 - outP)).toFixed(3);
      labels[k].style.transform = "translateY(" + ((1 - inP) * 8 - outP * 8).toFixed(2) + "px)";
      rails[k].style.width = (raw(r, s0, e0) * 100).toFixed(2) + "%";
    });
    var t = animT(r);

    // Build: each source drops its page into the notebook and its strip.
    var B = L.build;
    tiles.forEach(function (g, i) {
      var a = SRC_AT[i];
      var pop = seg(t, a, a + 0.35);
      var fly = seg(t, a + 0.45, a + 1.05);
      var target = { x: B.x + 150 * B.s, y: B.y + THUMB_Y[i] * B.s, s: 0.35, r: 0 };
      var P = lerpP({ x: L.tiles[i].x, y: L.tiles[i].y, s: 1, r: 0 }, target, fly);
      P.s *= lerp(0.6, 1, pop);
      g.setAttribute("transform", tf(P));
      show(g, pop * (1 - seg(t, a + 0.85, a + 1.1)));
    });
    var land = SRC_AT.map(function (a) { return seg(t, a + 0.85, a + 1.2); });
    front.setAttribute("transform", popAt(0, 0, lerp(0.88, 1, land[0])));
    show(front, land[0]);
    sheet2.setAttribute("transform", "translate(" + lerp(-9, 0, land[1]).toFixed(2) + " " + lerp(9, 0, land[1]).toFixed(2) + ")");
    show(sheet2, land[1]);
    sheet3.setAttribute("transform", "translate(" + lerp(-18, 0, land[2]).toFixed(2) + " " + lerp(18, 0, land[2]).toFixed(2) + ")");
    show(sheet3, land[2]);
    var box = seg(t, 3.2, 3.7);
    masterBox.setAttribute("transform", "translate(0 " + lerp(-16, 0, box).toFixed(2) + ")");
    show(masterBox, box);
    var countS = seg(t, 3.5, 3.95);
    countPill.setAttribute("transform", popAt(0, 141, countS));
    show(countPill, countS > 0.001 ? 1 : 0);

    // Assign: two of the three pages are the task; the third isn't.
    thumbs.forEach(function (th, i) {
      var inT = seg(t, SRC_AT[i] + 0.85, SRC_AT[i] + 1.2);
      th.g.setAttribute("transform", popAt(150, THUMB_Y[i], lerp(0.5, 1, inT)));
      var dim = i === 2 ? seg(t, 8.5, 8.9) : 0;
      show(th.g, inT * (1 - 0.55 * dim));
      var tickS = i < 2 ? seg(t, 8.0 + i * 0.25, 8.45 + i * 0.25) : 0;
      th.tick.setAttribute("transform", popAt(172, THUMB_Y[i] - 26, tickS));
      show(th.tick, tickS > 0.001 ? 1 : 0);
    });

    // The notebook steps aside for the push, and leaves for grading.
    var aside = seg(t, ASIDE, ASIDE + 1.0), leave = seg(t, LEAVE, LEAVE + 0.6);
    var M = lerpP(B, L.side, aside);
    M.s *= lerp(1, 0.6, leave);
    masterG.setAttribute("transform", tf(M));
    show(masterG, 1 - leave);

    // The due date.
    var rise = seg(t, 8.7, 9.4), fall = seg(t, LEAVE, LEAVE + 0.5);
    calG.setAttribute("transform", "translate(" + L.cal.x + " " + (lerp(L.cal.from, L.cal.to, rise) + (L.cal.from - L.cal.to) * fall).toFixed(2) + ")");
    show(calG, rise * (1 - fall));

    // Students.
    var resetOut = seg(t, RESET_AT, T - 0.1);
    var OUT = outPos();
    var order = [];
    cards.forEach(function (c, i) {
      var flyStart = FLY + i * 0.22;
      var fly = seg(t, flyStart, flyStart + 0.95);
      var gatherStart = LEAVE + 0.2 + i * 0.07;
      var gather = seg(t, gatherStart, gatherStart + 1.0);
      var P, key = i;

      if (t < gatherStart) {
        var origin = { x: L.side.x, y: L.side.y, s: 0.15, r: 0 };
        P = lerpP(origin, L.slots[i], fly);
        key = -i;
      } else if (t < CYC0) {
        P = lerpP(L.slots[i], stackPos(i), gather);
        key = i;
      } else {
        // The stack: card k is at the front during cycle k. It's marked,
        // scored, then swung out and tucked in behind the rest.
        var local = t - CYC0;
        var k = Math.min(Math.floor(local / C), 4);
        var within = local - k * C;
        var d = ((i - k) % 4 + 4) % 4;
        if (k >= 4 || within < MOVE_AT) {
          P = stackPos(k >= 4 ? i : d);
          key = k >= 4 ? i : d;
        } else {
          var m = raw(within, MOVE_AT, MOVE_AT + MOVE_LEN);
          if (d === 0) {
            if (m < 0.5) { P = lerpP(stackPos(0), OUT, expo(m * 2)); key = -1; }
            else { P = lerpP(OUT, stackPos(3), expo((m - 0.5) * 2)); key = 3.5; }
          } else {
            P = lerpP(stackPos(d), stackPos(d - 1), expo(m));
            key = d - expo(m);
          }
        }
      }
      P.s *= 1 - 0.12 * resetOut;
      c.g.setAttribute("transform", tf(P));
      show(c.g, seg(t, flyStart, flyStart + 0.35) * (1 - resetOut));
      order.push({ i: i, key: key });

      // Assigned: a check each, then they write their answers.
      var badgeS = seg(t, 9.0 + i * 0.15, 9.45 + i * 0.15) * (1 - seg(t, LEAVE, LEAVE + 0.4));
      c.badge.setAttribute("transform", popAt(58, -76, badgeS));
      show(c.badge, badgeS > 0.001 ? 1 : 0);
      var w = seg(t, 9.7 + i * 0.2, 10.5 + i * 0.2);
      c.scribble.setAttribute("stroke-dashoffset", (SCRIBBLE_LEN * (1 - w)).toFixed(2));
      show(c.tab, seg(t, LEAVE + 0.4, LEAVE + 0.9));
      show(c.extras, 1 - seg(t, gatherStart, gatherStart + 0.6));

      // Graded, when it's this card's turn at the front.
      var cs = CYC0 + i * C;
      var mk = seg(t, cs, cs + 0.4);
      c.mark.setAttribute("stroke-dashoffset", (CHECK_LEN * (1 - mk)).toFixed(2));
      show(c.mark, mk > 0 ? 1 : 0);
      var pillS = seg(t, cs + 0.22, cs + 0.52);
      c.pill.setAttribute("transform", popAt(38, 70, pillS));
      show(c.pill, pillS > 0.001 ? 1 : 0);
      show(c.spark, seg(t, cs + 0.32, cs + 0.46) * (1 - seg(t, cs + 0.5, cs + 0.7)));
    });

    // Paint order follows depth: deepest first, front last.
    order.sort(function (a, b) { return b.key - a.key; });
    var sig = order.map(function (o) { return o.i; }).join("");
    if (sig !== lastOrder) {
      order.forEach(function (o) { studentsG.appendChild(cards[o.i].g); });
      lastOrder = sig;
    }
  }

  /* ------------------------------------------------------------ format */
  // Wide where there's room for the words beside the pages; on a phone the
  // vertical layout, which puts them above.
  var stage = document.getElementById("ll-stage");
  var svg = document.getElementById("ll-svg");
  var dotfield = document.getElementById("ll-dotfield");
  var t = 0, paused = false, format = "";
  root.classList.add("ll-on");

  function setFormat(name) {
    if (name === format) return;
    format = name;
    L = LAYOUTS[name];
    stage.classList.remove("ll-f-wide", "ll-f-vertical");
    stage.classList.add("ll-f-" + name);
    svg.setAttribute("viewBox", "0 0 " + L.w + " " + L.h);
    dotfield.setAttribute("width", L.w);
    dotfield.setAttribute("height", L.h);
    render(t);
  }
  function fit() { setFormat(root.clientWidth < 560 ? "vertical" : "wide"); }
  window.addEventListener("resize", fit);

  var btn = document.getElementById("ll-toggle");
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    // One complete, still frame: the stack, with the first page graded.
    t = realT(CYC0 + 0.65);
    fit();
    return;
  }

  fit();
  var last = null;
  function frame(now) {
    // A hidden tab stops frames; don't leap ahead when it comes back.
    if (last !== null && !paused) t = (t + Math.min((now - last) / 1000, 0.1)) % TR;
    last = now;
    render(t);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  btn.addEventListener("click", function () {
    paused = !paused;
    stage.classList.toggle("ll-paused", paused);
    btn.setAttribute("aria-pressed", String(paused));
    btn.setAttribute("aria-label", paused ? "Resume the animation" : "Pause the animation");
  });
})();
`;
