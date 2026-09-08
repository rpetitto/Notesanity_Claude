/**
 * The shell every marketing page is rendered into.
 *
 * These pages are built to static HTML rather than added to the app's router,
 * for two reasons. A visitor reading the pricing page shouldn't download a
 * notebook editor — the app bundle is a quarter of a megabyte of PDF rendering
 * and data grids that a marketing page has no use for. And a single-page app
 * serves an empty shell to anything that doesn't run JavaScript: Google usually
 * will, but link previews in Slack, LinkedIn and iMessage often won't, and
 * these are pages whose whole job is to be found and shared.
 *
 * The styling is hand-written rather than Tailwind so the marketing build stays
 * independent of the app build. It is a small enough token set to keep in one
 * place, and it means these pages can be edited without touching the app.
 */

const PINE = "#20302C";
const MINT = "#7FD1AE";
const OAT = "#F4EFE6";

/** Shared across every page. Kept in one file so the brand can't drift. */
export const CSS = `
:root{
  --pine:${PINE}; --mint:${MINT}; --oat:${OAT};
  --quiet:#5b6b66; --line:rgba(32,48,44,.14); --white:#fff;
  --display:'Space Grotesk',ui-sans-serif,system-ui,'Segoe UI',Helvetica,Arial,sans-serif;
  --body:'Nunito',ui-sans-serif,system-ui,'Segoe UI',Helvetica,Arial,sans-serif;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;background:var(--oat);color:var(--pine);font-family:var(--body);font-size:17px;line-height:1.6;-webkit-font-smoothing:antialiased}
h1,h2,h3,.display{font-family:var(--display);font-weight:700;letter-spacing:-.01em;text-wrap:balance}
h1{font-size:clamp(34px,5.5vw,52px);line-height:1.08;margin:0 0 18px}
h2{font-size:clamp(25px,3vw,32px);line-height:1.2;margin:0 0 14px}
h3{font-size:20px;margin:0 0 8px}
p{margin:0 0 16px;max-width:68ch}
a{color:var(--pine);text-decoration-thickness:2px;text-underline-offset:3px}
a:hover{text-decoration-color:var(--mint)}
:focus-visible{outline:3px solid var(--mint);outline-offset:2px;border-radius:6px}

.wrap{max-width:1060px;margin:0 auto;padding:0 20px}
.narrow{max-width:760px}

/* header */
.site-header{position:sticky;top:0;z-index:30;background:rgba(244,239,230,.95);backdrop-filter:blur(8px);border-bottom:2px solid var(--line)}
.site-header .inner{display:flex;align-items:center;gap:16px;height:64px}
.brand{display:flex;align-items:center;gap:10px;text-decoration:none;flex-shrink:0}
.brand span{font-family:var(--display);font-size:22px;font-weight:700}
.site-nav{display:none;gap:4px;margin-left:8px;min-width:0}
.site-nav a{display:inline-flex;align-items:center;min-height:44px;padding:0 14px;border-radius:999px;border:3px solid transparent;
  font-family:var(--display);font-size:16px;font-weight:700;text-decoration:none;white-space:nowrap}
.site-nav a:hover{background:rgba(32,48,44,.07)}
.site-nav a[aria-current=page]{background:var(--pine);color:var(--oat)}
.header-actions{margin-left:auto;display:flex;align-items:center;gap:10px;flex-shrink:0}
@media(min-width:860px){.site-nav{display:flex}}

/* buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:52px;padding:0 26px;border-radius:999px;
  border:3px solid var(--pine);background:var(--white);color:var(--pine);font-family:var(--display);font-size:17px;font-weight:700;
  text-decoration:none;box-shadow:4px 4px 0 0 var(--pine);transition:transform .08s,box-shadow .08s;cursor:pointer}
.btn:hover{background:var(--oat)}
.btn:active{transform:translate(3px,3px);box-shadow:none}
.btn-primary{background:var(--mint)}
.btn-sm{min-height:44px;padding:0 18px;font-size:16px;box-shadow:3px 3px 0 0 var(--pine)}

/* cards & sections */
section{padding:56px 0}
.card{background:var(--white);border:3px solid var(--pine);border-radius:22px;box-shadow:4px 4px 0 0 var(--pine);padding:26px}
.grid{display:grid;gap:20px}
@media(min-width:720px){.grid-2{grid-template-columns:1fr 1fr}.grid-3{grid-template-columns:repeat(3,1fr)}}
.eyebrow{font-family:var(--display);font-size:16px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--quiet);margin:0 0 10px}
.lede{font-size:20px;color:var(--quiet);max-width:60ch}
.quiet{color:var(--quiet)}
.small{font-size:15px}

/* beta chip — present, not shouted */
.beta{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;border:2px solid rgba(32,48,44,.25);
  background:rgba(127,209,174,.25);font-family:var(--display);font-size:13px;font-weight:700;letter-spacing:.05em;text-transform:uppercase}

/* long-form documents (terms, privacy) */
.doc{max-width:74ch}
.doc h2{margin-top:40px;padding-top:18px;border-top:2px solid var(--line)}
.doc h3{margin-top:24px}
.doc ul{padding-left:22px;margin:0 0 16px}
.doc li{margin-bottom:8px}
.doc table{width:100%;border-collapse:collapse;margin:0 0 20px;font-size:16px}
.doc th,.doc td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}
.doc th{font-family:var(--display);font-size:14px;letter-spacing:.05em;text-transform:uppercase;color:var(--quiet)}
.toc{background:var(--white);border:3px solid var(--pine);border-radius:22px;padding:20px 24px;margin:0 0 32px}
.toc ol{margin:0;padding-left:20px}
.updated{font-size:15px;color:var(--quiet);margin:0 0 28px}
.callout{border:3px solid var(--pine);border-radius:18px;background:rgba(127,209,174,.18);padding:18px 20px;margin:0 0 22px}
.callout p:last-child{margin-bottom:0}

/* footer */
.site-footer{border-top:3px solid var(--pine);background:var(--white);padding:40px 0 48px;margin-top:40px}
.foot-grid{display:grid;gap:26px}
@media(min-width:720px){.foot-grid{grid-template-columns:2fr 1fr 1fr 1fr}}
.site-footer h4{font-family:var(--display);font-size:15px;letter-spacing:.05em;text-transform:uppercase;color:var(--quiet);margin:0 0 10px}
.site-footer ul{list-style:none;margin:0;padding:0}
.site-footer li{margin-bottom:8px}
.site-footer a{font-size:16px;text-decoration:none}
.site-footer a:hover{text-decoration:underline}
.colophon{margin-top:30px;padding-top:20px;border-top:2px solid var(--line);display:flex;flex-wrap:wrap;gap:12px;align-items:center;
  font-size:15px;color:var(--quiet)}

@media (prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}
`;

