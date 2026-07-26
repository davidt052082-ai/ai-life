# 学习计划自建人物 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fixed study-plan characters with account-scoped, user-created people and delete all existing study-plan records.

**Architecture:** A migration clears legacy plans, adds an account/project-scoped `study_people` table, and makes every plan refer to one person through a composite foreign key. A people repository and protected nested API manage people; the browser fetches people and plans together, dynamically renders person filters and colors, and never contains fixed-person defaults.

**Tech Stack:** PostgreSQL, Node.js ESM, Express, vanilla HTML/CSS/JavaScript, Node built-in test runner.

---

## File structure

- `db/migrations/006_custom_study_people.sql`: deletes legacy plans, adds people, and replaces `student` with scoped `person_id`.
- `src/repositories/studyPeopleRepository.js`: scoped create/list/rename/delete people persistence.
- `src/repositories/studyPlanRepository.js`: persists `personId` and joins person names on plan reads.
- `src/study-plan/schedule.js`: removes the fixed student list and validates `personId`.
- `src/routes/studyPeopleRoutes.js`: authenticated people CRUD endpoints.
- `server.js`: mounts the people API beneath the existing study-plan project route.
- `study-plan.html` and `study-plan-client.js`: people management, dynamic filters, dynamic colors, and plan selection.
- `test/custom-study-people-*.test.js`: migration, repository, API, schedule, and page regression coverage.

### Task 1: Migrate to scoped people and person-linked plans

**Files:**
- Create: `db/migrations/006_custom_study_people.sql`
- Create: `test/custom-study-people-migration.test.js`
- Modify: `test/database-config.test.js`

- [ ] **Step 1: Write failing migration tests**

```js
test("custom people migration clears legacy plans and creates a scoped person relation", async () => {
  const sql = await fs.readFile(new URL("../db/migrations/006_custom_study_people.sql", import.meta.url), "utf8");
  assert.match(sql, /DELETE FROM study_plans/);
  assert.match(sql, /CREATE TABLE study_people/);
  assert.match(sql, /UNIQUE \(id, user_id, project_id\)/);
  assert.match(sql, /DROP COLUMN student/);
  assert.match(sql, /ADD COLUMN person_id uuid/);
  assert.match(sql, /FOREIGN KEY \(person_id, user_id, project_id\)/);
});
```

Extend the migration list assertion with `"006_custom_study_people.sql"`.

- [ ] **Step 2: Run the migration tests to verify they fail**

Run: `node --test test/database-config.test.js test/custom-study-people-migration.test.js`

Expected: FAIL because migration `006` does not exist.

- [ ] **Step 3: Add the destructive, scoped migration**

```sql
DELETE FROM study_plans;

CREATE TABLE study_people (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 30),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id, project_id),
  UNIQUE (user_id, project_id, name)
);

ALTER TABLE study_plans DROP CONSTRAINT study_plans_student_check;
ALTER TABLE study_plans DROP COLUMN student;
ALTER TABLE study_plans ADD COLUMN person_id uuid NOT NULL;
ALTER TABLE study_plans ADD CONSTRAINT study_plans_person_scope_fk
  FOREIGN KEY (person_id, user_id, project_id)
  REFERENCES study_people (id, user_id, project_id)
  ON DELETE RESTRICT;
CREATE INDEX study_people_owner_created_idx ON study_people (user_id, project_id, created_at ASC);
CREATE INDEX study_plans_person_idx ON study_plans (user_id, project_id, person_id);
```

`DELETE FROM study_plans` must run before `person_id NOT NULL`; do not insert people or re-create legacy character values.

- [ ] **Step 4: Run migration tests to verify they pass**

Run: `node --test test/database-config.test.js test/custom-study-people-migration.test.js`

Expected: PASS. The next migration explicitly clears old plans and uses the scoped composite foreign key.

- [ ] **Step 5: Commit the data migration**

```bash
git add db/migrations/006_custom_study_people.sql test/database-config.test.js test/custom-study-people-migration.test.js
git commit -m "feat: replace fixed study people"
```

### Task 2: Expose scoped people and person-linked plan APIs

