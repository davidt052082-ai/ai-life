# 学习计划日期保留 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the exact date selected when creating or editing a learning plan, regardless of the server timezone.

**Architecture:** Treat PostgreSQL `date` values as calendar-only values at the repository boundary. The repository will format returned `Date` objects from their local calendar fields instead of UTC ISO serialization; string values remain unchanged.

**Tech Stack:** Node.js ESM, PostgreSQL `date`, Node built-in test runner.

---

## File structure

- Modify: `src/repositories/studyPlanRepository.js` — serialize date-only database values without UTC conversion.
- Modify: `test/study-plan-repository.test.js` — regression test for a `Date` value that would otherwise become the previous UTC date.

### Task 1: Preserve calendar dates at the repository boundary

**Files:**
- Modify: `test/study-plan-repository.test.js`
- Modify: `src/repositories/studyPlanRepository.js`

- [ ] **Step 1: Add a failing timezone regression test**

Append this test to `test/study-plan-repository.test.js`:

```js
test("repository preserves PostgreSQL date values without UTC day rollback", async () => {
  const { createStudyPlanRepository } = await import("../src/repositories/studyPlanRepository.js");
  const repository = createStudyPlanRepository({
    query: async () => ({
      rows: [{
        id: "plan-tz", person_id: "person-a", person_name: "小明", subject: "数学", location: "书房",
        start_date: new Date(2026, 8, 10), start_time: "16:30:00", end_time: "18:30:00",
        study_days: 1, rest_days: 0, target_study_days: 1, created_at: "created", updated_at: "updated"
      }],
      rowCount: 1
    })
  });

  const [plan] = await repository.listPlans({ userId: "user-a", projectId: "project-a" });
  assert.equal(plan.startDate, "2026-09-10");
});
```

- [ ] **Step 2: Run the focused test to verify it fails in a UTC+ timezone**

Run: `TZ=Asia/Shanghai node --test test/study-plan-repository.test.js`

Expected: FAIL because `Date#toISOString()` serializes local midnight as the prior UTC day.

- [ ] **Step 3: Replace UTC serialization with calendar-field formatting**

Replace `toIsoDate` in `src/repositories/studyPlanRepository.js` with:

```js
function toIsoDate(value) {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
}
```

Do not modify input validation, SQL storage, recurring-plan calculations, or client form code: they already exchange date-only `YYYY-MM-DD` values.

- [ ] **Step 4: Run focused and complete tests**

Run: `TZ=Asia/Shanghai node --test test/study-plan-repository.test.js && npm test`

Expected: the new regression test passes and the full suite reports zero failures.

- [ ] **Step 5: Commit the fix**

```bash
git add src/repositories/studyPlanRepository.js test/study-plan-repository.test.js docs/superpowers/plans/2026-09-10-study-plan-date-preservation.md
git commit -m "fix: preserve study plan start dates"
```

## Review notes

- Spec coverage: the sole task fixes date serialization and tests the exact UTC rollback case.
- Placeholder scan: no incomplete steps or unresolved decisions are present.
- Type consistency: the repository continues returning `startDate` as `YYYY-MM-DD` for both list and update responses.
