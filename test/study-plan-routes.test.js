import test from "node:test";
import assert from "node:assert/strict";

test("study-plan router exposes list, create, update, and scoped delete endpoints", async () => {
  const { createStudyPlanRouter } = await import("../src/routes/studyPlanRoutes.js");
  const router = createStudyPlanRouter({
    repository: {},
    sessionService: {},
    studyPlanProjectCode: "study-plan"
  });
  const paths = router.stack
    .filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route.methods)[0]} ${layer.route.path}`);

  assert.deepEqual(paths, ["get /", "post /", "patch /:id", "delete /:id"]);
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

test("updating a study plan validates the person and returns the scoped update", async () => {
  const { createStudyPlanRouter } = await import("../src/routes/studyPlanRoutes.js");
  const updates = [];
  const router = createStudyPlanRouter({
    repository: { updatePlan: async (input) => { updates.push(input); return { id: input.id, ...input.plan }; } },
    peopleRepository: { findPerson: async () => ({ id: "person-1" }) },
    sessionService: {},
    studyPlanProjectCode: "study-plan"
  });
  const handler = router.stack.find((layer) => layer.route?.path === "/:id" && layer.route.methods.patch).route.stack.at(-1).handle;
  const body = { personId: "person-1", subject: "阅读", location: "家", startDate: "2026-09-10", startTime: "19:00", endTime: "20:00", studyDays: 3, restDays: 1, targetStudyDays: 12 };
  const result = await invoke(handler, { params: { id: "plan-1" }, user: { id: "user-1" }, project: { id: "project-1" }, body });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.plan.id, "plan-1");
  assert.equal(updates[0].userId, "user-1");
  assert.equal(updates[0].projectId, "project-1");
});

test("updating a missing study plan returns PLAN_NOT_FOUND", async () => {
  const { createStudyPlanRouter } = await import("../src/routes/studyPlanRoutes.js");
  const router = createStudyPlanRouter({
    repository: { updatePlan: async () => null },
    peopleRepository: { findPerson: async () => ({ id: "person-1" }) },
    sessionService: {},
    studyPlanProjectCode: "study-plan"
  });
  const handler = router.stack.find((layer) => layer.route?.path === "/:id" && layer.route.methods.patch).route.stack.at(-1).handle;
  const result = await invoke(handler, {
    params: { id: "missing" }, user: { id: "user-1" }, project: { id: "project-1" },
    body: { personId: "person-1", subject: "阅读", location: "家", startDate: "2026-09-10", startTime: "19:00", endTime: "20:00", studyDays: 3, restDays: 1, targetStudyDays: 12 }
  });

  assert.equal(result.statusCode, 404);
  assert.equal(result.body.error, "PLAN_NOT_FOUND");
});

test("updating a study plan rejects a person outside the current account and project", async () => {
  const { createStudyPlanRouter } = await import("../src/routes/studyPlanRoutes.js");
  let updated = false;
  const router = createStudyPlanRouter({
    repository: { updatePlan: async () => { updated = true; } },
    peopleRepository: { findPerson: async () => null },
    sessionService: {},
    studyPlanProjectCode: "study-plan"
  });
  const handler = router.stack.find((layer) => layer.route?.path === "/:id" && layer.route.methods.patch).route.stack.at(-1).handle;
  const result = await invoke(handler, {
    params: { id: "plan-1" }, user: { id: "user-1" }, project: { id: "project-1" },
    body: { personId: "person-other", subject: "阅读", location: "家", startDate: "2026-09-10", startTime: "19:00", endTime: "20:00", studyDays: 3, restDays: 1, targetStudyDays: 12 }
  });

  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error, "INVALID_INPUT");
  assert.equal(updated, false);
});

async function invoke(handler, req) {
  const result = { statusCode: 200, body: null };
  const res = { status(code) { result.statusCode = code; return this; }, json(body) { result.body = body; return this; }, end() { return this; } };
  await handler(req, res);
  return result;
}
