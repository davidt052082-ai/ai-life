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
