# Notesanity

The worksheet you already made, handed out and handed back without printing.

Teachers build notebooks from PDFs or blank paper, students write on them with a
stylus or a keyboard, teachers grade the work in place. The message is written to
one teacher, never a school: the promise is no more paper, the reason it is
finally true is that the whole loop lives in one place, and the offer is that they
keep Classroom, their files and their gradebook.

Runs on Cloudflare — Workers, D1, R2 and Email Sending — in Robert's own account.
It was migrated off the Fling platform in September 2026; nothing depends on that
vendor any more.

## Layout

```
src/worker/        the API (Hono) and the platform layer over Cloudflare bindings
src/worker/platform/   db, storage, email, billing, cron, migrations — the seam over the bindings
src/shared/        constants the worker, the SPA and the marketing build all read (plans, the beta switch)
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
npm install --legacy-peer-deps   a fresh clone needs the flag: glide-data-grid pins marked@4, the app uses 18
npm run dev        wrangler dev — the whole thing with real bindings, port 8787
npm run dev:ui     vite with HMR, proxying /api to wrangler on 8787
npm run build      builds the SPA and renders the marketing pages
npm run deploy     build then deploy
npx wrangler d1 execute notesanity --remote --command "SELECT ..."
npx wrangler secret put STRIPE_SECRET_KEY        Stripe; also STRIPE_WEBHOOK_SECRET (test mode until launch)
npx wrangler secret put AWS_ACCESS_KEY_ID        SES, if switching mail off Cloudflare; also AWS_SECRET_ACCESS_KEY
```

Deploying needs Cloudflare credentials in `.cf-credentials` (gitignored):
`. ./.cf-credentials` first. If that token has been revoked, ask rather than
working around it. Worker secrets go in with `wrangler secret put` and never in
`wrangler.jsonc`; locally they live in `.dev.vars` (gitignored) under the same
names.

## Things worth knowing before changing them

- **Migrations run themselves** on first request, tracked in `_migrations`. Three
  of them mutate data rather than schema, so never let them run against a
  database that was populated some other way — see the comment in
  `scripts/export-fling.mjs`, which explains both ways to get that wrong.
- **Ink lives in R2, not D1.** A page's strokes are one object per layer under
  `notebooks/{id}/ink/`; the `layers` row keeps only `rev`, `updated_at` and
  `byte_length`, which is what lets the roster-wide "who has started" queries
  stay one query each. Every asset a notebook owns sits under its own prefix,
  and deleting the notebook sweeps that prefix — so nothing else may point into
  it (the page library copies bytes out for exactly this reason).
- **The beta switch is `src/shared/plans.mjs`.** The worker's plan gates,
  Checkout, and the static pricing page all read it. While `BETA_FREE` is true
  no gate refuses anything and prices render struck through. Flip it in one
  deliberate commit, a full semester after the notice the pricing page promises.
- **The root path is decided in the Worker.** `/` serves the static landing page
  to a visitor and the app to anyone with a session; every other marketing page
  is a static file and never reaches the Worker.
- **Marketing pages are static HTML, not app routes**, so a reader doesn't
  download the app bundle and link previews still work.
- **`/api/status` really probes.** Keep it that way — a status page that reports
  a value someone set by hand is worse than none.

## Public pages

`marketing/` holds the website. When a user-visible change ships, the changelog,
the landing page and the help center have to keep up with it — use the
`notesanity-docs` skill, which says which of the three a given change touches and
how entries are written.

## Brand

Pine `#20302C`, mint `#7FD1AE`, oat `#F4EFE6`. Space Grotesk for display, Nunito
for body. 3px outlines, 22px card corners, 999px pills, a hard 4px offset shadow,
16px interface text floor, 44px tap targets.
