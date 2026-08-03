# 交易分析项目接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将独立部署的交易分析仪表盘登记为 AI Life 的受权限保护项目，并安全跳转到部署地址。

**Architecture:** 数据库迁移新增 `trade-analysis` 项目，但不向默认分组授予权限；既有管理员组触发器会自动获得该项目权限。AI Life 的页面入口验证会话和项目访问权后，使用由环境变量提供、且仅允许 HTTP(S) 的目标 URL 返回 302 跳转；交易仪表盘及其数据仍保持独立部署。

**Tech Stack:** Node.js、Express 4、PostgreSQL SQL migrations、Node built-in test runner。

---

## File structure

- Create: `src/trade-analysis/targetUrl.js` — 规范化并验证交易分析部署 URL。
- Create: `src/routes/tradeAnalysisPage.js` — 交易分析页面入口的会话、授权与跳转处理。
- Create: `db/migrations/010_trade_analysis_project.sql` — 新项目目录记录。
- Create: `test/trade-analysis-page.test.js` — 目标 URL 与 HTTP 路由的行为测试。
- Create: `test/trade-analysis-project.test.js` — 项目迁移内容测试。
- Modify: `server.js` — 注入配置并注册受保护的项目页面路由。
- Modify: `test/database-config.test.js` — 更新迁移清单与环境/文档断言。
- Modify: `.env.example` — 声明 `TRADE_ANALYSIS_URL`。
- Modify: `README.md` — 说明交易分析项目的授权及独立部署配置。

### Task 1: Define the safe redirect and access behavior with failing tests

**Files:**
- Create: `test/trade-analysis-page.test.js`

- [ ] **Step 1: Write failing tests for target URL validation and the protected page**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.js";
import { normalizeTradeAnalysisUrl } from "../src/trade-analysis/targetUrl.js";

async function request(app, path) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const { port } = server.address();
    return await fetch(`http://127.0.0.1:${port}${path}`, { redirect: "manual" });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function createTradeApp({ user = { id: "user-1" }, project = { code: "trade-analysis" }, tradeAnalysisUrl } = {}) {
  return createApp({
    userRepository: { findProjectAccess: async () => project },
    sessionService: { getCurrentUser: async () => user },
    tradeAnalysisUrl
  });
}

test("normalizeTradeAnalysisUrl accepts only absolute HTTP(S) URLs", () => {
  assert.equal(normalizeTradeAnalysisUrl("https://trade.example.com/dashboard"), "https://trade.example.com/dashboard");
  assert.equal(normalizeTradeAnalysisUrl("http://localhost:8080/"), "http://localhost:8080/");
  assert.equal(normalizeTradeAnalysisUrl("file:///tmp/trade_analysis.html"), null);
  assert.equal(normalizeTradeAnalysisUrl("/dashboard"), null);
  assert.equal(normalizeTradeAnalysisUrl("javascript:alert(1)"), null);
  assert.equal(normalizeTradeAnalysisUrl(""), null);
});

test("GET /projects/trade-analysis redirects an authorized user to the configured dashboard", async () => {
  const response = await request(createTradeApp({ tradeAnalysisUrl: "https://trade.example.com/dashboard" }), "/projects/trade-analysis");

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://trade.example.com/dashboard");
});

test("GET /projects/trade-analysis sends unauthenticated users to login", async () => {
  const response = await request(createTradeApp({ user: null, tradeAnalysisUrl: "https://trade.example.com/" }), "/projects/trade-analysis");

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/login?next=/projects/trade-analysis");
});

test("GET /projects/trade-analysis returns unauthorized users to the project directory", async () => {
  const response = await request(createTradeApp({ project: null, tradeAnalysisUrl: "https://trade.example.com/" }), "/projects/trade-analysis");

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/");
});

test("GET /projects/trade-analysis returns 503 when the dashboard URL is unavailable", async () => {
  const response = await request(createTradeApp({ tradeAnalysisUrl: "file:///tmp/dashboard.html" }), "/projects/trade-analysis");

  assert.equal(response.status, 503);
  assert.match(await response.text(), /交易分析服务尚未配置/);
});
```

- [ ] **Step 2: Run the test to verify it fails before implementation**

Run: `node --test test/trade-analysis-page.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/trade-analysis/targetUrl.js`.

### Task 2: Implement the protected redirect route

**Files:**
- Create: `src/trade-analysis/targetUrl.js`
- Create: `src/routes/tradeAnalysisPage.js`
- Modify: `server.js:18-25,39-48,219-248`
- Test: `test/trade-analysis-page.test.js`

- [ ] **Step 1: Add the URL normalizer**

```js
export function normalizeTradeAnalysisUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Add a focused page handler**

```js
import { TRADE_ANALYSIS_PROJECT_CODE } from "../db/migrate.js";

export function createTradeAnalysisPageHandler({ repository, sessionService, targetUrl }) {
  return async (req, res, next) => {
    try {
      const user = await sessionService?.getCurrentUser(req);
      if (!user) return res.redirect("/login?next=/projects/trade-analysis");

      const project = await repository?.findProjectAccess({ userId: user.id, projectCode: TRADE_ANALYSIS_PROJECT_CODE });
      if (!project) return res.redirect("/");
      if (!targetUrl) return res.status(503).send("交易分析服务尚未配置。");

      return res.redirect(302, targetUrl);
    } catch (error) {
      return next(error);
    }
  };
}
```

- [ ] **Step 3: Wire configuration and the handler into `createApp`**

Add imports:

```js
import { createTradeAnalysisPageHandler } from "./src/routes/tradeAnalysisPage.js";
import { normalizeTradeAnalysisUrl } from "./src/trade-analysis/targetUrl.js";
```

