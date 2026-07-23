import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createApp } from "../server.js";

test("admin page is wired to administrator APIs without project management controls", async () => {
  const html = await fs.readFile(new URL("../admin.html", import.meta.url), "utf8");

  assert.match(html, /\/api\/admin\/overview/);
  assert.match(html, /\/api\/admin\/groups/);
  assert.match(html, /管理成员/);
  assert.match(html, /默认分组/);
  assert.doesNotMatch(html, /新建项目|删除项目|编辑项目/);
});

test("admin page remains reachable while its API reports an unavailable database", () => {
  const app = createApp({ disableDatabase: true });
  const pageRoute = app._router.stack.find((layer) => layer.route?.path === "/admin");
  const unavailableApi = app._router.stack.find((layer) => layer.regexp?.test?.("/api/admin/overview"));

  assert.ok(pageRoute);
  assert.ok(unavailableApi);
});
