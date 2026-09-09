/**
 * Notesanity schema.
 *
 * Design note — the non-destructive update engine:
 *   Every page and every form field carries a stable UUID that is minted once and
 *   never reused. Student work (ink layers, typed field values) is keyed by those
 *   UUIDs, never by ordinal position. That means a teacher can insert a page,
 *   archive a page, reorder pages, or move/resize a field, and existing student
 *   work stays anchored to the right place. Ordering lives in `pages.seq` (a REAL,
 *   so a page can always be slotted between two others without renumbering).
 */

import { migrate, db } from "./platform";

/**
 * Platform owners. Seeded by address so the role exists before they do, and
 * re-applied on sign-in, which also lets them in past the org's domain
 * allowlist — otherwise the people who fix the allowlist could be shut out by it.
 */
export const SUPERADMIN_EMAILS = [
  "r.petitto@gmail.com",
  "robert.petitto@woodward.edu",
  "robert@unropedapps.com",
];

migrate("001_core", async () => {
  // An org is one school/district, keyed by email domain. The first user to sign
  // in bootstraps the org and becomes its admin.
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS orgs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      primary_domain TEXT NOT NULL UNIQUE,
      teacher_domains TEXT NOT NULL DEFAULT '',
      student_domains TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      picture TEXT,
      role TEXT NOT NULL DEFAULT 'pending',
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id)`).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS classes (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      section TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'manual',
      google_course_id TEXT,
      join_code TEXT UNIQUE,
      accent_color TEXT NOT NULL DEFAULT '#1A73E8',
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_classes_owner ON classes(owner_id)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_classes_org ON classes(org_id)`).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS enrollments (
      id TEXT PRIMARY KEY,
      class_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student',
      status TEXT NOT NULL DEFAULT 'active',
      backfill_pending INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(class_id, user_id)
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_enroll_user ON enrollments(user_id)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_enroll_class ON enrollments(class_id)`).run();

  // A notebook is a master template. `asset_key` points at the source PDF in
  // object storage; the client renders it with pdf.js (Layer 1).
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS notebooks (
      id TEXT PRIMARY KEY,
      class_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      title TEXT NOT NULL,
      source_name TEXT NOT NULL DEFAULT '',
      asset_key TEXT,
      page_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft',
      last_published_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_notebooks_class ON notebooks(class_id)`).run();

  // Master pages. `id` is the permanent anchor for student work.
  // `source_index` is the 0-based page number inside the source PDF.
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS pages (
      id TEXT PRIMARY KEY,
      notebook_id TEXT NOT NULL,
      seq REAL NOT NULL,
      asset_key TEXT NOT NULL DEFAULT '',
      source_index INTEGER NOT NULL,
      width REAL NOT NULL DEFAULT 612,
      height REAL NOT NULL DEFAULT 792,
      label TEXT NOT NULL DEFAULT '',
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_pages_notebook ON pages(notebook_id, seq)`).run();

  // Layer 2: teacher-authored interactive form fields. Coordinates are in page
  // units (same space as pages.width/height) so they are resolution independent.
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS fields (
      id TEXT PRIMARY KEY,
      notebook_id TEXT NOT NULL,
      page_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text',
      x REAL NOT NULL,
      y REAL NOT NULL,
      w REAL NOT NULL,
      h REAL NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      options TEXT NOT NULL DEFAULT '[]',
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_fields_page ON fields(page_id)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_fields_notebook ON fields(notebook_id)`).run();

  // One row per (notebook, student) — the student's personal copy of the notebook.
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS instances (
      id TEXT PRIMARY KEY,
      notebook_id TEXT NOT NULL,
      class_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(notebook_id, student_id)
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_instances_student ON instances(student_id)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_instances_notebook ON instances(notebook_id)`).run();

  // Layer 3: ink/text/stamp overlays. One row per (instance, page, kind) where
  // kind is 'student' (the student's own work) or 'teacher' (grading markup).
  // `data` is a compact JSON payload; `rev` powers optimistic concurrency.
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS layers (
      id TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL,
      page_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'student',
      data TEXT NOT NULL DEFAULT '',
      rev INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(instance_id, page_id, kind)
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_layers_instance ON layers(instance_id)`).run();

  // Student answers to teacher-defined form fields, anchored to field UUID so
  // moving or resizing a field preserves the value.
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS field_values (
      id TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL,
      field_id TEXT NOT NULL,
      value TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(instance_id, field_id)
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_fieldvalues_instance ON field_values(instance_id)`).run();

  // `page_ids` is a JSON array of page UUIDs — supports non-adjacent scopes
  // like "pages 2, 5, 8" and survives reordering of the notebook.
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS assignments (
      id TEXT PRIMARY KEY,
      class_id TEXT NOT NULL,
      notebook_id TEXT NOT NULL,
      title TEXT NOT NULL,
      instructions TEXT NOT NULL DEFAULT '',
      page_ids TEXT NOT NULL DEFAULT '[]',
      release_at TEXT,
      due_at TEXT,
      grading TEXT NOT NULL DEFAULT 'points',
      points_max REAL NOT NULL DEFAULT 100,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_assignments_class ON assignments(class_id)`).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      assignment_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'not_started',
      submitted_at TEXT,
      returned_at TEXT,
      grade_points REAL,
      grade_letter TEXT,
      grade_complete INTEGER,
      feedback TEXT NOT NULL DEFAULT '',
      graded_at TEXT,
      graded_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(assignment_id, student_id)
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_submissions_assignment ON submissions(assignment_id)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_submissions_student ON submissions(student_id)`).run();
});

/**
 * Page grouping — lets a teacher label runs of pages ("Warm-up", "Lab", "Homework")
 * in the notebook's page list. Purely organizational: grouping never moves a page
 * or touches the UUID student work is anchored to.
 */
migrate("002_page_groups", async () => {
  const cols = await db.prepare(`PRAGMA table_info(pages)`).all<{ name: string }>();
  const has = (name: string) => (cols.results ?? []).some((c) => c.name === name);
  if (!has("group_name")) {
    await db.prepare(`ALTER TABLE pages ADD COLUMN group_name TEXT NOT NULL DEFAULT ''`).run();
  }
});

/**
 * Richer field types.
 *
 *  - `prompt` pairs a teacher instruction (and optionally an image) with a text
 *    answer box, so a question and its response are one object.
 *  - `image` and `audio` accept a student upload inside the teacher-defined box.
 *
 * `media_key` holds the teacher's own attachment for a prompt. Student uploads
 * are stored per response and referenced from field_values.
 */
migrate("005_rich_fields", async () => {
  const cols = await db.prepare(`PRAGMA table_info(fields)`).all<{ name: string }>();
  const has = (name: string) => (cols.results ?? []).some((c) => c.name === name);
  if (!has("prompt")) {
    await db.prepare(`ALTER TABLE fields ADD COLUMN prompt TEXT NOT NULL DEFAULT ''`).run();
  }
  if (!has("media_key")) {
    await db.prepare(`ALTER TABLE fields ADD COLUMN media_key TEXT`).run();
  }

  // A student response can now be a file rather than text.
  const vcols = await db.prepare(`PRAGMA table_info(field_values)`).all<{ name: string }>();
  const vhas = (name: string) => (vcols.results ?? []).some((c) => c.name === name);
  if (!vhas("asset_key")) {
    await db.prepare(`ALTER TABLE field_values ADD COLUMN asset_key TEXT`).run();
  }
  if (!vhas("content_type")) {
    await db.prepare(`ALTER TABLE field_values ADD COLUMN content_type TEXT`).run();
  }
});

/**
 * Teacher annotations on the master page.
 *
 * These are ink the teacher draws on the template itself — worked examples,
 * corrections, callouts — as opposed to marks on one student's copy. They follow
 * the same publish model as the rest of the template: `draft_data` is what the
 * teacher is editing, `published_data` is what students actually see, and
 * "Update student notebooks" promotes one to the other. That way a half-finished
 * annotation never appears mid-lesson on thirty screens.
 */
migrate("006_master_annotations", async () => {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS page_annotations (
      page_id TEXT PRIMARY KEY,
      notebook_id TEXT NOT NULL,
      draft_data TEXT NOT NULL DEFAULT '',
      published_data TEXT NOT NULL DEFAULT '',
      rev INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      published_at TEXT
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_page_annotations_nb ON page_annotations(notebook_id)`).run();
});

