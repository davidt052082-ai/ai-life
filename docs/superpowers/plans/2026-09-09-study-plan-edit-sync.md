# Study Plan Cloud Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add editing for existing study plans while preserving AI Life authentication, project authorization, custom people, and PostgreSQL synchronization, then publish the verified update to `ai-life.top`.

**Architecture:** Extend the existing account-scoped repository and Express router with an in-place `PATCH /:id` operation. Reuse the current plan dialog for create and edit modes, keep the browser client API-backed, and deploy the changed application files through a verified Git candidate with timestamped server backups and a PM2 restart.

**Tech Stack:** Node.js, Express, PostgreSQL, browser ES modules, Node test runner, Git, PM2, Nginx.

---

## File map

- Modify `src/repositories/studyPlanRepository.js`: add the account/project-scoped plan update query.
- Modify `src/routes/studyPlanRoutes.js`: expose and validate `PATCH /:id`.
- Modify `study-plan.html`: add edit-state labels and accessible interactive-card styling.
- Modify `study-plan-client.js`: open, populate, submit, cancel, and refresh edit state through the API.
- Modify `test/study-plan-repository.test.js`: prove update scope and row mapping.
- Modify `test/study-plan-routes.test.js`: prove PATCH registration, success, validation, and not-found behavior.
- Modify `test/study-plan-page.test.js`: prove the UI exposes editing without introducing local storage.

### Task 1: Add account-scoped repository updates

**Files:**
- Modify: `test/study-plan-repository.test.js`
- Modify: `src/repositories/studyPlanRepository.js`

- [ ] **Step 1: Write the failing repository test**

Append a test that records the SQL call and verifies all ownership keys and editable values:

```js
test("updating a plan preserves ownership scope and maps the returned plan", async () => {
  const { createStudyPlanRepository } = await import("../src/repositories/studyPlanRepository.js");
  const calls = [];
  const repository = createStudyPlanRepository({
    query: async (text, values) => {
      calls.push({ text, values });
      return {
        rows: [{
          id: "plan-a", person_id: "person-b", person_name: "小红", subject: "阅读", location: "书房",
          start_date: "2026-09-10", start_time: "19:00:00", end_time: "20:00:00",
          study_days: 3, rest_days: 1, target_study_days: 12,
          created_at: "created", updated_at: "updated"
        }],
        rowCount: 1
      };
    }
  });
  const plan = {
    personId: "person-b", subject: "阅读", location: "书房", startDate: "2026-09-10",
    startTime: "19:00", endTime: "20:00", studyDays: 3, restDays: 1, targetStudyDays: 12
  };

  const updated = await repository.updatePlan({ id: "plan-a", userId: "user-a", projectId: "project-a", plan });

  assert.match(calls[0].text, /WHERE id = \$1 AND user_id = \$2 AND project_id = \$3/);
  assert.deepEqual(calls[0].values, [
    "plan-a", "user-a", "project-a", "person-b", "阅读", "书房", "2026-09-10",
    "19:00", "20:00", 3, 1, 12
  ]);
  assert.equal(updated.id, "plan-a");
  assert.equal(updated.personName, "小红");
  assert.equal(updated.createdAt, "created");
});
```

- [ ] **Step 2: Run the repository test and verify it fails**

Run:

```bash
node --test test/study-plan-repository.test.js
```

Expected: FAIL with `repository.updatePlan is not a function`.

- [ ] **Step 3: Implement the scoped update query**

Add this method inside the returned repository object in `src/repositories/studyPlanRepository.js`:

```js
async updatePlan({ id, userId, projectId, plan }) {
  const result = await pool.query(
    `WITH updated AS (
       UPDATE study_plans
       SET person_id = $4, subject = $5, location = $6,
           start_date = $7, start_time = $8, end_time = $9,
           study_days = $10, rest_days = $11, target_study_days = $12,
           updated_at = now()
       WHERE id = $1 AND user_id = $2 AND project_id = $3
       RETURNING *
     )
     SELECT ${PLAN_FIELDS}
     FROM updated sp
     JOIN study_people p ON p.id = sp.person_id AND p.user_id = sp.user_id AND p.project_id = sp.project_id`,
    [
      id, userId, projectId, plan.personId, plan.subject, plan.location,
      plan.startDate, plan.startTime, plan.endTime,
      plan.studyDays, plan.restDays, plan.targetStudyDays
    ]
  );
  return toStudyPlan(result.rows[0]);
},
```

