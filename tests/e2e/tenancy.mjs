/**
 * Who can see and change what: schools, teachers, students and families kept
 * apart.
 *
 * There is no row-level security in the database; every rule lives in a route
 * handler. This builds two schools, a teacher on their own, students and a
 * family, then tries the requests each of them must never be able to make,
 * and checks each one is refused.
 *
 *   npx wrangler dev --port 8799 --persist-to /tmp/tenancy-state --var AUTH_DEV_LINKS:1 --var AI_STANDIN:1
 *   node tests/e2e/tenancy.mjs http://localhost:8799
 *
 * AUTH_DEV_LINKS hands sign-up and sign-in links back in the response on
 * localhost, so the test can follow them instead of reading a mailbox.
 *
 * Plain fetch, no browser. Exits non-zero when anything gets through.
 */

const B = process.argv[2] || "http://localhost:8799";
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

function session(label) {
  let cookie = "";
  const raw = async (method, path, body, extraHeaders = {}) => {
    const isForm = body instanceof FormData;
    const r = await fetch(B + path, {
      method,
      headers: { ...(isForm ? { cookie } : { "content-type": "application/json", cookie }), ...extraHeaders },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      redirect: "manual",
    });
    const sc = r.headers.get("set-cookie");
    if (sc && /notesanity_session=/.test(sc)) cookie = sc.match(/notesanity_session=[^;]*/)[0];
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, body: json, headers: r.headers };
  };
  /** Open a sign-in link as this browser would: the cookie it sets becomes ours. */
  const follow = async (link) => {
    const r = await fetch(link, { redirect: "manual", headers: { cookie } });
    const sc = r.headers.get("set-cookie");
    if (sc && /notesanity_session=/.test(sc)) cookie = sc.match(/notesanity_session=[^;]*/)[0];
    return r;
  };
  const call = async (method, path, body) => {
    const r = await raw(method, path, body);
    if (r.status >= 400) throw new Error(`${label}: ${method} ${path} → ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    return r.body;
  };
  call.raw = raw;
  call.follow = follow;
  call.label = label;
  call.cookie = () => cookie;
  return call;
}

/** The request must be refused: signed out, forbidden, or "not found". Anything 2xx is a leak. */
async function denied(name, who, method, path, body) {
  const r = await who.raw(method, path, body);
  check(name, [401, 403, 404].includes(r.status), `${who.label} ${method} ${path} → ${r.status}${r.status < 300 ? ` ${JSON.stringify(r.body).slice(0, 160)}` : ""}`);
  return r;
}

const PW = "correct-horse-battery";
const pdfBytes = () => {
  // A minimal two-page PDF, so nothing outside this file is needed.
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([out], { type: "application/pdf" });
};

async function classNotebook(teacher, classId, title, publish = true) {
  const f = new FormData();
  f.append("file", pdfBytes(), "w.pdf");
  f.append("title", title);
  const id = (await teacher("POST", `/api/classes/${classId}/notebooks`, f)).notebook.id;
  await teacher("POST", `/api/notebooks/${id}/pages`, { pages: [{ sourceIndex: 0, width: 612, height: 792 }, { sourceIndex: 1, width: 612, height: 792 }] });
  const nb = await teacher("GET", `/api/notebooks/${id}`);
  const field = (await teacher("POST", `/api/notebooks/${id}/fields`, { pageId: nb.pages[0].id, type: "text", x: 60, y: 300, w: 300, h: 30, label: "Answer" })).field.id;
  if (publish) await teacher("POST", `/api/notebooks/${id}/publish`, {});
  return { id, pages: nb.pages, field, assetKey: nb.notebook.assetKey };
}

// ------------------------------------------------------------------ setup

/** Sign up the way a person does: ask, then open the link that arrives. */
async function signUp(s, body) {
  const r = await s("POST", "/api/auth/password/register", body);
  if (!r.devLink) throw new Error(`${s.label}: sign-up sent no link — is wrangler running with --var AUTH_DEV_LINKS:1?`);
  await s.follow(r.devLink);
}

const SA = session("superadmin");
await signUp(SA, { email: "r.petitto@gmail.com", password: PW, name: "Platform Owner", door: "teacher" });
const orgA = (await SA("POST", "/api/admin/orgs", { name: "Alpha School", primaryDomain: "a.edu", teacherDomains: "a.edu", studentDomains: "students.a.edu" })).id;
const orgB = (await SA("POST", "/api/admin/orgs", { name: "Beta School", primaryDomain: "b.edu", teacherDomains: "b.edu", studentDomains: "students.b.edu" })).id;

const reg = async (label, email, extra = {}) => {
  const s = session(label);
  await signUp(s, { email, password: PW, name: label, ...extra });
  s.me = (await s("GET", "/api/me")).user;
  return s;
};
const TA1 = await reg("teacherA1", "ta1@a.edu", { door: "teacher" });
const TA2 = await reg("teacherA2", "ta2@a.edu", { door: "teacher" });
const TB = await reg("teacherB", "tb@b.edu", { door: "teacher" });
const SOLO = await reg("soloTeacher", "solo@gmail.com", { door: "teacher" });
await SA("PATCH", `/api/admin/users/${TA1.me.id}`, { column: "is_admin", value: 1 });
await SA("PATCH", `/api/admin/users/${TB.me.id}`, { column: "is_admin", value: 1 });
TA1.me = (await TA1("GET", "/api/me")).user;
TB.me = (await TB("GET", "/api/me")).user;

const clsA1 = (await TA1("POST", "/api/classes", { name: "A1 Period 1" })).class;
const clsA2 = (await TA2("POST", "/api/classes", { name: "A2 Period 2" })).class;
const clsB = (await TB("POST", "/api/classes", { name: "B Period 1" })).class;
const clsSolo = (await SOLO("POST", "/api/classes", { name: "Solo class" })).class;
const codeOf = async (t, cls) => (await t("GET", `/api/classes/${cls.id}`)).class.joinCode;

const SA1 = await reg("studentA1", "sa1@students.a.edu", { door: "student" });
const SA2 = await reg("studentA2", "sa2@students.a.edu", { door: "student" });
const SB = await reg("studentB", "sb@students.b.edu", { door: "student" });
await SA1("POST", "/api/classes/join", { code: await codeOf(TA1, clsA1) });
await SA2("POST", "/api/classes/join", { code: await codeOf(TA1, clsA1) });
await SB("POST", "/api/classes/join", { code: await codeOf(TB, clsB) });

const nbA1 = await classNotebook(TA1, clsA1.id, "A1 Unit");
const nbA1Draft = await classNotebook(TA1, clsA1.id, "A1 Draft", false);
const nbA2 = await classNotebook(TA2, clsA2.id, "A2 Unit");
const nbB = await classNotebook(TB, clsB.id, "B Unit");
await SA1("GET", `/api/notebooks/${nbA1.id}/work`);
await SA1("PUT", `/api/notebooks/${nbA1.id}/values`, { values: [{ fieldId: nbA1.field, value: "sa1 private answer" }] });
await SB("GET", `/api/notebooks/${nbB.id}/work`);
await SB("PUT", `/api/notebooks/${nbB.id}/values`, { values: [{ fieldId: nbB.field, value: "sb private answer" }] });

const fam = await TA1("GET", `/api/classes/${clsA1.id}/family`);
const sa1Code = fam.students.find((s) => s.id === SA1.me.id).code;
const G1 = await reg("guardianA1", "parent1@gmail.com", { door: "family", familyCode: sa1Code });

const orgOf = Object.fromEntries((await SA("GET", "/api/admin/users?limit=100")).rows.map((u) => [u.email, u.org_id]));
check("setup: two schools, a solo teacher, students and a family exist",
  orgOf["ta1@a.edu"] === orgA && orgOf["sa1@students.a.edu"] === orgA && orgOf["tb@b.edu"] === orgB && orgOf["sb@students.b.edu"] === orgB
  && ![orgA, orgB].includes(orgOf["solo@gmail.com"]) && G1.me.role === "guardian" && orgOf["parent1@gmail.com"] === orgA,
  JSON.stringify(orgOf));


// ------------------------------------------------------------------ teachers outside the class

const OUT = session("signedOut");
for (const [who, why] of [[TB, "another school's teacher"], [TA2, "a teacher in the same school, not of this class"], [SOLO, "a teacher on their own"]]) {
  const p = nbA1.pages[0].id;
  await denied(`${why}: can't open the notebook`, who, "GET", `/api/notebooks/${nbA1.id}`);
  await denied(`${why}: can't read a student's work`, who, "GET", `/api/notebooks/${nbA1.id}/work?student=${SA1.me.id}`);
  await denied(`${why}: can't read the source PDF`, who, "GET", `/api/notebooks/${nbA1.id}/asset`);
  await denied(`${why}: can't read the markup`, who, "GET", `/api/notebooks/${nbA1.id}/annotations`);
  await denied(`${why}: can't list its assignments`, who, "GET", `/api/notebooks/${nbA1.id}/assignments`);
  await denied(`${why}: can't rename it`, who, "PATCH", `/api/notebooks/${nbA1.id}`, { title: "pwned" });
  await denied(`${why}: can't add a box`, who, "POST", `/api/notebooks/${nbA1.id}/fields`, { pageId: p, type: "text", x: 1, y: 1, w: 10, h: 10 });
  await denied(`${why}: can't add pages`, who, "POST", `/api/notebooks/${nbA1.id}/pages/blank`, { pattern: "blank", color: "#000000", count: 1 });
  await denied(`${why}: can't delete a page`, who, "DELETE", `/api/notebooks/${nbA1.id}/pages/${p}`);
  await denied(`${why}: can't publish it`, who, "POST", `/api/notebooks/${nbA1.id}/publish`, {});
  await denied(`${why}: can't open the class`, who, "GET", `/api/classes/${clsA1.id}`);
  await denied(`${why}: can't rename the class`, who, "PATCH", `/api/classes/${clsA1.id}`, { name: "pwned" });
  await denied(`${why}: can't see family codes`, who, "GET", `/api/classes/${clsA1.id}/family`);
  await denied(`${why}: can't design into it with AI`, who, "POST", "/api/ai/designs", { notebookId: nbA1.id, kind: "exit", description: "x", pageCount: 1 });
}
await denied("signed out: can't open a notebook", OUT, "GET", `/api/notebooks/${nbA1.id}`);
await denied("signed out: can't read work", OUT, "GET", `/api/notebooks/${nbA1.id}/work`);
await denied("signed out: can't list classes", OUT, "GET", "/api/classes");
await denied("signed out: can't read an asset", OUT, "GET", `/api/notebooks/${nbA1.id}/asset`);

// ------------------------------------------------------------------ students

await denied("a student can't read a classmate's work", SA2, "GET", `/api/notebooks/${nbA1.id}/work?student=${SA1.me.id}`);
await denied("a student can't write a classmate's answers", SA2, "PUT", `/api/notebooks/${nbA1.id}/values?student=${SA1.me.id}`, { values: [{ fieldId: nbA1.field, value: "overwritten" }] });
await denied("a student can't open a draft notebook", SA1, "GET", `/api/notebooks/${nbA1Draft.id}`);
await denied("a student can't read a draft's work", SA1, "GET", `/api/notebooks/${nbA1Draft.id}/work`);
await denied("a student can't edit the class notebook", SA1, "PATCH", `/api/notebooks/${nbA1.id}`, { title: "pwned" });
await denied("a student can't add boxes", SA1, "POST", `/api/notebooks/${nbA1.id}/fields`, { pageId: nbA1.pages[0].id, type: "text", x: 1, y: 1, w: 10, h: 10 });
await denied("a student can't publish", SA1, "POST", `/api/notebooks/${nbA1.id}/publish`, {});
await denied("a student can't see family codes", SA1, "GET", `/api/classes/${clsA1.id}/family`);
await denied("a student can't open another class's notebook", SA1, "GET", `/api/notebooks/${nbA2.id}`);
await denied("a student can't open another school's notebook", SA1, "GET", `/api/notebooks/${nbB.id}/work`);
await denied("a student can't use the AI designer", SA1, "GET", "/api/ai/allowance");
{
  const r = await SA2.raw("GET", `/api/notebooks/${nbA1.id}/work`);
  check("a student's own work doesn't carry a classmate's answers", r.status === 200 && !JSON.stringify(r.body).includes("sa1 private answer"));
}
{
  const r = await SA1.raw("GET", `/api/classes/${clsA1.id}`);
  const text = JSON.stringify(r.body);
  check("a student opening their class doesn't get classmates' emails", r.status !== 200 || !text.includes("sa2@students.a.edu"), `status ${r.status}`);
}

// ------------------------------------------------------------------ families

await denied("a parent can't read another child's overview", G1, "GET", `/api/family/children/${SA2.me.id}/overview`);
await denied("a parent can't read another school's child", G1, "GET", `/api/family/children/${SB.me.id}/overview`);
await denied("a parent can't read a classmate's work through the work route", G1, "GET", `/api/notebooks/${nbA1.id}/work?student=${SA2.me.id}`);
await denied("a parent can't write in their child's work", G1, "PUT", `/api/notebooks/${nbA1.id}/values?student=${SA1.me.id}`, { values: [{ fieldId: nbA1.field, value: "parent wrote this" }] });
await denied("a parent can't open a draft", G1, "GET", `/api/notebooks/${nbA1Draft.id}`);
await denied("a parent can't open the class roster", G1, "GET", `/api/classes/${clsA1.id}`);
{
  const r = await G1.raw("GET", `/api/family/children/${SA1.me.id}/overview`);
  check("a parent can read their own child's overview", r.status === 200, String(r.status));
}

// ------------------------------------------------------------------ school admins and the platform

for (const path of ["/api/admin/users", "/api/admin/orgs", "/api/admin/notebooks", "/api/admin/logs", "/api/admin/impersonations"]) {
  await denied(`a school admin can't reach the platform admin ${path}`, TB, "GET", path);
}
await denied("a school admin can't impersonate", TB, "POST", "/api/admin/impersonate", { userId: TA1.me.id, reason: "x" });
await denied("a school admin can't edit users through the platform grid", TB, "PATCH", `/api/admin/users/${TB.me.id}`, { column: "is_superadmin", value: 1 });
for (const path of ["/api/org/notebooks", "/api/org/assignments", "/api/org/grades", "/api/org/family"]) {
  const r = await TB.raw("GET", path);
  const text = JSON.stringify(r.body);
  check(`a school admin's ${path} holds only their own school`, !text.includes("A1 Unit") && !text.includes("a.edu") && !text.includes("sa1"), `status ${r.status}`);
}
await denied("a teacher who isn't an admin can't read the school's grades", TA2, "GET", "/api/org/grades");

// ------------------------------------------------------------------ signing up proves the address

{
  // An account a teacher made ahead of time has no password yet — the case
  // that used to let anyone sign up "as" it.
  await TA1("POST", `/api/classes/${clsA1.id}/invite`, { emails: ["newkid@students.a.edu"] });
  const X = session("attacker");
  const r = await X.raw("POST", "/api/auth/password/register", { email: "newkid@students.a.edu", password: "attacker-password-1", door: "student" });
  check("sign-up for an existing address doesn't sign the caller in", r.status === 200 && r.body.verify === true && !X.cookie(), `${r.status} cookie=${!!X.cookie()}`);
  const me = await X.raw("GET", "/api/me");
  check("…and the caller isn't anyone afterwards", !me.body?.user, JSON.stringify(me.body).slice(0, 80));
  const login = await X.raw("POST", "/api/auth/password/login", { email: "newkid@students.a.edu", password: "attacker-password-1" });
  check("…and no password was set on that account", login.status === 401, String(login.status));
  const Y = session("attacker2");
  await Y.raw("POST", "/api/auth/password/register", { email: "robert@unropedapps.com", password: "attacker-password-1", door: "teacher" });
  const users = (await SA("GET", "/api/admin/users?limit=100")).rows.map((u) => u.email);
  check("sign-up for a platform-owner address makes nothing until the link is opened", !Y.cookie() && !users.includes("robert@unropedapps.com"));
  const Z = session("crossSite");
  const cs = await Z.raw("POST", "/api/auth/password/login", { email: "ta1@a.edu", password: PW }, { origin: "https://evil.example" });
  check("a sign-in posted from another site is refused", cs.status === 403 && !Z.cookie(), String(cs.status));
}

// ------------------------------------------------------------------ password reset

{
  const TA2b = session("teacherA2-otherDevice");
  await TA2b("POST", "/api/auth/password/login", { email: "ta2@a.edu", password: PW });
  const reset = await session("x")("POST", "/api/auth/magic/request", { email: "ta2@a.edu", purpose: "reset" });
  const R = session("teacherA2-reset");
  await R.follow(reset.devLink);
  const changed = await R.raw("POST", "/api/auth/password/change", { newPassword: "a-brand-new-password" });
  check("a reset link lets you choose a new password without the old one", changed.status === 200, `${changed.status} ${JSON.stringify(changed.body)}`);
  const stale = await TA2b.raw("GET", "/api/me");
  check("…and every other device is signed out", !stale.body?.user);
  const again = await R.raw("POST", "/api/auth/password/change", { newPassword: "yet-another-password" });
  check("…and only once: after that the old password is needed again", again.status === 401, String(again.status));
  const NOPE = session("noReset");
  await NOPE("POST", "/api/auth/password/login", { email: "ta2@a.edu", password: "a-brand-new-password" });
  const without = await NOPE.raw("POST", "/api/auth/password/change", { newPassword: "sneaky-new-password" });
  check("an ordinary session still needs the current password", without.status === 401, String(without.status));
  // The original TA2 session was signed out by the reset; sign it back in for what follows.
  await TA2("POST", "/api/auth/password/login", { email: "ta2@a.edu", password: "a-brand-new-password" });
}

// ------------------------------------------------------------------ school domains

{
  const c1 = await TA1.raw("PATCH", "/api/org", { teacherDomains: "a.edu, b.edu" });
  check("a school admin can't claim another school's domain", c1.status === 409, String(c1.status));
  const c2 = await TA1.raw("PATCH", "/api/org", { studentDomains: "students.a.edu, students.b.edu" });
  check("…or another school's student domain", c2.status === 409, String(c2.status));
  const r1 = await TA1.raw("PATCH", "/api/org", { teacherDomains: "a.edu, gmail.com" });
  check("…or a personal-mail domain", r1.status === 400, String(r1.status));
  const r2 = await TA1.raw("PATCH", "/api/org", { teacherDomains: "a.edu, unclaimed-district.org" });
  check("…or a domain nobody has claimed (the platform adds those)", r2.status === 403, String(r2.status));
  const r3 = await TA1.raw("PATCH", "/api/org", { teacherDomains: "a.edu, staff.a.edu" });
  check("…but can add a subdomain of their own", r3.status === 200, String(r3.status));
}

// ------------------------------------------------------------------ rosters across schools

{
  const r = await SOLO("POST", `/api/classes/${clsSolo.id}/invite`, { emails: ["kid9@students.b.edu"] });
  const users = (await SA("GET", "/api/admin/users?limit=100")).rows.map((u) => u.email);
  check("a solo teacher can't make accounts on a school's domain", r.skipped?.length === 1 && !users.includes("kid9@students.b.edu"), JSON.stringify(r));
  const r2 = await TA1("POST", `/api/classes/${clsA1.id}/invite`, { emails: ["sb@students.b.edu"] });
  check("inviting another school's existing student gives the same answer", r2.skipped?.[0]?.reason === r.skipped?.[0]?.reason, JSON.stringify(r2.skipped));
  const r3 = await TA1("POST", `/api/classes/${clsA1.id}/teachers`, { emails: ["sa2@students.a.edu", "parent1@gmail.com"] });
  check("only teacher accounts become co-teachers (not a student, not a parent)", !r3.added?.length && r3.skipped?.length === 2, JSON.stringify(r3));
  const r4 = await TA1.raw("POST", `/api/classes/${clsA1.id}/teachers`, { emails: "a@b" });
  check("the co-teacher list must be a list", r4.status === 400, String(r4.status));
}

// ------------------------------------------------------------------ co-teachers

{
  await TA1("POST", `/api/classes/${clsA1.id}/teachers`, { emails: ["ta2@a.edu"] });
  await denied("a co-teacher can't delete the owner's class", TA2, "DELETE", `/api/classes/${clsA1.id}?confirm=${encodeURIComponent(clsA1.name)}`);
  await TA1("DELETE", `/api/classes/${clsA1.id}/teachers/${TA2.me.id}`);
  const code = (await TA1("GET", `/api/classes/${clsA1.id}`)).class.joinCode;
  await denied("a removed co-teacher can't get back in with the join code", TA2, "POST", "/api/classes/join", { code });
  await denied("…and is out of the class", TA2, "GET", `/api/classes/${clsA1.id}`);
}

// ------------------------------------------------------------------ join codes

{
  const asStudent = await SA1("GET", `/api/classes/${clsA1.id}`);
  const text = JSON.stringify(asStudent);
  const code = (await TA1("GET", `/api/classes/${clsA1.id}`)).class.joinCode;
  check("a student doesn't receive the join code", !text.includes(code) && !("join_code" in asStudent.class));
  const r = await SB.raw("POST", "/api/classes/join", { code });
  check("another school's student gets the same answer as a wrong code", r.status === 404 && /No class matches/.test(r.body.error), `${r.status} ${JSON.stringify(r.body)}`);
}

// ------------------------------------------------------------------ family codes

{
  const fam2 = await TA1("GET", `/api/classes/${clsA1.id}/family`);
  const code = fam2.students.find((s) => s.id === SA2.me.id).code;
  await denied("a teacher can't redeem a family code of a student they teach", TA1, "POST", "/api/family/link", { code });
  await denied("a student can't redeem a classmate's family code", SA1, "POST", "/api/family/link", { code });
}

// ------------------------------------------------------------------ files

{
  const tpl = (await TB("POST", "/api/my/templates", { title: "B template", pages: 1, pattern: "graph", color: "#3F6C9E" })).notebook.id;
  const r = await TB.raw("POST", `/api/notebooks/${tpl}/pages`, { assetKey: nbA1.assetKey, pages: [{ sourceIndex: 0, width: 612, height: 792 }] });
  check("a page can't point at another notebook's document", r.status === 400, `${r.status} ${JSON.stringify(r.body)}`);
  const r2 = await TB.raw("POST", `/api/notebooks/${tpl}/pages`, { assetKey: `notebooks/${nbA1.id}/ink/x/y-student.json`, pages: [{ sourceIndex: 0, width: 612, height: 792 }] });
  check("…or at another notebook's ink", r2.status === 400, String(r2.status));
  const tp = (await TB("GET", `/api/notebooks/${tpl}`)).pages[0].id;
  const fig = (await TB("POST", `/api/notebooks/${tpl}/fields`, { pageId: tp, type: "figure", x: 10, y: 10, w: 100, h: 100 })).field.id;
  const f = new FormData();
  f.append("file", new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], { type: "image/svg+xml" }), "x.svg");
  const up = await TB.raw("POST", `/api/notebooks/${tpl}/fields/${fig}/media`, f);
  check("an SVG can't be uploaded as a picture", up.status === 400, String(up.status));
  const asset = await TA1.raw("GET", `/api/notebooks/${nbA1.id}/asset`);
  check("uploaded files are served with nosniff and a sandbox",
    asset.headers.get("x-content-type-options") === "nosniff" && /sandbox/.test(asset.headers.get("content-security-policy") ?? ""));
  await denied("a student can't fetch a non-page file from a notebook's folder", SA1, "GET", `/api/notebooks/${nbA1.id}/asset?key=${encodeURIComponent(`notebooks/${nbA1.id}/comments/x.webm`)}`);
}

