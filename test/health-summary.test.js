import test from "node:test";
import assert from "node:assert/strict";
import { buildDailySummary, buildMetricTrends, buildReminderCandidates, buildWeeklyComparison } from "../src/health/summary.js";

test("daily summary totals water and tea and counts meals", () => {
  const summary = buildDailySummary({ date: "2026-09-17", events: [
    { eventType: "hydration", payload: { type: "water", volumeMl: 300 } },
    { eventType: "hydration", payload: { type: "tea", volumeMl: 200 } }
  ], meals: [{ mealType: "breakfast", status: "pending_analysis" }] });
  assert.deepEqual(summary.hydration, { waterMl: 300, teaMl: 200, totalMl: 500 });
  assert.equal(summary.mealPhotoCount, 1);
  assert.ok(summary.remainingTasks.length > 0);
});

test("daily summary exposes per-schedule completion and latest undoable event", () => {
  const summary = buildDailySummary({
    date: "2026-09-20",
    events: [
      { id: "walk-lunch", eventType: "post_meal_walk", payload: { taskId: "lunch-walk" } },
      { id: "walk-dinner", eventType: "post_meal_walk", payload: { taskId: "dinner-walk" } },
      { id: "training", eventType: "workout", payload: { taskId: "training", sessionType: "strength" } },
      { id: "alcohol", eventType: "no_alcohol", payload: { taskId: "no-alcohol" } },
      { id: "snack", eventType: "no_late_snack", payload: { taskId: "no-late-snack" } },
      { id: "sugary", eventType: "no_sugary_drink", payload: { taskId: "no-sugary-drink" } }
    ],
    meals: [{ mealType: "breakfast" }],
    measurements: [{ id: "measure-1", weightKg: 75, waistCm: 88 }]
  });
  assert.deepEqual(summary.actionEvents, { "lunch-walk": "walk-lunch", "dinner-walk": "walk-dinner", training: "training", "no-alcohol": "alcohol", "no-late-snack": "snack", "no-sugary-drink": "sugary" });
  assert.equal(summary.measurementRecorded, true);
  assert.equal(summary.meals.breakfast, true);
});

test("comparison reports actual value, percentage, and difference", () => {
  assert.deepEqual(buildWeeklyComparison({ targets: { walks: 10 }, actuals: { walks: 8 } }), [{ id: "walks", name: "饭后步行", unit: "次", planned: 10, actual: 8, completionRate: 80, difference: -2 }]);
});

test("reminder is only created for an incomplete contextual task", () => {
  const candidates = buildReminderCandidates({ now: "2026-09-18T12:35:00+08:00", summary: { meals: {}, remainingTasks: [] } });
  assert.deepEqual(candidates, [{ kind: "lunch-photo", message: "午餐拍照，拍一张即可完成" }]);
});

test("metric trends aggregate daily events, meals, and body measurements", () => {
  const trends = buildMetricTrends({
    startDate: "2026-09-01", endDate: "2026-09-07",
    measurements: [{ occurredAt: "2026-09-01T00:00:00Z", weightKg: 79, waistCm: 95 }, { occurredAt: "2026-09-07T00:00:00Z", weightKg: 78.2, waistCm: 94 }],
    events: [
      { planDate: "2026-09-07", eventType: "hydration", payload: { type: "water", volumeMl: 300 } },
      { planDate: "2026-09-07", eventType: "hydration", payload: { type: "tea", volumeMl: 200 } },
      { planDate: "2026-09-07", eventType: "workout", payload: { sessionType: "cardio" } },
      { planDate: "2026-09-07", eventType: "no_alcohol", payload: { value: true } }
    ],
    meals: [{ planDate: "2026-09-07" }, { planDate: "2026-09-07" }]
  });
  assert.equal(trends.daily.length, 7);
  assert.deepEqual(trends.daily.at(-1), { date: "2026-09-07", cardioSessions: 1, strengthSessions: 0, postMealWalks: 0, waterMl: 300, teaMl: 200, fluidMl: 500, mealPhotos: 2, noAlcohol: 1, noLateSnack: 0, noSugaryDrink: 0 });
  assert.equal(trends.current.weight.value, 78.2);
  assert.equal(trends.current.waist.value, 94);
  assert.equal(trends.current.fluid.value, 500);
  assert.equal(trends.current.mealPhotos.value, 2);
});