/**
 * Sign-in beyond Google.
 *
 * `credentials` holds a PBKDF2 hash + per-user salt (never a raw password).
 * `auth_tokens` backs magic links and password resets: only a hash of the token
 * is stored, so a leaked database still can't be used to sign in as anyone.
 * `sessions` is a plain opaque-token table — the cookie value is a random id
 * looked up here, which needs no signing secret to be unforgeable.
 */
migrate("007_local_auth", async () => {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS credentials (
      user_id TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      iterations INTEGER NOT NULL DEFAULT 210000,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auth_tokens (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT 'magic',
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_auth_tokens_email ON auth_tokens(email)`).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`).run();
});

/** Class identity: an emoji badge and an optional featured image. */
migrate("004_class_identity", async () => {
  const cols = await db.prepare(`PRAGMA table_info(classes)`).all<{ name: string }>();
  const has = (name: string) => (cols.results ?? []).some((c) => c.name === name);
  if (!has("emoji")) {
    await db.prepare(`ALTER TABLE classes ADD COLUMN emoji TEXT NOT NULL DEFAULT ''`).run();
  }
  if (!has("cover_key")) {
    await db.prepare(`ALTER TABLE classes ADD COLUMN cover_key TEXT`).run();
  }
});

/** Per-notebook cover styling: an accent color and an optional uploaded image. */
migrate("003_notebook_cover", async () => {
  const cols = await db.prepare(`PRAGMA table_info(notebooks)`).all<{ name: string }>();
  const has = (name: string) => (cols.results ?? []).some((c) => c.name === name);
  if (!has("accent_color")) {
    await db.prepare(`ALTER TABLE notebooks ADD COLUMN accent_color TEXT NOT NULL DEFAULT '#1A73E8'`).run();
  }
  if (!has("cover_key")) {
    await db.prepare(`ALTER TABLE notebooks ADD COLUMN cover_key TEXT`).run();
  }
});

/**
 * Retire the placeholder Google blue.
 *
 * Accents were seeded with #1A73E8 before the brand existed; it clashes badly
 * with Pine and Oat. Anything still on the old default moves to the brand's
 * deep teal. A color a teacher actually chose is left alone.
 */
migrate("008_brand_accents", async () => {
  await db.prepare(`UPDATE classes SET accent_color = '#2E7D6B' WHERE accent_color = '#1A73E8'`).run();
  await db.prepare(`UPDATE notebooks SET accent_color = '#2E7D6B' WHERE accent_color = '#1A73E8'`).run();
});

/**
 * Activity log.
 *
 * Every change to a student's work, and every teacher action on it, is recorded
 * with a timestamp. This exists to settle exactly one kind of dispute: a page
 * edited after it was marked, with the student saying the teacher missed it. The
 * log is shown to both sides — a record only one party can see isn't evidence,
 * it's surveillance.
 *
 * `detail` is a short human sentence, not a diff: the point is a readable
 * history, and storing full page contents per revision would dwarf the work.
 */
migrate("009_activity_log", async () => {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY,
      notebook_id TEXT,
      instance_id TEXT,
      page_id TEXT,
      assignment_id TEXT,
      student_id TEXT,
      actor_id TEXT NOT NULL,
      actor_role TEXT NOT NULL DEFAULT 'student',
      action TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_activity_instance ON activity(instance_id, created_at)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_activity_assignment ON activity(assignment_id, created_at)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_activity_student ON activity(student_id, created_at)`).run();
});

/**
 * Explicit lock state on a submission.
 *
 * Submitting already froze the assigned pages, but returning the work unfroze
 * them — which is precisely the window where a student could edit a page and
 * claim it was always that way. Work now stays locked once handed in, including
 * after it comes back, until a teacher deliberately reopens it.
 */
migrate("010_submission_lock", async () => {
  const cols = await db.prepare(`PRAGMA table_info(submissions)`).all<{ name: string }>();
  const has = (n: string) => (cols.results ?? []).some((c) => c.name === n);
  if (!has("locked")) {
    await db.prepare(`ALTER TABLE submissions ADD COLUMN locked INTEGER NOT NULL DEFAULT 0`).run();
  }
  if (!has("reopened_at")) {
    await db.prepare(`ALTER TABLE submissions ADD COLUMN reopened_at TEXT`).run();
  }
  // Anything already handed in stays that way.
  await db.prepare(`UPDATE submissions SET locked = 1 WHERE submitted_at IS NOT NULL`).run();
});

/**
 * Teacher-inserted blank pages.
 *
 * A blank page has no source document: `asset_key` stays empty and `pattern`
 * names the ruling to draw instead. The client renders it from those two
 * columns, so the page costs nothing in storage and stays sharp at any zoom.
 * An empty `pattern` means the page is PDF-backed, which is every page that
 * existed before this.
 */
migrate("011_blank_pages", async () => {
  const cols = await db.prepare(`PRAGMA table_info(pages)`).all<{ name: string }>();
  const has = (n: string) => (cols.results ?? []).some((c) => c.name === n);
  if (!has("pattern")) {
    await db.prepare(`ALTER TABLE pages ADD COLUMN pattern TEXT NOT NULL DEFAULT ''`).run();
  }
  if (!has("pattern_color")) {
    await db.prepare(`ALTER TABLE pages ADD COLUMN pattern_color TEXT NOT NULL DEFAULT ''`).run();
  }
});

/**
 * Teacher-authored page content.
 *
 * Until now everything a teacher placed on a page was something a student had
 * to fill in. `richtext` and `figure` are content instead: formatted text and
 * pictures that belong to the page itself and take no answer. `content` holds
 * the sanitised markup for `richtext`; `figure` reuses the existing `media_key`
 * that prompt illustrations already use.
 */
migrate("012_page_content", async () => {
  const cols = await db.prepare(`PRAGMA table_info(fields)`).all<{ name: string }>();
  const has = (n: string) => (cols.results ?? []).some((c) => c.name === n);
  if (!has("content")) {
    await db.prepare(`ALTER TABLE fields ADD COLUMN content TEXT NOT NULL DEFAULT ''`).run();
  }
});

/**
 * A record of every sign-in email we tried to send.
 *
 * Delivery was previously unobservable: the endpoint answers the same way
 * whether it sent, refused, or failed — deliberately, so it can't be used to
 * discover who has an account — which also meant a misconfiguration and a spam
 * filter looked identical from the outside. This table is the evidence, for an
 * admin only, so "teachers aren't getting the email" can be answered instead of
 * guessed at.
 */
migrate("013_mail_log", async () => {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS mail_log (
      id TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_maillog_time ON mail_log(created_at DESC)`).run();
});

