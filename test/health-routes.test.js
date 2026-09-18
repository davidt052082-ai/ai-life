import test from "node:test";
import assert from "node:assert/strict";
import { createHealthRouter } from "../src/routes/healthRoutes.js";

test("health router exposes the agreed API endpoints", () => {
  const router = createHealthRouter({ repository: {}, projectRepository: {}, sessionService: {}, healthProjectCode: "health", uploadDirectory: "/tmp/ai-life-health-test" });
  const paths = router.stack.filter((layer) => layer.route).map((layer) => `${Object.keys(layer.route.methods)[0]} ${layer.route.path}`);
  assert.deepEqual(paths, ["get /today", "post /hydration", "post /checkins", "post /measurements", "post /events/:eventId/undo", "post /meals", "get /meals", "delete /meals/:id", "get /trends", "get /plan-vs-actual", "get /weekly-report", "get /settings", "patch /settings", "get /notifications", "patch /notifications/:id"]);
});

test("hydration route rejects invalid volume before persistence", async () => {
  let created = false;
  const router = createHealthRouter({ repository: { createEvent: async () => { created = true; } }, projectRepository: {}, sessionService: {}, healthProjectCode: "health", uploadDirectory: "/tmp/ai-life-health-test" });
  const handler = router.stack.find((layer) => layer.route?.path === "/hydration").route.stack.at(-1).handle;
  const result = { statusCode: 200, body: null };
  await handler({ body: { type: "water", volumeMl: -1 }, get: () => "key", user: { id: "u" }, project: { id: "p" } }, { status(code) { result.statusCode = code; return this; }, json(body) { result.body = body; return this; } });
  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error, "INVALID_INPUT");
  assert.equal(created, false);
});
