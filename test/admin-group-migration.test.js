import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("admin-group migration creates both automatic synchronization triggers", async () => {
  const migration = await fs.readFile(new URL("../db/migrations/005_admin_group.sql", import.meta.url), "utf8");

  assert.match(migration, /code, name, description, is_default, is_system/);
  assert.match(migration, /CREATE TRIGGER admin_group_membership_trigger/);
  assert.match(migration, /AFTER INSERT OR UPDATE OF is_admin ON users/);
  assert.match(migration, /CREATE TRIGGER admin_group_project_access_trigger/);
  assert.match(migration, /AFTER INSERT ON projects/);
  assert.match(migration, /DELETE FROM user_groups/);
  assert.match(migration, /INSERT INTO group_project_access/);
});