/**
 * Superadmins, and the request log they oversee.
 *
 * `is_admin` already meant "can manage this school". A superadmin is a tier
 * above it: the people who run the platform itself, who can see across every
 * school and appoint school admins. The seed list is by email because these
 * three need the role whether or not they have signed in yet.
 *
 * `api_log` records failed requests. Writing a row per *successful* call would
 * put a database write in front of every page of every notebook, which costs
 * more than the visibility is worth — errors are what need explaining.
 */
migrate("014_superadmin", async () => {
  const cols = await db.prepare(`PRAGMA table_info(users)`).all<{ name: string }>();
  const has = (n: string) => (cols.results ?? []).some((c) => c.name === n);
  if (!has("is_superadmin")) {
    await db.prepare(`ALTER TABLE users ADD COLUMN is_superadmin INTEGER NOT NULL DEFAULT 0`).run();
  }
  for (const address of SUPERADMIN_EMAILS) {
    // Also grants school admin, so a superadmin is never locked out of the
    // ordinary settings they are meant to be able to fix.
    await db.prepare(`UPDATE users SET is_superadmin = 1, is_admin = 1 WHERE email = ?`).bind(address).run();
  }

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS api_log (
      id TEXT PRIMARY KEY,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      status INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      message TEXT NOT NULL DEFAULT '',
      user_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_apilog_time ON api_log(created_at DESC)`).run();
});

/**
 * Personal notebooks.
 *
 * A notebook has always belonged to a class. A personal one belongs to a
 * person: their own notes, outside the teacher→student flow entirely, not
 * shared and not assignable. `class_id` is NOT NULL and rewriting the table to
 * change that would be a far riskier migration than carrying an empty string
 * and saying plainly which kind a row is.
 */
migrate("015_personal_notebooks", async () => {
  const cols = await db.prepare(`PRAGMA table_info(notebooks)`).all<{ name: string }>();
  const has = (n: string) => (cols.results ?? []).some((c) => c.name === n);
  if (!has("kind")) {
    await db.prepare(`ALTER TABLE notebooks ADD COLUMN kind TEXT NOT NULL DEFAULT 'class'`).run();
  }
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_notebooks_owner ON notebooks(owner_id, kind)`).run();
});

