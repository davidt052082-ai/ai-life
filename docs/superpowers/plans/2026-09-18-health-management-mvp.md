# Health Management MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the authenticated “健康管理 → 腹型减脂” project and its non-AI MVP: daily actions, photo storage, measurements, trends, plan comparison, score, in-app reminders, and weekly report.

**Architecture:** Extend the Express/PostgreSQL monolith with a health project seed, scoped persistence, protected API router, pure plan/scoring/summary modules, and a responsive HTML page. Raw health records are the source of truth; every daily/weekly view is recomputed on read.

**Tech Stack:** Node.js ESM, Express 4, PostgreSQL via pg, node:test, browser Fetch/FormData/Canvas, and multer for bounded multipart image parsing.

---

## File Structure

- Create: db/migrations/011_health_management.sql — health tables and project/default-group seed.
- Modify: src/db/migrate.js — health constants and seed function.
- Create: src/health/plan.js, src/health/scoring.js, src/health/summary.js — pure daily-plan, scoring, and aggregation logic.
- Create: src/repositories/healthRepository.js — SQL-only persistence and ownership scope.
- Create: src/routes/healthRoutes.js — validation, project protection, multipart upload, JSON endpoints.
- Modify: server.js — dependency wiring, routes, and protected project page.
- Create: health.html and health-client.js — responsive action-first UI.
- Modify: package.json and package-lock.json — add multer.
- Modify: README.md — health operation and deferred scope.
- Create: test/health-migration.test.js, test/health-plan.test.js, test/health-scoring.test.js, test/health-summary.test.js, test/health-repository.test.js, test/health-routes.test.js, test/health-page.test.js.

### Task 1: Add the health project and database schema

**Files:**
- Create: db/migrations/011_health_management.sql
- Modify: src/db/migrate.js
- Test: test/health-migration.test.js

- [ ] **Step 1: Write the failing schema test.**

~~~js
test("health migration defines scoped tables and project identity", async () => {
  const sql = await fs.readFile(new URL("../db/migrations/011_health_management.sql", import.meta.url), "utf8");
  const { HEALTH_PROJECT_CODE } = await import("../src/db/migrate.js");
  assert.equal(HEALTH_PROJECT_CODE, "health");
  for (const name of ["health_settings", "health_events", "health_measurements", "health_meals", "health_notifications"]) {
    assert.match(sql, new RegExp("CREATE TABLE " + name));
  }
  assert.match(sql, /UNIQUE \(user_id, idempotency_key\)/);
});
~~~

- [ ] **Step 2: Run it to verify failure.**

Run: node --test test/health-migration.test.js  
Expected: FAIL because no health migration or exported project constant exists.

- [ ] **Step 3: Implement the migration and project seed.**

Export these values from src/db/migrate.js:

~~~js
export const HEALTH_PROJECT_ID = "8d82f809-4b39-4054-8718-3fec10c1f3cb";
export const HEALTH_PROJECT_CODE = "health";
~~~

Add seedHealthProject(client), call it after seedWearableProject(client), and upsert project health with name 健康管理, route /projects/health, description 腹型减脂的计划、打卡、趋势与周报。, and sort order 4. The SQL migration must create:

- health_settings with user/project primary key, timezone default Asia/Shanghai, hydration target default 1700, cutoff default 01:00, and massage flag default false.
- health_events with UUID id, user/project foreign keys, event ID, idempotency key, constrained action type, JSON payload, occurred-at UTC, timezone, plan date, source, sync status, version, audit timestamps, and unique user/idempotency key.
- health_measurements with nullable positive weight/waist, timestamps, scope, audit data, and idempotency uniqueness.
- health_meals with restricted meal type, safe storage key, file metadata, capture time, plan date, and status constrained to pending_analysis.
- health_notifications with user/project/date/reminder-kind uniqueness and nullable read timestamp.

Seed the same project in the migration and grant it to default group with ON CONFLICT DO NOTHING. Do not add it to the guest catalogue.

- [ ] **Step 4: Run the test.**

Run: node --test test/health-migration.test.js  
Expected: PASS.

- [ ] **Step 5: Commit.**

~~~bash
git add db/migrations/011_health_management.sql src/db/migrate.js test/health-migration.test.js
git commit -m "feat: add health management schema"
~~~

### Task 2: Implement daily plan, date ownership, and scoring

**Files:**
- Create: src/health/plan.js
- Create: src/health/scoring.js
- Test: test/health-plan.test.js
- Test: test/health-scoring.test.js

- [ ] **Step 1: Write failing pure-domain tests.**

