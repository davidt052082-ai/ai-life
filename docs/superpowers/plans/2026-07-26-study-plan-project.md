# 学习计划日历项目 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an access-controlled, account-synchronized learning-plan calendar project to AI Life.

**Architecture:** Store only each account's study-plan rules in PostgreSQL, scoped by the existing project record. A pure shared schedule module validates rules and derives calendar events in both the authenticated Express API and the browser page; events are not persisted. Reuse current group-derived project access so the project appears only after an administrator grants it to a group.

**Tech Stack:** Node.js ESM, Express 4, PostgreSQL, vanilla HTML/CSS/JavaScript, Node built-in test runner.

---

## File structure

- `db/migrations/004_study_plan_project.sql`: creates `study_plans`, its account/project index, and the non-default `study-plan` project record.
- `src/study-plan/schedule.js`: pure plan input validation, recurrence expansion, event sorting, and rest-day detection shared by server tests and browser modules.
- `src/repositories/studyPlanRepository.js`: converts PostgreSQL rows to API plans and scopes all queries to one user and project.
- `src/routes/studyPlanRoutes.js`: authenticated, project-authorized CRUD endpoints for the study-plan project only.
- `study-plan.html`: responsive Learning Cabin page shell, dialog, accessible feedback, and all visual rendering.
- `study-plan-client.js`: account API client and DOM behavior; imports recurrence helpers from the shared module route.
- `server.js`: wires the repository, API router, static module route, and protected project page route.
- `test/study-plan-*.test.js`: test pure scheduling, repository scoping, route surface, server routes, and page integration.

### Task 1: Create the shared recurrence and validation model

**Files:**
- Create: `src/study-plan/schedule.js`
- Create: `test/study-plan-schedule.test.js`

- [ ] **Step 1: Write failing schedule and validation tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { expandPlan, isRestDate, sortEvents, validatePlanInput } from "../src/study-plan/schedule.js";

const basePlan = {
  id: "p-1", student: "大公主", subject: "数学", location: "书房",
  startDate: "2026-07-10", startTime: "16:30", endTime: "18:30",
  studyDays: 5, restDays: 1, targetStudyDays: 18
};

test("five study days then one rest day produces exactly eighteen learning dates", () => {
  const events = expandPlan(basePlan);
  assert.equal(events.length, 18);
  assert.deepEqual(events.slice(0, 6).map((event) => event.date), [
    "2026-07-10", "2026-07-11", "2026-07-12", "2026-07-13", "2026-07-14", "2026-07-16"
  ]);
  assert.equal(isRestDate(basePlan, "2026-07-15"), true);
  assert.equal(isRestDate(basePlan, events.at(-1).date), false);
  assert.equal(isRestDate(basePlan, "2026-08-01"), false);
});

test("zero rest and same-day events are supported", () => {
  const daily = { ...basePlan, studyDays: 1, restDays: 0, targetStudyDays: 3 };
  assert.deepEqual(expandPlan(daily).map((event) => event.date), ["2026-07-10", "2026-07-11", "2026-07-12"]);
  assert.deepEqual(sortEvents([
    { date: "2026-07-10", startTime: "16:30", subject: "数学" },
    { date: "2026-07-10", startTime: "10:00", subject: "钢琴" }
  ]).map((event) => event.startTime), ["10:00", "16:30"]);
});

test("invalid plan fields return an API-safe Chinese error", () => {
  assert.equal(validatePlanInput(basePlan), "");
  assert.match(validatePlanInput({ ...basePlan, endTime: "15:30" }), /结束时间/);
  assert.match(validatePlanInput({ ...basePlan, studyDays: 0 }), /至少为 1/);
  assert.match(validatePlanInput({ ...basePlan, student: "其他" }), /学习者/);
});
```

- [ ] **Step 2: Run the model test to verify it fails**

Run: `node --test test/study-plan-schedule.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/study-plan/schedule.js`.

- [ ] **Step 3: Implement the pure model with local-date-safe helpers**

```js
export const STUDENTS = ["大公主", "小公主"];