After the existing analytics configuration in `createApp`, define:

```js
const tradeAnalysisUrl = normalizeTradeAnalysisUrl(
  options.tradeAnalysisUrl ?? process.env.TRADE_ANALYSIS_URL
);
```

Register the page after the existing study-plan page route:

```js
app.get("/projects/trade-analysis", createTradeAnalysisPageHandler({
  repository: userRepository,
  sessionService,
  targetUrl: tradeAnalysisUrl
}));
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `node --test test/trade-analysis-page.test.js`

Expected: PASS with 5 passing subtests.

- [ ] **Step 5: Run all existing route and project-page tests**

Run: `node --test test/auth-projects.test.js test/project-pages.test.js test/group-access.test.js`

Expected: PASS; no existing project authorization behavior changes.

- [ ] **Step 6: Commit the redirect route**

```bash
git add server.js src/trade-analysis/targetUrl.js src/routes/tradeAnalysisPage.js test/trade-analysis-page.test.js
git commit -m "feat: add trade analysis project redirect"
```

### Task 3: Register the project and document deployment configuration

**Files:**
- Create: `db/migrations/010_trade_analysis_project.sql`
- Create: `test/trade-analysis-project.test.js`
- Modify: `test/database-config.test.js:6-33`
- Modify: `.env.example:1-12`
- Modify: `README.md:1-70,83-99`

- [ ] **Step 1: Write failing migration and configuration tests**

Create `test/trade-analysis-project.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("trade-analysis migration registers an independently deployed, non-default project", async () => {
  const migration = await fs.readFile(new URL("../db/migrations/010_trade_analysis_project.sql", import.meta.url), "utf8");

  assert.match(migration, /'trade-analysis'/);
  assert.match(migration, /'交易分析'/);
  assert.match(migration, /'\/projects\/trade-analysis'/);
  assert.match(migration, /ON CONFLICT \(code\) DO UPDATE/);
  assert.doesNotMatch(migration, /default/);
  assert.doesNotMatch(migration, /group_project_access/);
});
```

In `test/database-config.test.js`, append `TRADE_ANALYSIS_URL` to the expected migration list and add these assertions to the environment/documentation test:

```js
assert.match(envExample, /^TRADE_ANALYSIS_URL=$/m);
assert.match(readme, /TRADE_ANALYSIS_URL/);
assert.match(readme, /交易分析/);
```

- [ ] **Step 2: Run the tests to verify they fail before the migration and docs exist**

Run: `node --test test/trade-analysis-project.test.js test/database-config.test.js`

Expected: FAIL because migration `010_trade_analysis_project.sql` and `TRADE_ANALYSIS_URL` do not yet exist.

- [ ] **Step 3: Add the idempotent project migration and project constants**

Create `db/migrations/010_trade_analysis_project.sql`:

```sql
INSERT INTO projects (id, code, name, description, route, cover_image_url, sort_order)
VALUES (
  '6cc66a0d-0ad2-4873-ac2c-e2e4a4bb6f1a',
  'trade-analysis',
  '交易分析',
  '展示账户资金流水、收益、持仓与交易行为分析。',
  '/projects/trade-analysis',
  NULL,
  3
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  route = EXCLUDED.route,
  cover_image_url = EXCLUDED.cover_image_url,
  sort_order = EXCLUDED.sort_order;
```

In `src/db/migrate.js`, add alongside the existing project constants:

```js
export const TRADE_ANALYSIS_PROJECT_ID = "6cc66a0d-0ad2-4873-ac2c-e2e4a4bb6f1a";
export const TRADE_ANALYSIS_PROJECT_CODE = "trade-analysis";
```

The existing `admin_group_project_access_trigger` (from migration `005`) grants the admin group access when this migration inserts the new project. Do not add a default-group grant.

- [ ] **Step 4: Document the environment variable and operational behavior**

Add this after `PORT=5173` in `.env.example`:

```dotenv
# Absolute HTTP(S) URL for the independently deployed trade-analysis dashboard.
TRADE_ANALYSIS_URL=
```

Update the README introductory sentence to list “交易分析” as a project. In “数据与授权”, add:

```markdown
- 交易分析是独立部署的仪表盘。AI Life 仅在授权后跳转；管理员需在后台向目标分组开通该项目。
```

In “切换云端 PostgreSQL”, include `TRADE_ANALYSIS_URL` in the production environment variable list, and state that it must be an absolute HTTP(S) URL of the independently deployed dashboard.

- [ ] **Step 5: Run migration/configuration tests and the whole suite**

Run: `node --test test/trade-analysis-project.test.js test/trade-analysis-page.test.js test/database-config.test.js`

Expected: PASS with all focused tests passing.

Run: `npm test`

Expected: PASS with no test failures.

- [ ] **Step 6: Commit project registration and documentation**

```bash
git add .env.example README.md db/migrations/010_trade_analysis_project.sql src/db/migrate.js test/database-config.test.js test/trade-analysis-project.test.js
git commit -m "feat: register trade analysis project"
```

## Plan self-review

- Spec coverage: Task 2 covers login, authorization, safe 302 behavior and absent/invalid configuration; Task 3 covers the idempotent project record, admin-only initial visibility, environment declaration and deployment documentation. No spec requirement is omitted.
- Placeholder scan: the plan contains no incomplete steps or deferred implementation markers.
- Type consistency: `normalizeTradeAnalysisUrl` returns `string | null`; `createTradeAnalysisPageHandler` consumes that as `targetUrl`; `TRADE_ANALYSIS_PROJECT_CODE` has one canonical spelling in the migration constants and handler.
