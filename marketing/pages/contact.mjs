import { layout } from "../layout.mjs";

/**
 * The contact page.
 *
 * Fewer required fields than the enterprise forms this is modeled on. Every
 * required box is a chance to lose someone, and the only two we genuinely
 * cannot answer without are a name and an address — a teacher trying us out
 * should not have to name a district before we will talk to them. The rest is
 * asked because it helps us reply well, and marked optional because it does.
 *
 * The form works without JavaScript: it posts to the same endpoint natively,
 * and the script only exists to keep people on the page and show the reply
 * inline.
 */

const ROLES = [
  "Teacher",
  "School administrator",
  "District administrator",
  "Department chair",
  "Librarian or media staff",
  "IT or technology staff",
  "Instructional coach",
  "Student or parent",
  "Something else",
];

const INTERESTS = [
  "Using Notesanity in my classroom",
  "Rolling it out across a school",
  "Rolling it out across a district",
  "Privacy, security or a signed agreement",
  "Help with something I'm stuck on",
  "Feedback or a feature request",
  "Something else",
];

const HEARD = [
  "A colleague",
  "Search engine or an AI assistant",
  "Social media",
  "A conference or event",
  "A newsletter or article",
  "Already used it somewhere else",
  "Something else",
];

const STATES = [
  "Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware",
  "District of Columbia","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas",
  "Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan","Minnesota","Mississippi",
  "Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey","New Mexico","New York",
  "North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island",
  "South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont","Virginia","Washington",
  "West Virginia","Wisconsin","Wyoming","Outside the United States",
];

const options = (list, placeholder) =>
  `<option value="" selected>${placeholder}</option>` +
  list.map((o) => `<option value="${o}">${o}</option>`).join("");

const field = (id, label, control, { required = false, hint = "" } = {}) => `
  <div class="fld">
    <label for="${id}">${label}${required ? '<span class="req" aria-hidden="true"> *</span>' : ' <span class="opt">optional</span>'}</label>
    ${control}
    ${hint ? `<p class="hint">${hint}</p>` : ""}
  </div>`;