// ------------------------------------------------------------------ assignments and grades

{
  const live = (await TA1("POST", `/api/classes/${clsA1.id}/assignments`, { title: "Live one", notebookId: nbA1.id, pageIds: [nbA1.pages[0].id], status: "active", grading: "points", pointsMax: 10 })).assignment?.id;
  const later = (await TA1("POST", `/api/classes/${clsA1.id}/assignments`, { title: "Not yet", notebookId: nbA1.id, pageIds: [nbA1.pages[1].id], status: "active", releaseAt: new Date(Date.now() + 7 * 86400_000).toISOString() })).assignment?.id;
  await denied("a teacher can't grade someone who isn't in the class", TA1, "POST", `/api/assignments/${live}/grade`, { studentId: SB.me.id, points: 1 });
  await denied("a student can't open an assignment before it's released", SA1, "GET", `/api/assignments/${later}`);
  await denied("…or hand it in", SA1, "POST", `/api/assignments/${later}/submit`, {});
  const ok = await SA1.raw("GET", `/api/assignments/${live}`);
  check("a student can open a live assignment", ok.status === 200, String(ok.status));
}

// ------------------------------------------------------------------ students' own notebooks

{
  await SA2("POST", `/api/classes/${clsA1.id}/my-notebooks`, { title: "SA2 private journal", pages: 1, pattern: "blank", color: "#000000" });
  const mine = await SA1("GET", "/api/my/notebooks");
  check("a student's notebook list doesn't include a classmate's own notebook", !JSON.stringify(mine).includes("SA2 private journal"));
  const theirs = await SA2("GET", "/api/my/notebooks");
  check("…but does include their own", JSON.stringify(theirs).includes("SA2 private journal"));
}

