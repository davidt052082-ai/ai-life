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

test("hydration route accepts 1000 ml and rejects removed 300 ml size", async () => {
  const calls = [];
  const router = createHealthRouter({ repository: { getSettings: async () => ({ timezone: "Asia/Shanghai", planDayCutoff: "01:00" }), createEvent: async (event) => { calls.push(event); return event; } }, projectRepository: {}, sessionService: {}, healthProjectCode: "health", uploadDirectory: "/tmp/ai-life-health-test" });
  const handler = router.stack.find((layer) => layer.route?.path === "/hydration").route.stack.at(-1).handle;
  const response = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  const req = (volumeMl) => ({ body: { type: "tea", volumeMl }, get: () => "key", user: { id: "u" }, project: { id: "p" } });
  const accepted = response(); await handler(req(1000), accepted);
  const rejected = response(); await handler(req(300), rejected);
  assert.equal(accepted.statusCode, 201);
  assert.equal(calls[0].payload.volumeMl, 1000);
  assert.equal(rejected.statusCode, 400);
  assert.equal(rejected.body.error, "INVALID_INPUT");
});
