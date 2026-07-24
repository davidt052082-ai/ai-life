import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("project pages provide login, registration, and an authorization-driven directory", async () => {
  const [login, register, home] = await Promise.all([
    fs.readFile(new URL("../login.html", import.meta.url), "utf8"),
    fs.readFile(new URL("../register.html", import.meta.url), "utf8"),
    fs.readFile(new URL("../project-home.html", import.meta.url), "utf8")
  ]);

  assert.match(login, /\/api\/auth\/login/);
  assert.match(register, /\/api\/auth\/register/);
  assert.match(home, /\/api\/auth\/me/);
  assert.match(home, /\/api\/projects/);
  assert.match(home, /me\.user\.isAdmin/);
  assert.match(home, /href="\/admin"/);
  assert.doesNotMatch(home, /新建项目|删除项目|编辑项目/);
});

test("wearable page loads account-scoped state and offers the project home link", async () => {
  const html = await fs.readFile(new URL("../index.html", import.meta.url), "utf8");

  assert.match(html, /WEARABLE_API_ROOT = "\/api\/projects\/wearable-monitoring\/wearable"/);
  assert.match(html, /initializeWearableProject/);
  assert.match(html, /migrate-local-data/);
  assert.match(html, /返回项目首页/);
});
