import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("browser analytics client stores anonymous IDs by browser lifetime and sends controlled events", async () => {
  const client = await fs.readFile(new URL("../public/analytics-client.js", import.meta.url), "utf8");

  assert.match(client, /"ai-life\.analytics\.visitor-id"/);
  assert.match(client, /persistentId\(localStorage, visitorStorageKey\)/);
  assert.match(client, /"ai-life\.analytics\.session-id"/);
  assert.match(client, /persistentId\(sessionStorage, sessionStorageKey\)/);
  assert.match(client, /navigator\.sendBeacon/);
  assert.match(client, /keepalive: true/);
  assert.match(client, /window\.aiLifeAnalytics = \{ track \}/);
  assert.match(client, /track\("page_view"/);
  assert.match(client, /location\.pathname/);
  assert.match(client, /utm_source/);
  assert.doesNotMatch(client, /document\.cookie|FormData|location\.href/);
});

test("application pages load the shared analytics client and project pages track authorized entry", async () => {
  const files = ["project-home.html", "index.html", "study-plan.html", "login.html", "register.html", "admin.html"];
  const pages = await Promise.all(files.map((file) => fs.readFile(new URL(`../${file}`, import.meta.url), "utf8")));
  const studyClient = await fs.readFile(new URL("../study-plan-client.js", import.meta.url), "utf8");

  pages.forEach((page) => assert.match(page, /<script src="\/analytics-client\.js" defer><\/script>/));
  assert.match(pages[1], /track\("project_enter", \{ projectCode: "wearable-monitoring" \}\)/);
  assert.match(studyClient, /track\("project_enter", \{ projectCode: "study-plan" \}\)/);
});

test("operations console exposes four data views and uses only first-party APIs", async () => {
  const [analytics, admin, server] = await Promise.all([
    fs.readFile(new URL("../analytics.html", import.meta.url), "utf8"),
    fs.readFile(new URL("../admin.html", import.meta.url), "utf8"),
    fs.readFile(new URL("../server.js", import.meta.url), "utf8")
  ]);

  assert.match(analytics, /id="analyticsDateRange"/);
  assert.match(analytics, /data-view="overview"/);
  assert.match(analytics, /data-view="traffic"/);
  assert.match(analytics, /data-view="conversion"/);
  assert.match(analytics, /data-view="events"/);
  assert.match(analytics, /\/api\/admin\/analytics\/summary/);
  assert.match(analytics, /\/api\/admin\/analytics\/breakdown/);
  assert.match(analytics, /\/api\/admin\/analytics\/funnel/);
  assert.match(analytics, /\/api\/admin\/analytics\/events/);
  assert.match(admin, /href="\/admin\/analytics"/);
  assert.match(server, /app\.get\("\/admin\/analytics"/);
  assert.doesNotMatch(analytics, /google-analytics|googletagmanager|matomo|cdn\.jsdelivr/i);
});