export function validatePlanInput(plan) {
  if (!STUDENTS.includes(plan.student)) return "请选择学习者。";
  if (![plan.subject, plan.location, plan.startDate, plan.startTime, plan.endTime].every((value) => typeof value === "string" && value.trim())) return "请完整填写计划信息。";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plan.startDate) || !/^\d{2}:\d{2}$/.test(plan.startTime) || !/^\d{2}:\d{2}$/.test(plan.endTime)) return "日期或时间格式无效。";
  if (plan.startTime >= plan.endTime) return "结束时间必须晚于开始时间。";
  if (!Number.isInteger(plan.studyDays) || plan.studyDays < 1 || !Number.isInteger(plan.restDays) || plan.restDays < 0 || !Number.isInteger(plan.targetStudyDays) || plan.targetStudyDays < 1) return "学习天数和目标学习天数至少为 1；休息天数可为 0。";
  return "";
}

export function expandPlan(plan) {
  const cursor = new Date(`${plan.startDate}T00:00:00`);
  const events = [];
  for (let completed = 0; completed < plan.targetStudyDays;) {
    for (let day = 0; day < plan.studyDays && completed < plan.targetStudyDays; day += 1, completed += 1) {
      events.push({ ...plan, date: toIsoDate(cursor) });
      cursor.setDate(cursor.getDate() + 1);
    }
    cursor.setDate(cursor.getDate() + plan.restDays);
  }
  return events;
}
```

Add the remaining exported helpers exactly as follows so browser and server share the same calendar rules:

```js
export function toIsoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function sortEvents(events) {
  return [...events].sort((left, right) => left.date.localeCompare(right.date) || left.startTime.localeCompare(right.startTime) || left.subject.localeCompare(right.subject));
}

export function isRestDate(plan, isoDate) {
  if (plan.restDays === 0) return false;
  const events = expandPlan(plan);
  const finalStudyDate = events.at(-1)?.date;
  if (!finalStudyDate || isoDate < plan.startDate || isoDate > finalStudyDate || events.some((event) => event.date === isoDate)) return false;
  const start = new Date(`${plan.startDate}T00:00:00`);
  const date = new Date(`${isoDate}T00:00:00`);
  const elapsedDays = Math.round((date - start) / 86400000);
  const cycleLength = plan.studyDays + plan.restDays;
  return elapsedDays % cycleLength >= plan.studyDays;
}
```

- [ ] **Step 4: Run the model test to verify it passes**

Run: `node --test test/study-plan-schedule.test.js`

Expected: PASS with three passing subtests.

- [ ] **Step 5: Commit the shared model**

```bash
git add src/study-plan/schedule.js test/study-plan-schedule.test.js
git commit -m "feat: add study plan recurrence model"
```

### Task 2: Add the project record, table, and scoped repository

**Files:**
- Create: `db/migrations/004_study_plan_project.sql`
- Create: `src/repositories/studyPlanRepository.js`
- Create: `test/study-plan-repository.test.js`
- Modify: `src/db/migrate.js`
- Modify: `test/database-config.test.js`

- [ ] **Step 1: Write failing migration and repository scoping tests**

```js
test("listMigrationFiles includes the study-plan migration", async () => {
  const { listMigrationFiles } = await import("../src/db/migrate.js");
  assert.deepEqual(await listMigrationFiles(), [
    "001_initial_schema.sql", "002_scope_wearable_record_ids.sql", "003_group_based_project_access.sql", "004_study_plan_project.sql"
  ]);
});

test("study-plan queries are always scoped to the owning user and project", async () => {
  const { createStudyPlanRepository } = await import("../src/repositories/studyPlanRepository.js");
  const calls = [];
  const repository = createStudyPlanRepository({ query: async (text, values) => { calls.push({ text, values }); return { rows: [], rowCount: 0 }; } });
  await repository.listPlans({ userId: "user-a", projectId: "project-a" });
  await repository.deletePlan({ id: "plan-a", userId: "user-a", projectId: "project-a" });
  assert.match(calls[0].text, /WHERE user_id = \$1 AND project_id = \$2/);
  assert.match(calls[1].text, /WHERE id = \$1 AND user_id = \$2 AND project_id = \$3/);
  assert.deepEqual(calls[1].values, ["plan-a", "user-a", "project-a"]);
});
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `node --test test/database-config.test.js test/study-plan-repository.test.js`

