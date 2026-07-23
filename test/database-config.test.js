import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("validateDatabaseUrl only accepts PostgreSQL connection strings", async () => {
  const { validateDatabaseUrl } = await import("../src/db/migrate.js");

  assert.equal(validateDatabaseUrl("postgresql://app:secret@localhost:5432/ai_life"), true);
  assert.equal(validateDatabaseUrl("postgres://app:secret@localhost:5432/ai_life"), true);
  assert.throws(() => validateDatabaseUrl("mysql://localhost/ai_life"), /DATABASE_URL/);
});

test("environment example includes database and administrator configuration", async () => {
  const envExample = await fs.readFile(new URL("../.env.example", import.meta.url), "utf8");

  assert.match(envExample, /^DATABASE_URL=/m);
  assert.match(envExample, /^ADMIN_EMAIL=/m);
});

test("listMigrationFiles returns SQL files in lexical order", async () => {
  const { listMigrationFiles } = await import("../src/db/migrate.js");

  const files = await listMigrationFiles();
  assert.deepEqual(files, [
    "001_initial_schema.sql",
    "002_scope_wearable_record_ids.sql",
    "003_group_based_project_access.sql"
  ]);
});
