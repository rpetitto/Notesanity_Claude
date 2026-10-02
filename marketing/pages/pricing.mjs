import { layout } from "../layout.mjs";
import { BETA_FREE, PLANS, FREE_NOTEBOOK_LIMIT, FREE_STUDENT_LIMIT, dollars } from "../../src/shared/plans.mjs";

/**
 * Pricing, during the beta and after it.
 *
 * The plans are published now, while everything is still free, because schools
 * plan budgets a year ahead and a page that says "free" without saying what
 * comes next reads as a bait-and-switch the moment that changes. So the real
 * prices are shown, struck through, with the promise that makes acting on
 * "free" safe: a full semester's notice before anything costs money.
 *
 * `BETA_FREE` comes from the same module the app's own plan gates read, which
 * is what keeps this page and the server from ever disagreeing.
 */

const tick = `<span aria-hidden="true" style="color:var(--pine);font-weight:700">✓</span>`;
const item = (t) => `<li style="display:flex;gap:10px;margin-bottom:10px">${tick}<span>${t}</span></li>`;

const srOnly = `position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap`;

/** Every price says what it's per, so a budget line can be copied straight off the page. */
const perYear = `<span class="quiet" style="font-size:16px;font-weight:400">/year</span>`;
const price = (key) => {
  const p = PLANS[key];
  const big = "margin:0 0 4px;font-family:var(--display);font-size:34px;font-weight:700";
  if (p.priceCents === 0) return `<p style="${big}">$0${perYear}</p>`;
  const amount = dollars(p.priceCents);
  if (BETA_FREE) {
    return `<p style="${big}">
      <span aria-hidden="true" style="opacity:.45"><s>${amount}</s>${perYear}</span><span style="${srOnly}">normally ${amount} a year,</span>
      <span class="beta" style="vertical-align:middle;font-size:13px">Free while in beta</span>
    </p>`;
  }
  return `<p style="${big}">${amount}${perYear}</p>`;
};

const tier = ({ key, who, bullets, cta }) => `
  <div class="card" style="display:flex;flex-direction:column">
    <p class="eyebrow" style="margin-bottom:8px">${PLANS[key].label}</p>
    ${price(key)}
    <p class="quiet" style="margin-bottom:18px">${who}</p>
    <ul style="list-style:none;padding:0;margin:0 0 22px;flex:1">${bullets.map(item).join("")}</ul>
    ${cta}
  </div>`;

const contact = `<a class="btn" href="/contact" style="background:transparent;border-color:var(--pine);color:var(--pine)">Talk to us</a>`;

export default () =>
  layout({
    path: "/pricing",
    title: "Pricing",
    description: BETA_FREE
      ? "Notesanity is free for every teacher while in beta. See the Free and Pro plans that follow, with a full semester's notice before anything costs money."
      : "Simple plans for one teacher or a whole school. Free to start, Pro for one teacher, and Department and School plans by invoice.",
    body: `
<section>
  <div class="wrap narrow">
    <p class="eyebrow">Pricing</p>
    <h1>${BETA_FREE ? "Free while we're in beta. Here's what it will cost." : "Simple plans, for one teacher or a whole school."}</h1>
    <p class="lede">
      ${BETA_FREE
        ? "Every teacher, every class, every student — free for the whole beta, no card and no trial clock. The plans below are what comes after, published now so a school can plan a year ahead."
        : "Keep your files, keep your gradebook. Notesanity replaces the printing, not your stack. Start free, and go Pro when you want last year's work to pay off again: unlimited notebooks and the page library. Schools buy by the department or the building, on an invoice."}
    </p>
  </div>
</section>

<section style="padding-top:0">
  <div class="wrap">
    <div style="display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(230px,1fr))">
      ${tier({
        key: "free",
        who: "One teacher, getting started",
        bullets: [
          `${FREE_NOTEBOOK_LIMIT} class notebooks at a time`,
          `Unlimited classes, up to ${FREE_STUDENT_LIMIT} students in each`,
          "PDF, Word, PowerPoint and Google Drive imports",
          "Find the blanks in a worksheet and make them fillable",
          "Students' own personal notebooks",
          "Google sign-in, sign-in links and passwords",
        ],
        cta: `<a class="btn" href="/?signin=1">Start free</a>`,
      })}
      ${tier({
        key: "pro",
        who: "One teacher, all in",
        bullets: [
          "Everything in Free",
          "Unlimited class notebooks",
          "Classes of any size",
          "The page library — save any page, reuse it anywhere",
          "Support straight from the people who build it",
        ],
        cta: BETA_FREE
          ? `<a class="btn" href="/?signin=1">Start free</a>`
          : `<a class="btn" href="/?signin=1">Upgrade in Settings</a>`,
      })}
      ${tier({
        key: "department",
        who: "A department, on one invoice",
        bullets: [
          `${PLANS.department.seats} Pro seats for one school`,
          "Your admin assigns them to teachers",
          "Invoice or purchase order",
        ],
        cta: contact,
      })}
      ${tier({
        key: "school",
        who: "The whole building",
        bullets: [
          "Every teacher on Pro",
          "The school admin panel — notebooks, assignments and grades across the school",
          "Invoice or purchase order",
        ],
        cta: contact,
      })}
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
      The Free plan will. Pro, Department and School are the plans above, and the prices are the
      ones shown — published now so nobody is surprised later. What we commit to is the notice
      period above, and to never holding your work hostage to a plan.
    </p>
    <h3>How do we buy Department or School?</h3>
    <p>
      <a href="/contact">Get in touch</a> and we'll send a quote. Pay by invoice or purchase order,
      and we switch the plan on for your school — no card, no seat-by-seat signup.
    </p>
    <h3>Do you need a purchase order or a contract?</h3>
    <p>
      Not to use it. If your district needs a data processing agreement or a signed privacy
      addendum before staff can adopt a tool — many do — email
      <a href="mailto:support@notesanity.com">support@notesanity.com</a> and we'll work through
      your paperwork.
    </p>
    <h3>How does that compare with Kami, OneNote or Google Classroom?</h3>
    <p>
      Each prices differently, and each does a different job. The
      <a href="/compare">comparison page</a> sets out what they cost, what they do, and where each
      is stronger than we are.
    </p>
    <h3>Is there a limit we could hit?</h3>
    <p>
      ${BETA_FREE
        ? `Not during the beta. When paid plans arrive, the Free plan will be capped at ${FREE_NOTEBOOK_LIMIT} class notebooks per teacher and ${FREE_STUDENT_LIMIT} students in each class — you'll have a full semester's notice, nothing is deleted, and archived notebooks don't count. The technical ceilings — a notebook starts at up to 100 pages, uploads are capped at 25&nbsp;MB — are described in the <a href="/help">help center</a> where they apply.`
        : `On the Free plan, ${FREE_NOTEBOOK_LIMIT} class notebooks at a time and ${FREE_STUDENT_LIMIT} students in each class — archived notebooks don't count, and nothing is ever deleted. Otherwise only technical ceilings: a notebook starts at up to 100 pages, uploads are capped at 25&nbsp;MB, and they're described in the <a href="/help">help center</a> where they apply.`}
    </p>
  </div>
</section>`,
  });