- [ ] **Step 4: Run the repository test and verify it passes**

Run:

```bash
node --test test/study-plan-repository.test.js
```

Expected: all repository tests PASS.

- [ ] **Step 5: Commit the repository slice**

```bash
git add src/repositories/studyPlanRepository.js test/study-plan-repository.test.js
git commit -m "feat: update synchronized study plans"
```

### Task 2: Expose the validated PATCH route

**Files:**
- Modify: `test/study-plan-routes.test.js`
- Modify: `src/routes/studyPlanRoutes.js`

- [ ] **Step 1: Extend the route-registration test**

Change the expected route list to:

```js
assert.deepEqual(paths, ["get /", "post /", "patch /:id", "delete /:id"]);
```

Add tests that invoke the PATCH handler directly:

```js
test("updating a study plan validates the person and returns the scoped update", async () => {
  const { createStudyPlanRouter } = await import("../src/routes/studyPlanRoutes.js");
  const updates = [];
  const router = createStudyPlanRouter({
    repository: { updatePlan: async (input) => { updates.push(input); return { id: input.id, ...input.plan }; } },
    peopleRepository: { findPerson: async () => ({ id: "person-1" }) },
    sessionService: {},
    studyPlanProjectCode: "study-plan"
  });
  const handler = router.stack.find((layer) => layer.route?.path === "/:id" && layer.route.methods.patch).route.stack.at(-1).handle;
  const body = { personId: "person-1", subject: "阅读", location: "家", startDate: "2026-09-10", startTime: "19:00", endTime: "20:00", studyDays: 3, restDays: 1, targetStudyDays: 12 };
  const result = await invoke(handler, { params: { id: "plan-1" }, user: { id: "user-1" }, project: { id: "project-1" }, body });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.plan.id, "plan-1");
  assert.equal(updates[0].userId, "user-1");
  assert.equal(updates[0].projectId, "project-1");
});

test("updating a missing study plan returns PLAN_NOT_FOUND", async () => {
  const { createStudyPlanRouter } = await import("../src/routes/studyPlanRoutes.js");
  const router = createStudyPlanRouter({
    repository: { updatePlan: async () => null },
    peopleRepository: { findPerson: async () => ({ id: "person-1" }) },
    sessionService: {},
    studyPlanProjectCode: "study-plan"
  });
  const handler = router.stack.find((layer) => layer.route?.path === "/:id" && layer.route.methods.patch).route.stack.at(-1).handle;
  const result = await invoke(handler, {
    params: { id: "missing" }, user: { id: "user-1" }, project: { id: "project-1" },
    body: { personId: "person-1", subject: "阅读", location: "家", startDate: "2026-09-10", startTime: "19:00", endTime: "20:00", studyDays: 3, restDays: 1, targetStudyDays: 12 }
  });

  assert.equal(result.statusCode, 404);
  assert.equal(result.body.error, "PLAN_NOT_FOUND");
});
```

- [ ] **Step 2: Run the route test and verify it fails**

Run:

```bash
node --test test/study-plan-routes.test.js
```

Expected: FAIL because `patch /:id` is absent.

- [ ] **Step 3: Implement the PATCH route**

Insert before the delete route in `src/routes/studyPlanRoutes.js`:

```js
router.patch("/:id", route(async (req, res) => {
  const plan = readPlanInput(req.body);
  const person = await peopleRepository.findPerson({
    id: plan.personId,
    userId: req.user.id,
    projectId: req.project.id
  });
  if (!person) throw inputError("请选择当前账号的人物。");
  const updated = await repository.updatePlan({
    id: req.params.id,
    userId: req.user.id,
    projectId: req.project.id,
    plan
  });
  if (!updated) {
    res.status(404).json({ error: "PLAN_NOT_FOUND", message: "学习计划不存在。" });
    return;
  }
  res.json({ plan: updated });
}));
```

