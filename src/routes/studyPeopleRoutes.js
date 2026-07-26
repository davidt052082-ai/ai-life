import { randomUUID } from "node:crypto";
import { Router } from "express";
import { requireProjectAccess, requireUser } from "../auth/middleware.js";

function messageError(message, status = 400, code = "INVALID_INPUT") { const error = new Error(message); error.status = status; error.code = code; return error; }
function readName(body) { const name = typeof body?.name === "string" ? body.name.trim() : ""; if (!name || name.length > 30) throw messageError("人物名称需为 1–30 个字符。"); return name; }
function route(handler) { return async (req, res) => { try { await handler(req, res); } catch (error) { if (error?.status && error?.code) return res.status(error.status).json({ error: error.code, message: error.message }); if (error?.code === "23505") return res.status(409).json({ error: "PERSON_NAME_CONFLICT", message: "人物名称已存在。" }); console.error("Study people API failed:", error); return res.status(500).json({ error: "STUDY_PEOPLE_FAILED", message: "人物操作失败，请稍后重试。" }); } }; }

export function createStudyPeopleRouter({ repository, projectRepository = repository, sessionService, studyPlanProjectCode }) {
  const router = Router({ mergeParams: true });
  router.use(requireUser(sessionService));
  router.use(requireProjectAccess(projectRepository));
  router.use((req, res, next) => req.params.code === studyPlanProjectCode ? next() : res.status(404).json({ error: "PROJECT_NOT_FOUND", message: "未找到学习计划项目。" }));
  router.get("/", route(async (req, res) => res.json({ people: await repository.listPeople({ userId: req.user.id, projectId: req.project.id }) })));
  router.post("/", route(async (req, res) => res.status(201).json({ person: await repository.createPerson({ id: randomUUID(), userId: req.user.id, projectId: req.project.id, name: readName(req.body) }) })));
  router.patch("/:id", route(async (req, res) => { const person = await repository.renamePerson({ id: req.params.id, userId: req.user.id, projectId: req.project.id, name: readName(req.body) }); if (!person) throw messageError("人物不存在。", 404, "PERSON_NOT_FOUND"); res.json({ person }); }));
  router.delete("/:id", route(async (req, res) => { const scope = { id: req.params.id, userId: req.user.id, projectId: req.project.id }; if (await repository.personHasPlans(scope)) throw messageError("请先删除该人物的学习计划。", 409, "PERSON_HAS_PLANS"); if (!await repository.deletePerson(scope)) throw messageError("人物不存在。", 404, "PERSON_NOT_FOUND"); res.status(204).end(); }));
  return router;
}