~~~js
test("Thursday has a recovery task excluded from the core score", () => {
  assert.deepEqual(getDailyPlan("2026-09-17", "Asia/Shanghai").training,
    { type: "baduanjin", label: "八段锦恢复训练", minMinutes: 15, maxMinutes: 25, countsTowardScore: false });
});

test("training before the 01:00 cutoff belongs to the prior plan date", () => {
  assert.equal(getPlanDate("2026-09-18T00:45:00+08:00", "workout", "Asia/Shanghai", "01:00"), "2026-09-17");
});

test("absence of sleep redistributes only its weight", () => {
  assert.equal(weeklyExecutionScore({ cardio: 1, strength: 1, walks: 1, hydration: 1, alcoholFree: 1, sleep: null, mealPhotos: 1, waist: 1 }), 100);
});
~~~

- [ ] **Step 2: Run the tests to verify failure.**

Run: node --test test/health-plan.test.js test/health-scoring.test.js  
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the full weekly plan and attribution rules.**

Use a literal weekday plan: 40-minute fast walk Monday/Wednesday; 30–35 minute bodyweight/band strength Tuesday; 15–25 minute Baduanjin Thursday; 30–35 minute kettlebell strength Friday; 60-minute walk Saturday; Sunday review/rest. Include meal, hydration, two walk, and daily-behavior task IDs. Show abdominal massage only if settings enable it, label it comfort assistance, and set countsTowardScore false.

getPlanDate returns the local natural date except workout/Baduanjin before the configured cutoff, which returns the preceding local calendar date. The stored timestamp is never changed. getHighlightedTask uses exact breakfast 07:00–10:30, lunch 11:30–14:30, dinner 17:30–20:00, Thursday Baduanjin 19:30–21:30, 60 minutes before ordinary training, and incomplete high-priority tasks after 21:30.

- [ ] **Step 4: Implement score and outcome rules.**

Use weights cardio 30, strength 20, walks 10, hydration 10, alcohol-free 10, sleep 8, meal photos 7, and waist 5. Clamp ratios to 0–1. Exclude null dimensions, rescale available dimensions to 100, and round to an integer. Never include Baduanjin, massage, or core activation.

Return accumulating_data until four weekly points include waist and seven-day weight; then return effective for waist decline of at least 1cm, observe for weight decline without waist decline, adjust for score at least 80 with no result, and execution_insufficient below 60.

- [ ] **Step 5: Run the tests and commit.**

Run: node --test test/health-plan.test.js test/health-scoring.test.js  
Expected: PASS.

~~~bash
git add src/health/plan.js src/health/scoring.js test/health-plan.test.js test/health-scoring.test.js
git commit -m "feat: add health plan and scoring rules"
~~~

### Task 3: Implement aggregation, reminders, and scoped repository persistence

**Files:**
- Create: src/health/summary.js
- Create: src/repositories/healthRepository.js
- Test: test/health-summary.test.js
- Test: test/health-repository.test.js

- [ ] **Step 1: Write failing aggregation and SQL-scope tests.**

~~~js
test("daily summary totals water and tea and counts pending photos", () => {
  const summary = buildDailySummary({ events: [
    { eventType: "hydration", payload: { type: "water", volumeMl: 300 } },
    { eventType: "hydration", payload: { type: "tea", volumeMl: 200 } }
  ], meals: [{ status: "pending_analysis" }] });
  assert.deepEqual(summary.hydration, { waterMl: 300, teaMl: 200, totalMl: 500 });
  assert.equal(summary.mealPhotoCount, 1);
});

test("event insert is user/project scoped and idempotent", async () => {
  const calls = [];
  const repo = createHealthRepository({ query: async (text, values) => { calls.push({ text, values }); return { rows: [] }; } });
  await repo.createEvent({ id: "e", userId: "u", projectId: "p", idempotencyKey: "k", eventType: "hydration", payload: {}, occurredAt: "2026-09-18T00:00:00Z", timezone: "Asia/Shanghai", planDate: "2026-09-18" });
  assert.match(calls[0].text, /ON CONFLICT \(user_id, idempotency_key\)/);
  assert.deepEqual(calls[0].values.slice(0, 4), ["e", "u", "p", "k"]);
});
~~~

- [ ] **Step 2: Run tests to verify failure.**

Run: node --test test/health-summary.test.js test/health-repository.test.js  
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement summary functions.**

buildDailySummary calculates water, tea, total fluid, completed task IDs, meal-photo completion, remaining tasks, and contextual action without mutation. buildWeeklyComparison returns rows with plan/actual/rate/difference for cardio, strength, walks, fluid, photos, alcohol-free days, and waist recording. buildReminderCandidates emits only incomplete breakfast/lunch/dinner/hydration/walk/training/end-of-day reminders within their time windows; each candidate has date, kind, and Chinese message.

