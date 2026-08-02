import test from "node:test";
import assert from "node:assert/strict";
import { normalizeClientEvent, requestAnalyticsContext } from "../src/analytics/normalizeEvent.js";
import { createSlidingWindowRateLimiter } from "../src/analytics/rateLimiter.js";
import { createAnalyticsExclusionList } from "../src/analytics/excludedTraffic.js";

const visitorId = "c2b8404a-8728-468d-8c6b-f4145ce1713a";
const sessionId = "ecb1df03-3a68-43b5-94ce-1b66f7c44438";

test("normalizes a page view and keeps only allowlisted fields", () => {
  const event = normalizeClientEvent({
    visitorId,
    sessionId,
    eventType: "page_view",
    pagePath: "/?token=not-kept#hidden",
    referrer: "https://search.example/path?q=hidden",
    utm: { source: "newsletter", ignored: "no" },
    properties: { title: "项目首页", userId: "forged" },
    screen: { width: 1440, height: 900 },
    language: "zh-CN"
  });

  assert.equal(event.pagePath, "/");
  assert.equal(event.referrerHost, "search.example");
  assert.deepEqual(event.properties, { title: "项目首页" });
  assert.equal(event.utmSource, "newsletter");
  assert.equal(event.utmCampaign, null);
  assert.equal(event.screenWidth, 1440);
  assert.equal(event.screenHeight, 900);
});

test("rejects unknown events, external paths, malformed IDs, and forbidden properties", () => {
  const base = { visitorId, sessionId, pagePath: "/" };

  assert.throws(() => normalizeClientEvent({ ...base, eventType: "password_capture" }), { code: "INVALID_ANALYTICS_EVENT" });
  assert.throws(() => normalizeClientEvent({ ...base, eventType: "page_view", pagePath: "https://outside.example" }), { code: "INVALID_ANALYTICS_EVENT" });
  assert.throws(() => normalizeClientEvent({ ...base, eventType: "wearable_scheme_save", properties: { snapshot: "sensitive" } }), { code: "INVALID_ANALYTICS_EVENT" });
  assert.throws(() => normalizeClientEvent({ ...base, visitorId: "not-a-uuid", eventType: "page_view" }), { code: "INVALID_ANALYTICS_EVENT" });
});

test("does not trust country headers unless proxy trust is explicitly enabled", () => {
  const req = { ip: "203.0.113.8", headers: { "cf-ipcountry": "TW" } };

  const untrusted = requestAnalyticsContext(req, { ipSalt: "salt", trustProxy: false });
  const trusted = requestAnalyticsContext(req, { ipSalt: "salt", trustProxy: true });
  assert.equal(untrusted.countryCode, null);
  assert.equal(trusted.countryCode, "TW");
  assert.match(untrusted.ipHash, /^[a-f0-9]{64}$/);
});

test("does not create an IP hash without an explicit deployment salt", () => {
  const context = requestAnalyticsContext({ ip: "203.0.113.8", headers: {} }, { ipSalt: "", trustProxy: false });
  assert.equal(context.ipHash, null);
});

test("trusted proxy context accepts a bounded city header and ignores it otherwise", () => {
  const req = { ip: "198.51.100.7", headers: { "cf-ipcity": " 上海 ", "x-geo-city": "杭州" } };

  assert.equal(requestAnalyticsContext(req, { trustProxy: false }).cityName, null);
  assert.equal(requestAnalyticsContext(req, { trustProxy: true }).cityName, "上海");
});

test("analytics exclusions cover local/private addresses and configured IPv4 CIDRs", () => {
  const exclusions = createAnalyticsExclusionList("203.0.113.12,198.51.100.0/24,2001:db8::1");

  assert.equal(exclusions.has("127.0.0.1"), true);
  assert.equal(exclusions.has("10.20.30.40"), true);
  assert.equal(exclusions.has("::1"), true);
  assert.equal(exclusions.has("fc00::5"), true);
  assert.equal(exclusions.has("198.51.100.90"), true);
  assert.equal(exclusions.has("203.0.113.12"), true);
  assert.equal(exclusions.has("203.0.113.13"), false);
});

test("invalid configured analytics exclusion entries fail startup configuration clearly", () => {
  assert.throws(() => createAnalyticsExclusionList("not-an-ip"), /ANALYTICS_EXCLUDED_IPS/);
  assert.throws(() => createAnalyticsExclusionList("203.0.113.0/33"), /ANALYTICS_EXCLUDED_IPS/);
});

test("limits one browser/IP key to sixty events per minute", () => {
  let time = 1_000;
  const limiter = createSlidingWindowRateLimiter({ limit: 60, windowMs: 60_000, now: () => time });

  for (let index = 0; index < 60; index += 1) assert.equal(limiter.allow("hash:visitor"), true);
  assert.equal(limiter.allow("hash:visitor"), false);
  time += 60_001;
  assert.equal(limiter.allow("hash:visitor"), true);
});
