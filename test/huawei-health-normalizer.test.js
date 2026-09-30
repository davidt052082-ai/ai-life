import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDailyGroup } from "../src/integrations/huawei-health/normalizer.js";

test("daily normalizer maps approved Huawei values", () => {
  assert.deepEqual(normalizeDailyGroup({ localDate: "2026-09-28", values: { steps: 8624, calories: 516, intensityMinutes: 47, weightKg: 78.4, sleepMinutes: 432, restingHr: 62 } }), { localDate: "2026-09-28", steps: 8624, activeCaloriesKcal: 516, exerciseMinutes: 47, weightKg: 78.4, sleepMinutes: 432, deepSleepMinutes: null, restingHr: 62 });
});