**Files:**
- Create: `src/repositories/studyPeopleRepository.js`
- Create: `src/routes/studyPeopleRoutes.js`
- Create: `test/custom-study-people-repository.test.js`
- Modify: `src/repositories/studyPlanRepository.js`
- Modify: `src/routes/studyPlanRoutes.js`
- Modify: `src/study-plan/schedule.js`
- Modify: `server.js`
- Modify: `test/study-plan-schedule.test.js`
- Modify: `test/study-plan-repository.test.js`

- [ ] **Step 1: Write failing person and person-ID tests**

```js
test("people queries and deletes are scoped to one account and project", async () => {
  const { createStudyPeopleRepository } = await import("../src/repositories/studyPeopleRepository.js");
  const calls = [];
  const repository = createStudyPeopleRepository({ query: async (text, values) => { calls.push({ text, values }); return { rows: [], rowCount: 0 }; } });
  await repository.deletePerson({ id: "person-a", userId: "user-a", projectId: "project-a" });
  assert.match(calls[0].text, /WHERE id = \$1 AND user_id = \$2 AND project_id = \$3/);
  assert.deepEqual(calls[0].values, ["person-a", "user-a", "project-a"]);
});

test("a plan needs a nonempty person ID instead of a fixed student name", () => {
  assert.equal(validatePlanInput({ ...basePlan, personId: "person-a" }), "");
  assert.match(validatePlanInput({ ...basePlan, personId: "" }), /人物/);
});
```

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `node --test test/custom-study-people-repository.test.js test/study-plan-schedule.test.js test/study-plan-repository.test.js`

Expected: FAIL because people persistence does not exist and plans still require `student`.

- [ ] **Step 3: Implement scoped repositories and routes**

Use this people row mapper and repository contract:

```js
function toPerson(row) { return row ? { id: row.id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at } : null; }

export function createStudyPeopleRepository(pool) {
  return {
    async listPeople({ userId, projectId }) {
      const result = await pool.query("SELECT id, name, created_at, updated_at FROM study_people WHERE user_id = $1 AND project_id = $2 ORDER BY created_at ASC, name ASC", [userId, projectId]);
      return result.rows.map(toPerson);
    },
    async createPerson({ id, userId, projectId, name }) {
      const result = await pool.query("INSERT INTO study_people (id, user_id, project_id, name) VALUES ($1, $2, $3, $4) RETURNING id, name, created_at, updated_at", [id, userId, projectId, name]);
      return toPerson(result.rows[0]);
    },
    async renamePerson({ id, userId, projectId, name }) {
      const result = await pool.query("UPDATE study_people SET name = $4, updated_at = now() WHERE id = $1 AND user_id = $2 AND project_id = $3 RETURNING id, name, created_at, updated_at", [id, userId, projectId, name]);
      return toPerson(result.rows[0]);
    },
    async deletePerson({ id, userId, projectId }) {
      const result = await pool.query("DELETE FROM study_people WHERE id = $1 AND user_id = $2 AND project_id = $3", [id, userId, projectId]);
      return result.rowCount === 1;
    },
    async personHasPlans({ id, userId, projectId }) {
      const result = await pool.query("SELECT EXISTS(SELECT 1 FROM study_plans WHERE person_id = $1 AND user_id = $2 AND project_id = $3) AS exists", [id, userId, projectId]);
      return Boolean(result.rows[0]?.exists);
    },
    async findPerson({ id, userId, projectId }) {
      const result = await pool.query("SELECT id, name, created_at, updated_at FROM study_people WHERE id = $1 AND user_id = $2 AND project_id = $3", [id, userId, projectId]);
      return toPerson(result.rows[0]);
    }
  };
}
```

The people router must use `requireUser`, `requireProjectAccess`, and the study-plan project-code guard already used by plans. It exposes `GET /`, `POST /`, `PATCH /:id`, and `DELETE /:id`; creation and rename accept only a trimmed 1–30-character `name`. `DELETE` first calls `personHasPlans`, responding `409 { error: "PERSON_HAS_PLANS", message: "请先删除该人物的学习计划。" }` when referenced.

Change plan API input from `student` to `personId`. Before create, call `peopleRepository.findPerson({ id: personId, userId, projectId })`; reject missing or cross-scope people with `400 INVALID_INPUT`. Update `studyPlanRepository` to store `person_id`, return `personId` and `personName`, and `JOIN study_people p ON p.id = sp.person_id AND p.user_id = sp.user_id AND p.project_id = sp.project_id` on plan reads. Remove `STUDENTS`; `validatePlanInput` requires only a nonempty string `personId` plus existing plan fields.