/**
 * Outgoing mail that can wait.
 *
 * The platform allows three sends a minute for the whole project, which is
 * fine for one person asking for a sign-in link and hopeless for a teacher
 * inviting a class of twenty-five. Those invites are queued and drained on a
 * schedule instead of being fired at a wall — and, crucially, instead of being
 * silently dropped, which is what happened before this existed.
 */
migrate("016_mail_queue", async () => {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS mail_queue (
      id TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      subject TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      sent_at TEXT
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_mailqueue_pending ON mail_queue(status, created_at)`).run();
});

/**
 * Overflow chunks for a page's ink.
 *
 * A layer used to be one TEXT column, so adding a single stroke rewrote every
 * stroke already on the page — around 107 KB a save on a dense page, and the
 * reason a page had to be capped at all. The strokes are now split across rows
 * of a fixed size: an append rewrites only the last one.
 *
 * `layers.data` stays the first chunk and keeps the text, stamps and comments,
 * which means every row written before this migration is already a valid
 * chunk 0 and nothing has to be converted. That matters more than elegance
 * here — the data being migrated would be student work, which has no backup.
 */
migrate("017_layer_chunks", async () => {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS layer_chunks (
      id TEXT PRIMARY KEY,
      layer_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      data TEXT NOT NULL DEFAULT '',
      UNIQUE(layer_id, seq)
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_layer_chunks_layer ON layer_chunks(layer_id, seq)`).run();
});

