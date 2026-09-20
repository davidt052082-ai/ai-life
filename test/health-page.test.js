import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("health page contains action-first mobile controls and no fabricated nutrition", async () => {
  const [html, client] = await Promise.all([
    fs.readFile(new URL("../health.html", import.meta.url), "utf8"),
    fs.readFile(new URL("../health-client.js", import.meta.url), "utf8")
  ]);
  for (const label of ["今日完成度", "水 +200 ml", "水 +500 ml", "水 +1000 ml", "茶 +200 ml", "茶 +500 ml", "茶 +1000 ml", "周报", "待 AI 分析"]) assert.ok(`${html}\n${client}`.includes(label));
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
  assert.match(client, /filter\(\(item\) => item\.action !== "hydration"\)/);
  for (const label of ["水 +1000 ml", "茶 +500 ml", "茶 +1000 ml", "计划提醒"]) assert.ok(page.includes(label));
  assert.doesNotMatch(page, /水 \+300 ml|茶 \+300 ml/);
});

test("fluid card separates water and tea controls and hides hydration checks from today actions", async () => {
  const [html, client, plan] = await Promise.all([
    fs.readFile(new URL("../health.html", import.meta.url), "utf8"),
    fs.readFile(new URL("../health-client.js", import.meta.url), "utf8"),
    fs.readFile(new URL("../src/health/plan.js", import.meta.url), "utf8")
  ]);
  assert.doesNotMatch(html, /id="hydration"|id="hydrationBar"/);
  assert.match(html, /饮水[\s\S]*data-fluid-slider="water"[\s\S]*水 \+200 ml/);
  assert.match(html, /喝茶[\s\S]*data-fluid-slider="tea"[\s\S]*茶 \+200 ml/);
  assert.match(client, /filter\(\(item\) => item\.action !== "hydration"\)/);
  assert.doesNotMatch(client, /data-today-target="hydration"/);
  assert.match(plan, /id: "morning-hydration"/);
  assert.match(plan, /id: "afternoon-hydration"/);
});

test("today schedule merges priority into action-style plan buttons", async () => {
  const [html, client] = await Promise.all([
    fs.readFile(new URL("../health.html", import.meta.url), "utf8"),
    fs.readFile(new URL("../health-client.js", import.meta.url), "utf8")
  ]);
  assert.match(html, /id="todaySchedule" class="actions"/);
  assert.doesNotMatch(html, /<h2>此刻优先<\/h2>/);
  assert.match(client, /此刻优先：/);
  assert.match(client, /scheduleButton/);
  assert.match(client, /class="action"/);
  assert.match(client, /disabled>.*计划提醒/);
});

test("today page makes meals, measurements, completion and fluid editing available in schedule actions", async () => {
  const [html, client] = await Promise.all([
    fs.readFile(new URL("../health.html", import.meta.url), "utf8"),
    fs.readFile(new URL("../health-client.js", import.meta.url), "utf8")
  ]);
  assert.doesNotMatch(html, /id="mealCard"|id="measurementCard"/);
  assert.match(html, /id="mealPhotoInput"[^>]*capture="environment"/);
  assert.match(html, /id="measurementDialog"/);
  assert.match(html, /data-fluid-slider="water"/);
  assert.match(html, /data-fluid-slider="tea"/);
  for (const label of ["水 +200 ml", "水 +500 ml", "水 +1000 ml", "茶 +200 ml", "茶 +500 ml", "茶 +1000 ml"]) assert.ok(html.includes(label));
  assert.match(client, /data-meal-action/);
  assert.match(client, /data-measurement-action/);
  assert.match(client, /item\.action === "checkin" \? item\.checkinType/);
  assert.match(client, /已完成 · 再点取消/);
  assert.match(client, /\/events\/\$\{eventId\}\/undo/);
  assert.match(client, /data-fluid-slider/);
});

test("health PWA exposes manifest, service worker and a static-only cache policy", async () => {
  const [manifest, worker, server] = await Promise.all([
    fs.readFile(new URL("../public/health-manifest.webmanifest", import.meta.url), "utf8"),
    fs.readFile(new URL("../public/health-sw.js", import.meta.url), "utf8"),
    fs.readFile(new URL("../server.js", import.meta.url), "utf8")
  ]);
  assert.equal(JSON.parse(manifest).display, "standalone");
  assert.match(worker, /CACHE_NAME = "ai-life-health-shell-v1"/);
  assert.match(worker, /"\/projects\/health"/);
  assert.doesNotMatch(worker, /\/api\/projects\/health\/health/);
  for (const path of ["/health-manifest.webmanifest", "/health-icon.svg", "/health-sw.js", "/health-offline.js"]) assert.ok(server.includes(path));
});

test("health page registers PWA, reports sync state, and queues network-only write failures", async () => {
  const [html, client] = await Promise.all([
    fs.readFile(new URL("../health.html", import.meta.url), "utf8"),
    fs.readFile(new URL("../health-client.js", import.meta.url), "utf8")
  ]);
  assert.match(html, /rel="manifest" href="\/health-manifest\.webmanifest"/);
  assert.match(html, /id="pwaStatus"/);
  assert.match(html, /id="installHealthApp"/);
  assert.match(client, /navigator\.serviceWorker\.register\("\/health-sw\.js"/);
  assert.match(client, /beforeinstallprompt/);
  assert.match(client, /offlineQueue\.enqueue/);
  assert.match(client, /addEventListener\("online"/);
});