Mount `/api/projects/:code/study-plans/people` in `server.js`, injecting the people repository into plan routes and adding a database-not-configured fallback.

- [ ] **Step 4: Run focused API/model tests to verify they pass**

Run: `node --test test/custom-study-people-repository.test.js test/study-plan-schedule.test.js test/study-plan-repository.test.js`

Expected: PASS. Plans no longer expose or validate fixed student names; all people and plan SQL retains user/project boundaries.

- [ ] **Step 5: Commit data API changes**

```bash
git add src/repositories/studyPeopleRepository.js src/repositories/studyPlanRepository.js src/routes/studyPeopleRoutes.js src/routes/studyPlanRoutes.js src/study-plan/schedule.js server.js test/custom-study-people-repository.test.js test/study-plan-schedule.test.js test/study-plan-repository.test.js
git commit -m "feat: add custom study people API"
```

### Task 3: Replace fixed-person UI with dynamic people management

**Files:**
- Modify: `study-plan.html`
- Modify: `study-plan-client.js`
- Modify: `test/study-plan-page.test.js`

- [ ] **Step 1: Write failing fixed-person removal and dynamic-UI tests**

```js
test("study page manages custom people and has no fixed princess names", async () => {
  const [html, client] = await Promise.all([fs.readFile(new URL("../study-plan.html", import.meta.url), "utf8"), fs.readFile(new URL("../study-plan-client.js", import.meta.url), "utf8")]);
  assert.match(html, /人物管理/);
  assert.match(client, /people/);
  assert.match(client, /PERSON_COLORS/);
  assert.doesNotMatch(`${html}\n${client}`, /大公主|小公主/);
});
```

- [ ] **Step 2: Run the page test to verify it fails**

Run: `node --test test/study-plan-page.test.js`

Expected: FAIL because the page still contains fixed princess tabs, select options, labels, and legend.

- [ ] **Step 3: Implement people management and dynamic presentation**

Replace fixed tabs with a “总览” tab, a dynamic container `#person-tabs`, and a “日历” tab. Add a `人物管理` button and dialog that lists people, creates names, renames names, and deletes only unreferenced people. Load people and plans with `Promise.all([peopleApiFetch(), planApiFetch()])`; after every successful people mutation, refresh both collections from the server.

Use this deterministic color helper in `study-plan-client.js`:

```js
const PERSON_COLORS = ["rose", "blue", "gold", "violet", "green"];
function personColor(personId) {
  const index = state.people.findIndex((person) => person.id === personId);
  return PERSON_COLORS[Math.max(index, 0) % PERSON_COLORS.length];
}
```

Plan cards, event chips, rest notes, legends, per-person tabs, and dashboard metrics must use `personId`/`personName` and `personColor`, never fixed names. When no people exist, show an empty people-state and make the add-plan action open people management. Populate the plan form select from `state.people`, and reject save when there is no selected person. Keep the existing monthly sorting, recurring rules, API error feedback, and delete-plan confirmation.

- [ ] **Step 4: Run the page test to verify it passes**

Run: `node --test test/study-plan-page.test.js`

Expected: PASS. The static assets contain no former default-person names and include dynamic people management.

- [ ] **Step 5: Run the full test suite and migrate locally**

Run: `npm test && npm run db:migrate`

Expected: all tests pass; migration output reports success. Verify the study-plan page opens with no people and no plans, create two people, create plans for both, rename one, confirm calendar updates, then delete plans and delete the people.

- [ ] **Step 6: Commit dynamic people UI**

```bash
git add study-plan.html study-plan-client.js test/study-plan-page.test.js
git commit -m "feat: manage custom study people"
```

## Review notes

- Spec coverage: Task 1 deletes legacy plans and enforces same-account/person ownership; Task 2 provides authorized people and person-linked plan APIs; Task 3 removes every default person from the page and supplies empty-state, dynamic filtering, colors, and management.
- Type consistency: APIs use `personId` and `personName`; PostgreSQL uses `person_id`; people APIs use `id` and `name`.
- Scope: people are intentionally text-only and local to one account/project; legacy plans are intentionally unrecoverable after migration as requested.
