import test from "node:test";
import assert from "node:assert/strict";
import { readDependencyInput, readPersonInput, readTaskInput } from "../src/task-management/validation.js";

function validTask(overrides = {}) {
  return {
    title: "接口联调", description: "", assigneeId: null,
    startDate: "2026-06-20", endDate: "2026-06-24",
    estimatedHours: 24, actualHours: 12, status: "in_progress",
    priority: "high", isMilestone: false, ...overrides
  };
}

test("task input keeps four task values independent", () => {
  assert.deepEqual(readTaskInput(validTask()), validTask());
});

test("task input permits an inverted date range for soft warnings", () => {
  assert.equal(readTaskInput(validTask({ startDate: "2026-06-25", endDate: "2026-06-20" })).endDate, "2026-06-20");
});

test("task input rejects malformed dates and negative hours", () => {
  assert.throws(() => readTaskInput(validTask({ startDate: "20-06-01" })), /开始日期/);
  assert.throws(() => readTaskInput(validTask({ estimatedHours: -1 })), /预计工时/);
});

test("people and dependencies validate their own fields", () => {
  assert.deepEqual(readPersonInput({ name: " 陈晨 ", color: "#38BDF8", dailyCapacityHours: 8 }), { name: "陈晨", color: "#38BDF8", dailyCapacityHours: 8 });
  assert.throws(() => readPersonInput({ name: "陈晨", color: "blue", dailyCapacityHours: 8 }), /颜色/);
  assert.throws(() => readPersonInput({ name: "陈晨", color: "#38BDF8", dailyCapacityHours: 0 }), /容量/);
  assert.deepEqual(readDependencyInput({ predecessorId: "a0a0a0a0-1111-4111-8111-111111111111", successorId: "b0b0b0b0-2222-4222-8222-222222222222" }), { predecessorId: "a0a0a0a0-1111-4111-8111-111111111111", successorId: "b0b0b0b0-2222-4222-8222-222222222222" });
});
