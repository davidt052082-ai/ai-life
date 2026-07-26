import test from "node:test";
import assert from "node:assert/strict";

test("study people are always queried within the current user and project", async () => {
  const { createStudyPeopleRepository } = await import("../src/repositories/studyPeopleRepository.js");
  const calls = [];
  const repository = createStudyPeopleRepository({
    query: async (text, values) => {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 };
    }
  });

  await repository.listPeople({ userId: "user-a", projectId: "project-a" });
  await repository.personHasPlans({ id: "person-a", userId: "user-a", projectId: "project-a" });
  await repository.deletePerson({ id: "person-a", userId: "user-a", projectId: "project-a" });

  assert.match(calls[0].text, /WHERE user_id = \$1 AND project_id = \$2/);
  assert.deepEqual(calls[0].values, ["user-a", "project-a"]);
  assert.match(calls[1].text, /person_id = \$1 AND user_id = \$2 AND project_id = \$3/);
  assert.deepEqual(calls[1].values, ["person-a", "user-a", "project-a"]);
  assert.match(calls[2].text, /WHERE id = \$1 AND user_id = \$2 AND project_id = \$3/);
  assert.deepEqual(calls[2].values, ["person-a", "user-a", "project-a"]);
});

test("study people router exposes scoped CRUD endpoints", async () => {
  const { createStudyPeopleRouter } = await import("../src/routes/studyPeopleRoutes.js");
  const router = createStudyPeopleRouter({
    repository: {},
    sessionService: {},
    studyPlanProjectCode: "study-plan"
  });
  const paths = router.stack
    .filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route.methods)[0]} ${layer.route.path}`);

  assert.deepEqual(paths, ["get /", "post /", "patch /:id", "delete /:id"]);
});