Expected: FAIL because migration `004` and `createStudyPlanRepository` do not exist.

- [ ] **Step 3: Add the migration and exported project constants**

```sql
CREATE TABLE study_plans (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  student text NOT NULL CHECK (student IN ('大公主', '小公主')),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 30),
  location text NOT NULL CHECK (length(location) BETWEEN 1 AND 50),
  start_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL CHECK (end_time > start_time),
  study_days integer NOT NULL CHECK (study_days >= 1),
  rest_days integer NOT NULL CHECK (rest_days >= 0),
  target_study_days integer NOT NULL CHECK (target_study_days >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX study_plans_owner_updated_idx ON study_plans (user_id, project_id, updated_at DESC);

INSERT INTO projects (id, code, name, description, route, cover_image_url, sort_order)
VALUES ('b406a418-20d1-4c15-a797-33ad4c904492', 'study-plan', '学习计划日历', '按学习与休息循环安排两位小公主的课程日历。', '/projects/study-plan', NULL, 2)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  route = EXCLUDED.route,
  cover_image_url = EXCLUDED.cover_image_url,
  sort_order = EXCLUDED.sort_order;
```

Export matching `STUDY_PLAN_PROJECT_ID` and `STUDY_PLAN_PROJECT_CODE` constants from `src/db/migrate.js`. Do not insert a `group_project_access` row for the default group.

- [ ] **Step 4: Implement a row mapper and three scoped repository methods**

```js
export function createStudyPlanRepository(pool) {
  return {
    async listPlans({ userId, projectId }) {
      const result = await pool.query(
        `SELECT id, student, subject, location, start_date, start_time, end_time, study_days, rest_days, target_study_days, created_at, updated_at
         FROM study_plans WHERE user_id = $1 AND project_id = $2 ORDER BY start_date ASC, start_time ASC, created_at ASC`,
        [userId, projectId]
      );
      return result.rows.map(toStudyPlan);
    },
    async createPlan({ id, userId, projectId, plan }) {
      const result = await pool.query(
        `INSERT INTO study_plans (id, user_id, project_id, student, subject, location, start_date, start_time, end_time, study_days, rest_days, target_study_days)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id, student, subject, location, start_date, start_time, end_time, study_days, rest_days, target_study_days, created_at, updated_at`,
        [id, userId, projectId, plan.student, plan.subject, plan.location, plan.startDate, plan.startTime, plan.endTime, plan.studyDays, plan.restDays, plan.targetStudyDays]
      );
      return toStudyPlan(result.rows[0]);
    },
    async deletePlan({ id, userId, projectId }) {
      const result = await pool.query("DELETE FROM study_plans WHERE id = $1 AND user_id = $2 AND project_id = $3", [id, userId, projectId]);
      return result.rowCount === 1;
    }
  };
}
```

Use this mapper before `createStudyPlanRepository`; it returns browser camelCase fields and normalizes PostgreSQL date/time strings:

```js
function toStudyPlan(row) {
  if (!row) return null;
  const date = typeof row.start_date === "string" ? row.start_date.slice(0, 10) : row.start_date.toISOString().slice(0, 10);
  const time = (value) => String(value).slice(0, 5);
  return {
    id: row.id, student: row.student, subject: row.subject, location: row.location,
    startDate: date, startTime: time(row.start_time), endTime: time(row.end_time),
    studyDays: Number(row.study_days), restDays: Number(row.rest_days), targetStudyDays: Number(row.target_study_days),
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}
```

- [ ] **Step 5: Run migration and repository tests to verify they pass**

Run: `node --test test/database-config.test.js test/study-plan-repository.test.js`

Expected: PASS. The migration order list includes `004`, and both select and delete queries have user/project boundaries.

- [ ] **Step 6: Commit persistence changes**

```bash
git add db/migrations/004_study_plan_project.sql src/db/migrate.js src/repositories/studyPlanRepository.js test/database-config.test.js test/study-plan-repository.test.js
git commit -m "feat: persist account study plans"
```

### Task 3: Expose protected study-plan API and project page route

