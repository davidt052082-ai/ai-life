import test from "node:test";
import assert from "node:assert/strict";
import { expandPlan, isRestDate, sortEvents, validatePlanInput } from "../src/study-plan/schedule.js";

const basePlan = {
  id: "p-1",
  student: "大公主",
  subject: "数学",
  location: "书房",
  startDate: "2026-07-10",
  startTime: "16:30",
  endTime: "18:30",
  studyDays: 5,
  restDays: 1,
  targetStudyDays: 18
};

test("five study days then one rest day produces exactly eighteen learning dates", () => {
  const events = expandPlan(basePlan);

  assert.equal(events.length, 18);
  assert.deepEqual(events.slice(0, 6).map((event) => event.date), [
    "2026-07-10", "2026-07-11", "2026-07-12", "2026-07-13", "2026-07-14", "2026-07-16"
  ]);
  assert.equal(isRestDate(basePlan, "2026-07-15"), true);
  assert.equal(isRestDate(basePlan, events.at(-1).date), false);
  assert.equal(isRestDate(basePlan, "2026-08-01"), false);
});

test("zero rest and same-day events are supported", () => {
  const daily = { ...basePlan, studyDays: 1, restDays: 0, targetStudyDays: 3 };

  assert.deepEqual(expandPlan(daily).map((event) => event.date), ["2026-07-10", "2026-07-11", "2026-07-12"]);
  assert.deepEqual(sortEvents([
    { date: "2026-07-10", startTime: "16:30", subject: "数学" },
    { date: "2026-07-10", startTime: "10:00", subject: "钢琴" }
  ]).map((event) => event.startTime), ["10:00", "16:30"]);
});

test("invalid plan fields return an API-safe Chinese error", () => {
  assert.equal(validatePlanInput(basePlan), "");
  assert.match(validatePlanInput({ ...basePlan, endTime: "15:30" }), /结束时间/);
  assert.match(validatePlanInput({ ...basePlan, studyDays: 0 }), /至少为 1/);
  assert.match(validatePlanInput({ ...basePlan, student: "其他" }), /学习者/);
});
