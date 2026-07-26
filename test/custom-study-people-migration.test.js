import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("custom people migration clears legacy plans and creates a scoped person relation", async () => {
  const sql = await fs.readFile(new URL("../db/migrations/006_custom_study_people.sql", import.meta.url), "utf8");
  assert.match(sql, /DELETE FROM study_plans/);
  assert.match(sql, /CREATE TABLE study_people/);
  assert.match(sql, /UNIQUE \(id, user_id, project_id\)/);
  assert.match(sql, /DROP COLUMN student/);
  assert.match(sql, /ADD COLUMN person_id uuid/);
  assert.match(sql, /FOREIGN KEY \(person_id, user_id, project_id\)/);
});