- [ ] **Step 4: Run route and repository tests**

Run:

```bash
node --test test/study-plan-routes.test.js test/study-plan-repository.test.js
```

Expected: all tests PASS.

- [ ] **Step 5: Commit the API slice**

```bash
git add src/routes/studyPlanRoutes.js test/study-plan-routes.test.js
git commit -m "feat: expose study plan editing API"
```

### Task 3: Reuse the plan dialog for editing

**Files:**
- Modify: `test/study-plan-page.test.js`
- Modify: `study-plan.html`
- Modify: `study-plan-client.js`

- [ ] **Step 1: Write the failing page assertions**

Add these assertions to the existing page test:

```js
assert.match(html, /id="plan-dialog-title"/);
assert.match(html, /id="save-plan"/);
assert.match(client, /editingPlanId/);
assert.match(client, /editingPlanId \? "PATCH" : "POST"/);
assert.match(client, /data-edit-plan/);
assert.match(client, /编辑学习计划/);
```

- [ ] **Step 2: Run the page test and verify it fails**

Run:

```bash
node --test test/study-plan-page.test.js
```

Expected: FAIL because edit state and PATCH submission are absent.

- [ ] **Step 3: Add accessible edit affordances to the HTML**

In `study-plan.html`, give the plan heading an ID:

```html
<h2 id="plan-dialog-title">新增学习计划</h2>
```

Extend `.plan-card` styles with keyboard and hover feedback:

```css
.plan-card[data-edit-plan] { cursor:pointer; }
.plan-card[data-edit-plan]:hover { border-color:#cbd7ed; box-shadow:0 6px 16px rgba(60,75,110,.08); }
.plan-card[data-edit-plan]:focus-visible { outline:3px solid #bfd0ff; outline-offset:2px; }
```

- [ ] **Step 4: Add explicit create/edit state to the client**

Near the existing state declarations in `study-plan-client.js`, add:

```js
let editingPlanId = "";
const planDialogTitle = document.querySelector("#plan-dialog-title");
const savePlanButton = document.querySelector("#save-plan");
```

Render each plan card as an accessible edit target while retaining the nested delete button:

```js
<article class="plan-card ${personColor(plan.personId)}" data-edit-plan="${plan.id}" tabindex="0" role="button" aria-label="编辑${escapeHtml(personName(plan.personId))}的${escapeHtml(plan.subject)}计划">
```

Replace `openPlan()` with a create/edit-aware version:

```js
function openPlan(planId = "") {
  if (!state.people.length) return openPeople();
  const plan = state.plans.find((item) => item.id === planId) || null;
  editingPlanId = plan?.id || "";
  const select = document.querySelector("#person");
  select.innerHTML = state.people.map((person) => `<option value="${person.id}">${escapeHtml(person.name)}</option>`).join("");
  planForm.reset();
  planDialogTitle.textContent = plan ? "编辑学习计划" : "新增学习计划";
  savePlanButton.textContent = plan ? "保存修改" : "保存计划";
  document.querySelector("#form-error").textContent = "";
  document.querySelector("#person").value = plan?.personId || state.people[0].id;
  document.querySelector("#subject").value = plan?.subject || "";
  document.querySelector("#location").value = plan?.location || "";
  document.querySelector("#start-date").value = plan?.startDate || toIsoDate(new Date());
  document.querySelector("#start-time").value = plan?.startTime || "";
  document.querySelector("#end-time").value = plan?.endTime || "";
  document.querySelector("#study-days").value = plan?.studyDays ?? 5;
  document.querySelector("#rest-days").value = plan?.restDays ?? 1;
  document.querySelector("#target-days").value = plan?.targetStudyDays ?? 18;
  planDialog.showModal();
}

function closePlan() {
  editingPlanId = "";
  planDialog.close();
}
```

In the submit handler, select POST or PATCH before calling `api`:

