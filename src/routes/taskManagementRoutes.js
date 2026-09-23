import { randomUUID } from "node:crypto";
import { Router } from "express";
import { requireProjectAccess, requireUser } from "../auth/middleware.js";
import { inputError, readDependencyInput, readPersonInput, readTaskInput, readWorkspaceInput } from "../task-management/validation.js";
import { calculateWarnings } from "../task-management/warnings.js";
import { calculateEstimatedHours } from "../task-management/scheduling.js";

function route(handler) {
  return async (req, res, next) => {
    try { await handler(req, res, next); }
    catch (error) {
      if (error?.status && error?.code) res.status(error.status).json({ error: error.code, message: error.message });
      else if (error?.code === "23503") res.status(409).json({ error: "REFERENCE_CONFLICT", message: "记录仍被引用，或关联记录已发生变化，请刷新后重试。" });
      else if (error?.code === "23505") res.status(409).json({ error: "DUPLICATE_DEPENDENCY", message: "该依赖关系已存在。" });
      else {
        console.error("Task management API failed:", error);
        res.status(500).json({ error: "TASK_MANAGEMENT_SAVE_FAILED", message: "事项管理数据保存失败，请稍后重试。" });
      }
    }
  };
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createTaskManagementRouter({ repository, projectRepository = repository, sessionService, taskManagementProjectCode }) {
  const router = Router({ mergeParams: true });
  router.use(requireUser(sessionService));
  router.use(requireProjectAccess(projectRepository));
  router.use((req, res, next) => req.params.code === taskManagementProjectCode ? next() :
    res.status(404).json({ error: "PROJECT_NOT_FOUND", message: "未找到事项管理项目。" }));
  const owner = (req) => ({ userId: req.user.id, projectId: req.project.id });

  router.get("/workspaces", route(async (req, res) => {
    res.json({ workspaces: await repository.listWorkspaces(owner(req)) });
  }));
  router.post("/workspaces", route(async (req, res) => {
    const workspace = await repository.createWorkspace({
      id: randomUUID(), ...owner(req), workspace: readWorkspaceInput(req.body)
    });
    res.status(201).json({ workspace });
  }));

  const scoped = Router({ mergeParams: true });
  const context = (req) => ({ ...owner(req), workspaceId: req.params.workspaceId });
  scoped.use(route(async (req, res, next) => {
    if (!UUID.test(req.params.workspaceId)) throw inputError("项目标识无效。");
    req.taskWorkspace = await repository.findWorkspace(context(req));
    if (!req.taskWorkspace) return res.status(404).json({ error: "WORKSPACE_NOT_FOUND", message: "项目不存在或无权访问。" });
    if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS" && req.params.id && !UUID.test(req.params.id)) {
      throw inputError("记录标识无效。");
    }
    next();
  }));
  scoped.param("id", (req, res, next, id) => {
    if (!UUID.test(id)) return res.status(400).json({ error: "INVALID_INPUT", message: "记录标识无效。" });
    next();
  });
  const workspace = async (req) => {
    const value = await repository.loadWorkspace(context(req));
    return { ...value, warnings: calculateWarnings(value), project: req.taskWorkspace };
  };
  const reference = async (req, collection, id) => {
    const value = await repository.loadWorkspace(context(req));
    if (!value[collection].some((item) => item.id === id)) throw inputError("关联记录不属于当前项目。");
  };
  scoped.get("/workspace", route(async (req, res) => res.json(await workspace(req))));
  scoped.get("/people", route(async (req, res) => res.json({ people: (await workspace(req)).people })));
  scoped.post("/people", route(async (req, res) => {
    const person = await repository.createPerson({ id: randomUUID(), ...context(req), person: readPersonInput(req.body) });
    res.status(201).json({ person, workspace: await workspace(req) });
  }));
  scoped.patch("/people/:id", route(async (req, res) => {
    const person = await repository.updatePerson({ id: req.params.id, ...context(req), person: readPersonInput(req.body) });
    if (!person) return res.status(404).json({ error: "PERSON_NOT_FOUND", message: "责任人不存在。" });
    res.json({ person, workspace: await workspace(req) });
  }));
  scoped.delete("/people/:id", route(async (req, res) => {
    const person = await repository.deletePerson({ id: req.params.id, ...context(req) });
    if (!person) return res.status(404).json({ error: "PERSON_NOT_FOUND", message: "责任人不存在。" });
    res.json({ person, workspace: await workspace(req) });
  }));
  scoped.get("/tasks", route(async (req, res) => res.json({ tasks: (await workspace(req)).tasks })));
  scoped.post("/tasks", route(async (req, res) => {
    const task = readTaskInput({ ...req.body, estimatedHours: calculateEstimatedHours(req.body?.startDate, req.body?.endDate) });
    if (task.assigneeId) await reference(req, "people", task.assigneeId);
    const created = await repository.createTask({ id: randomUUID(), ...context(req), task });
    res.status(201).json({ task: created, workspace: await workspace(req) });
  }));
  scoped.patch("/tasks/:id", route(async (req, res) => {
    const task = readTaskInput(req.body);
    if (task.assigneeId) await reference(req, "people", task.assigneeId);
    const updated = await repository.updateTask({ id: req.params.id, ...context(req), task });
    if (!updated) return res.status(404).json({ error: "TASK_NOT_FOUND", message: "事项不存在。" });
    res.json({ task: updated, workspace: await workspace(req) });
  }));
  scoped.delete("/tasks/:id", route(async (req, res) => {
    const task = await repository.deleteTask({ id: req.params.id, ...context(req) });
    if (!task) return res.status(404).json({ error: "TASK_NOT_FOUND", message: "事项不存在。" });
    res.json({ task, workspace: await workspace(req) });
  }));
  scoped.get("/dependencies", route(async (req, res) => res.json({ dependencies: (await workspace(req)).dependencies })));
  scoped.post("/dependencies", route(async (req, res) => {
    const dependency = readDependencyInput(req.body);
    await reference(req, "tasks", dependency.predecessorId);
    await reference(req, "tasks", dependency.successorId);
    const created = await repository.createDependency({ id: randomUUID(), ...context(req), dependency });
    res.status(201).json({ dependency: created, workspace: await workspace(req) });
  }));
  scoped.delete("/dependencies/:id", route(async (req, res) => {
    const dependency = await repository.deleteDependency({ id: req.params.id, ...context(req) });
    if (!dependency) return res.status(404).json({ error: "DEPENDENCY_NOT_FOUND", message: "依赖关系不存在。" });
    res.json({ dependency, workspace: await workspace(req) });
  }));
  scoped.get("/logs", route(async (req, res) => res.json({ logs: await repository.listLogs(context(req)) })));
  router.use("/workspaces/:workspaceId", scoped);
  // Unscoped legacy URLs must never silently read or write another business project.
  return router;
}
