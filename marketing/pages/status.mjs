import { layout } from "../layout.mjs";

/**
 * The status page.
 *
 * The markup here is a frame; every value in it comes from /api/status, which
 * probes each component when asked. Nothing on this page can be green because
 * someone forgot to change it — if the database is unreachable, the check that
 * says so is the same call the app would have made.
 *
 * It fails loudly on purpose: if the status endpoint itself can't be reached,
 * the page says the service is unreachable rather than leaving a spinner or,
 * worse, the last good answer.
 */

export default () =>
  layout({
    path: "/status",
    title: "Status",
    description:
      "Live status of Notesanity — the app, notebooks and grades, uploads, and sign-in emails. Checked when you load the page, not updated by hand.",
    body: `
<section>
  <div class="wrap narrow">
    <p class="eyebrow">Status</p>
    <h1 id="headline">Checking…</h1>
    <p class="lede" id="subhead">Running live checks against each part of the service.</p>

    <div id="components" style="margin-top:32px"></div>

    <p class="small quiet" id="checked" style="margin-top:20px"></p>

    <div class="card" style="margin-top:32px">
      <h3>Something wrong that isn't here?</h3>
      <p class="small quiet" style="margin-bottom:0">
        These checks cover the service as a whole. If Notesanity is green here but not working for
        you, it's worth checking your school's network first — then email
        <a href="mailto:support@notesanity.com">support@notesanity.com</a> and tell us what you
        were doing.
      </p>
    </div>
  </div>
</section>

<script>
(function () {
  var TONE = {
    operational: { label: "Operational", dot: "#7FD1AE", head: "All systems operational" },
    degraded:    { label: "Slow",        dot: "#E0B03E", head: "Some parts are slow" },
    down:        { label: "Not working", dot: "#A3341F", head: "Something is not working" }
  };

  function row(c) {
    var t = TONE[c.state] || TONE.down;
    var ms = c.ms === null ? "" : '<span class="small quiet" style="margin-left:auto;white-space:nowrap">' + c.ms + ' ms</span>';
    return '<div class="card" style="margin-bottom:12px;padding:18px 20px">' +
      '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
        '<span aria-hidden="true" style="width:12px;height:12px;border-radius:999px;flex-shrink:0;background:' + t.dot + ';border:2px solid var(--pine)"></span>' +
        '<span style="font-family:var(--display);font-weight:700;font-size:18px">' + c.name + '</span>' +
        '<span class="small" style="padding:2px 10px;border-radius:999px;border:2px solid var(--pine);white-space:nowrap">' + t.label + '</span>' +
        ms +
      '</div>' +
      '<p class="small quiet" style="margin:8px 0 0">' + c.detail +
        (c.note ? ' — <b>' + c.note.replace(/</g, "&lt;") + '</b>' : '') +
      '</p>' +
    '</div>';
  }

  function render(data) {
    var t = TONE[data.state] || TONE.down;
    document.getElementById("headline").textContent = t.head;
    document.getElementById("subhead").textContent =
      data.state === "operational"
        ? "Every part of Notesanity answered just now."
        : "The detail below says which part, and what it affects.";
    document.getElementById("components").innerHTML = data.checks.map(row).join("");
    var d = new Date(data.checkedAt);
    document.getElementById("checked").textContent =
      "Checked " + d.toLocaleTimeString() + " on " + d.toLocaleDateString() + ". Refreshes every 60 seconds.";
  }

  function unreachable() {
    document.getElementById("headline").textContent = "Notesanity is unreachable";
    document.getElementById("subhead").textContent =
      "The status check itself could not be reached, which usually means the service is down or your connection is offline.";
    document.getElementById("components").innerHTML = "";
    document.getElementById("checked").textContent = "";
  }

  function check() {
    fetch("/api/status", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(render)
      .catch(unreachable);
  }

  check();
  setInterval(check, 60000);
})();
</script>`,
  });
