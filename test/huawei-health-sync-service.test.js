import test from "node:test";
import assert from "node:assert/strict";
import { createHuaweiSyncService, syncWindow } from "../src/integrations/huawei-health/sync-service.js";

test("incremental Huawei sync overlaps the previous success by three days", () => {
  const window = syncWindow({ connection: { lastSuccessfulSyncAt: new Date("2026-09-28T12:00:00Z") }, now: () => new Date("2026-09-29T12:00:00Z"), initialDays: 30, lookbackDays: 3 });
  assert.equal(window.start.toISOString(), "2026-09-25T12:00:00.000Z");
  assert.equal(window.end.toISOString(), "2026-09-29T12:00:00.000Z");
});

test("first Huawei sync defaults to the configured history range", () => {
  const window = syncWindow({ connection: {}, now: () => new Date("2026-09-29T12:00:00Z"), initialDays: 30, lookbackDays: 3 });
  assert.equal(window.start.toISOString(), "2026-08-30T12:00:00.000Z");
});

test("sync writes normalized daily data without touching manual records", async () => {
  const calls = [];
  const repository = {
    getConnection: async () => ({ status: "connected", accessTokenEnc: "encrypted" }),
    createSyncRun: async (run) => { calls.push(["run", run]); return "run-1"; },
    upsertSamples: async (input) => calls.push(["samples", input]),
    upsertDaily: async (input) => calls.push(["daily", input]),
    finishSyncRun: async (input) => calls.push(["finish", input]),
    markSyncSuccess: async () => calls.push(["success"]),
    markSyncFailure: async () => calls.push(["failure"]),
    markReauthRequired: async () => calls.push(["reauth"])
  };
  const service = createHuaweiSyncService({ repository, config: { initialDays: 30, lookbackDays: 3, tokenKey: "key" }, decrypt: () => "token", now: () => new Date("2026-09-29T12:00:00Z"), client: { collectDaily: async () => ({ daily: [{ localDate: "2026-09-29", timezone: "Asia/Shanghai", steps: 8624 }], samples: [], recordsRead: 1 }) } });
  const result = await service.syncUser({ userId: "u", projectId: "p", trigger: "manual" });
  assert.equal(result.status, "success");
  assert.equal(calls.find(([kind]) => kind === "daily")[1].rows[0].steps, 8624);
  assert.equal(calls.find(([kind]) => kind === "finish")[1].status, "success");
});

test("unauthorized Huawei sync marks the connection for reauthorization", async () => {
  const calls = [];
  const repository = {
    getConnection: async () => ({ status: "connected", accessTokenEnc: "encrypted" }),
    createSyncRun: async () => "run-1", markReauthRequired: async () => calls.push("reauth"), markSyncFailure: async () => calls.push("failure"), finishSyncRun: async (value) => calls.push(value)
  };
  const error = Object.assign(new Error("reauth"), { code: "HUAWEI_REAUTH_REQUIRED" });
  const service = createHuaweiSyncService({ repository, config: { initialDays: 30, lookbackDays: 3, tokenKey: "key" }, decrypt: () => "token", client: { collectDaily: async () => { throw error; } } });
  await assert.rejects(() => service.syncUser({ userId: "u", projectId: "p", trigger: "scheduled" }), { code: "HUAWEI_REAUTH_REQUIRED" });
  assert.deepEqual(calls.slice(0, 2), ["reauth", "failure"]);
});

test("expired access token is refreshed and re-encrypted before collecting", async () => {
  const calls = [];
  const repository = {
    getConnection: async () => ({ status: "connected", projectId: "p", accessTokenEnc: "old-access", refreshTokenEnc: "old-refresh", accessTokenExpiresAt: "2026-09-29T11:59:00Z", grantedScopes: ["scope"] }),
    createSyncRun: async () => "run", upsertConnection: async (input) => calls.push(input), upsertSamples: async () => {}, upsertDaily: async () => {}, finishSyncRun: async () => {}, markSyncSuccess: async () => {}
  };
  const service = createHuaweiSyncService({ repository, config: { initialDays: 30, lookbackDays: 3, tokenKey: "key" }, now: () => new Date("2026-09-29T12:00:00Z"), decrypt: (value) => value === "old-access" ? "access" : "refresh", encrypt: (value) => `enc:${value}`, refreshToken: async () => ({ accessToken: "new-access", refreshToken: "new-refresh", expiresAt: new Date("2026-09-29T13:00:00Z") }), client: { collectDaily: async ({ token }) => { assert.equal(token, "new-access"); return { daily: [], samples: [] }; } } });
  await service.syncUser({ userId: "u", projectId: "p", trigger: "scheduled" });
  assert.equal(calls[0].accessTokenEnc, "enc:new-access");
  assert.equal(calls[0].refreshTokenEnc, "enc:new-refresh");
});
