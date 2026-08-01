import test from "node:test";
import assert from "node:assert/strict";

test("wearable router exposes state, equipment, scheme, and migration endpoints", async () => {
  const { createWearableRouter } = await import("../src/routes/wearableRoutes.js");
  const router = createWearableRouter({
    repository: {},
    sessionService: {},
    wearableProjectCode: "wearable-monitoring"
  });
  const paths = router.stack.filter((layer) => layer.route).map((layer) => `${Object.keys(layer.route.methods)[0]} ${layer.route.path}`);

  assert.deepEqual(paths, [
    "get /state",
    "put /state",
    "get /equipment",
    "post /equipment",
    "patch /equipment/:id",
    "delete /equipment/:id",
    "get /schemes",
    "post /schemes",
    "delete /schemes/:id",
    "post /migrate-local-data"
  ]);
});

test("adding equipment and saving a scheme records analytics only after success", async () => {
  const { createWearableRouter } = await import("../src/routes/wearableRoutes.js");
  const recorded = [];
  const router = createWearableRouter({
    repository: {
      createEquipment: async () => ({ id: "custom-device", version: 1 }),
      createScheme: async () => ({ id: "scheme-device", version: 1 })
    },
    sessionService: {},
    wearableProjectCode: "wearable-monitoring",
    analytics: { record: async (event) => recorded.push(event) }
  });
  const equipment = router.stack.find((layer) => layer.route?.path === "/equipment" && layer.route.methods.post).route.stack.at(-1).handle;
  const scheme = router.stack.find((layer) => layer.route?.path === "/schemes" && layer.route.methods.post).route.stack.at(-1).handle;
  const user = { id: "5c89ac08-f7c3-43cb-8e04-8a6aa0488bed" };
  const project = { id: "8c59b238-d1b7-4d67-b8fe-dfa78b11b1af", code: "wearable-monitoring" };

  const first = await invoke(equipment, { user, project, body: { id: "custom-device", data: { name: "设备" } } });
  const second = await invoke(scheme, { user, project, body: { title: "方案", evaluation: {}, snapshot: {} } });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 201);
  assert.deepEqual(recorded.map((event) => event.eventType), ["wearable_equipment_add", "wearable_scheme_save"]);
  assert.equal(recorded[0].properties.sourceType, "custom");
});

async function invoke(handler, req) {
  const result = { statusCode: 200, body: null };
  const res = {
    status(code) { result.statusCode = code; return this; },
    json(body) { result.body = body; return this; },
    end() { return this; }
  };
  await handler(req, res);
  return result;
}
