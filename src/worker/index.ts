/**
 * Fling Backend Worker
 *
 * This is your backend API entry point. Define HTTP routes and database
 * migrations here.
 */

import { app, migrate, db } from "flingit";

// Database migrations - run automatically on startup
// IMPORTANT: Migrations MUST be idempotent (safe to run multiple times).
// Due to distributed execution, a migration might run more than once.
// Use "CREATE TABLE IF NOT EXISTS", "CREATE INDEX IF NOT EXISTS", etc.
migrate("001_create_example", async () => {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS example (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `).run();
});

// API endpoint - the React frontend calls this
app.get("/api/hello", (c) => {
  return c.json({ message: "Hello from Fling API!" });
});
