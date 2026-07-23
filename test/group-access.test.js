import test from "node:test";
import assert from "node:assert/strict";

test("project access is derived from group membership and deduplicates projects", async () => {
  const { createUserRepository } = await import("../src/repositories/userRepository.js");
  const calls = [];
  const repository = createUserRepository({
    query: async (text, values) => {
      calls.push({ text, values });
      return { rows: [] };
    }
  });

  const projects = await repository.listProjectsForUser("user-1");

  assert.deepEqual(projects, []);
  assert.match(calls[0].text, /SELECT DISTINCT/);
  assert.match(calls[0].text, /FROM user_groups ug/);
  assert.match(calls[0].text, /JOIN group_project_access gpa ON gpa\.group_id = ug\.group_id/);
  assert.match(calls[0].text, /WHERE ug\.user_id = \$1/);
  assert.deepEqual(calls[0].values, ["user-1"]);
});

test("project lookup checks group-derived access for the requested project code", async () => {
  const { createUserRepository } = await import("../src/repositories/userRepository.js");
  const calls = [];
  const repository = createUserRepository({
    query: async (text, values) => {
      calls.push({ text, values });
      return { rows: [] };
    }
  });

  const project = await repository.findProjectAccess({ userId: "user-1", projectCode: "wearable-monitoring" });

  assert.equal(project, null);
  assert.match(calls[0].text, /FROM user_groups ug/);
  assert.match(calls[0].text, /WHERE ug\.user_id = \$1/);
  assert.match(calls[0].text, /AND p\.code = \$2/);
  assert.deepEqual(calls[0].values, ["user-1", "wearable-monitoring"]);
});
