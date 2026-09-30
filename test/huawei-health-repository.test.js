import test from "node:test";
import assert from "node:assert/strict";
import { createHuaweiHealthRepository } from "../src/repositories/huaweiHealthRepository.js";

test("sample upsert uses provider source identity", async () => {
  const queries = [];
  const repository = createHuaweiHealthRepository({ query: async (text, values) => { queries.push([text, values]); return { rows: [] }; } });
  await repository.upsertSamples({ userId: "u", projectId: "p", samples: [{ id: "id", metricType: "steps", sourceRecordId: "h-1", startTimeUtc: new Date("2026-09-28T00:00:00Z"), endTimeUtc: new Date("2026-09-28T00:05:00Z"), valueNum: 200, unit: "steps", rawHash: "hash" }] });
  assert.match(queries[0][0], /ON CONFLICT \(provider, user_id, metric_type, source_record_id\) DO UPDATE/);
});

test("consuming OAuth state deletes it atomically", async () => {
  const queries = [];
  const repository = createHuaweiHealthRepository({ query: async (text, values) => { queries.push([text, values]); return { rows: [{ user_id: "u", project_id: "p", redirect_path: "/projects/health" }] }; } });
  const state = await repository.consumeOAuthState("opaque-state");
  assert.equal(state.userId, "u");
  assert.match(queries[0][0], /^DELETE FROM health_oauth_states/);
  assert.equal(queries[0][1].length, 1);
});

test("connection keeps its project so the scheduler can sync a first-time connection", async () => {
  const queries = [];
  const repository = createHuaweiHealthRepository({ query: async (text, values) => {
    queries.push([text, values]);
    return { rows: text.startsWith("SELECT") ? [{ user_id: "u", project_id: "p" }] : [{ id: "connection", user_id: "u", project_id: "p", status: "connected" }] };
  } });
  await repository.upsertConnection({ userId: "u", projectId: "p", accessTokenEnc: "access", refreshTokenEnc: "refresh", accessTokenExpiresAt: new Date(), grantedScopes: [] });
  const connected = await repository.listConnectedUsers();
  assert.deepEqual(connected, [{ userId: "u", projectId: "p" }]);
  assert.match(queries[0][0], /project_id/);
  assert.doesNotMatch(queries[1][0], /health_daily/i);
});