// ------------------------------------------------------------------ rostering ahead of time

{
  const rows = [
    { email: "kid@a.edu", name: "Kid On Staff Domain", role: "student" },     // a.edu says "teacher" — the roster says otherwise
    { email: "newteacher@a.edu", name: "New Teacher", role: "Teacher" },
    { email: "sa2@students.a.edu", name: "", role: "student" },                // already right
    { email: "sb@students.b.edu", name: "", role: "student" },                 // another school's account
    { email: "stranger@b.edu", name: "", role: "teacher" },                    // another school's domain
    { email: "parent1@gmail.com", name: "", role: "teacher" },                 // a family account
    { email: "not-an-email", name: "", role: "student" },
    { email: "x@a.edu", name: "", role: "principal" },
  ];
  const preview = await TA1("POST", "/api/org/roster", { rows, apply: false });
  const by = Object.fromEntries(preview.rows.map((r) => [r.email, r]));
  check("roster preview: adds the new people", by["kid@a.edu"].outcome === "create" && by["newteacher@a.edu"].outcome === "create");
  check("roster preview: someone already right is left alone", by["sa2@students.a.edu"].outcome === "same");
  check("roster preview: never another school's account or domain, one reason for both",
    by["sb@students.b.edu"].outcome === "skip" && by["stranger@b.edu"].outcome === "skip" && by["sb@students.b.edu"].detail === by["stranger@b.edu"].detail);
  check("roster preview: never a family account, a bad address or an unknown role",
    by["parent1@gmail.com"].outcome === "skip" && by["not-an-email"].outcome === "skip" && by["x@a.edu"].outcome === "skip");
  let emails = (await SA("GET", "/api/admin/users?limit=200")).rows.map((u) => u.email);
  check("roster preview changes nothing", !emails.includes("kid@a.edu"));
  await denied("a teacher who isn't an admin can't import a roster", TA2, "POST", "/api/org/roster", { rows, apply: true });
  await denied("a student can't import a roster", SA1, "POST", "/api/org/roster", { rows, apply: true });
  const other = await TB("POST", "/api/org/roster", { rows: [{ email: "ta2@a.edu", role: "student" }], apply: true });
  check("another school's admin can't change this school's people", other.rows[0].outcome === "skip");
  const done = await TA1("POST", "/api/org/roster", { rows, apply: true });
  emails = (await SA("GET", "/api/admin/users?limit=200")).rows.map((u) => u.email);
  check("roster import adds them", done.applied && done.summary.create === 2 && emails.includes("kid@a.edu") && emails.includes("newteacher@a.edu"));
  const KID = session("rosteredKid");
  await signUp(KID, { email: "kid@a.edu", password: PW, name: "Kid", door: "teacher" });
  check("someone rostered as a student stays a student even if they pick Teacher", (await KID("GET", "/api/me")).user.role === "student");
  const NEW = session("rosteredTeacher");
  await signUp(NEW, { email: "newteacher@a.edu", password: PW, name: "New Teacher", door: "teacher" });
  check("someone rostered as a teacher is a teacher when they sign in", (await NEW("GET", "/api/me")).user.role === "teacher");
}

// ------------------------------------------------------------------ result

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
