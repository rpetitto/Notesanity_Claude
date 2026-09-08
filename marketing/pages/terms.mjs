import { layout } from "../layout.mjs";

/**
 * Terms of service.
 *
 * Deliberately plain. The people agreeing to these are teachers and school
 * administrators, not counsel, and terms nobody reads protect nobody. Where a
 * clause exists to protect us it says so rather than hiding behind capitals.
 *
 * A draft for counsel, not a substitute for one — the liability and governing
 * law sections in particular are placeholders that need a lawyer and a
 * jurisdiction.
 */

const UPDATED = "8 September 2026";

export default () =>
  layout({
    path: "/terms",
    title: "Terms of service",
    description:
      "The terms for using Notesanity: who may open an account, who owns the work, what we promise during the beta, and how either side can stop.",
    body: `
<section>
  <div class="wrap">
    <div class="doc">
      <p class="eyebrow">Legal</p>
      <h1>Terms of service</h1>
      <p class="updated">Last updated ${UPDATED}</p>

      <div class="callout">
        <p><b>In short.</b> Your work is yours. We keep it safe and let you take it with you. The
        service is free while it's in beta and may change while you're using it. Don't use it to
        break the law or to harm the children in it.</p>
      </div>

      <h2 id="agreement">1. This agreement</h2>
      <p>
        These terms are between Notesanity and the person or institution using it. If you are using
        Notesanity as part of a school, your school's agreement with us governs, and these terms
        apply to you as a user of it. If you are opening an account on behalf of a school, you are
        confirming you are allowed to do so.
      </p>

      <h2 id="accounts">2. Accounts</h2>
      <ul>
        <li>Accounts are limited to email domains the school has approved. The first person to sign
            in creates the school; after that, an administrator controls which domains are allowed.</li>
        <li>You are responsible for what happens under your account. Don't share your password or
            forward a sign-in link.</li>
        <li>Children use Notesanity through their school. We rely on the school to have the
            authority to provide accounts to its students — see the
            <a href="/privacy">privacy notice</a>.</li>
        <li>We may suspend an account that is being used to harm someone, break the law, or attack
            the service. Where we can, we will tell the school first.</li>
      </ul>

      <h2 id="ownership">3. Who owns what</h2>
      <p>
        <b>You own your content.</b> Notebooks a teacher builds, work a student writes, files
        uploaded — they belong to the person or school that made them, not to us. We claim no
        ownership of it.
      </p>
      <p>
        We need a narrow permission to run the service: to store your content, to show it to the
        people you have shared it with, and to process it as the app requires — displaying a page,
        converting a document, producing a PDF export. That permission exists only to operate
        Notesanity for you, and it ends when you delete the content or close the account.
      </p>
      <p>
        <b>We own Notesanity itself</b> — the software, the design and the name. Using it doesn't
        transfer any of that.
      </p>

      <h2 id="acceptable">4. Acceptable use</h2>
      <p>Don't use Notesanity to:</p>
      <ul>
        <li>break the law, or infringe someone else's rights, including copyright in material you
            upload;</li>
        <li>harass, bully or endanger anyone — particularly the children who use it;</li>
        <li>upload malware, or attempt to gain access to accounts, schools or data that are not
            yours;</li>
        <li>probe, overload or interfere with the service, or work around its limits;</li>
        <li>resell it or pass it off as your own.</li>
      </ul>
      <p>
        Teachers are responsible for the material they bring in. If you upload a worksheet, you
        should have the right to use it.
      </p>

      <h2 id="beta">5. The beta</h2>
      <p>
        Notesanity is in beta and free to use. That means features change, appear and occasionally
        move while you are using it, and it may be briefly unavailable more often than a mature
        product would be. <a href="/status">The status page</a> reflects live checks rather than
        hand-updated claims.
      </p>
      <p>Three commitments hold regardless:</p>
      <ul>
        <li>We will give schools at least a full term's notice before charging for anything they
            currently use for free.</li>
        <li>You can export your work at any time, in the app or by asking us.</li>
        <li>We will not delete a school's data without instruction, except as described in the
            <a href="/privacy">privacy notice</a>.</li>
      </ul>

      <h2 id="availability">6. Availability</h2>
      <p>
        We work to keep Notesanity running during school hours and to lose nothing that was written
        into it. During the beta we do not offer a service level agreement. Work is saved to the
        device first and synced afterwards, so an interruption should not cost a lesson — but no
        system is perfect, and important work should not exist only in one place.
      </p>

      <h2 id="ending">7. Ending it</h2>
      <p>
        You can stop at any time. A school can ask us to delete its data and we will, as described in
        the <a href="/privacy">privacy notice</a>.
      </p>
      <p>
        We may end or suspend access if these terms are seriously or repeatedly broken, or if we
        have to for legal or safety reasons. If we discontinue Notesanity, we will give schools
        notice and time to export their work before anything is switched off.
      </p>

      <h2 id="liability">8. Warranties and liability</h2>
      <p>
        Notesanity is provided as it is. While it is free and in beta we make no warranty that it
        will be uninterrupted or error-free, and to the extent the law allows, our liability is
        limited. Nothing here limits liability for death or personal injury caused by negligence,
        for fraud, or for anything else that cannot lawfully be limited.
      </p>
      <p class="small quiet">
        A school with its own procurement requirements will usually need something more specific
        than this section. Email <a href="mailto:support@notesanity.com">support@notesanity.com</a>
        and we will work through your district's paperwork.
      </p>

      <h2 id="changes">9. Changes</h2>
      <p>
        We may update these terms. If a change materially affects schools using Notesanity, we will
        tell them before it takes effect rather than changing the date at the top and hoping.
      </p>

      <h2 id="contact">10. Contact</h2>
      <p>
        <a href="mailto:support@notesanity.com">support@notesanity.com</a>.
      </p>
    </div>
  </div>
</section>`,
  });
