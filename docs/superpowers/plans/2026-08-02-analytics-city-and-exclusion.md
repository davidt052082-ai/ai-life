# 运营统计城市维度与自身流量排除 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exclude internal/deployment traffic before analytics persistence and add trusted-proxy city breakdowns to the operations console without storing raw IP addresses.

**Architecture:** A focused analytics exclusion module wraps Node's built-in `net.BlockList` and supplies default loopback/private ranges plus configured IP/CIDR rules. Public ingestion checks it before rate limiting or persistence. A migration adds `city_name`; request context reads city headers only behind `TRUST_PROXY`, the repository exposes a `city` dimension, and the console replaces country with city.

**Tech Stack:** Node.js ESM (`node:net`, `node:crypto`), Express, PostgreSQL migrations, vanilla JavaScript/CSS, Node built-in test runner.

---

## File structure

- Create: `src/analytics/excludedTraffic.js` — parse configured IP/CIDR entries and test default/internal traffic with `BlockList`.
- Create: `db/migrations/009_analytics_city_and_exclusion.sql` — add city field/index to the existing event table.
- Modify: `src/analytics/normalizeEvent.js` — safely extract trusted proxy city headers.
- Modify: `src/routes/analyticsRoutes.js` — return `204` before rate-limit/write for excluded request IPs.
- Modify: `src/repositories/analyticsRepository.js` — persist city, aggregate it, and expose `city` breakdown data.
- Modify: `src/routes/adminAnalyticsRoutes.js` — allow `dimension=city`.
- Modify: `server.js` — construct exclusion matcher from `ANALYTICS_EXCLUDED_IPS` and inject it into public ingestion.
- Modify: `analytics.html` — replace country traffic card/request with city.
- Modify: `.env.example`, `README.md` — document proxy city headers and configured exclusions.
- Modify: `test/analytics-normalize.test.js`, `test/analytics-routes.test.js`, `test/analytics-repository.test.js`, `test/analytics-page.test.js`, `test/database-config.test.js`.

### Task 1: Build and test internal-traffic and city-context primitives

**Files:**
- Create: `src/analytics/excludedTraffic.js`
- Modify: `src/analytics/normalizeEvent.js`
- Modify: `test/analytics-normalize.test.js`

- [x] **Step 1: Add failing unit tests for city headers and excluded ranges**

Append tests to `test/analytics-normalize.test.js`:

```js
import { createAnalyticsExclusionList } from "../src/analytics/excludedTraffic.js";

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
```

- [x] **Step 2: Run the focused unit test to verify it fails**

Run: `node --test test/analytics-normalize.test.js`

Expected: FAIL because `excludedTraffic.js` and `cityName` do not exist.

- [x] **Step 3: Implement the pure primitives**

Create `src/analytics/excludedTraffic.js` with this public API:

```js
import { BlockList, isIP } from "node:net";

export function createAnalyticsExclusionList(raw = "") {
  // Add 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16,
  // ::1, and fc00::/7. Parse comma-separated exact IPs or CIDRs.
  // Return { has(ip) } and throw Error("ANALYTICS_EXCLUDED_IPS contains an invalid IP or CIDR.") on invalid input.
}
```

Use `BlockList.addSubnet` for IPv4 CIDRs, `BlockList.addAddress` for exact IPv4/IPv6 entries, and normalize an IPv4-mapped address such as `::ffff:127.0.0.1` before checking. Support exact IPv6 entries in configuration; reject IPv6 CIDRs with the same explicit configuration error rather than silently accepting a partial implementation.

In `requestAnalyticsContext`, add:

```js
const cityHeader = trustProxy ? (req?.headers?.["cf-ipcity"] || req?.headers?.["x-geo-city"]) : null;
const cityName = typeof cityHeader === "string" && cityHeader.trim()
  ? cityHeader.trim().slice(0, 80)
  : null;
return { ipHash, countryCode, cityName };
```

Keep country support unchanged so existing data/API consumers remain backward-compatible during this change.

- [x] **Step 4: Run focused tests to verify they pass**

Run: `node --test test/analytics-normalize.test.js`

Expected: PASS, including default ranges, configured ranges, and city-header trust boundaries.

- [ ] **Step 5: Commit primitives**

```bash
git add src/analytics/excludedTraffic.js src/analytics/normalizeEvent.js test/analytics-normalize.test.js
git commit -m "feat: identify internal analytics traffic and proxy city"
```

