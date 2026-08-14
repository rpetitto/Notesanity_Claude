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

import { migrate, db } from "flingit";

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
 * in the notebook's page list. Purely organisational: grouping never moves a page
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

/** Per-notebook cover styling: an accent colour and an optional uploaded image. */
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
