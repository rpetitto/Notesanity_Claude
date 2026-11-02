/**
 * Who can see and change what: schools, teachers, students and families kept
 * apart.
 *
 * There is no row-level security in the database; every rule lives in a route
 * handler. This builds two schools, a teacher on their own, students and a
 * family, then tries the requests each of them must never be able to make,
 * and checks each one is refused.
 *
 *   npx wrangler dev --port 8799 --persist-to /tmp/tenancy-state   (fresh state)
 *   node tests/e2e/tenancy.mjs http://localhost:8799
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
  const raw = async (method, path, body) => {
    const isForm = body instanceof FormData;
    const r = await fetch(B + path, {
      method,
      headers: isForm ? { cookie } : { "content-type": "application/json", cookie },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      redirect: "manual",
    });
    const sc = r.headers.get("set-cookie");
    if (sc && /notesanity_session=/.test(sc)) cookie = sc.match(/notesanity_session=[^;]*/)[0];
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, body: json };
  };
  const call = async (method, path, body) => {
    const r = await raw(method, path, body);
    if (r.status >= 400) throw new Error(`${label}: ${method} ${path} → ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    return r.body;
  };
  call.raw = raw;
  call.label = label;
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

const SA = session("superadmin");
await SA("POST", "/api/auth/password/register", { email: "r.petitto@gmail.com", password: PW, name: "Platform Owner", door: "teacher" });
const orgA = (await SA("POST", "/api/admin/orgs", { name: "Alpha School", primaryDomain: "a.edu", teacherDomains: "a.edu", studentDomains: "students.a.edu" })).id;
const orgB = (await SA("POST", "/api/admin/orgs", { name: "Beta School", primaryDomain: "b.edu", teacherDomains: "b.edu", studentDomains: "students.b.edu" })).id;

const reg = async (label, email, extra = {}) => {
  const s = session(label);
  await s("POST", "/api/auth/password/register", { email, password: PW, name: label, ...extra });
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

// ------------------------------------------------------------------ result

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
