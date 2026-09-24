import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import pg from "pg";
import express from "express";
import { createTaskManagementRepository } from "../src/repositories/taskManagementRepository.js";
import { createTaskManagementRouter } from "../src/routes/taskManagementRoutes.js";
import { readWorkspaceInput } from "../src/task-management/validation.js";

test("project names are trimmed and invalid input is rejected", () => {
  assert.deepEqual(readWorkspaceInput({ name: " 官网改版 ", description: " 迭代 " }), { name: "官网改版", description: "迭代" });
  for (const body of [null, [], { name: "" }, { name: " " }, { name: 1 }, { name: "x".repeat(121) }, { name: "valid", description: 42 }]) {
    assert.throws(() => readWorkspaceInput(body), { code: "INVALID_INPUT" });
  }
});

// Explicit opt-in URL: run against a disposable local PostgreSQL instance only.
test("PostgreSQL migration and HTTP APIs isolate multiple task projects", {
  skip: !process.env.TEST_TASK_DATABASE_URL
}, async (t) => {
  const connectionString = process.env.TEST_TASK_DATABASE_URL;
  const schema = "tm_test_" + randomUUID().replaceAll("-", "");
  const admin = new pg.Pool({ connectionString });
  await admin.query('CREATE SCHEMA "' + schema + '"');
  const pool = new pg.Pool({ connectionString, options: "-c search_path=" + schema });
  t.after(async () => {
    await pool.end();
    await admin.query('DROP SCHEMA "' + schema + '" CASCADE');
    await admin.end();
  });
  await pool.query("CREATE TABLE users (id uuid PRIMARY KEY); CREATE TABLE projects (id uuid PRIMARY KEY, code text UNIQUE, name text, description text, route text, cover_image_url text, sort_order integer); CREATE TABLE groups (id uuid PRIMARY KEY, code text); CREATE TABLE group_project_access (group_id uuid, project_id uuid, is_enabled boolean, PRIMARY KEY(group_id, project_id));");
  const applicationId = "40c36068-6081-4a11-a1b2-7622b2058db5";
  const userId = randomUUID(), otherUserId = randomUUID();
  await pool.query("INSERT INTO users VALUES ($1),($2)", [userId, otherUserId]);
  await pool.query(await fs.readFile(new URL("../db/migrations/012_task_management.sql", import.meta.url), "utf8"));
  const personId = randomUUID(), taskId = randomUUID(), successorId = randomUUID(), dependencyId = randomUUID();
  await pool.query("INSERT INTO task_people(id,user_id,project_id,name,color) VALUES ($1,$2,$3,'旧责任人','#38BDF8')", [personId, userId, applicationId]);
  await pool.query("INSERT INTO task_items(id,user_id,project_id,title,assignee_id,start_date,end_date,estimated_hours) VALUES ($1,$2,$3,'旧事项',$4,'2026-09-20','2026-09-22',12)", [taskId, userId, applicationId, personId]);
  await pool.query("INSERT INTO task_items(id,user_id,project_id,title,start_date,end_date) VALUES ($1,$2,$3,'旧后置事项','2026-09-21','2026-09-23')", [successorId, userId, applicationId]);
  await pool.query("INSERT INTO task_dependencies(id,user_id,project_id,predecessor_id,successor_id) VALUES ($1,$2,$3,$4,$5)", [dependencyId, userId, applicationId, taskId, successorId]);
  for (const owner of [userId, otherUserId]) {
    await pool.query("INSERT INTO task_audit_logs(id,user_id,project_id,entity_type,entity_id,action,before_state) VALUES ($1,$2,$3,'task',$4,'delete',$5)",
      [randomUUID(), owner, applicationId, randomUUID(), JSON.stringify({ title: "历史记录" })]);
  }
  await pool.query("BEGIN");
  await pool.query(await fs.readFile(new URL("../db/migrations/013_task_management_workspaces.sql", import.meta.url), "utf8"));
  await pool.query("COMMIT");
  const repository = createTaskManagementRepository(pool);
  const owner = { userId, projectId: applicationId };
  const defaults = await repository.listWorkspaces(owner);
  const workspaceA = defaults[0].id;
  const otherWorkspace = (await repository.listWorkspaces({ ...owner, userId: otherUserId }))[0].id;
  await t.test("legacy tasks, people, dependencies and log-only accounts survive migration", async () => {
    assert.equal(defaults.length, 1);
    assert.equal(defaults[0].name, "默认项目");
    const old = await repository.loadWorkspace({ ...owner, workspaceId: workspaceA });
    assert.equal(old.people[0].id, personId);
    assert.equal(old.tasks.length, 2);
    assert.equal(old.tasks[0].startDate, "2026-09-20");
    assert.equal(old.dependencies[0].id, dependencyId);
    assert.equal((await repository.listLogs({ ...owner, workspaceId: workspaceA })).length, 1);
    assert.equal((await repository.listLogs({ ...owner, userId: otherUserId, workspaceId: otherWorkspace })).length, 1);
  });

  const app = express();
  app.use(express.json());
  app.use("/api/projects/:code/task-management", createTaskManagementRouter({
    repository, taskManagementProjectCode: "task-management",
    sessionService: { getCurrentUser: async (req) => req.get("x-test-user") === "none" ? null : { id: req.get("x-test-user") || userId } },
    projectRepository: { findProjectAccess: async ({ userId: id, projectCode }) => id === "denied" || projectCode !== "task-management" ? null : { id: applicationId } }
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  async function request(path, method = "GET", body, user) {
    const response = await fetch("http://127.0.0.1:" + server.address().port + "/api/projects/task-management/task-management" + path, {
      method, headers: { "Content-Type": "application/json", ...(user ? { "x-test-user": user } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }
  const a = "/workspaces/" + workspaceA;
  const created = await request("/workspaces", "POST", { name: "项目 B", description: "隔离测试" });
  assert.equal(created.status, 201);
  const workspaceB = created.body.workspace.id;
  const b = "/workspaces/" + workspaceB;
  await t.test("project listing, authentication, ownership and missing selection", async () => {
    assert.equal((await request("/workspaces")).body.workspaces.length, 2);
    assert.equal((await request("/workspaces", "GET", null, "none")).status, 401);
    assert.equal((await request("/workspaces", "GET", null, "denied")).status, 403);
    assert.equal((await request("/workspaces", "POST", { name: " " })).status, 400);
    assert.equal((await request("/workspaces/" + otherWorkspace + "/workspace")).status, 404);
    assert.equal((await request(b + "/workspace", "GET", null, otherUserId)).status, 404);
    assert.equal((await request("/workspaces/invalid/workspace")).status, 400);
    assert.equal((await request("/workspace")).status, 404);
    assert.equal((await request("/tasks", "POST", { title: "unscoped" })).status, 404);
    assert.equal((await request(b + "/workspace")).body.tasks.length, 0);
    assert.equal((await request(b + "/logs")).body.logs.length, 0);
  });
  const personB = (await request(b + "/people", "POST", { name: "责任人 B", color: "#38BDF8", dailyCapacityHours: 4 })).body.person;
  const taskInput = { title: "事项 B", description: "", assigneeId: personB.id, startDate: "2026-09-21", endDate: "2026-09-21", estimatedHours: 12, actualHours: 0, status: "not_started", priority: "medium", isMilestone: false };
  const taskBResponse = await request(b + "/tasks", "POST", taskInput);
  assert.equal(taskBResponse.status, 201);
  const taskB = taskBResponse.body.task;
  assert.equal(taskB.estimatedHours, 8, 'creation uses dates instead of client-supplied estimate');
  await t.test('date edits recalculate estimates while unrelated edits preserve them', async () => {
    const dateChanged = await request(b + '/tasks/' + taskB.id, 'PATCH', {
      ...taskInput, endDate: '2026-09-23', estimatedHours: 999
    });
    assert.equal(dateChanged.status, 200);
    assert.equal(dateChanged.body.task.estimatedHours, 24);

    const unrelated = await request(b + '/tasks/' + taskB.id, 'PATCH', {
      ...taskInput, endDate: '2026-09-23', estimatedHours: 777, status: 'in_progress'
    });
    assert.equal(unrelated.status, 200);
    assert.equal(unrelated.body.task.estimatedHours, 24);

    const reversed = await request(b + '/tasks/' + taskB.id, 'PATCH', {
      ...taskInput, startDate: '2026-09-24', endDate: '2026-09-23', estimatedHours: 777
    });
    assert.equal(reversed.status, 200);
    assert.equal(reversed.body.task.estimatedHours, 0);
    assert.ok(reversed.body.workspace.warnings.some((warning) => warning.kind === 'task_date' && warning.taskIds.includes(taskB.id)));

    const restored = await request(b + '/tasks/' + taskB.id, 'PATCH', taskInput);
    assert.equal(restored.status, 200);
    assert.equal(restored.body.task.estimatedHours, 8);
  });
  await t.test('milestones share dependency APIs, calculated hours and workspace isolation', async () => {
    const first = await request(b + '/tasks', 'POST', { ...taskInput, title: '里程碑一', assigneeId: null, isMilestone: true, endDate: '2026-09-23' });
    const second = await request(b + '/tasks', 'POST', { ...taskInput, title: '里程碑二', assigneeId: null, isMilestone: true });
    assert.equal(first.status, 201);
    assert.equal(first.body.task.estimatedHours, 24);
    assert.equal(first.body.task.isMilestone, true);
    for (const [predecessorId, successorId] of [[taskB.id, first.body.task.id], [first.body.task.id, second.body.task.id], [second.body.task.id, taskB.id]]) {
      assert.equal((await request(b + '/dependencies', 'POST', { predecessorId, successorId })).status, 201);
    }
    const workspace = (await request(b + '/workspace')).body;
    assert.equal(workspace.dependencies.length, 3);
    assert.ok(workspace.warnings.some((warning) => warning.kind === 'cycle'));
    assert.equal((await request(a + '/dependencies', 'POST', { predecessorId: taskId, successorId: first.body.task.id })).status, 400);
    for (const item of [first, second]) assert.equal((await request(b + '/tasks/' + item.body.task.id, 'DELETE')).status, 200);
    assert.equal((await request(b + '/workspace')).body.dependencies.length, 0);
    assert.equal((await request(b + '/tasks', 'POST', { ...taskInput, startDate: '2026-02-30' })).status, 400);
  });
  await t.test("cross-project mutation and reference injection are rejected", async () => {
    assert.equal((await request(b + "/tasks/" + taskId, "PATCH", taskInput)).status, 404);
    assert.equal((await request(b + "/tasks/" + taskId, "DELETE")).status, 404);
    assert.equal((await request(b + "/people/" + personId, "PATCH", { name: "forged", color: "#38BDF8", dailyCapacityHours: 8 })).status, 404);
    assert.equal((await request(b + "/people/" + personId, "DELETE")).status, 404);
    assert.equal((await request(b + "/dependencies/" + dependencyId, "DELETE")).status, 404);
    assert.equal((await request(b + "/tasks", "POST", { ...taskInput, assigneeId: personId })).status, 400);
    assert.equal((await request(b + "/tasks/" + taskB.id, "PATCH", { ...taskInput, assigneeId: personId })).status, 400);
    assert.equal((await request(b + "/dependencies", "POST", { predecessorId: taskId, successorId: taskB.id })).status, 400);
    assert.equal((await request(a + "/workspace")).body.tasks.find((task) => task.id === taskId).title, "旧事项");
    await assert.rejects(repository.createTask({ ...owner, workspaceId: workspaceB, id: randomUUID(), task: { ...taskInput, assigneeId: personId } }), { code: "23503" });
    await assert.rejects(repository.createDependency({ ...owner, workspaceId: workspaceB, id: randomUUID(), dependency: { predecessorId: taskId, successorId: taskB.id } }), { code: "23503" });
    await assert.rejects(repository.loadWorkspace(owner), /scope is required/);
  });
  await t.test("writes, soft warnings and audit history stay in the chosen project", async () => {
    assert.ok(taskBResponse.body.workspace.warnings.some((warning) => warning.kind === "resource_overload"));
    const updated = await request(b + "/tasks/" + taskB.id, "PATCH", { ...taskInput, status: "completed" });
    assert.equal(updated.body.task.status, "completed");
    const cyclic = await request(b + "/dependencies", "POST", { predecessorId: taskB.id, successorId: taskB.id });
    assert.equal(cyclic.status, 201);
    assert.ok(cyclic.body.workspace.warnings.some((warning) => warning.kind === "cycle"));
    assert.equal((await request(b + "/dependencies/" + cyclic.body.dependency.id, "DELETE")).status, 200);
    assert.equal((await request(b + "/people/" + personB.id, "DELETE")).status, 409);
    assert.equal((await request(b + "/tasks/" + taskB.id, "DELETE")).status, 200);
    assert.equal((await request(b + "/people/" + personB.id, "DELETE")).status, 200);
    const history = (await request(b + "/logs")).body.logs;
    assert.ok(history.some((log) => log.action === "delete" && log.entityType === "task" && log.beforeState.title === "事项 B" && log.afterState === null));
    assert.equal((await request(a + "/logs")).body.logs.length, 1);
    assert.equal((await request(b + "/workspace")).body.warnings.length, 0);
    const count = history.length;
    assert.equal((await request(b + "/tasks/" + taskB.id, "DELETE")).status, 404);
    assert.equal((await request(b + "/logs")).body.logs.length, count);
  });
});
