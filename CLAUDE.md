# Notesanity

Interactive notebooks for classrooms: teachers build notebooks from PDFs or blank
paper, students write on them with a stylus or a keyboard, teachers mark the work
in place.

Runs on Cloudflare — Workers, D1, R2 and Email Sending — in Robert's own account.
It was migrated off the Fling platform in September 2026; nothing depends on that
vendor any more.

## Layout

```
src/worker/        the API (Hono) and the platform layer over Cloudflare bindings
src/worker/platform/   db, storage, email, cron, migrations — the seam over the bindings
src/react-app/     the SPA
marketing/         the static marketing pages (landing, help, pricing, terms, privacy, status)
scripts/           build and one-off migration tooling
```

`src/worker/platform` exists on purpose. Application code imports `db`, `storage`,
`app`, `migrate` and `cron` from there rather than reaching for bindings directly,
so a change of database or mail provider is a file rather than an edit across 150
call sites. `databaseFor()` in `entry.ts` is where a request gets pointed at one
district's database once sharding is needed.

## Commands

```
npm run dev        wrangler dev — the whole thing with real bindings, port 8787
npm run dev:ui     vite with HMR, proxying /api to wrangler on 8787
npm run build      builds the SPA and renders the marketing pages
npm run deploy     build then deploy
npx wrangler d1 execute notesanity --remote --command "SELECT ..."
```

Deploying needs Cloudflare credentials in `.cf-credentials` (gitignored):
`. ./.cf-credentials` first. If that token has been revoked, ask rather than
working around it.

## Things worth knowing before changing them

- **Migrations run themselves** on first request, tracked in `_migrations`. Three
  of them mutate data rather than schema, so never let them run against a
  database that was populated some other way — see the comment in
  `scripts/export-fling.mjs`, which explains both ways to get that wrong.
- **Ink is chunked.** A page's strokes are split across `layer_chunks` rows of
  twenty so an append rewrites one chunk, not the page. `layers.data` is chunk 0
  and also holds text, stamps and comments.
- **The root path is decided in the Worker.** `/` serves the static landing page
  to a visitor and the app to anyone with a session; every other marketing page
  is a static file and never reaches the Worker.
- **Marketing pages are static HTML, not app routes**, so a reader doesn't
  download the app bundle and link previews still work.
- **`/api/status` really probes.** Keep it that way — a status page that reports
  a value someone set by hand is worse than none.

## Brand

Pine `#20302C`, mint `#7FD1AE`, oat `#F4EFE6`. Space Grotesk for display, Nunito
for body. 3px outlines, 22px card corners, 999px pills, a hard 4px offset shadow,
16px interface text floor, 44px tap targets.
