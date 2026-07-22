import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createApp } from "../server.js";

test("wearable page route is public while wearable data API stays separate", () => {
  const app = createApp({ disableDatabase: true });
  const route = app._router.stack.find((layer) => layer.route?.path === "/projects/wearable");

  assert.equal(route.route.stack.length, 1);
  assert.equal(route.route.stack[0].handle.length, 2);
});

test("project home renders a local wearable project when auth returns 401", async () => {
  const html = await fs.readFile(new URL("../project-home.html", import.meta.url), "utf8");

  assert.match(html, /renderGuestProjects/);
  assert.match(html, /\/projects\/wearable/);
  assert.doesNotMatch(html, /meResponse\.status === 401\) \{ window\.location\.replace\("\/login"\)/);
});

test("wearable page separates guest local storage from account API synchronization", async () => {
  const html = await fs.readFile(new URL("../index.html", import.meta.url), "utf8");

  assert.match(html, /let storageMode = "guest"/);
  assert.match(html, /function initializeGuestProject\(\)/);
  assert.match(html, /storageMode !== "account"/);
  assert.match(html, /async function initializeAccountProject\(\)/);
});
