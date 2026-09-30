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

test("Huawei schema is isolated from manual health tables", async () => {
  const sql = await fs.readFile(new URL("../db/migrations/014_huawei_health.sql", import.meta.url), "utf8");
  for (const table of ["health_oauth_states", "health_connections", "health_samples", "health_daily", "health_workouts", "health_sync_runs"]) {
    assert.match(sql, new RegExp(`CREATE TABLE ${table}`));
  }
  assert.match(sql, /UNIQUE \(provider, user_id, metric_type, source_record_id\)/);
  assert.match(sql, /UNIQUE \(user_id, provider\)/);
  assert.match(sql, /project_id uuid NOT NULL REFERENCES projects/i);
  assert.doesNotMatch(sql, /ALTER TABLE health_(events|measurements|meals) DROP/);
});
