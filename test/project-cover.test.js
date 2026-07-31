import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("study-plan gets a dedicated warm calendar cover", async () => {
  const { generateProjectCover } = await import("../src/project-cover.js");
  const cover = generateProjectCover({ code: "study-plan", name: "学习计划日历", description: "计划" });
  assert.match(cover, /^data:image\/svg\+xml;base64,/);
  const svg = Buffer.from(cover.split(",")[1], "base64").toString("utf8");
  assert.match(svg, /LEARNING PLAN/);
  assert.match(svg, /class="project-cover calendar"/);
  assert.doesNotMatch(svg, /智能穿戴/);
});

test("generic project covers are stable, project-specific, and XML-safe", async () => {
  const { generateProjectCover } = await import("../src/project-cover.js");
  const first = generateProjectCover({ code: "meal-plan", name: "膳食 <计划>", description: "" });
  const second = generateProjectCover({ code: "meal-plan", name: "膳食 <计划>", description: "" });
  const other = generateProjectCover({ code: "habit", name: "习惯", description: "" });
  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.match(Buffer.from(first.split(",")[1], "base64").toString("utf8"), /膳食 &lt;计划&gt;/);
});

test("project cover migration backfills projects and generates covers on future inserts", async () => {
  const sql = await fs.readFile(new URL("../db/migrations/007_project_cover_generation.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE OR REPLACE FUNCTION generated_project_cover/);
  assert.match(sql, /CREATE TRIGGER projects_generated_cover_trigger/);
  assert.match(sql, /BEFORE INSERT OR UPDATE OF code, name, cover_image_url ON projects/);
  assert.match(sql, /WHERE code <> 'wearable-monitoring' AND \(cover_image_url IS NULL OR cover_image_url = ''\)/);
  assert.match(sql, /WHERE code = 'study-plan'/);
});

test("project homepage falls back to a project-specific generated cover", async () => {
  const [home, server] = await Promise.all([
    fs.readFile(new URL("../project-home.html", import.meta.url), "utf8"),
    fs.readFile(new URL("../server.js", import.meta.url), "utf8")
  ]);
  assert.match(home, /import \{ generateProjectCover \} from "\/project-cover\.js"/);
  assert.match(home, /project\.coverImageUrl \|\| generateProjectCover\(project\)/);
  assert.doesNotMatch(home, /coverImageUrl \|\| "\/assets\/cyber-body-base\.png"/);
  assert.match(server, /app\.get\("\/project-cover\.js"/);
});
