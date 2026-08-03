import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("trade-analysis migration registers an independently deployed, non-default project", async () => {
  const migration = await fs.readFile(new URL("../db/migrations/010_trade_analysis_project.sql", import.meta.url), "utf8");

  assert.match(migration, /'trade-analysis'/);
  assert.match(migration, /'交易分析'/);
  assert.match(migration, /'\/projects\/trade-analysis'/);
  assert.match(migration, /ON CONFLICT \(code\) DO UPDATE/);
  assert.doesNotMatch(migration, /default/);
  assert.doesNotMatch(migration, /group_project_access/);
});