- [ ] **Step 4: Implement the repository.**

Export createHealthRepository(pool) with getSettings, updateSettings, createEvent, undoEvent, listEvents, createMeasurement, listMeasurements, createMeal, listMeals, deleteMeal, listNotifications, createNotificationsIfAbsent, and markNotificationRead. Every query must include user_id and project_id. createEvent uses INSERT ... ON CONFLICT (user_id, idempotency_key) to return the original event. undoEvent creates a compensating event in the same transaction and returns both records. The repository returns raw records only; it never computes daily or weekly scores.

- [ ] **Step 5: Run tests and commit.**

Run: node --test test/health-summary.test.js test/health-repository.test.js  
Expected: PASS.

~~~bash
git add src/health/summary.js src/repositories/healthRepository.js test/health-summary.test.js test/health-repository.test.js
git commit -m "feat: persist and aggregate health records"
~~~

### Task 4: Build the protected HTTP API and photo upload

**Files:**
- Modify: package.json
- Modify: package-lock.json
- Create: src/routes/healthRoutes.js
- Test: test/health-routes.test.js

- [ ] **Step 1: Write failing router tests.**

~~~js
test("health router exposes the agreed API surface", () => {
  const router = createHealthRouter({ repository: {}, projectRepository: {}, sessionService: {}, healthProjectCode: "health", uploadDirectory: "/tmp/health" });
  const routes = router.stack.filter((layer) => layer.route).map((layer) => Object.keys(layer.route.methods)[0] + " " + layer.route.path);
  assert.deepEqual(routes, ["get /today", "post /hydration", "post /checkins", "post /measurements", "post /events/:eventId/undo", "post /meals", "get /meals", "delete /meals/:id", "get /trends", "get /plan-vs-actual", "get /weekly-report", "get /settings", "patch /settings", "get /notifications", "patch /notifications/:id"]);
});
~~~

- [ ] **Step 2: Run to verify failure.**

Run: node --test test/health-routes.test.js  
Expected: FAIL with module-not-found.

- [ ] **Step 3: Add Multer and write the router.**

Run: npm install multer@^2.0.2  
Expected: package.json and package-lock.json change.

Create a merge-params router. Apply requireUser then requireProjectAccess; return 404 PROJECT_NOT_FOUND for any code other than health. Require a nonempty Idempotency-Key header on every POST creation. Validate positive fluid amounts, supported behavior types, ISO dates, measurements, and settings bounds before calling persistence.

Configure multer disk storage under the injected upload directory; accept only JPEG/PNG/WebP, maximum one file and 2MB, and create filenames from randomUUID plus extension selected from MIME type. Return JSON errors for bad type/size. Do not expose upload storage statically. Store a meal only as pending_analysis.

Implement exactly these endpoints: GET today; POST hydration, checkins, measurements, undo; POST/GET/DELETE meals; GET trends, plan-vs-actual, weekly-report; GET/PATCH settings; GET/PATCH notifications. All reads fetch raw scoped records then call Task 2/3 pure functions. Mutations return event, event_id, sync_status synced, and server_version.

- [ ] **Step 4: Run tests and commit.**

Run: node --test test/health-routes.test.js  
Expected: PASS.

~~~bash
git add package.json package-lock.json src/routes/healthRoutes.js test/health-routes.test.js
git commit -m "feat: add health management API"
~~~

### Task 5: Wire the app and project-page authorization

**Files:**
- Modify: server.js
- Test: test/health-routes.test.js
- Test: test/health-page.test.js

- [ ] **Step 1: Write failing wiring test.**

~~~js
test("server wires health router and protects the health page", async () => {
  const source = await fs.readFile(new URL("../server.js", import.meta.url), "utf8");
  assert.match(source, /createHealthRepository/);
  assert.match(source, /createHealthRouter/);
  assert.match(source, /\/api\/projects\/:code\/health/);
  assert.match(source, /\/projects\/health/);
});
~~~

- [ ] **Step 2: Run to verify failure.**

Run: node --test test/health-routes.test.js test/health-page.test.js  
Expected: FAIL because health dependencies are not mounted.

- [ ] **Step 3: Wire dependencies.**

Import HEALTH_PROJECT_CODE, createHealthRepository, and createHealthRouter. Support injected healthRepository and healthUploadDirectory options; otherwise create repository from pool and use path.join(__dirname, "uploads", "health"). Mount API under /api/projects/:code/health and a matching 503 fallback where no database is configured. Add /projects/health with the same anonymous redirect and unauthorized redirect behavior as /projects/study-plan. Serve health-client.js explicitly. Never mount uploads with express.static.

- [ ] **Step 4: Run tests and commit.**

