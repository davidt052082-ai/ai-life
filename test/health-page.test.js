import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("health page contains action-first mobile controls and no fabricated nutrition", async () => {
  const [html, client] = await Promise.all([
    fs.readFile(new URL("../health.html", import.meta.url), "utf8"),
    fs.readFile(new URL("../health-client.js", import.meta.url), "utf8")
  ]);
  for (const label of ["今日完成度", "水 +200 ml", "水 +500 ml", "水 +1000 ml", "茶 +200 ml", "茶 +500 ml", "茶 +1000 ml", "早餐拍照", "周报", "待 AI 分析"]) assert.ok(`${html}\n${client}`.includes(label));
  assert.match(client, /const API_ROOT = "\/api\/projects\/health\/health"/);
  assert.match(client, /Idempotency-Key/);
  assert.match(client, /canvas\.toBlob/);
  assert.match(client, /撤销/);
  assert.doesNotMatch(`${html}\n${client}`, /localStorage|indexedDB|Notification\.requestPermission/);
  assert.doesNotMatch(client, /estimated_kcal|nutrition/);
});

test("server wires health project API and protected page", async () => {
  const source = await fs.readFile(new URL("../server.js", import.meta.url), "utf8");
  assert.match(source, /createHealthRepository/);
  assert.match(source, /createHealthRouter/);
  assert.match(source, /\/api\/projects\/:code\/health/);
  assert.match(source, /\/projects\/health/);
});

test("health page has selectable weekly plan and localized metric rendering", async () => {
  const [html, client] = await Promise.all([
    fs.readFile(new URL("../health.html", import.meta.url), "utf8"),
    fs.readFile(new URL("../health-client.js", import.meta.url), "utf8")
  ]);
  assert.match(html, /id="weekOverview"/);
  assert.match(html, /id="planDetail"/);
  assert.match(client, /\/today\?date=/);
  assert.match(client, /徒手\/抱物深蹲/);
  assert.match(client, /壶铃硬拉/);
  assert.match(client, /item\.name/);
  assert.match(client, /item\.unit/);
  assert.match(client, /formatMetric/);
});

test("trend page renders current metrics, real series, and explicit unavailable states", async () => {
  const [html, client] = await Promise.all([
    fs.readFile(new URL("../health.html", import.meta.url), "utf8"),
    fs.readFile(new URL("../health-client.js", import.meta.url), "utf8")
  ]);
  const page = `${html}\n${client}`;
  assert.match(page, /核心结果/);
  assert.match(page, /执行与行为/);
  assert.match(page, /待接入指标/);
  assert.match(page, /阶段性体检/);
  assert.match(client, /buildTrendSvg/);
  assert.match(client, /暂未采集/);
  assert.match(client, /未录入体检数据/);
});

test("today and plan views render the API schedule and expose all hydration sizes", async () => {
  const [html, client] = await Promise.all([
    fs.readFile(new URL("../health.html", import.meta.url), "utf8"),
    fs.readFile(new URL("../health-client.js", import.meta.url), "utf8")
  ]);
  const page = `${html}\n${client}`;
  assert.match(html, /id="todaySchedule"/);
  assert.match(client, /data\.plan\.schedule/);
  assert.match(client, /renderTodaySchedule/);
  assert.match(client, /hydration: "hydration"/);
  for (const label of ["水 +1000 ml", "茶 +500 ml", "茶 +1000 ml", "计划提醒"]) assert.ok(page.includes(label));
  assert.doesNotMatch(page, /水 \+300 ml|茶 \+300 ml/);
});