**Files:**
- Create: `src/routes/studyPlanRoutes.js`
- Create: `test/study-plan-routes.test.js`
- Modify: `server.js`
- Modify: `test/project-pages.test.js`

- [ ] **Step 1: Write failing route-surface and page-route tests**

```js
test("study-plan router exposes list, create, and scoped delete endpoints", async () => {
  const { createStudyPlanRouter } = await import("../src/routes/studyPlanRoutes.js");
  const router = createStudyPlanRouter({ repository: {}, sessionService: {}, studyPlanProjectCode: "study-plan" });
  const paths = router.stack.filter((layer) => layer.route).map((layer) => `${Object.keys(layer.route.methods)[0]} ${layer.route.path}`);
  assert.deepEqual(paths, ["get /", "post /", "delete /:id"]);
});

test("study plan page is registered as a protected project route", () => {
  const app = createApp({ disableDatabase: true });
  assert.ok(app._router.stack.find((layer) => layer.route?.path === "/projects/study-plan"));
  assert.ok(app._router.stack.find((layer) => layer.route?.path === "/study-plan/schedule.js"));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/study-plan-routes.test.js test/project-pages.test.js`

Expected: FAIL because the router module and server routes do not exist.

- [ ] **Step 3: Implement the authorization-first router and error responses**

```js
export function createStudyPlanRouter({ repository, projectRepository = repository, sessionService, studyPlanProjectCode }) {
  const router = Router({ mergeParams: true });
  router.use(requireUser(sessionService));
  router.use(requireProjectAccess(projectRepository));
  router.use((req, res, next) => {
    if (req.params.code !== studyPlanProjectCode) return res.status(404).json({ error: "PROJECT_NOT_FOUND", message: "未找到学习计划项目。" });
    next();
  });
  router.get("/", route(async (req, res) => res.json({ plans: await repository.listPlans({ userId: req.user.id, projectId: req.project.id }) })));
  router.post("/", route(async (req, res) => {
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : null;
    if (!body) throw inputError("请求数据格式无效。");
    const plan = {
      student: String(body.student || ""), subject: String(body.subject || "").trim(), location: String(body.location || "").trim(),
      startDate: String(body.startDate || ""), startTime: String(body.startTime || ""), endTime: String(body.endTime || ""),
      studyDays: Number(body.studyDays), restDays: Number(body.restDays), targetStudyDays: Number(body.targetStudyDays)
    };
    const message = validatePlanInput(plan);
    if (message) throw inputError(message);
    const created = await repository.createPlan({ id: randomUUID(), userId: req.user.id, projectId: req.project.id, plan });
    res.status(201).json({ plan: created });
  }));
  router.delete("/:id", route(async (req, res) => {
    const deleted = await repository.deletePlan({ id: req.params.id, userId: req.user.id, projectId: req.project.id });
    if (!deleted) return res.status(404).json({ error: "PLAN_NOT_FOUND", message: "学习计划不存在。" });
    res.status(204).end();
  }));
  return router;
}
```

Define the route helpers used above as follows: `inputError(message)` returns an `Error` with `status = 400` and `code = "INVALID_INPUT"`; `route(handler)` catches errors; and `sendRouteError` maps errors carrying `status` and `code` to `{ error: code, message }`. All other errors return `500 { error: "STUDY_PLAN_SAVE_FAILED", message: "学习计划保存失败，请稍后重试。" }`. Import `randomUUID`, `Router`, `requireUser`, `requireProjectAccess`, and `validatePlanInput` at the top of the file.

- [ ] **Step 4: Wire the repository, API, page, and browser module routes**

```js
const studyPlanRepository = options.studyPlanRepository || (pool ? createStudyPlanRepository(pool) : null);

app.use("/api/projects/:code/study-plans", createStudyPlanRouter({
  repository: studyPlanRepository,
  projectRepository: userRepository,
  sessionService,
  studyPlanProjectCode: STUDY_PLAN_PROJECT_CODE
}));
app.get("/projects/study-plan", async (req, res, next) => {
  try {
    const user = await sessionService?.getCurrentUser(req);
    if (!user) return res.redirect("/login?next=/projects/study-plan");
    const project = await userRepository?.findProjectAccess({ userId: user.id, projectCode: STUDY_PLAN_PROJECT_CODE });
    if (!project) return res.redirect("/");
    res.sendFile(path.join(__dirname, "study-plan.html"));
  } catch (error) {
    next(error);
  }
});
app.get("/study-plan/schedule.js", (_req, res) => res.sendFile(path.join(__dirname, "src/study-plan/schedule.js")));
app.get("/study-plan-client.js", (_req, res) => res.sendFile(path.join(__dirname, "study-plan-client.js")));
```

