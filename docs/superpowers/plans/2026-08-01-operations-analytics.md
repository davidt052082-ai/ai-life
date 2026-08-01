# 可视化运营控制台与第一方统计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add privacy-conscious first-party website analytics and a visual administrator-only operations console for traffic, conversion, project usage, and recent business events.

**Architecture:** Browser pages load one lightweight client that creates anonymous visitor/session IDs and reports allowlisted page events. Express validates those events, associates an authenticated user only on the server, then persists them through an analytics repository. Existing successful business routes record trusted server-side events through a non-blocking recorder. PostgreSQL retains 180 days of raw events and indefinitely keeps daily aggregates. A separate protected `/admin/analytics` page renders APIs with native SVG/CSS charts.

**Tech Stack:** Node.js ESM, Express, PostgreSQL, `crypto`, vanilla browser JavaScript/CSS/SVG, Node built-in test runner.

---

## File structure

- Create: `db/migrations/008_operations_analytics.sql` — raw event and daily aggregate tables with indexes and constraints.
- Create: `src/analytics/normalizeEvent.js` — event/property allowlists, client input normalization, safe request context extraction.
- Create: `src/analytics/rateLimiter.js` — in-memory per-visitor sliding-window limit.
- Create: `src/analytics/maintenance.js` — initial and daily rollup/retention scheduler.
- Create: `src/repositories/analyticsRepository.js` — event persistence, business event helper, metrics, breakdowns, funnel, event list, retention.
- Create: `src/routes/analyticsRoutes.js` — public event ingestion endpoint.
- Create: `src/routes/adminAnalyticsRoutes.js` — administrator-only analytics query routes.
- Create: `public/analytics-client.js` — browser identifier lifecycle, automatic page view, public `track` function.
- Create: `analytics.html` — operations console UI and data rendering.
- Create: `test/analytics-normalize.test.js` — normalization, privacy, and rate-limit tests.
- Create: `test/analytics-repository.test.js` — SQL/query contract and metrics tests with stub pool.
- Create: `test/analytics-routes.test.js` — public ingestion and admin authorization/API tests.
- Create: `test/analytics-page.test.js` — static console and browser-client regression tests.
- Modify: `src/db/migrate.js` only if a named analytics constant is useful; migration discovery otherwise remains generic.
- Modify: `test/database-config.test.js` — expect migration 008.
- Modify: `server.js` and `server-start.mjs` — construct/mount analytics services, publish static scripts, run maintenance only with a configured database.
- Modify: `src/routes/authRoutes.js`, `src/routes/wearableRoutes.js`, `src/routes/studyPlanRoutes.js`, `src/routes/adminRoutes.js` — inject an optional recorder and log successful trusted actions.
- Modify: `project-home.html`, `index.html`, `study-plan.html`, `login.html`, `register.html`, `admin.html` — load the analytics client; add admin console navigation.
- Modify: `study-plan-client.js` and the existing module script in `index.html` — emit authenticated `project_enter` once per relevant project view.
- Modify: `README.md`, `.env.example` — document `ANALYTICS_IP_SALT`, `TRUST_PROXY`, retention, and the console URL.

## Task 1: Define the analytics contract before persistence

**Files:**
- Create: `src/analytics/normalizeEvent.js`
- Create: `src/analytics/rateLimiter.js`
- Create: `test/analytics-normalize.test.js`

- [x] **Step 1: Write failing input normalization and privacy tests**

Create `test/analytics-normalize.test.js` with these core cases:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeClientEvent, requestAnalyticsContext } from "../src/analytics/normalizeEvent.js";
import { createSlidingWindowRateLimiter } from "../src/analytics/rateLimiter.js";

