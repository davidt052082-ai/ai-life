import test from "node:test";
import assert from "node:assert/strict";
import { startHuaweiScheduler } from "../src/integrations/huawei-health/scheduler.js";

test("scheduler acquires one advisory lock before syncing every connection", async () => {
  let tick; const calls = [];
  const scheduler = startHuaweiScheduler({
    repository: { tryAcquireSchedulerLock: async () => true, listConnectedUsers: async () => [{ userId: "u", projectId: "p" }], releaseSchedulerLock: async () => calls.push("release") },
    syncService: { syncUser: async (value) => calls.push(value) }, intervalHours: 4,
    setIntervalImpl: (handler) => { tick = handler; return 1; }
  });
  await scheduler.run();
  assert.deepEqual(calls, [{ userId: "u", projectId: "p", trigger: "scheduled" }, "release"]);
  assert.equal(typeof tick, "function");
  scheduler.stop();
});