### Task 2: Persist and query the city analytics dimension

**Files:**
- Create: `db/migrations/009_analytics_city_and_exclusion.sql`
- Modify: `src/repositories/analyticsRepository.js`
- Modify: `test/database-config.test.js`
- Modify: `test/analytics-repository.test.js`

- [x] **Step 1: Add failing migration/repository assertions**

Extend `test/database-config.test.js` expected migrations with `"009_analytics_city_and_exclusion.sql"`. Add these checks to `test/analytics-repository.test.js`:

```js
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
```

- [x] **Step 2: Run focused tests to verify they fail**

Run: `node --test test/database-config.test.js test/analytics-repository.test.js`

Expected: FAIL because migration 009, event city persistence, and `city` breakdown are absent.

- [x] **Step 3: Add the migration and repository changes**

Create `db/migrations/009_analytics_city_and_exclusion.sql`:

```sql
ALTER TABLE analytics_events ADD COLUMN city_name text;
CREATE INDEX analytics_events_city_date_idx
  ON analytics_events (city_name, event_date DESC)
  WHERE city_name IS NOT NULL;
```

In `src/repositories/analyticsRepository.js`:

1. Add `cityName: row.city_name` in `eventFromRow`.
2. Include `city_name` before `properties` in the `INSERT`, bind `event.cityName`, and retain JSONB as the final parameter.
3. Add `city: "COALESCE(NULLIF(city_name, ''), '未知城市')"` to `breakdownFields`.
4. Add a `city` page-view `UNION ALL` row in `refreshDailyMetrics`, using the same `未知城市` expression.
5. Include `city_name` in event selects so event mapping stays complete.

Do not attempt historical IP geolocation or any `UPDATE` for existing events.

- [x] **Step 4: Run focused tests and apply the migration locally**

Run: `node --test test/database-config.test.js test/analytics-repository.test.js`

Expected: PASS.

Run: `npm run db:migrate`

Expected: `Applied database migrations.`

- [ ] **Step 5: Commit city persistence**

```bash
git add db/migrations/009_analytics_city_and_exclusion.sql src/repositories/analyticsRepository.js test/database-config.test.js test/analytics-repository.test.js
git commit -m "feat: store analytics city dimension"
```

### Task 3: Drop internal traffic before any analytics write

**Files:**
- Modify: `src/routes/analyticsRoutes.js`
- Modify: `server.js`
- Modify: `test/analytics-routes.test.js`

- [x] **Step 1: Add failing ingestion tests**

Add a test in `test/analytics-routes.test.js` that constructs the existing public router with `excludedTraffic: { has: (ip) => ip === "127.0.0.1" }`, sends the valid `eventBody()` from `127.0.0.1`, and asserts a `204`, zero `recordEvent` calls, and zero limiter calls. Add a server source/route construction assertion that verifies `ANALYTICS_EXCLUDED_IPS` reaches `createAnalyticsExclusionList`.

```js
test("excluded internal traffic is acknowledged without rate limiting or persistence", async () => {
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
```

- [x] **Step 2: Run focused route tests to verify they fail**

Run: `node --test test/analytics-routes.test.js`

Expected: FAIL because the router does not receive/check an exclusion matcher.

- [x] **Step 3: Inject and enforce exclusions**

Change the public router factory signature to:

```js
export function createAnalyticsRouter({ repository, sessionService, rateLimiter, excludedTraffic, ipSalt = "", trustProxy = false })
```

At the top of `POST /events`, after `normalizeClientEvent(req.body)` and before `requestAnalyticsContext`/rate limiting, add:

```js
if (excludedTraffic?.has(req.ip)) {
  res.status(204).end();
  return;
}
```

In `server.js`, import `createAnalyticsExclusionList`, create one per app:

```js
const analyticsExcludedTraffic = options.analyticsExcludedTraffic
  || createAnalyticsExclusionList(options.analyticsExcludedIps ?? process.env.ANALYTICS_EXCLUDED_IPS ?? "");
```

Immediately after resolving `trustProxy`, configure Express before any middleware reads `req.ip`:

```js
app.set("trust proxy", trustProxy);
```

This setting is only safe with `TRUST_PROXY=true` when the upstream reverse proxy is controlled and overwrites forwarded IP headers; keep the documented default `false` for direct/local deployments.

Pass `excludedTraffic: analyticsExcludedTraffic` when mounting `/api/analytics`. This must happen during app creation, so malformed production configuration fails at startup instead of silently losing data later.

