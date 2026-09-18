import test from "node:test";
import assert from "node:assert/strict";
import { createHealthRepository } from "../src/repositories/healthRepository.js";

test("event persistence is scoped and idempotent", async () => {
  const calls = [];
  const repository = createHealthRepository({ query: async (text, values) => { calls.push({ text, values }); return { rows: [{ id: "event-1", event_id: "hydration_1", event_type: "hydration", payload: {}, occurred_at: "now", timezone: "Asia/Shanghai", plan_date: "2026-09-18", sync_status: "synced", version: 1 }] }; } });
  await repository.createEvent({ id: "event-1", eventId: "hydration_1", userId: "user-1", projectId: "project-1", idempotencyKey: "key-1", eventType: "hydration", payload: { volumeMl: 300 }, occurredAt: "2026-09-18T02:30:00Z", timezone: "Asia/Shanghai", planDate: "2026-09-18" });
  assert.match(calls[0].text, /ON CONFLICT \(user_id, idempotency_key\)/);
  assert.deepEqual(calls[0].values.slice(0, 5), ["event-1", "user-1", "project-1", "hydration_1", "key-1"]);
});

test("meal deletion includes both user and project scope", async () => {
  const calls = [];
  const repository = createHealthRepository({ query: async (text, values) => { calls.push({ text, values }); return { rows: [], rowCount: 0 }; } });
  await repository.deleteMeal({ id: "meal-1", userId: "user-1", projectId: "project-1" });
  assert.match(calls[0].text, /WHERE id = \$1 AND user_id = \$2 AND project_id = \$3/);
  assert.deepEqual(calls[0].values, ["meal-1", "user-1", "project-1"]);
});
