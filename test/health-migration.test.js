import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("health migration defines scoped health tables and idempotency", async () => {
  const sql = await fs.readFile(new URL("../db/migrations/011_health_management.sql", import.meta.url), "utf8");
  const { HEALTH_PROJECT_CODE } = await import("../src/db/migrate.js");
  assert.equal(HEALTH_PROJECT_CODE, "health");
  for (const table of ["health_settings", "health_events", "health_measurements", "health_meals", "health_notifications"]) {
    assert.match(sql, new RegExp(`CREATE TABLE ${table}`));
  }
  assert.match(sql, /UNIQUE \(user_id, idempotency_key\)/);
  assert.match(sql, /'health'/);
});
