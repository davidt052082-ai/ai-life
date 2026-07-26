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
