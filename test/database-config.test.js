import test from "node:test";
import assert from "node:assert/strict";

test("validateDatabaseUrl only accepts PostgreSQL connection strings", async () => {
  const { validateDatabaseUrl } = await import("../src/db/migrate.js");

  assert.equal(validateDatabaseUrl("postgresql://app:secret@localhost:5432/ai_life"), true);
  assert.equal(validateDatabaseUrl("postgres://app:secret@localhost:5432/ai_life"), true);
  assert.throws(() => validateDatabaseUrl("mysql://localhost/ai_life"), /DATABASE_URL/);
});

test("listMigrationFiles returns SQL files in lexical order", async () => {
  const { listMigrationFiles } = await import("../src/db/migrate.js");

  const files = await listMigrationFiles();
  assert.deepEqual(files, ["001_initial_schema.sql", "002_scope_wearable_record_ids.sql"]);
});
