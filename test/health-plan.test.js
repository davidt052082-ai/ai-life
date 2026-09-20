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

test("daily plan exposes the reusable schedule with the day training", () => {
  const plan = getDailyPlan("2026-09-18");
  assert.deepEqual(plan.schedule.map((item) => item.id), [
    "measurement", "breakfast-photo", "morning-hydration", "lunch-photo",
    "lunch-walk", "afternoon-hydration", "dinner-photo", "dinner-walk",
    "training", "no-alcohol", "no-late-snack", "no-sugary-drink", "missing-items", "sleep-prep", "sleep"
  ]);
  assert.deepEqual(plan.schedule.find((item) => item.id === "training"), {
    id: "training", time: "20:00", label: "壶铃基础力量", frequency: "按周计划",
    detail: "训练提醒 + 完成打卡", action: "training"
  });
  assert.deepEqual(plan.schedule.filter((item) => ["no-alcohol", "no-late-snack", "no-sugary-drink"].includes(item.id)), [
    { id: "no-alcohol", time: "21:30", label: "无酒", frequency: "每天", detail: "晚间确认", action: "checkin", checkinType: "no_alcohol" },
    { id: "no-late-snack", time: "21:30", label: "无夜宵", frequency: "每天", detail: "晚间确认", action: "checkin", checkinType: "no_late_snack" },
    { id: "no-sugary-drink", time: "21:30", label: "无含糖饮料", frequency: "每天", detail: "晚间确认", action: "checkin", checkinType: "no_sugary_drink" }
  ]);
  assert.equal(plan.schedule.find((item) => item.id === "sleep").action, "reminder");
});