Add a database-not-configured fallback for `/api/projects/:code/study-plans`, matching the existing `/api/projects` 503 behavior. The server page handler redirects unauthenticated users to `/login?next=/projects/study-plan` and unauthorized users to `/`; the client repeats those redirects when a session expires after page load.

- [ ] **Step 5: Run router and page-route tests to verify they pass**

Run: `node --test test/study-plan-routes.test.js test/project-pages.test.js`

Expected: PASS. The API has exactly GET, POST, and DELETE routes; the page and shared browser module routes are registered.

- [ ] **Step 6: Commit API wiring**

```bash
git add src/routes/studyPlanRoutes.js server.js test/study-plan-routes.test.js test/project-pages.test.js
git commit -m "feat: add protected study plan API"
```

### Task 4: Build the account-synchronized Learning Cabin page

**Files:**
- Create: `study-plan.html`
- Create: `study-plan-client.js`
- Create: `test/study-plan-page.test.js`

- [ ] **Step 1: Write failing static-page behavior tests**

```js
test("study plan page uses the account API and has no local storage data source", async () => {
  const [html, client] = await Promise.all([
    fs.readFile(new URL("../study-plan.html", import.meta.url), "utf8"),
    fs.readFile(new URL("../study-plan-client.js", import.meta.url), "utf8")
  ]);
  assert.match(html, /总览/);
  assert.match(html, /大公主/);
  assert.match(html, /小公主/);
  assert.match(html, /新增学习计划/);
  assert.match(client, /const API_ROOT = "\/api\/projects\/study-plan\/study-plans"/);
  assert.match(client, /fetch\(`\$\{API_ROOT\}\$\{path\}`/);
  assert.doesNotMatch(client, /localStorage/);
});
```

- [ ] **Step 2: Run the page test to verify it fails**

Run: `node --test test/study-plan-page.test.js`

Expected: FAIL with `ENOENT` for `study-plan.html`.

- [ ] **Step 3: Add the responsive semantic page shell**

```html
<header class="app-header">
  <div><p class="eyebrow">LEARNING PLANS</p><h1>学习小屋</h1><p class="subtitle">把两位小公主的学习安排，放进一张清晰的日历里。</p></div>
  <button id="open-plan-dialog" class="primary-button" type="button">＋ 新增计划</button>
</header>
<nav class="view-tabs" aria-label="查看范围">
  <button class="tab active" data-view="overview" type="button">总览</button>
  <button class="tab" data-view="大公主" type="button">大公主</button>
  <button class="tab" data-view="小公主" type="button">小公主</button>
  <button class="tab" data-view="calendar" type="button">日历</button>
</nav>
<p id="sync-status" class="sync-status" role="status"></p>
<main id="app-content" aria-live="polite"></main>
<script type="module" src="/study-plan-client.js"></script>
```

Include the confirmed rose/blue learning-calendar visual treatment, seven-column calendar, plan dialog, labels for every input, a back-to-project-home link, and the compact mobile breakpoint at `760px`. Do not add guest mode or browser-local storage.

- [ ] **Step 4: Implement the client state, API operations, and rendering**

```js
import { STUDENTS, expandPlan, isRestDate, sortEvents, validatePlanInput } from "/study-plan/schedule.js";

const API_ROOT = "/api/projects/study-plan/study-plans";
const state = { view: "overview", month: new Date(new Date().getFullYear(), new Date().getMonth(), 1), plans: [] };

async function apiFetch(path = "", options = {}) {
  const response = await fetch(`${API_ROOT}${path}`, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  if (response.status === 401) window.location.assign("/login?next=/projects/study-plan");
  if (response.status === 403) window.location.assign("/");
  return response;
}

async function loadPlans() {
  const response = await apiFetch();
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || "无法读取学习计划，请稍后重试。");
  state.plans = (await response.json()).plans || [];
  render();
}
```

