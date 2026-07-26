import test from "node:test";
import assert from "node:assert/strict";

test("study-plan queries are always scoped to the owning user and project", async () => {
  const { createStudyPlanRepository } = await import("../src/repositories/studyPlanRepository.js");
  const calls = [];
  const repository = createStudyPlanRepository({
    query: async (text, values) => {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 };
    }
  });

  await repository.listPlans({ userId: "user-a", projectId: "project-a" });
  await repository.deletePlan({ id: "plan-a", userId: "user-a", projectId: "project-a" });

  assert.match(calls[0].text, /WHERE user_id = \$1 AND project_id = \$2/);
  assert.deepEqual(calls[0].values, ["user-a", "project-a"]);
  assert.match(calls[1].text, /WHERE id = \$1 AND user_id = \$2 AND project_id = \$3/);
  assert.deepEqual(calls[1].values, ["plan-a", "user-a", "project-a"]);
});

test("repository maps PostgreSQL rows to browser plan fields", async () => {
  const { createStudyPlanRepository } = await import("../src/repositories/studyPlanRepository.js");
  const repository = createStudyPlanRepository({
    query: async () => ({
      rows: [{
        id: "plan-a", student: "小公主", subject: "钢琴", location: "教室",
        start_date: "2026-07-10T00:00:00.000Z", start_time: "10:00:00", end_time: "11:00:00",
        study_days: 1, rest_days: 0, target_study_days: 3, created_at: "created", updated_at: "updated"
      }],
      rowCount: 1
    })
  });

  const [plan] = await repository.listPlans({ userId: "user-a", projectId: "project-a" });
  assert.deepEqual(plan, {
    id: "plan-a", student: "小公主", subject: "钢琴", location: "教室",
    startDate: "2026-07-10", startTime: "10:00", endTime: "11:00",
    studyDays: 1, restDays: 0, targetStudyDays: 3, createdAt: "created", updatedAt: "updated"
  });
});
