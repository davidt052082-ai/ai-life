import test from "node:test";
import assert from "node:assert/strict";
import { getDailyPlan, getHighlightedTask, getPlanDate } from "../src/health/plan.js";

test("Thursday has a Baduanjin recovery task excluded from scoring", () => {
  const plan = getDailyPlan("2026-09-17");
  assert.deepEqual(plan.training, { type: "baduanjin", label: "八段锦恢复训练", minMinutes: 15, maxMinutes: 25, countsTowardScore: false });
});

test("massage task is hidden unless explicitly enabled", () => {
  assert.equal(getDailyPlan("2026-09-17").tasks.some((task) => task.id === "abdominal-massage"), false);
  assert.equal(getDailyPlan("2026-09-17", "Asia/Shanghai", { abdominalMassageEnabled: true }).tasks.some((task) => task.id === "abdominal-massage"), true);
});

test("training before the cutoff belongs to the prior plan day", () => {
  assert.equal(getPlanDate("2026-09-18T00:45:00+08:00", "workout"), "2026-09-17");
  assert.equal(getPlanDate("2026-09-18T01:00:00+08:00", "workout"), "2026-09-18");
  assert.equal(getPlanDate("2026-09-18T00:45:00+08:00", "hydration"), "2026-09-18");
});

test("lunch is highlighted in its time window", () => {
  assert.equal(getHighlightedTask("2026-09-18T12:35:00+08:00", { meals: {} })?.id, "lunch-photo");
});
