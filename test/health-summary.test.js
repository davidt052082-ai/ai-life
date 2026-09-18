import test from "node:test";
import assert from "node:assert/strict";
import { buildDailySummary, buildReminderCandidates, buildWeeklyComparison } from "../src/health/summary.js";

test("daily summary totals water and tea and counts meals", () => {
  const summary = buildDailySummary({ date: "2026-09-17", events: [
    { eventType: "hydration", payload: { type: "water", volumeMl: 300 } },
    { eventType: "hydration", payload: { type: "tea", volumeMl: 200 } }
  ], meals: [{ mealType: "breakfast", status: "pending_analysis" }] });
  assert.deepEqual(summary.hydration, { waterMl: 300, teaMl: 200, totalMl: 500 });
  assert.equal(summary.mealPhotoCount, 1);
  assert.ok(summary.remainingTasks.length > 0);
});

test("comparison reports actual value, percentage, and difference", () => {
  assert.deepEqual(buildWeeklyComparison({ targets: { walks: 10 }, actuals: { walks: 8 } }), [{ id: "walks", planned: 10, actual: 8, completionRate: 80, difference: -2 }]);
});

test("reminder is only created for an incomplete contextual task", () => {
  const candidates = buildReminderCandidates({ now: "2026-09-18T12:35:00+08:00", summary: { meals: {}, remainingTasks: [] } });
  assert.deepEqual(candidates, [{ kind: "lunch-photo", message: "午餐拍照，拍一张即可完成" }]);
});