```js
const path = editingPlanId ? `/${editingPlanId}` : "";
const method = editingPlanId ? "PATCH" : "POST";
const response = await api(path, { method, body: JSON.stringify(plan) });
if (!response.ok) return document.querySelector("#form-error").textContent = await errorMessage(response, "保存失败。");
editingPlanId = "";
planDialog.close();
await refresh();
```

In the document click handler, open editing only when the nested delete button was not clicked:

```js
const edit = event.target.closest("[data-edit-plan]");
if (edit && !event.target.closest("[data-delete]")) {
  openPlan(edit.dataset.editPlan);
  return;
}
```

Add keyboard activation:

```js
document.addEventListener("keydown", (event) => {
  const edit = event.target.closest("[data-edit-plan]");
  if (edit && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    openPlan(edit.dataset.editPlan);
  }
});
```

Change the close and cancel handlers to use `closePlan`:

```js
document.querySelector("#close-plan-dialog").onclick = closePlan;
document.querySelector("#cancel-plan").onclick = closePlan;
```

- [ ] **Step 5: Run focused browser-client tests**

Run:

```bash
node --test test/study-plan-page.test.js test/project-pages.test.js test/study-plan-schedule.test.js
```

Expected: all focused tests PASS and no assertion finds `localStorage` or hard-coded people names.

- [ ] **Step 6: Commit the client slice**

```bash
git add study-plan.html study-plan-client.js test/study-plan-page.test.js
git commit -m "feat: edit synchronized study plans"
```

### Task 4: Run full regression and prepare the release

**Files:**
- Verify all tracked files changed by Tasks 1-3.

- [ ] **Step 1: Run the complete test suite**

Run:

```bash
npm test
```

Expected: every test PASS; zero failures, cancellations, or skipped tests introduced by this change.

- [ ] **Step 2: Check formatting and the exact release diff**

Run:

```bash
git diff --check HEAD~3..HEAD
git status --short
git diff --stat HEAD~3..HEAD
```

Expected: no whitespace errors; only the seven implementation/test files plus the previously approved design and plan documents are related to this work. Existing unrelated untracked files remain untouched.

- [ ] **Step 3: Record release hashes**

Run:

```bash
shasum -a 256 study-plan.html study-plan-client.js src/routes/studyPlanRoutes.js src/repositories/studyPlanRepository.js
stat -f '%N %z' study-plan.html study-plan-client.js src/routes/studyPlanRoutes.js src/repositories/studyPlanRepository.js
```

Expected: four non-empty SHA-256 values and byte sizes to use for server candidate verification.

- [ ] **Step 4: Push the implementation commits**

Run:

```bash
git push origin main
```

Expected: `main` advances to the final implementation commit without force-push.

### Task 5: Publish safely to ai-life.top

**Files:**
- Replace on server: `/opt/ai-life/study-plan.html`
- Replace on server: `/opt/ai-life/study-plan-client.js`
- Replace on server: `/opt/ai-life/src/routes/studyPlanRoutes.js`
- Replace on server: `/opt/ai-life/src/repositories/studyPlanRepository.js`

- [ ] **Step 1: Fetch a clean server candidate**

In the authenticated Tencent Cloud terminal, run:

```bash
git clone --depth 1 https://github.com/davidt052082-ai/ai-life.git /tmp/ai-life-study-edit-20260909
```

Expected: clone completes without authentication or partial-transfer errors.

- [ ] **Step 2: Verify all candidate hashes before touching production**

Run:

```bash
sha256sum /tmp/ai-life-study-edit-20260909/study-plan.html /tmp/ai-life-study-edit-20260909/study-plan-client.js /tmp/ai-life-study-edit-20260909/src/routes/studyPlanRoutes.js /tmp/ai-life-study-edit-20260909/src/repositories/studyPlanRepository.js
```

Expected: every value exactly matches the corresponding local release hash from Task 4.

- [ ] **Step 3: Stage files in the production directory and validate JavaScript syntax**

Run:

