import test from "node:test";
import assert from "node:assert/strict";
import { getOutcomeStatus, weeklyExecutionScore } from "../src/health/scoring.js";

test("missing sleep weight is redistributed across available metrics", () => {
  assert.equal(weeklyExecutionScore({ cardio: 1, strength: 1, walks: 1, hydration: 1, alcoholFree: 1, sleep: null, mealPhotos: 1, waist: 1 }), 100);
});

test("non-core recovery and massage values do not affect score", () => {
  const base = { cardio: .5, strength: 0, walks: 1, hydration: 1, alcoholFree: 1, sleep: null, mealPhotos: 1, waist: 0 };
  assert.equal(weeklyExecutionScore(base), weeklyExecutionScore({ ...base, baduanjin: 1, abdominalMassage: 1 }));
});

test("four-week result needs enough observations", () => {
  assert.equal(getOutcomeStatus({ weeklyScore: 90, weights: [78.3], waists: [94] }).status, "accumulating_data");
  assert.equal(getOutcomeStatus({ weeklyScore: 90, weights: [78.3, 78.2, 78.1, 78], waists: [94, 93.8, 93.5, 92.9] }).status, "effective");
});
