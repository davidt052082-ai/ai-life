import { randomUUID } from "node:crypto";
import { Router } from "express";
import { requireProjectAccess, requireUser } from "../auth/middleware.js";
import { inputError, readDependencyInput, readPersonInput, readTaskInput } from "../task-management/validation.js";
import { calculateWarnings } from "../task-management/warnings.js";

function route(handler) { return async (req, res) => { try { await handler(req, res); } catch (error) { if (error?.status && error?.code) res.status(error.status).json({ error: error.code, message: error.message }); else if (error?.code === "23503") res.status(409).json({ error: "PERSON_IN_USE", message: "该负责人仍被事项使用，无法删除。" }); else { console.error("Task management API failed:", error); res.status(500).json({ error: "TASK_MANAGEMENT_SAVE_FAILED", message: "事项管理数据保存失败，请稍后重试。" }); } }; }; }

export function createTaskManagementRouter({ repository, projectRepository = repository, sessionService, taskManagementProjectCode }) {
  const router = Router({ mergeParams: true });
  router.use(requireUser(sessionService));
  router.use(requireProjectAccess(projectRepository));
  router.use((req, res, next) => req.params.code === taskManagementProjectCode ? next() : res.status(404).json({ error: "PROJECT_NOT_FOUND", message: "未找到事项管理项目。" }));
  const context = (req) => ({ userId: req.user.id, projectId: req.project.id });
  const workspace = async (req) => { const value = await repository.loadWorkspace(context(req)); return { ...value, warnings: calculateWarnings(value) }; };
  const sendWorkspace = (status, key) => route(async (req, res) => { const value = await workspace(req); res.status(status).json({ ...(key ? { [key]: req.result } : {}), workspace: value }); });
  const requireScopedTask = async (req, id) => { const value = await repository.loadWorkspace(context(req)); if (!value.tasks.some((task) => task.id === id)) throw inputError("事项不属于当前项目。"); };
  const requireScopedPerson = async (req, id) => { const value = await repository.loadWorkspace(context(req)); if (!value.people.some((person) => person.id === id)) throw inputError("负责人不属于当前项目。"); };
  router.get("/workspace", route(async (req, res) => res.json(await workspace(req))));
  router.get("/people", route(async (req, res) => res.json({ people: (await workspace(req)).people })));
  router.post("/people", route(async (req, res) => { req.result = await repository.createPerson({ id: randomUUID(), ...context(req), person: readPersonInput(req.body) }); const value = await workspace(req); res.status(201).json({ person: req.result, workspace: value }); }));
  router.patch("/people/:id", route(async (req, res) => { const person = await repository.updatePerson({ id: req.params.id, ...context(req), person: readPersonInput(req.body) }); if (!person) return res.status(404).json({ error: "PERSON_NOT_FOUND", message: "负责人不存在。" }); res.json({ person, workspace: await workspace(req) }); }));
  router.delete("/people/:id", route(async (req, res) => { const person = await repository.deletePerson({ id: req.params.id, ...context(req) }); if (!person) return res.status(404).json({ error: "PERSON_NOT_FOUND", message: "负责人不存在。" }); res.json({ person, workspace: await workspace(req) }); }));
  router.get("/tasks", route(async (req, res) => res.json({ tasks: (await workspace(req)).tasks })));
  router.post("/tasks", route(async (req, res) => { const task = readTaskInput(req.body); if (task.assigneeId) await requireScopedPerson(req, task.assigneeId); const created = await repository.createTask({ id: randomUUID(), ...context(req), task }); res.status(201).json({ task: created, workspace: await workspace(req) }); }));
  router.patch("/tasks/:id", route(async (req, res) => { const task = readTaskInput(req.body); if (task.assigneeId) await requireScopedPerson(req, task.assigneeId); const updated = await repository.updateTask({ id: req.params.id, ...context(req), task }); if (!updated) return res.status(404).json({ error: "TASK_NOT_FOUND", message: "事项不存在。" }); res.json({ task: updated, workspace: await workspace(req) }); }));
  router.delete("/tasks/:id", route(async (req, res) => { const task = await repository.deleteTask({ id: req.params.id, ...context(req) }); if (!task) return res.status(404).json({ error: "TASK_NOT_FOUND", message: "事项不存在。" }); res.json({ task, workspace: await workspace(req) }); }));
  router.get("/dependencies", route(async (req, res) => res.json({ dependencies: (await workspace(req)).dependencies })));
  router.post("/dependencies", route(async (req, res) => { const dependency = readDependencyInput(req.body); await requireScopedTask(req, dependency.predecessorId); await requireScopedTask(req, dependency.successorId); const created = await repository.createDependency({ id: randomUUID(), ...context(req), dependency }); res.status(201).json({ dependency: created, workspace: await workspace(req) }); }));
  router.delete("/dependencies/:id", route(async (req, res) => { const dependency = await repository.deleteDependency({ id: req.params.id, ...context(req) }); if (!dependency) return res.status(404).json({ error: "DEPENDENCY_NOT_FOUND", message: "依赖关系不存在。" }); res.json({ dependency, workspace: await workspace(req) }); }));
  router.get("/logs", route(async (req, res) => res.json({ logs: await repository.listLogs(context(req)) })));
  return router;
}