/**
 * Enquiries from the public contact form.
 *
 * Stored as well as emailed. Email is the useful half — someone should be told
 * a district is asking — but it is also the half that can fail silently, and a
 * lead that existed only in a message the provider dropped is a lead nobody
 * knows was lost. The row is the record; the email is the notification.
 */
migrate("018_contact_requests", async () => {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS contact_requests (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL,
      region TEXT NOT NULL DEFAULT '',
      organization TEXT NOT NULL DEFAULT '',
      interest TEXT NOT NULL DEFAULT '',
      heard_from TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_contact_created ON contact_requests(created_at DESC)`).run();
});

/**
 * Which guided tours a person has finished or waved away.
 *
 * One row per tour they are done with; the absence of a row is what makes a
 * tour run. Keyed by role as well as place — `teacher.class` and
 * `student.class` are different tours of the same screen — so a student who is
 * later promoted to teacher is shown around again rather than left with the
 * tour of a screen they no longer see.
 *
 * `status` distinguishes finishing from skipping, and `step` records how far
 * they got. Neither changes what the app does; they are here because "everyone
 * quits on step 3" is the only way to find out that step 3 is wrong.
 */
migrate("019_user_tours", async () => {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS user_tours (
      user_id TEXT NOT NULL,
      tour TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      step INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, tour)
    )
  `).run();
});
