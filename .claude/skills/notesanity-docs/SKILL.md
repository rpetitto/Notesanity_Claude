---
name: notesanity-docs
description: Keep the changelog, landing page and help center in step with the app. Use after shipping any user-visible change to Notesanity — a new feature, a changed behavior, a fix someone would notice — and when asked to update the changelog, overview, FAQ or marketing copy.
---

# Keeping the public pages true

Three pages describe Notesanity to people who don't have the code in front of
them, and they rot in different ways:

| Page | File | Rots by |
|---|---|---|
| Changelog | `marketing/pages/changelog.mjs` | going stale — the last entry is months old |
| Overview (landing) | `marketing/pages/landing.mjs` | promising what the app no longer does, or missing what it now does |
| Help center | `marketing/pages/help.mjs` | describing behavior that has since changed |

A page that describes software accurately is documentation. A page that
describes software that used to exist is a support ticket, and worse, it costs
trust at the exact moment someone is deciding whether to believe the rest.

Run `npm run build` after editing; the pages are rendered to static HTML by
`scripts/build-marketing.mjs`, and a syntax error in a page fails the build.

## When to update which

Ask what a **teacher** would notice, not what the diff touched.

- **Changelog** — any user-visible change. New capability, changed behavior, a
  fix someone hit, or an internal change with a visible effect (something got
  much faster, a limit moved). Skip refactors nobody can see.
- **Overview** — only when the *pitch* changes: a capability significant enough
  that someone choosing the product would weigh it. Most releases don't touch it.
  Adding a feature card for every change turns the page into a list.
- **Help center** — whenever an answer on it stops being true, and when a change
  will generate a question. New behavior with a sharp edge belongs here the day
  it ships.

If a change affects none of the three, say so rather than inventing an entry.

## Changelog entries

Entries live in the `RELEASES` array, newest first. Each release is
`[date, summary, items]`; each item is `["new" | "better" | "fixed", "text"]`.

Add to today's release if one exists for today; otherwise start a new one at the
top. Dates are the release date in `Month D, YYYY`.

Write what someone can now do:

- ✅ "The eraser can rub out part of a stroke, so you can fix one letter without
  redrawing the word."
- ❌ "Added `erase` mode to `ToolState` and implemented stroke splitting."

Rules that matter:

- **Lead with the person, not the mechanism.** "Opening an assignment for a large
  class is much faster" beats "grading queries are now batched".
- **Name the cost of the bug you fixed.** "A stroke drawn while a save was in
  flight could be dropped" tells a teacher whether it happened to them. "Fixed a
  race condition" does not.
- **Quantify when you honestly can.** "About fifteen times smaller" is worth
  more than "significantly smaller" — but only if you measured it.
- **Don't inflate.** Not every release needs a `new`. A release that is three
  fixes is three fixes.
- No internal names, file paths, or ticket numbers.

## Overview (landing page)

The feature cards in `landing.mjs` are the product's claims. Change one when
what it claims has changed, and add one only for something that would genuinely
affect a decision to adopt.

Before adding a card, check whether an existing one should absorb it — six
sharp cards beat nine vague ones. If the page reaches nine, something on it has
stopped being a headline.

The three-step "How a lesson goes" section describes the core loop: build,
assign, grade. It should only change if that loop changes.

## Help center

Answers live in `help.mjs`, grouped by `group("Title", [[question, answer], …])`.

- Put the question where a confused person would look, not where the feature
  lives in the code.
- Answer in two or three sentences. Long answers are a sign the app needs
  changing, not the page.
- **Say what is not possible, too.** "A teacher can read a student's own notebook
  and nothing else" prevents more support mail than any description of what works.
- When behavior changes, fix the existing answer rather than adding a second one.
  Two answers that disagree are worse than one that is out of date.

## House style

American English throughout — color, center, organize, recognize. **Grade**, not
mark: US teachers grade work. "Marked up" for annotation is fine; "marked" for
graded is not. Prices in dollars.

The product is in beta and says so plainly on pricing, in the footer and on the
landing page. Don't remove those, and don't make them the headline either.

Write plainly, in the second person, in the vocabulary of the classroom rather
than the codebase: *notebook*, *page*, *assignment*, *hand in*, *grade*, *class*,
*roster*.

## Before finishing

1. `npm run build` — the pages must render.
2. Read your entry back as a teacher who wasn't in this conversation. If it only
   makes sense to someone who saw the diff, rewrite it.
3. Check the claim is *true of what shipped*, not of what was intended. If it was
   deployed behind a condition, say so or leave it out.