test("normalizes a page view and keeps only allowlisted fields", () => {
  const event = normalizeClientEvent({
    visitorId: "c2b8404a-8728-468d-8c6b-f4145ce1713a",
    sessionId: "ecb1df03-3a68-43b5-94ce-1b66f7c44438",
    eventType: "page_view",
    pagePath: "/?token=not-kept",
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
});

test("rejects unknown events, external paths, malformed IDs, and forbidden properties", () => {
  const base = { visitorId: "c2b8404a-8728-468d-8c6b-f4145ce1713a", sessionId: "ecb1df03-3a68-43b5-94ce-1b66f7c44438", pagePath: "/" };
  assert.throws(() => normalizeClientEvent({ ...base, eventType: "password_capture" }), { code: "INVALID_ANALYTICS_EVENT" });
  assert.throws(() => normalizeClientEvent({ ...base, eventType: "page_view", pagePath: "https://outside.example" }), { code: "INVALID_ANALYTICS_EVENT" });
  assert.throws(() => normalizeClientEvent({ ...base, eventType: "wearable_scheme_save", properties: { snapshot: "sensitive" } }), { code: "INVALID_ANALYTICS_EVENT" });
  assert.throws(() => normalizeClientEvent({ ...base, visitorId: "not-a-uuid", eventType: "page_view" }), { code: "INVALID_ANALYTICS_EVENT" });
});

test("does not trust country headers unless proxy trust is explicitly enabled", () => {
  const req = { ip: "203.0.113.8", headers: { "cf-ipcountry": "TW" } };
  assert.equal(requestAnalyticsContext(req, { ipSalt: "salt", trustProxy: false }).countryCode, null);
  assert.equal(requestAnalyticsContext(req, { ipSalt: "salt", trustProxy: true }).countryCode, "TW");
  assert.match(requestAnalyticsContext(req, { ipSalt: "salt", trustProxy: false }).ipHash, /^[a-f0-9]{64}$/);
});

test("limits one browser/IP key to sixty events per minute", () => {
  const limiter = createSlidingWindowRateLimiter({ limit: 60, windowMs: 60_000, now: () => 1_000 });
  for (let index = 0; index < 60; index += 1) assert.equal(limiter.allow("hash:visitor"), true);
  assert.equal(limiter.allow("hash:visitor"), false);
});
```

- [x] **Step 2: Run focused tests to verify they fail**

Run: `node --test test/analytics-normalize.test.js`

Expected: FAIL because the analytics modules do not yet exist.

- [x] **Step 3: Implement strict event and request normalization**

Create `src/analytics/normalizeEvent.js` with these exported constants/functions:

```js
export const ANALYTICS_EVENT_TYPES = new Set([
  "page_view", "sign_up", "login", "project_enter", "wearable_equipment_add",
  "wearable_scheme_save", "study_plan_create", "admin_group_create",
  "admin_membership_change", "admin_project_access_change"
]);

export function normalizeClientEvent(body) { /* throws { code: "INVALID_ANALYTICS_EVENT", status: 400 } */ }
export function normalizeServerEvent(event) { /* same allowlist, trusted IDs, allowlisted properties */ }
export function requestAnalyticsContext(req, { ipSalt, trustProxy }) { /* sha256(ipSalt + req.ip), country only with trustProxy */ }
```

Implement all string limits in the module rather than route handlers: `pagePath` maximum 240, host maximum 180, UTM values maximum 120, language/browser/OS maximum 80, title maximum 160, and UUID validation using `randomUUID`-compatible canonical UUID syntax. Strip query/hash from paths; accept only a leading-slash in-site path. Parse referrers through `new URL()` and normalize same-origin/empty values to `direct`/`internal`. Map browser input to only `desktop`, `mobile`, `tablet`, or `unknown` device values. The only client properties allowed are: `page_view.title`, `project_enter.projectCode`, `wearable_equipment_add.sourceType`, and each admin change `operation`; each must pass exact type, length, and enum validation.

Create `src/analytics/rateLimiter.js` exporting `createSlidingWindowRateLimiter({ limit = 60, windowMs = 60_000, now = Date.now })`. Store timestamp arrays in a `Map`, discard expired entries before deciding, and expose `clear()` for tests/maintenance. Do not make the limiter global so `createApp` test instances remain isolated.

- [x] **Step 4: Run focused tests to verify they pass**

Run: `node --test test/analytics-normalize.test.js`

Expected: PASS, including an explicit check that forged `userId` is absent from normalized data.

- [ ] **Step 5: Commit the input contract**

```bash
git add src/analytics/normalizeEvent.js src/analytics/rateLimiter.js test/analytics-normalize.test.js
git commit -m "feat: validate first-party analytics events"
```

## Task 2: Add durable PostgreSQL storage and aggregation

**Files:**
- Create: `db/migrations/008_operations_analytics.sql`
- Create: `src/repositories/analyticsRepository.js`
- Modify: `test/database-config.test.js`
- Create: `test/analytics-repository.test.js`

- [x] **Step 1: Write failing migration and repository contract tests**

Create `test/analytics-repository.test.js`. Read the migration and assert it defines both tables, event indexes, an event-type constraint, and the composite daily metric primary key. Then use a recording `pool.query()` stub to assert `recordEvent()` writes every value parameterized, and that no SQL is built by interpolating page paths/properties.

Include behavioral expectations for these repository methods:

```js
const repository = createAnalyticsRepository(pool);
await repository.recordEvent(event);
await repository.refreshDailyMetrics({ from: "2026-07-01", to: "2026-07-07" });
await repository.purgeExpiredEvents();
await repository.getSummary({ from: "2026-07-01", to: "2026-07-07" });
await repository.getBreakdown({ from: "2026-07-01", to: "2026-07-07", dimension: "project" });
await repository.getFunnel({ from: "2026-07-01", to: "2026-07-07" });
await repository.listEvents({ from: "2026-07-01", to: "2026-07-07", limit: 51 });
```

Assert that summary uses `COUNT(DISTINCT visitor_id)` for unique visitors, `COUNT(DISTINCT user_id)` with non-null user IDs for active users, and treats the three agreed event types as key actions. Add `"008_operations_analytics.sql"` after migration 007 in `test/database-config.test.js`.

- [x] **Step 2: Run the focused tests to verify they fail**

Run: `node --test test/database-config.test.js test/analytics-repository.test.js`

Expected: FAIL because migration 008 and `analyticsRepository.js` do not exist.

- [x] **Step 3: Create the migration**

Create `db/migrations/008_operations_analytics.sql` with `pgcrypto` UUID defaults, the two tables, and these guarded constraints/indexes:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  event_date date NOT NULL DEFAULT current_date,
  visitor_id uuid NOT NULL,
  session_id uuid NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'page_view', 'sign_up', 'login', 'project_enter', 'wearable_equipment_add',
    'wearable_scheme_save', 'study_plan_create', 'admin_group_create',
    'admin_membership_change', 'admin_project_access_change'
  )),
  page_path text NOT NULL,
  project_code text,
  referrer_host text NOT NULL DEFAULT 'direct',
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  device_type text NOT NULL DEFAULT 'unknown' CHECK (device_type IN ('desktop', 'mobile', 'tablet', 'unknown')),
  browser_name text,
  os_name text,
  language text,
  screen_width integer CHECK (screen_width IS NULL OR screen_width BETWEEN 1 AND 10000),
  screen_height integer CHECK (screen_height IS NULL OR screen_height BETWEEN 1 AND 10000),
  ip_hash text,
  country_code char(2),
  properties jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX analytics_events_date_idx ON analytics_events (event_date DESC, occurred_at DESC);
CREATE INDEX analytics_events_type_date_idx ON analytics_events (event_type, event_date DESC);
CREATE INDEX analytics_events_project_date_idx ON analytics_events (project_code, event_date DESC) WHERE project_code IS NOT NULL;
CREATE INDEX analytics_events_visitor_date_idx ON analytics_events (visitor_id, event_date DESC);
CREATE INDEX analytics_events_user_date_idx ON analytics_events (user_id, event_date DESC) WHERE user_id IS NOT NULL;

CREATE TABLE analytics_daily_metrics (
  metric_date date NOT NULL,
  metric_key text NOT NULL,
  dimension_type text NOT NULL,
  dimension_value text NOT NULL,
  metric_value bigint NOT NULL CHECK (metric_value >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (metric_date, metric_key, dimension_type, dimension_value)
);
```

Use application-created UUIDs in `recordEvent`; the migration default remains useful for administrative SQL and does not alter existing tables.

- [x] **Step 4: Implement the repository**

Create `src/repositories/analyticsRepository.js` exporting `createAnalyticsRepository(pool)`. Keep all queries parameterized and return plain JSON-friendly values. Its exact public surface is:

```js
{
  recordEvent(event),
  refreshDailyMetrics({ from, to }),
  purgeExpiredEvents(),
  getSummary({ from, to }),
  getBreakdown({ from, to, dimension }),
  getFunnel({ from, to }),
  listEvents({ from, to, type, projectCode, cursor, limit })
}
```

`recordEvent` inserts a server-generated UUID and `current_date` as `event_date`; never accept client time. `refreshDailyMetrics` deletes only its target date range, then recomputes all/all-project/source/device/page/country rows with set-based `INSERT ... SELECT ... ON CONFLICT ... DO UPDATE`. Recompute `unique_visitors`, `page_views`, `signups`, `project_enters`, `active_users`, and `key_actions`; map empty source/device/page/country values to `direct`, `unknown`, `/`, and `unknown`. `purgeExpiredEvents` deletes only `event_date < current_date - interval '180 days'`.

For dashboard range requests (maximum 90 days), calculate KPIs, trend and funnel directly from raw events so the current numbers remain exact. Return all numeric counts as JavaScript numbers. Use cursor pagination as `(occurred_at, id)` encoded with base64url JSON, request `limit + 1`, and return only allowlisted properties already stored by the repository.

- [x] **Step 5: Run focused tests and apply migration locally**

Run: `node --test test/database-config.test.js test/analytics-repository.test.js`

Expected: PASS.

Run: `npm run db:migrate`

Expected: `Applied database migrations.`

Run a read-only local verification:

```bash
node --input-type=module -e 'import "dotenv/config"; import { createDatabasePool } from "./src/db/pool.js"; const pool = createDatabasePool(); try { console.log((await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename LIKE '\''analytics_%'\'' ORDER BY tablename")).rows); } finally { await pool.end(); }'
```

Expected: rows for `analytics_daily_metrics` and `analytics_events`.

- [ ] **Step 6: Commit persistence and aggregation**

```bash
git add db/migrations/008_operations_analytics.sql src/repositories/analyticsRepository.js test/database-config.test.js test/analytics-repository.test.js
git commit -m "feat: persist analytics events and daily metrics"
```

## Task 3: Expose safe ingestion, protected analytics APIs, and maintenance

**Files:**
- Create: `src/routes/analyticsRoutes.js`
- Create: `src/routes/adminAnalyticsRoutes.js`
- Create: `src/analytics/maintenance.js`
- Modify: `server.js`
- Modify: `server-start.mjs`
- Create: `test/analytics-routes.test.js`

- [x] **Step 1: Write failing public/admin route tests**

Create `test/analytics-routes.test.js` using the route/middleware invocation helpers already used in `test/auth-routes.test.js` and `test/admin-routes.test.js`. Cover:

1. `POST /api/analytics/events` records a normalized `page_view` and returns `204` for a guest.
2. A valid session associates `req.user.id`; a forged body `userId` does not override it.
3. Invalid event body returns `400 INVALID_ANALYTICS_EVENT`; the 61st event returns `204` without invoking `recordEvent`.
4. `GET /api/admin/analytics/summary`, `/breakdown`, `/funnel`, and `/events` are mounted with `requireUser` and `requireAdmin` and forward validated dates/filters to the repository.
5. A non-admin receives existing `403 ADMIN_REQUIRED`; date spans over 90 days and unknown dimensions return `400 INVALID_ANALYTICS_QUERY`.
6. Database-disabled `createApp({ disableDatabase: true })` responds `503 DATABASE_NOT_CONFIGURED` for both analytics API roots without changing public HTML behavior.

- [x] **Step 2: Run focused tests to verify they fail**

Run: `node --test test/analytics-routes.test.js`

Expected: FAIL because the routes and their server mounts are absent.

- [x] **Step 3: Implement public ingestion and admin query routes**

Create `src/routes/analyticsRoutes.js` as `createAnalyticsRouter({ repository, sessionService, rateLimiter, ipSalt, trustProxy })`. Apply `express.json({ limit: "8kb" })` only to this router. On `POST /events`, normalize body, optionally resolve the signed-in user from the current session using the existing session service/repository convention, create request context, use the key `${ipHash || "no-ip"}:${visitorId}`, and call `repository.recordEvent`. Return `204` for success and rate limit suppression. Do not expose an event ID or a distinction that assists retry amplification.

Create `src/routes/adminAnalyticsRoutes.js` as `createAdminAnalyticsRouter({ repository, sessionService, adminEmail })`. Reuse the existing admin middleware from `adminRoutes.js` or move shared middleware into the existing module only if that avoids duplication without changing behavior. Validate `from`/`to` as ISO date-only strings, default to the last seven calendar days, reject reversed or >90-day spans, restrict `dimension` to the five specified values, constrain `type` to `ANALYTICS_EVENT_TYPES`, and constrain `projectCode` to a short code regex.

Create `src/analytics/maintenance.js` exporting:

```js
export async function runAnalyticsMaintenance(repository, now = new Date()) { /* refresh last 7 days, then purge */ }
export function startAnalyticsMaintenance(repository, { intervalMs = 86_400_000, logger = console } = {}) { /* immediate best-effort run; interval.unref(); returns stop() */ }
```

Maintenance errors must call `logger.error` and never reject startup, login, or a request.

- [x] **Step 4: Wire services into the existing app**

In `server.js`, after the existing database pool/repositories are constructed, create an `analyticsRepository` only when `userRepository` exists. Create a per-app rate limiter and mount public `/api/analytics` before static file handling; mount `/api/admin/analytics` before the broader `/api/admin` router. Add `app.locals.startAnalyticsMaintenance = () => ...` and no-op it when no database is configured. Add explicit `503 DATABASE_NOT_CONFIGURED` fallbacks in the current no-database branch.

Publish `public/analytics-client.js` through the existing static assets approach and add `GET /admin/analytics` serving `analytics.html` beside the existing `/admin` route. In both `server-start.mjs` and the direct-run block at the end of `server.js`, call `app.locals.startAnalyticsMaintenance()` after `syncConfiguredAdmin()` and retain the returned stop function for `SIGINT`/`SIGTERM` before exiting. Do not begin intervals inside `createApp`, so test applications do not leak timers.

- [x] **Step 5: Run focused tests**

Run: `node --test test/analytics-routes.test.js`

Expected: PASS.

Run: `npm test`

Expected: all pre-existing tests plus analytics route tests pass.

- [ ] **Step 6: Commit API/service integration**

```bash
git add src/routes/analyticsRoutes.js src/routes/adminAnalyticsRoutes.js src/analytics/maintenance.js server.js server-start.mjs test/analytics-routes.test.js
git commit -m "feat: add analytics ingestion and admin APIs"
```

## Task 4: Record trusted business lifecycle events only after success

**Files:**
- Modify: `src/routes/authRoutes.js`
- Modify: `src/routes/wearableRoutes.js`
- Modify: `src/routes/studyPlanRoutes.js`
- Modify: `src/routes/adminRoutes.js`
- Modify: `server.js`
- Modify: `test/auth-routes.test.js`
- Modify: `test/wearable-routes.test.js`
- Modify: `test/study-plan-routes.test.js`
- Modify: `test/admin-routes.test.js`

- [x] **Step 1: Add failing success-only event tests**

Extend each existing route test file with a fake recorder:

```js
const recorded = [];
const analytics = { record: async (event) => recorded.push(event) };
```

Assert exactly one event after each successful mutation and no event when input validation or persistence fails:

| Existing route | Event | Required event context |
| --- | --- | --- |
| `POST /api/auth/register` | `sign_up` | newly created user ID, `/register` |
| `POST /api/auth/login` | `login` | authenticated user ID, `/login` |
| `POST /api/projects/:code/wearable/equipment` | `wearable_equipment_add` | request user, project code, `{ sourceType }` |
| `POST /api/projects/:code/wearable/schemes` | `wearable_scheme_save` | request user, project code |
| `POST /api/projects/:code/study-plans` | `study_plan_create` | request user, project code |
| `POST /api/admin/groups` | `admin_group_create` | administrator ID |
| member `PUT`/`DELETE` | `admin_membership_change` | administrator ID, `{ operation: "grant" | "revoke" }` |
| group-project `PUT`/`DELETE` | `admin_project_access_change` | administrator ID, `{ operation: "grant" | "revoke" }` |

Add a test proving recorder rejection does not turn a previously successful `201` or `204` into an error response.

- [x] **Step 2: Run focused business tests to verify they fail**

Run: `node --test test/auth-routes.test.js test/wearable-routes.test.js test/study-plan-routes.test.js test/admin-routes.test.js`

Expected: FAIL because route factories do not yet accept/use an analytics recorder.

- [x] **Step 3: Add an optional non-blocking recorder dependency**

Give each affected router factory an optional `analytics` object. Define a tiny local helper or shared helper with this exact behavior:

```js
function recordAnalytics(analytics, event) {
  if (!analytics) return;
  Promise.resolve(analytics.record(event)).catch((error) => console.error("Analytics event record failed:", error));
}
```

Call it immediately after the business repository successfully resolves and before/after the response is sent, but never `await` it. Build server events with `normalizeServerEvent` through an adapter constructed in `server.js`:

```js
const analytics = analyticsRepository && {
  record: (event) => analyticsRepository.recordEvent(normalizeServerEvent(event))
};
```

All trusted events must set server `occurredAt`/date through repository defaults, pass an explicit in-site `pagePath`, use `req.user.id` (not a request body ID), and never include equipment/scheme snapshots, group names, email addresses, or affected user IDs in properties.

- [x] **Step 4: Run focused tests and full regression suite**

Run: `node --test test/auth-routes.test.js test/wearable-routes.test.js test/study-plan-routes.test.js test/admin-routes.test.js`

Expected: PASS, including recorder-failure resilience.

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit trusted lifecycle instrumentation**

```bash
git add src/routes/authRoutes.js src/routes/wearableRoutes.js src/routes/studyPlanRoutes.js src/routes/adminRoutes.js server.js test/auth-routes.test.js test/wearable-routes.test.js test/study-plan-routes.test.js test/admin-routes.test.js
git commit -m "feat: record trusted product lifecycle events"
```

## Task 5: Add browser page views and project entry tracking

**Files:**
- Create: `public/analytics-client.js`
- Modify: `server.js`
- Modify: `project-home.html`
- Modify: `index.html`
- Modify: `study-plan.html`
- Modify: `study-plan-client.js`
- Modify: `login.html`
- Modify: `register.html`
- Modify: `admin.html`
- Modify: `test/analytics-page.test.js`

- [x] **Step 1: Write failing client/static integration tests**

Create `test/analytics-page.test.js` to assert:

1. `public/analytics-client.js` creates `ai-life.analytics.visitor-id` only in `localStorage` and `ai-life.analytics.session-id` only in `sessionStorage`.
2. It calls `/api/analytics/events` using `navigator.sendBeacon` with a `fetch(..., { keepalive: true })` fallback, strips query/hash from `location.pathname`, and only extracts named UTM parameters.
3. It exposes `window.aiLifeAnalytics.track` and sends an automatic `page_view` once per document load.
4. Each existing HTML page loads `/analytics-client.js` with `defer` before its own inline/module client script.
5. Wearable and study-plan client code calls `track("project_enter", { projectCode: ... })` only after their existing authenticated project/account load succeeds.

- [x] **Step 2: Run focused tests to verify they fail**

Run: `node --test test/analytics-page.test.js`

Expected: FAIL because the browser script and page includes do not exist.

- [x] **Step 3: Implement the lightweight browser client**

Create `public/analytics-client.js` as an IIFE with no imports. Use `crypto.randomUUID()` where available and a compact RFC4122 fallback. Persist only random UUIDs. On `DOMContentLoaded`, read `location.pathname` (never `location.href`), derive source host with `document.referrer`, build an allowlisted payload under 8 KB, and call `track("page_view", { title: document.title.slice(0, 160) })`.

`track(eventType, properties = {})` should infer the same path, UTM params and simple device/browser/OS descriptors for every event, then POST a Blob JSON body to `/api/analytics/events`. It must return `void`, catch all transport errors, and never block clicks, login, project initialization, or navigation. Do not read cookies, local database content, form values, location query values other than `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, and `utm_content`.

Add `<script src="/analytics-client.js" defer></script>` in the page `<head>` of the six existing public/admin HTML files. Do not add this tag to share-image rendering or saved static snapshots.

In the existing successful account/project initialization paths in `index.html` and `study-plan-client.js`, call:

```js
window.aiLifeAnalytics?.track("project_enter", { projectCode: project.code });
```

Guard it with a per-page `let projectEnterTracked = false` so rerenders and refreshes of page data cannot multiply the event in the same document. Guests may create `page_view`s but must not emit `project_enter` unless the existing server-backed project access call has succeeded.

- [x] **Step 4: Run focused client tests**

Run: `node --test test/analytics-page.test.js`

Expected: PASS.

- [ ] **Step 5: Commit browser instrumentation**

```bash
git add public/analytics-client.js project-home.html index.html study-plan.html study-plan-client.js login.html register.html admin.html test/analytics-page.test.js
git commit -m "feat: track first-party page and project visits"
```

## Task 6: Build the administrator visual operations console

**Files:**
- Create: `analytics.html`
- Modify: `admin.html`
- Modify: `server.js`
- Modify: `test/analytics-page.test.js`

- [x] **Step 1: Write failing console page and navigation tests**

Extend `test/analytics-page.test.js` to assert that:

```js
assert.match(analyticsHtml, /id="analyticsDateRange"/);
assert.match(analyticsHtml, /data-view="overview"/);
assert.match(analyticsHtml, /data-view="traffic"/);
assert.match(analyticsHtml, /data-view="conversion"/);
assert.match(analyticsHtml, /data-view="events"/);
assert.match(analyticsHtml, /\/api\/admin\/analytics\/summary/);
assert.match(analyticsHtml, /\/api\/admin\/analytics\/breakdown/);
assert.match(analyticsHtml, /\/api\/admin\/analytics\/funnel/);
assert.match(analyticsHtml, /\/api\/admin\/analytics\/events/);
assert.match(adminHtml, /href="\/admin\/analytics"/);
assert.match(server, /app\.get\("\/admin\/analytics"/);
```

Also assert the HTML avoids third-party analytics/chart URLs and contains no `innerHTML` rendering from API-provided event fields.

- [x] **Step 2: Run focused tests to verify they fail**

Run: `node --test test/analytics-page.test.js`

Expected: FAIL because the console and navigation route are absent.

- [x] **Step 3: Implement the `/admin/analytics` UI**

Create `analytics.html` following the current `admin.html` dark, cyan, orange, dense administration visual language. It must include a shared left navigation with links to `/admin` and `/admin/analytics`, a responsive content panel, and these views controlled by real `<button>` tab controls:

1. **概览**: date range picker (7/30/90 day presets and custom dates), six KPI cells, SVG line chart for visitors/page views, project usage table, current range funnel, recent key events.
2. **流量**: source, device, page, and country tables/bar rows populated by `/breakdown` requests.
3. **转化**: full funnel with stage counts/rates and per-project key-action share.
4. **事件**: event-type and project filters, cursor-based “加载更多” control, formatted timestamp/path/project/property labels.

Use `textContent`, `replaceChildren`, `document.createElement`, and fixed class names for all API values. Build SVG nodes via `createElementNS`; charts must handle all-zero/empty datasets with a concise empty state instead of blank axes. On mobile (`max-width: 760px`), make KPI cards 2 columns and stack all chart/table grids; preserve stable widths and no horizontal text overlap. All API calls use `credentials: "same-origin"`; an `ADMIN_REQUIRED`/`401` response redirects to `/login?next=/admin/analytics`, while other errors display a local retry action.

Add a sidebar link “运营控制台” in `admin.html`. In `server.js`, serve `analytics.html` at `/admin/analytics`; API authorization remains the enforcement point, consistent with the existing `/admin` page model.

- [ ] **Step 4: Run console tests and manually verify responsive layout**

Run: `node --test test/analytics-page.test.js`

Expected: PASS.

Run: `npm test`

Expected: PASS.

Start the local app using the existing development service, sign in with the configured administrator, open `http://127.0.0.1:5174/admin/analytics`, generate a few visits/actions in a second browser session, and verify: public visitors cannot query admin data; overview refreshes; an empty install displays zero/empty states; and narrow mobile width keeps every tab usable.

- [ ] **Step 5: Commit the visual console**

```bash
git add analytics.html admin.html server.js test/analytics-page.test.js
git commit -m "feat: add visual operations analytics console"
```

## Task 7: Document configuration and perform end-to-end verification

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-01-operations-analytics-design.md` only if implementation decisions differ from the approved design.

- [x] **Step 1: Add configuration/documentation regression checks**

Add assertions to `test/database-config.test.js` or a dedicated `test/analytics-page.test.js` documentation test that `.env.example` names `ANALYTICS_IP_SALT` and `TRUST_PROXY`, and README explains the 180-day raw-event retention and administrator-only console URL.

- [x] **Step 2: Run the focused check to verify it fails**

Run: `node --test test/database-config.test.js test/analytics-page.test.js`

Expected: FAIL until configuration documentation is added.

- [x] **Step 3: Document safe deployment configuration**

Add these `.env.example` entries without real values:

```dotenv
# Optional: random secret used to hash request IPs for analytics rate limiting; do not rotate casually.
ANALYTICS_IP_SALT=
# Set true only behind a reverse proxy that you control and that overwrites geo headers.
TRUST_PROXY=false
```

Document that `ANALYTICS_IP_SALT` is optional (no IP hash is stored if blank), proxy country data is disabled by default, events are first-party and allowlisted, raw events are deleted after 180 days, daily aggregates persist, and `/admin/analytics` requires an administrator. Include local validation steps: migration, `npm test`, and a non-admin `403` check.

- [x] **Step 4: Run all automated checks**

Run: `npm test`

Expected: all tests pass.

Run: `npm run db:migrate`

Expected: safe no-op after migration 008 is applied.

Run a non-destructive analytics smoke script against the configured local database that inserts one normalized synthetic event through the repository, queries its summary for today, then deletes that exact generated UUID in a `finally` block. Confirm the summary includes the event before cleanup and that cleanup succeeds.

- [ ] **Step 5: Commit deployment documentation**

```bash
git add .env.example README.md test/database-config.test.js test/analytics-page.test.js docs/superpowers/specs/2026-08-01-operations-analytics-design.md
git commit -m "docs: document analytics deployment settings"
```

## Final review checklist

- [x] Compare implementation against `docs/superpowers/specs/2026-08-01-operations-analytics-design.md`: all ten event types, 180-day retention, daily metrics, four console views, and no external analytics dependency are present.
- [x] Confirm every ingestion/query path rejects unknown event types/properties and never accepts client `userId`, raw IP, country, or arbitrary JSON.
- [x] Confirm no analytics write is awaited in a primary business mutation and recorder errors cannot alter status codes.
- [x] Search with `rg -n "TODO|FIXME|placeholder|example\.com|innerHTML" src/analytics src/routes analytics.html public/analytics-client.js` and resolve any implementation placeholders or unsafe event rendering.
- [ ] Run `npm test` and `npm run db:migrate`; manually validate `/admin/analytics` as administrator and 403/redirect behavior as a normal user.
