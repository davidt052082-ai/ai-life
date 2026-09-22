import test from "node:test";
import assert from "node:assert/strict";
import { calculateWarnings } from "../src/task-management/warnings.js";

test("returns a dependency date warning without blocking the task", () => {
  const warnings = calculateWarnings({ people: [], tasks: [
    { id: "a", title: "需求", startDate: "2026-06-01", endDate: "2026-06-10", estimatedHours: 0, assigneeId: null },
    { id: "b", title: "测试", startDate: "2026-06-05", endDate: "2026-06-12", estimatedHours: 0, assigneeId: null }
  ], dependencies: [{ id: "edge", predecessorId: "a", successorId: "b" }] });
  assert.deepEqual(warnings.map((warning) => warning.kind), ["dependency_date"]);
  assert.deepEqual(warnings[0].taskIds, ["a", "b"]);
});

test("returns a cycle warning for a dependency loop", () => {
  const tasks = ["a", "b", "c"].map((id) => ({ id, title: id, startDate: null, endDate: null, estimatedHours: 0, assigneeId: null }));
  const dependencies = [{ id: "ab", predecessorId: "a", successorId: "b" }, { id: "bc", predecessorId: "b", successorId: "c" }, { id: "ca", predecessorId: "c", successorId: "a" }];
  assert.equal(calculateWarnings({ people: [], tasks, dependencies }).at(-1).kind, "cycle");
});

test("returns a resource warning when daily capacity is exceeded", () => {
  const warnings = calculateWarnings({ people: [{ id: "person", name: "陈晨", dailyCapacityHours: 8 }], tasks: [
    { id: "a", title: "A", assigneeId: "person", startDate: "2026-06-01", endDate: "2026-06-01", estimatedHours: 5 },
    { id: "b", title: "B", assigneeId: "person", startDate: "2026-06-01", endDate: "2026-06-01", estimatedHours: 4 }
  ], dependencies: [] });
  assert.deepEqual(warnings.map((warning) => warning.kind), ["resource_overload"]);
  assert.equal(warnings[0].personId, "person");
});
