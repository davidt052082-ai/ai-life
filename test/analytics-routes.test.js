import test from "node:test";
import assert from "node:assert/strict";

const visitorId = "c2b8404a-8728-468d-8c6b-f4145ce1713a";
const sessionId = "ecb1df03-3a68-43b5-94ce-1b66f7c44438";

function response() {
  const result = { statusCode: 200, body: null, ended: false };
  return {
    result,
    status(code) {
      result.statusCode = code;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    },
    end() {
      result.ended = true;
      return this;
    }
  };
}

async function invoke(handler, req) {
  const res = response();
  await handler(req, res);
  return res.result;
}

function eventBody(overrides = {}) {
  return {
    visitorId,
    sessionId,
    eventType: "page_view",
    pagePath: "/",
    properties: { title: "项目首页" },
    ...overrides
  };
}

test("public event ingestion records a normalized anonymous event", async () => {
  const { createAnalyticsRouter } = await import("../src/routes/analyticsRoutes.js");
  const recorded = [];
  const router = createAnalyticsRouter({
    repository: { recordEvent: async (event) => recorded.push(event) },
    sessionService: { getCurrentUser: async () => null },
    rateLimiter: { allow: () => true },
    ipSalt: "salt",
    trustProxy: false
  });
  const handler = router.stack.find((layer) => layer.route?.path === "/events").route.stack.at(-1).handle;
  const result = await invoke(handler, { body: eventBody(), ip: "203.0.113.8", headers: {} });

  assert.equal(result.statusCode, 204);
  assert.equal(result.ended, true);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].userId, null);
  assert.equal(recorded[0].pagePath, "/");
  assert.match(recorded[0].ipHash, /^[a-f0-9]{64}$/);
});

test("public ingestion associates the session user but ignores a forged body user ID", async () => {
  const { createAnalyticsRouter } = await import("../src/routes/analyticsRoutes.js");
  const recorded = [];
  const router = createAnalyticsRouter({
    repository: { recordEvent: async (event) => recorded.push(event) },
    sessionService: { getCurrentUser: async () => ({ id: "5c89ac08-f7c3-43cb-8e04-8a6aa0488bed" }) },
    rateLimiter: { allow: () => true }
  });
  const handler = router.stack.find((layer) => layer.route?.path === "/events").route.stack.at(-1).handle;
  await invoke(handler, { body: eventBody({ userId: "ab868691-878b-4ed5-9fd0-0d3712c1f62c" }), ip: "203.0.113.8", headers: {} });

  assert.equal(recorded[0].userId, "5c89ac08-f7c3-43cb-8e04-8a6aa0488bed");
});

test("public ingestion rejects invalid input and silently suppresses rate-limited events", async () => {
  const { createAnalyticsRouter } = await import("../src/routes/analyticsRoutes.js");
  const recorded = [];
  const router = createAnalyticsRouter({
    repository: { recordEvent: async (event) => recorded.push(event) },
    sessionService: { getCurrentUser: async () => null },
    rateLimiter: { allow: () => false }
  });
  const handler = router.stack.find((layer) => layer.route?.path === "/events").route.stack.at(-1).handle;

  const invalid = await invoke(handler, { body: eventBody({ eventType: "unknown" }), ip: "203.0.113.8", headers: {} });
  const limited = await invoke(handler, { body: eventBody(), ip: "203.0.113.8", headers: {} });

  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error, "INVALID_ANALYTICS_EVENT");
  assert.equal(limited.statusCode, 204);
  assert.equal(recorded.length, 0);
});

test("excluded internal traffic is acknowledged without rate limiting or persistence", async () => {
  const { createAnalyticsRouter } = await import("../src/routes/analyticsRoutes.js");
  let limiterCalls = 0;
  const recorded = [];
  const router = createAnalyticsRouter({
    repository: { recordEvent: async (event) => recorded.push(event) },
    sessionService: { getCurrentUser: async () => null },
    rateLimiter: { allow: () => { limiterCalls += 1; return true; } },
    excludedTraffic: { has: (ip) => ip === "127.0.0.1" }
  });
  const handler = router.stack.find((layer) => layer.route?.path === "/events").route.stack.at(-1).handle;
  const result = await invoke(handler, { body: eventBody(), ip: "127.0.0.1", headers: {} });

  assert.equal(result.statusCode, 204);
  assert.equal(recorded.length, 0);
  assert.equal(limiterCalls, 0);
});

test("admin analytics router exposes the protected query endpoints", async () => {
  const { createAdminAnalyticsRouter } = await import("../src/routes/adminAnalyticsRoutes.js");
  const router = createAdminAnalyticsRouter({ repository: {}, sessionService: {}, adminEmail: "owner@example.com" });
  const paths = router.stack
    .filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route.methods)[0]} ${layer.route.path}`);

  assert.deepEqual(paths, ["get /summary", "get /breakdown", "get /funnel", "get /events"]);
});

test("admin analytics query validation rejects unknown dimensions and oversized ranges", async () => {
  const { createAdminAnalyticsRouter } = await import("../src/routes/adminAnalyticsRoutes.js");
  const router = createAdminAnalyticsRouter({
    repository: { getBreakdown: async () => [] },
    sessionService: {},
    adminEmail: "owner@example.com"
  });
  const handler = router.stack.find((layer) => layer.route?.path === "/breakdown").route.stack.at(-1).handle;
  const unknownDimension = await invoke(handler, { query: { dimension: "email" } });
  const oversizedRange = await invoke(handler, { query: { dimension: "source", from: "2026-01-01", to: "2026-05-01" } });

  assert.equal(unknownDimension.statusCode, 400);
  assert.equal(unknownDimension.body.error, "INVALID_ANALYTICS_QUERY");
  assert.equal(oversizedRange.statusCode, 400);
  assert.equal(oversizedRange.body.error, "INVALID_ANALYTICS_QUERY");
});

test("admin analytics accepts the city breakdown dimension", async () => {
  const { createAdminAnalyticsRouter } = await import("../src/routes/adminAnalyticsRoutes.js");
  let received;
  const router = createAdminAnalyticsRouter({
    repository: { getBreakdown: async (options) => { received = options; return []; } },
    sessionService: {},
    adminEmail: "owner@example.com"
  });
  const handler = router.stack.find((layer) => layer.route?.path === "/breakdown").route.stack.at(-1).handle;
  const result = await invoke(handler, { query: { dimension: "city" } });

  assert.equal(result.statusCode, 200);
  assert.equal(received.dimension, "city");
});

test("database-disabled apps retain an explicit analytics unavailable response", async () => {
  const { createApp } = await import("../server.js");
  const app = createApp({ disableDatabase: true });
  const layer = app._router.stack.find((entry) => entry.regexp?.test("/api/analytics/events"));

  assert.ok(layer);
});