/** The mark, drawn inline so no request is needed to paint the header. */
export const LOGO = `<svg width="30" height="30" viewBox="0 0 64 64" fill="none" aria-hidden="true">
  <g stroke="${PINE}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <rect x="10" y="12" width="40" height="40" rx="10" fill="${OAT}" transform="rotate(-10 30 32)"></rect>
    <rect x="18" y="14" width="38" height="40" rx="10" fill="${MINT}"></rect>
    <path d="M27 34.5 33 40.5 46 27" stroke-width="4"></path>
  </g>
</svg>`;

const NAV = [
  { href: "/help", label: "Help" },
  { href: "/pricing", label: "Pricing" },
  { href: "/status", label: "Status" },
];

export const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Wrap page content in the shared shell.
 *
 * `path` drives the current-page marker in the nav; `description` is what a
 * search result and a link preview actually show, so every page sets one.
 */
export function layout({ path, title, description, body, wide = false }) {
  const full = path === "/" ? "Notesanity — interactive notebooks for classrooms" : `${title} · Notesanity`;
  const canonical = `https://notesanity.com${path === "/" ? "" : path}`;
  const nav = NAV.map(
    (n) => `<a href="${n.href}"${n.href === path ? ' aria-current="page"' : ""}>${n.label}</a>`,
  ).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(full)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<meta property="og:title" content="${esc(full)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Notesanity">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="${OAT}">
<link rel="icon" href="/notesanity.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Nunito:wght@400;600;700&display=swap">
<style>${CSS}</style>
</head>
<body>
<a href="#main" class="btn btn-sm" style="position:absolute;left:-9999px;top:8px"
   onfocus="this.style.left='8px'" onblur="this.style.left='-9999px'">Skip to content</a>

<header class="site-header">
  <div class="wrap inner">
    <a class="brand" href="/">${LOGO}<span>Notesanity</span></a>
    <nav class="site-nav" aria-label="Main">${nav}</nav>
    <div class="header-actions">
      <a class="btn btn-sm btn-primary" href="/?signin=1">Sign in</a>
    </div>
  </div>
</header>

<main id="main">
${body}
</main>

<footer class="site-footer">
  <div class="wrap">
    <div class="foot-grid">
      <div>
        <a class="brand" href="/" style="margin-bottom:10px">${LOGO}<span>Notesanity</span></a>
        <p class="small quiet" style="max-width:34ch">
          Interactive notebooks for classrooms. Teachers build them, students write in them,
          and the work stays where it was made.
        </p>
        <p><span class="beta">Beta</span></p>
      </div>
      <div>
        <h4>Product</h4>
        <ul>
          <li><a href="/">Overview</a></li>
          <li><a href="/pricing">Pricing</a></li>
          <li><a href="/status">Status</a></li>
        </ul>
      </div>
      <div>
        <h4>Support</h4>
        <ul>
          <li><a href="/help">Help center</a></li>
          <li><a href="/changelog">Changelog</a></li>
          <li><a href="mailto:support@notesanity.com">support@notesanity.com</a></li>
        </ul>
      </div>
      <div>
        <h4>Legal</h4>
        <ul>
          <li><a href="/privacy">Privacy</a></li>
          <li><a href="/terms">Terms</a></li>
        </ul>
      </div>
    </div>
    <div class="colophon">
      <span>&copy; ${new Date().getFullYear()} Notesanity</span>
      <span aria-hidden="true">·</span>
      <span>Built for teachers and students.</span>
    </div>
  </div>
</footer>
</body>
</html>`;
}