Implement `createPlan` to disable the form submit button while POSTing, append only the returned `plan` after a 201 response, then close and reset the dialog. Implement `deletePlan` to require `confirm`, call DELETE, remove the plan only after a 204 response, and leave the current calendar intact on failure. Display `同步完成` after a successful change and a specific error message after a failed load/save/delete. Derive dashboard metrics, per-person filters, month navigation, chips sorted by time, and rest-day notes only from `state.plans` and the shared helpers.

- [ ] **Step 5: Run the static-page test to verify it passes**

Run: `node --test test/study-plan-page.test.js`

Expected: PASS. The page contains the four confirmed views and the client uses only the account API for data.

- [ ] **Step 6: Manually verify the authenticated browser flow**

1. Apply migrations, grant “学习计划日历” to a non-default test group in `/admin`, and add a test account to the group.
2. Sign in as that account and open `/projects/study-plan`; confirm the project appears in the directory and the empty state loads.
3. Add 大公主计划：2026-07-10，数学思维，家中书房，16:30–18:30，学习 5 天、休息 1 天、目标 18 天. Confirm 18 chips, 2026-07-15 rest note, and no rest notes after final completion.
4. Add 小公主 plan at 10:00 on 2026-07-11; confirm both colors show that day, ordered 10:00 then 16:30.
5. Open the same account on a second browser or phone; refresh and confirm both plans match. Add or delete on one device, refresh the other, and confirm it reflects the server state.
6. Sign in as an account outside the granted group; confirm the directory omits the project, `/projects/study-plan` redirects to the directory after access denial, and the API returns 403.

- [ ] **Step 7: Commit the Learning Cabin UI**

```bash
git add study-plan.html study-plan-client.js test/study-plan-page.test.js
git commit -m "feat: add synchronized study plan calendar"
```

### Task 5: Document operation and run the full regression suite

**Files:**
- Modify: `README.md`
- Modify: `test/guest-mode.test.js`

- [ ] **Step 1: Write a failing operations-documentation test**

```js
test("README documents group-controlled study-plan synchronization", async () => {
  const readme = await fs.readFile(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, /学习计划日历不属于默认分组/);
  assert.match(readme, /手机和电脑登录同一账号即可同步/);
});
```

- [ ] **Step 2: Run the test to verify it fails before the README update**

Run: `node --test test/guest-mode.test.js`

Expected: FAIL because README has not yet documented the new project’s authorization and sync behavior.

- [ ] **Step 3: Document admin-controlled access and account synchronization**

```markdown
- “学习计划日历”按登录账号保存计划规则，手机和电脑登录同一账号即可同步；日历课程由规则自动生成。
- 学习计划日历不属于默认分组。管理员需在后台的“分组与权限”中向目标分组开通该项目，再将用户加入该分组。
```

Add this next to the existing data-and-access bullets. Do not change the wearable guest-mode description. Keep the existing guest-directory assertion in `test/guest-mode.test.js` so guests continue to see only the local wearable project.

- [ ] **Step 4: Run full automated regression tests**

Run: `npm test`

Expected: PASS, including the new schedule, repository, route, page, migration, and guest-directory tests.

- [ ] **Step 5: Commit documentation and regression coverage**

```bash
git add README.md test/guest-mode.test.js
git commit -m "docs: explain study plan project access"
```

## Review notes

- Spec coverage: Tasks 1–4 cover rule generation, account and project scoping, non-default group authorization, authenticated API access, the confirmed calendar interface, feedback on failed sync, and cross-device verification. Task 5 documents administrator setup and preserves guest-mode boundaries.
- Placeholder scan: implementation steps define exact file paths, API paths, schema fields, status codes, commands, and success expectations; no deferred requirements remain.
- Type consistency: plans use `student`, `subject`, `location`, `startDate`, `startTime`, `endTime`, `studyDays`, `restDays`, and `targetStudyDays` in the shared model, repository API mapping, route input, and client state. The project code is consistently `study-plan`.
