import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("validateDatabaseUrl only accepts PostgreSQL connection strings", async () => {
  const { validateDatabaseUrl } = await import("../src/db/migrate.js");

  assert.equal(validateDatabaseUrl("postgresql://app:secret@localhost:5432/ai_life"), true);
  assert.equal(validateDatabaseUrl("postgres://app:secret@localhost:5432/ai_life"), true);
  assert.throws(() => validateDatabaseUrl("mysql://localhost/ai_life"), /DATABASE_URL/);
});

test("environment example includes database, administrator, and analytics configuration", async () => {
  const [envExample, readme] = await Promise.all([
    fs.readFile(new URL("../.env.example", import.meta.url), "utf8"),
    fs.readFile(new URL("../README.md", import.meta.url), "utf8")
  ]);

  assert.match(envExample, /^DATABASE_URL=/m);
  assert.match(envExample, /^ADMIN_EMAIL=/m);
  assert.match(envExample, /^TRADE_ANALYSIS_URL=$/m);
  assert.match(envExample, /^ANALYTICS_IP_SALT=/m);
  assert.match(envExample, /^TRUST_PROXY=false$/m);
  assert.match(envExample, /^ANALYTICS_EXCLUDED_IPS=$/m);
  assert.match(readme, /180 天/);
  assert.match(readme, /\/admin\/analytics/);
  assert.match(readme, /CF-IPCity/);
  assert.match(readme, /TRADE_ANALYSIS_URL/);
  assert.match(readme, /交易分析/);
});

test("listMigrationFiles returns SQL files in lexical order", async () => {
  const { listMigrationFiles } = await import("../src/db/migrate.js");

  const files = await listMigrationFiles();
  assert.deepEqual(files, [
    "001_initial_schema.sql",
    "002_scope_wearable_record_ids.sql",
    "003_group_based_project_access.sql",
    "004_study_plan_project.sql",
    "005_admin_group.sql",
    "006_custom_study_people.sql",
    "007_project_cover_generation.sql",
    "008_operations_analytics.sql",
    "009_analytics_city_and_exclusion.sql",
    "010_trade_analysis_project.sql"
  ]);
});