```bash
sudo cp /tmp/ai-life-study-edit-20260909/study-plan.html /opt/ai-life/study-plan.html.new
sudo cp /tmp/ai-life-study-edit-20260909/study-plan-client.js /opt/ai-life/study-plan-client.js.new
sudo cp /tmp/ai-life-study-edit-20260909/src/routes/studyPlanRoutes.js /opt/ai-life/src/routes/studyPlanRoutes.js.new
sudo cp /tmp/ai-life-study-edit-20260909/src/repositories/studyPlanRepository.js /opt/ai-life/src/repositories/studyPlanRepository.js.new
sudo chown root:root /opt/ai-life/study-plan.html.new /opt/ai-life/study-plan-client.js.new /opt/ai-life/src/routes/studyPlanRoutes.js.new /opt/ai-life/src/repositories/studyPlanRepository.js.new
sudo chmod 644 /opt/ai-life/study-plan.html.new /opt/ai-life/study-plan-client.js.new /opt/ai-life/src/routes/studyPlanRoutes.js.new /opt/ai-life/src/repositories/studyPlanRepository.js.new
node --check /opt/ai-life/study-plan-client.js.new
node --check /opt/ai-life/src/routes/studyPlanRoutes.js.new
node --check /opt/ai-life/src/repositories/studyPlanRepository.js.new
```

Expected: all syntax checks exit successfully.

- [ ] **Step 4: Back up and switch the four production files**

Use one deployment timestamp for all files:

```bash
study_edit_stamp=$(date +%Y%m%d-%H%M%S)
sudo mv /opt/ai-life/study-plan.html /opt/ai-life/study-plan.html.backup-$study_edit_stamp
sudo mv /opt/ai-life/study-plan-client.js /opt/ai-life/study-plan-client.js.backup-$study_edit_stamp
sudo mv /opt/ai-life/src/routes/studyPlanRoutes.js /opt/ai-life/src/routes/studyPlanRoutes.js.backup-$study_edit_stamp
sudo mv /opt/ai-life/src/repositories/studyPlanRepository.js /opt/ai-life/src/repositories/studyPlanRepository.js.backup-$study_edit_stamp
sudo mv /opt/ai-life/study-plan.html.new /opt/ai-life/study-plan.html
sudo mv /opt/ai-life/study-plan-client.js.new /opt/ai-life/study-plan-client.js
sudo mv /opt/ai-life/src/routes/studyPlanRoutes.js.new /opt/ai-life/src/routes/studyPlanRoutes.js
sudo mv /opt/ai-life/src/repositories/studyPlanRepository.js.new /opt/ai-life/src/repositories/studyPlanRepository.js
```

Expected: all live paths exist and all timestamped backups remain available.

- [ ] **Step 5: Restart the discovered PM2 application**

Run:

```bash
pm2 restart ai-life --update-env
pm2 status ai-life
```

Expected: `ai-life` returns to `online` with a new process ID and no restart error.

- [ ] **Step 6: Verify live files, local application behavior, and public HTTPS**

Run on the server:

```bash
sha256sum /opt/ai-life/study-plan.html /opt/ai-life/study-plan-client.js /opt/ai-life/src/routes/studyPlanRoutes.js /opt/ai-life/src/repositories/studyPlanRepository.js
curl -sS -I http://127.0.0.1:5173/projects/study-plan | head -n 8
curl -sS http://127.0.0.1:5173/study-plan-client.js | sha256sum
curl -sS -I https://ai-life.top/projects/study-plan | head -n 8
curl -sS -L https://ai-life.top/study-plan-client.js | sha256sum
```

Expected: live file hashes match Task 4; unauthenticated project requests return the existing login redirect; the client script returns `200` and its local/public body hash matches the release.

- [ ] **Step 7: Roll back immediately if verification fails**

If any hash, syntax, process, or response check fails, stop the new process, move the failed files aside with `.failed-$study_edit_stamp`, restore all four `.backup-$study_edit_stamp` files to their original paths, then run:

```bash
pm2 restart ai-life --update-env
pm2 status ai-life
curl -sS -I https://ai-life.top/projects/study-plan | head -n 8
```

Expected: the previous version is online and the protected route behaves as it did before deployment.
