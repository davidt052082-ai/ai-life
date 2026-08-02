import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createAnalyticsRepository } from "../src/repositories/analyticsRepository.js";

function createPool(rows = []) {
  const calls = [];
  return {
    calls,
    async query(text, values = []) {
      calls.push({ text, values });
      return { rows, rowCount: rows.length };
    }
  };
}

const event = {
  id: "c2b8404a-8728-468d-8c6b-f4145ce1713a",
  visitorId: "ecb1df03-3a68-43b5-94ce-1b66f7c44438",
  sessionId: "3f78335d-1a71-4b70-aa9d-f03c8474d80d",
  userId: "5c89ac08-f7c3-43cb-8e04-8a6aa0488bed",
  eventType: "page_view",
  pagePath: "/projects/wearable",
  projectCode: "wearable-monitoring",
  referrerHost: "direct",
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  utmTerm: null,
  utmContent: null,
  deviceType: "desktop",
  browserName: "Chrome",
  osName: "macOS",
  language: "zh-CN",
  screenWidth: 1440,
  screenHeight: 900,
  ipHash: "a".repeat(64),
  countryCode: null,
  cityName: null,
  properties: { title: "智能穿戴" }
};

test("analytics migration defines raw events, aggregates, and indexes", async () => {
  const sql = await fs.readFile(new URL("../db/migrations/008_operations_analytics.sql", import.meta.url), "utf8");

  assert.match(sql, /CREATE TABLE analytics_events/);
  assert.match(sql, /event_type text NOT NULL CHECK/);
  assert.match(sql, /CREATE INDEX analytics_events_visitor_date_idx/);
  assert.match(sql, /CREATE TABLE analytics_daily_metrics/);
  assert.match(sql, /PRIMARY KEY \(metric_date, metric_key, dimension_type, dimension_value\)/);
});

test("recordEvent uses a parameterized insert and JSONB properties", async () => {
  const pool = createPool();
  const repository = createAnalyticsRepository(pool);

  await repository.recordEvent(event);

  assert.equal(pool.calls.length, 1);
  assert.match(pool.calls[0].text, /INSERT INTO analytics_events/);
  assert.match(pool.calls[0].text, /\$1/);
  assert.equal(pool.calls[0].values[0], event.id);
  assert.equal(pool.calls[0].values[4], event.eventType);
  assert.equal(pool.calls[0].values.at(-1), JSON.stringify(event.properties));
  assert.doesNotMatch(pool.calls[0].text, /projects\/wearable/);
});

test("summary calculates unique visitors, active users, and key actions from raw events", async () => {
  const pool = createPool([{ unique_visitors: "3", page_views: "8", signups: "2", project_enters: "4", active_users: "2", key_actions: "5" }]);
  const repository = createAnalyticsRepository(pool);
  const summary = await repository.getSummary({ from: "2026-07-01", to: "2026-07-07" });

  assert.deepEqual(summary.kpis, { uniqueVisitors: 3, pageViews: 8, signups: 2, projectEnters: 4, activeUsers: 2, keyActions: 5 });
  assert.match(pool.calls[0].text, /COUNT\(DISTINCT visitor_id\)/);
  assert.match(pool.calls[0].text, /COUNT\(DISTINCT user_id\) FILTER/);
  assert.match(pool.calls[0].text, /wearable_equipment_add/);
  assert.match(pool.calls[0].text, /study_plan_create/);
});

test("repository exposes date-bounded breakdown, funnel, event list, rollup, and retention operations", async () => {
  const pool = createPool();
  const repository = createAnalyticsRepository(pool);

  await repository.refreshDailyMetrics({ from: "2026-07-01", to: "2026-07-07" });
  await repository.purgeExpiredEvents();
  await repository.getBreakdown({ from: "2026-07-01", to: "2026-07-07", dimension: "project" });
  await repository.getFunnel({ from: "2026-07-01", to: "2026-07-07" });
  await repository.listEvents({ from: "2026-07-01", to: "2026-07-07", limit: 51 });

  assert.equal(pool.calls.some(({ text }) => /DELETE FROM analytics_daily_metrics/.test(text)), true);
  assert.equal(pool.calls.some(({ text }) => /ON CONFLICT \(metric_date, metric_key, dimension_type, dimension_value\)/.test(text)), true);
  assert.equal(pool.calls.some(({ text }) => /interval '180 days'/.test(text)), true);
  assert.equal(pool.calls.some(({ text }) => /ORDER BY metric_value DESC/.test(text)), true);
  assert.equal(pool.calls.some(({ text }) => /key_actions/.test(text)), true);
  assert.equal(pool.calls.some(({ text }) => /LIMIT \$/.test(text)), true);
});

test("event list preserves a partial final page and only emits a cursor when another page exists", async () => {
  const pool = createPool([{ id: event.id, occurred_at: "2026-07-07T10:00:00.000Z", event_type: "page_view", page_path: "/", properties: {} }]);
  const repository = createAnalyticsRepository(pool);

  const result = await repository.listEvents({ from: "2026-07-01", to: "2026-07-07", limit: 50 });

  assert.equal(result.events.length, 1);
  assert.equal(result.nextCursor, null);
});

test("city migration and repository persist the trusted city dimension", async () => {
  const sql = await fs.readFile(new URL("../db/migrations/009_analytics_city_and_exclusion.sql", import.meta.url), "utf8");
  assert.match(sql, /ADD COLUMN city_name text/);
  assert.match(sql, /CREATE INDEX analytics_events_city_date_idx/);

  const pool = createPool();
  const repository = createAnalyticsRepository(pool);
  await repository.recordEvent({ ...event, cityName: "上海" });

  assert.match(pool.calls[0].text, /city_name/);
  assert.equal(pool.calls[0].values.at(-2), "上海");
});

test("city breakdown maps missing trusted city data to an explicit unknown label", async () => {
  const pool = createPool([{ dimension_value: "未知城市", metric_value: "2", unique_visitors: "2" }]);
  const items = await createAnalyticsRepository(pool).getBreakdown({ from: "2026-08-01", to: "2026-08-02", dimension: "city" });

  assert.deepEqual(items, [{ value: "未知城市", count: 2, uniqueVisitors: 2 }]);
  assert.match(pool.calls[0].text, /city_name/);
});

test("funnel separates registered and unregistered visitors without double-counting a browser", async () => {
  const pool = createPool([{ page_views: "10", registered_visitors: "4", unregistered_visitors: "6", signups: "2", project_enters: "3", key_actions: "2" }]);
  const repository = createAnalyticsRepository(pool);

  const stages = await repository.getFunnel({ from: "2026-07-01", to: "2026-07-07" });

  assert.deepEqual(stages[0], {
    key: "pageViews",
    label: "访问",
    count: 10,
    registeredVisitors: 4,
    unregisteredVisitors: 6
  });
  assert.match(pool.calls[0].text, /bool_or\(user_id IS NOT NULL\)/);
});