Run: node --test test/health-routes.test.js test/health-page.test.js  
Expected: PASS.

~~~bash
git add server.js test/health-routes.test.js test/health-page.test.js
git commit -m "feat: mount health project"
~~~

### Task 6: Build the action-first responsive health UI

**Files:**
- Create: health.html
- Create: health-client.js
- Test: test/health-page.test.js

- [ ] **Step 1: Write failing UI contract test.**

~~~js
test("health page provides daily mobile controls with no offline or AI claims", async () => {
  const [html, client] = await Promise.all([fs.readFile(new URL("../health.html", import.meta.url), "utf8"), fs.readFile(new URL("../health-client.js", import.meta.url), "utf8")]);
  for (const text of ["今日完成度", "+200 ml", "+300 ml", "+500 ml", "早餐拍照", "饭后走路", "无酒", "周报", "待 AI 分析"]) assert.match(html + client, new RegExp(text));
  assert.match(client, /Idempotency-Key/);
  assert.match(client, /撤销/);
  assert.doesNotMatch(html + client, /localStorage|indexedDB|Notification\.requestPermission|营养|热量/);
});
~~~

- [ ] **Step 2: Run to verify failure.**

Run: node --test test/health-page.test.js  
Expected: FAIL because page/client files are absent.

- [ ] **Step 3: Implement markup and client.**

Build tabs 今日、计划、饮食、趋势、计划 vs 实际、周报、设置. Today is the default and contains completion, remaining work, hydration progress, contextual task, meal inputs, water/tea controls, walk, training, no-alcohol/no-late-snack/no-sugary-drink controls, measurement inputs, and aria-live error/status output. Touch controls are minimum 48px; desktop permits cards but not horizontal data tables on phones.

Set API root to /api/projects/health/health. A request wrapper parses API errors and sends a generated UUID Idempotency-Key for every creation. Quick actions show submitting, refetch today after success, show a six-second undo snackbar, and POST to events/id/undo. Failure becomes a visible retry action, not a local optimistic total.

For photos use capture=environment, image accept types, Canvas resize at 1600px long edge, WebP quality 0.8 blob, FormData POST, and render pending_analysis as 待 AI 分析. Never render food, nutrition, portion, meal reuse, AI confirmation, PWA, automatic sync, Web Push, or hardware sync. Render Baduanjin only on Thursday; render massage only when settings enable it.

- [ ] **Step 4: Run UI tests and commit.**

Run: node --test test/health-page.test.js  
Expected: PASS.

~~~bash
git add health.html health-client.js test/health-page.test.js
git commit -m "feat: add health management page"
~~~

### Task 7: Document, migrate, and regress

**Files:**
- Modify: README.md
- Test: all health tests and existing suite

- [ ] **Step 1: Add README coverage test.**

~~~js
test("README names the health project and AI deferral", async () => {
  const readme = await fs.readFile(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, /健康管理/);
  assert.match(readme, /待 AI 分析/);
  assert.match(readme, /暂不接入 AI/);
});
~~~

- [ ] **Step 2: Run to verify failure.**

Run: node --test test/health-page.test.js  
Expected: FAIL because README lacks health scope.

- [ ] **Step 3: Document operation.**

Document health route/access, daily controls, photo pending state, and explicit deferrals: AI/nutrition, PWA/IndexedDB/background sync, Web Push/scheduled delivery, and device/scale/wearable integration.

- [ ] **Step 4: Run all automated checks.**

Run: git diff --check && node --test test/health-*.test.js && npm test  
Expected: diff check is silent; every health and pre-existing test passes.

- [ ] **Step 5: Run local migration and manual smoke test.**

Run: npm run db:migrate && npm start  
Expected: migration succeeds and server starts at port 5173. Log in; open /projects/health; add +300ml then undo; upload a JPEG and see 待 AI 分析; record a weight; and confirm weekly data changes.

- [ ] **Step 6: Commit documentation.**

~~~bash
git add README.md test/health-page.test.js
git commit -m "docs: describe health management MVP"
~~~

## Plan Self-Review

- Coverage: Tasks 1 and 5 implement project registration/access; 2 implements defaults, contextual tasks, date attribution, score, and outcome rules; 3 and 4 cover persistence, idempotency, undo, aggregation, reports, reminders, and upload; 6 implements the mobile/desktop UI; 7 documents and verifies operation.
- Explicit deferrals remain out of all implementation tasks: AI food/nutrition analysis, PWA, service worker, IndexedDB, offline/background sync, Web Push, scheduled jobs, meal reuse, and device integrations.
- Placeholder/type check: every named source file and function is introduced in an earlier task or this plan’s file structure; no TODO/TBD steps remain.