export default () =>
  layout({
    path: "/contact",
    title: "Talk to us",
    description:
      "Get in touch about using Notesanity in a classroom, a school or a district — including privacy reviews, signed agreements and district paperwork.",
    body: `
<style>
.contact{display:grid;gap:32px;align-items:start}
@media(min-width:900px){.contact{grid-template-columns:minmax(0,1fr) minmax(0,540px);gap:48px}}
.fld{margin-bottom:18px}
.fld label{display:block;font-family:var(--display);font-size:15px;font-weight:700;margin-bottom:6px}
.req{color:#A3341F}
.opt{font-family:var(--body);font-weight:400;font-size:14px;color:var(--quiet)}
.fld input,.fld select,.fld textarea{width:100%;min-height:52px;padding:12px 14px;border:3px solid var(--pine);
  border-radius:14px;background:var(--white);font-family:var(--body);font-size:17px;color:var(--pine)}
.fld textarea{min-height:130px;resize:vertical}
.fld select{appearance:none;
  background-image:linear-gradient(45deg,transparent 50%,var(--pine) 50%),linear-gradient(135deg,var(--pine) 50%,transparent 50%);
  background-position:calc(100% - 20px) 22px,calc(100% - 14px) 22px;background-size:6px 6px;background-repeat:no-repeat;
  padding-right:44px}
.fld input:focus,.fld select:focus,.fld textarea:focus{outline:3px solid var(--mint);outline-offset:2px}
.hint{margin:6px 0 0;font-size:14px;color:var(--quiet)}
.row{display:grid;gap:0}
@media(min-width:560px){.row{grid-template-columns:1fr 1fr;gap:16px}}
/* Off-screen rather than display:none — the bots that fill these read the DOM,
   and a hidden field they can see is the point. */
.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.form-note{font-size:14px;color:var(--quiet);margin:0 0 18px}
.sent{display:none;border:3px solid var(--pine);border-radius:18px;background:var(--mint);padding:24px}
.sent h3{margin-bottom:6px}
.formerr{display:none;border:3px solid #A3341F;background:rgba(163,52,31,.08);color:#7d2716;
  border-radius:14px;padding:12px 14px;margin-bottom:16px;font-size:16px}
</style>

<section>
  <div class="wrap contact">

    <div>
      <p class="eyebrow">Talk to us</p>
      <h1>What does your class actually need?</h1>
      <p class="lede">
        We're a small team, and the person reading this form is the person who builds the thing.
        Tell us what you're trying to do and we'll answer properly.
      </p>

      <div class="card" style="margin-top:28px">
        <h3>Bringing it to a school or district?</h3>
        <p class="small quiet" style="margin-bottom:0">
          Say so below and we'll send what your review needs — how student data is handled, what we
          store, and a signed agreement if your district requires one. There's detail in the
          <a href="/privacy">privacy notice</a> already.
        </p>
      </div>

      <div class="card" style="margin-top:16px">
        <h3>Just stuck on something?</h3>
        <p class="small quiet" style="margin-bottom:0">
          The <a href="/help">help center</a> answers the common ones, and
          <a href="/status">the status page</a> says whether it's us. If neither helps, this form
          reaches the same inbox as <a href="mailto:support@notesanity.com">support@notesanity.com</a>.
        </p>
      </div>
    </div>

    <div>
      <div class="card">
        <h2 style="font-size:24px">Send us a message</h2>
        <p class="form-note">Two fields are required. The rest just help us reply well.</p>

        <div class="formerr" id="formerr" role="alert"></div>

        <form id="contact-form" method="post" action="/api/contact" novalidate>
          <div class="row">
            ${field("name", "Your name", `<input id="name" name="name" type="text" autocomplete="name" required>`, { required: true })}
            ${field("email", "Email", `<input id="email" name="email" type="email" autocomplete="email" required>`, { required: true })}
          </div>

          ${field("role", "Your role", `<select id="role" name="role">${options(ROLES, "Choose one")}</select>`)}
          ${field("organization", "School or district", `<input id="organization" name="organization" type="text" autocomplete="organization">`)}
          ${field("region", "State", `<select id="region" name="region">${options(STATES, "Choose one")}</select>`)}
          ${field("interest", "What's this about?", `<select id="interest" name="interest">${options(INTERESTS, "Choose one")}</select>`)}
          ${field("message", "Anything else", `<textarea id="message" name="message" rows="5" placeholder="What are you trying to do?"></textarea>`)}
          ${field("heardFrom", "How did you hear about us?", `<select id="heardFrom" name="heardFrom">${options(HEARD, "Choose one")}</select>`)}

          <div class="hp" aria-hidden="true">
            <label for="website">Leave this empty</label>
            <input id="website" name="website" type="text" tabindex="-1" autocomplete="off">
          </div>

          <p class="form-note">
            We'll only use this to reply. See the <a href="/privacy">privacy notice</a> and
            <a href="/terms">terms</a>.
          </p>

          <button class="btn btn-primary" type="submit" id="send">Send message</button>
        </form>
      </div>

      <div class="card sent" id="sent" role="status">
        <h3>Thanks — that's with us.</h3>
        <p style="margin-bottom:0">
          We read every message ourselves, so it may take a day rather than a minute. If it's
          urgent, <a href="mailto:support@notesanity.com">email us directly</a>.
        </p>
      </div>
    </div>

  </div>
</section>

<script>
(function () {
  var form = document.getElementById("contact-form");
  if (!form) return;
  var btn = document.getElementById("send");
  var err = document.getElementById("formerr");
  var sent = document.getElementById("sent");

  function fail(msg) {
    err.textContent = msg;
    err.style.display = "block";
    err.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    err.style.display = "none";

    var data = {};
    new FormData(form).forEach(function (v, k) { data[k] = v; });

    if (!String(data.name || "").trim()) return fail("Please tell us your name.");
    if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(String(data.email || ""))) {
      return fail("That doesn't look like an email address.");
    }

    btn.disabled = true;
    btn.textContent = "Sending…";

    fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) throw new Error(j.error || "We couldn't send that. Try again, or email us directly.");
          return j;
        });
      })
      .then(function () {
        form.parentElement.style.display = "none";
        sent.style.display = "block";
        sent.scrollIntoView({ block: "center", behavior: "smooth" });
      })
      .catch(function (e2) {
        fail(e2.message);
        btn.disabled = false;
        btn.textContent = "Send message";
      });
  });
})();
</script>`,
  });
