import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("study plan page uses the account API and has no local storage data source", async () => {
  const [html, client] = await Promise.all([
    fs.readFile(new URL("../study-plan.html", import.meta.url), "utf8"),
    fs.readFile(new URL("../study-plan-client.js", import.meta.url), "utf8")
  ]);

  assert.match(html, /总览/);
  assert.match(html, /人物管理/);
  assert.match(html, /新增学习计划/);
  assert.match(client, /const API_ROOT = "\/api\/projects\/study-plan\/study-plans"/);
  assert.match(client, /PERSON_COLORS/);
  assert.match(client, /fetch\(`\$\{API_ROOT\}\$\{path\}`/);
  assert.doesNotMatch(client, /localStorage/);
  assert.doesNotMatch(`${html}\n${client}`, /大公主|小公主/);
});
