import { layout } from "../layout.mjs";

/**
 * Pricing during the beta.
 *
 * Everything is free, so this page's real job is to say that honestly without
 * either burying the beta or making it the headline. Schools plan budgets a
 * year ahead, and a page that says "free" without saying "for now" reads as a
 * bait-and-switch the moment that changes. The commitments below — notice
 * before any charge, and export of your data whatever happens — are what make
 * "free while in beta" safe for a school to act on.
 */

const tick = `<span aria-hidden="true" style="color:var(--pine);font-weight:700">✓</span>`;
const item = (t) => `<li style="display:flex;gap:10px;margin-bottom:10px">${tick}<span>${t}</span></li>`;

export default () =>
  layout({
    path: "/pricing",
    title: "Pricing",
    description:
      "Notesanity is free for every teacher, class and school while it is in beta. No card, no seat limits, and notice before anything changes.",
    body: `
<section>
  <div class="wrap narrow">
    <p class="eyebrow">Pricing</p>
    <h1>Free for your whole school.</h1>
    <p class="lede">
      Notesanity is in beta, and it's free while it is — every teacher, every class, every
      student. There's no card to enter, no seat count, and no trial that runs out.
    </p>
  </div>
</section>

<section style="padding-top:0">
  <div class="wrap narrow">
    <div class="card" style="background:var(--mint)">
      <p style="margin:0 0 6px"><span class="beta">Beta</span></p>
      <h2 style="margin-bottom:6px">$0</h2>
      <p class="quiet" style="margin-bottom:20px">for everyone, for now</p>
      <ul style="list-style:none;padding:0;margin:0 0 22px">
        ${item("Unlimited teachers, students and classes")}
        ${item("Unlimited notebooks, assignments and grading")}
        ${item("PDF, Word, PowerPoint and Google Drive imports")}
        ${item("Students' own personal notebooks")}
        ${item("Google sign-in, sign-in links and passwords")}
        ${item("Support straight from the people who build it")}
      </ul>
      <a class="btn" href="/?signin=1">Start free</a>
    </div>
  </div>
</section>

<section>
  <div class="wrap narrow">
    <h2>What "beta" means here</h2>
    <p>
      It means the app is in real classrooms and being changed while it's there. Features arrive
      often, and occasionally something moves or is renamed. We think that's a fair trade for
      software shaped by the teachers using it, but you should know it before you plan a semester
      around it.
    </p>
    <p>It does not mean your work is a trial. Everything you make is yours:</p>
    <ul>
      <li><b>Your data is exportable.</b> Any notebook can be saved as a PDF, and we'll produce a
          full export of a school's data on request — during the beta or after it.</li>
      <li><b>We'll give notice before anything costs money.</b> If we introduce paid plans, schools
          already using Notesanity get at least a full semester's notice, and nothing switches off
          without warning.</li>
      <li><b>We don't sell data, and there's no advertising.</b> Not during the beta, not after.
          See the <a href="/privacy">privacy notice</a>.</li>
    </ul>
  </div>
</section>

<section style="padding-top:0">
  <div class="wrap narrow">
    <h2>Common questions</h2>
    <h3>Will it stay free?</h3>
    <p>
      Some of it, probably; all of it, we can't promise. We'd rather say that than imply otherwise
      and change our minds. What we will commit to is the notice period above, and to never
      holding your work hostage to a plan.
    </p>
    <h3>Do you need a purchase order or a contract?</h3>
    <p>
      Not to use it. If your district needs a data processing agreement or a signed privacy
      addendum before staff can adopt a tool — many do — email
      <a href="mailto:support@notesanity.com">support@notesanity.com</a> and we'll work through
      your paperwork.
    </p>
    <h3>Is there a limit we could hit?</h3>
    <p>
      Nothing you'll meet in normal teaching. There are technical ceilings — a notebook starts at
      up to 100 pages, uploads are capped at 25&nbsp;MB — and they're described in the
      <a href="/help">help center</a> where they apply.
    </p>
  </div>
</section>`,
  });