- [x] **Step 4: Run focused route tests**

Run: `node --test test/analytics-routes.test.js`

Expected: PASS; exclusion returns 204 without storage/rate-limit side effects, while external valid requests remain recorded.

- [ ] **Step 5: Commit filtering**

```bash
git add src/routes/analyticsRoutes.js server.js test/analytics-routes.test.js
git commit -m "feat: exclude internal analytics traffic"
```

### Task 4: Show cities in the operations console and document deployment

**Files:**
- Modify: `src/routes/adminAnalyticsRoutes.js`
- Modify: `analytics.html`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `test/analytics-page.test.js`
- Modify: `test/analytics-routes.test.js`

- [x] **Step 1: Add failing API/UI/documentation tests**

Extend `test/analytics-routes.test.js` to invoke the breakdown handler with `query: { dimension: "city" }` and assert that it calls `repository.getBreakdown` with `dimension: "city"`. Extend `test/analytics-page.test.js` with:

```js
assert.match(analytics, /id="cityBreakdown"/);
assert.match(analytics, /城市/);
assert.doesNotMatch(analytics, /id="countryBreakdown"/);
```

Extend the environment/README test to assert `ANALYTICS_EXCLUDED_IPS` and `X-Geo-City` are documented.

- [x] **Step 2: Run focused tests to verify they fail**

Run: `node --test test/analytics-page.test.js test/analytics-routes.test.js test/database-config.test.js`

Expected: FAIL because city is not an allowed API dimension and the existing traffic card is country-based.

- [x] **Step 3: Implement city display and deployment documentation**

In `src/routes/adminAnalyticsRoutes.js`, change the allowed dimensions to:

```js
const DIMENSIONS = new Set(["source", "device", "page", "project", "country", "city"]);
```

In `analytics.html`, replace the country panel with:

```html
<section class="panel"><div class="panel-header"><h3>城市</h3><span>可信代理可用时</span></div><div id="cityBreakdown" class="panel-body dim-list"></div></section>
```

Change `loadTraffic()` to request `const dimensions = ["source", "device", "page", "city"];`. Leave the generic `renderBreakdown()` unchanged.

Add this `.env.example` configuration:

```dotenv
# Comma-separated internal/deployment IPs or IPv4 CIDRs excluded before analytics persistence.
ANALYTICS_EXCLUDED_IPS=
```

In README, state that city requires `TRUST_PROXY=true` and a controlled proxy that provides `CF-IPCity` or `X-Geo-City`; without it, the console reports `未知城市`. Include an `ANALYTICS_EXCLUDED_IPS` example and make clear it is evaluated before analytics writes.

- [x] **Step 4: Run targeted tests and full regression suite**

Run: `node --test test/analytics-page.test.js test/analytics-routes.test.js test/database-config.test.js`

Expected: PASS.

Run: `npm test`

Expected: all existing tests pass.

- [ ] **Step 5: Verify local service behavior**

Restart the local app, then run a read-only/reversible smoke check:

1. POST a valid event as `127.0.0.1`; verify `analytics_events` count is unchanged.
2. POST a valid event with external test IP and `TRUST_PROXY=true`, `CF-IPCity: Shanghai`; verify it is stored with `city_name = 'Shanghai'`, query the city breakdown, then delete the event by its generated UUID.
3. Capture desktop/mobile screenshots of `/admin/analytics` with mocked admin APIs returning `city` data, and verify the traffic card is titled “城市” with no horizontal page overflow.

- [ ] **Step 6: Commit console/docs work**

```bash
git add src/routes/adminAnalyticsRoutes.js analytics.html .env.example README.md test/analytics-page.test.js test/analytics-routes.test.js test/database-config.test.js
git commit -m "feat: show analytics cities and exclusion settings"
```

## Final review checklist

- [x] Confirm `cityName` is only populated from server proxy headers with `TRUST_PROXY=true`; no client request field can override it.
- [x] Confirm default loopback/private/ULA and configured exact IP/IPv4 CIDR traffic return `204` without calling the limiter or repository.
- [x] Confirm historical rows are not modified and missing city renders as `未知城市`.
- [x] Run `rg -n "TODO|FIXME|placeholder|countryBreakdown" src/analytics src/routes analytics.html` and resolve accidental obsolete city/country references.
- [x] Run `npm test`, `npm run db:migrate`, and the local reversible smoke check.
