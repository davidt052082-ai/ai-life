import test from "node:test";
import assert from "node:assert/strict";

test("study-plan router exposes list, create, and scoped delete endpoints", async () => {
  const { createStudyPlanRouter } = await import("../src/routes/studyPlanRoutes.js");
  const router = createStudyPlanRouter({
    repository: {},
    sessionService: {},
    studyPlanProjectCode: "study-plan"
  });
  const paths = router.stack
    .filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route.methods)[0]} ${layer.route.path}`);

  assert.deepEqual(paths, ["get /", "post /", "delete /:id"]);
});

test("creating a study plan records an analytics action after the plan exists", async () => {
  const { createStudyPlanRouter } = await import("../src/routes/studyPlanRoutes.js");
  const recorded = [];
  const router = createStudyPlanRouter({
    repository: { createPlan: async () => ({ id: "1" }) },
    peopleRepository: { findPerson: async () => ({ id: "person-1" }) },
    sessionService: {},
    studyPlanProjectCode: "study-plan",
    analytics: { record: async (event) => recorded.push(event) }
  });
  const handler = router.stack.find((layer) => layer.route?.path === "/" && layer.route.methods.post).route.stack.at(-1).handle;
  const result = await invoke(handler, {
    user: { id: "5c89ac08-f7c3-43cb-8e04-8a6aa0488bed" },
    project: { id: "8c59b238-d1b7-4d67-b8fe-dfa78b11b1af", code: "study-plan" },
    body: { personId: "person-1", subject: "数学", location: "家", startDate: "2026-08-01", startTime: "09:00", endTime: "10:00", studyDays: 2, restDays: 1, targetStudyDays: 10 }
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(result.statusCode, 201);
  assert.equal(recorded[0].eventType, "study_plan_create");
});

async function invoke(handler, req) {
  const result = { statusCode: 200, body: null };
  const res = { status(code) { result.statusCode = code; return this; }, json(body) { result.body = body; return this; }, end() { return this; } };
  await handler(req, res);
  return result;
}
