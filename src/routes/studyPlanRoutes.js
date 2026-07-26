import { randomUUID } from "node:crypto";
import { Router } from "express";
import { requireProjectAccess, requireUser } from "../auth/middleware.js";
import { validatePlanInput } from "../study-plan/schedule.js";

function inputError(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = "INVALID_INPUT";
  return error;
}

function readPlanInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw inputError("请求数据格式无效。");
  const stringFields = ["student", "subject", "location", "startDate", "startTime", "endTime"];
  if (stringFields.some((field) => typeof body[field] !== "string")) throw inputError("请求数据格式无效。");
  const numberFields = ["studyDays", "restDays", "targetStudyDays"];
  if (numberFields.some((field) => !Number.isInteger(body[field]))) throw inputError("学习与休息天数必须为整数。");

  const plan = {
    student: body.student,
    subject: body.subject.trim(),
    location: body.location.trim(),
    startDate: body.startDate,
    startTime: body.startTime,
    endTime: body.endTime,
    studyDays: body.studyDays,
    restDays: body.restDays,
    targetStudyDays: body.targetStudyDays
  };
  const message = validatePlanInput(plan);
  if (message) throw inputError(message);
  return plan;
}

function sendRouteError(res, error) {
  if (error?.status && error?.code) {
    res.status(error.status).json({ error: error.code, message: error.message });
    return;
  }
  console.error("Study plan API failed:", error);
  res.status(500).json({ error: "STUDY_PLAN_SAVE_FAILED", message: "学习计划保存失败，请稍后重试。" });
}

function route(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      sendRouteError(res, error);
    }
  };
}

export function createStudyPlanRouter({ repository, projectRepository = repository, sessionService, studyPlanProjectCode }) {
  const router = Router({ mergeParams: true });
  router.use(requireUser(sessionService));
  router.use(requireProjectAccess(projectRepository));
  router.use((req, res, next) => {
    if (req.params.code !== studyPlanProjectCode) {
      res.status(404).json({ error: "PROJECT_NOT_FOUND", message: "未找到学习计划项目。" });
      return;
    }
    next();
  });

  router.get("/", route(async (req, res) => {
    const plans = await repository.listPlans({ userId: req.user.id, projectId: req.project.id });
    res.json({ plans });
  }));

  router.post("/", route(async (req, res) => {
    const plan = readPlanInput(req.body);
    const created = await repository.createPlan({
      id: randomUUID(),
      userId: req.user.id,
      projectId: req.project.id,
      plan
    });
    res.status(201).json({ plan: created });
  }));

  router.delete("/:id", route(async (req, res) => {
    const deleted = await repository.deletePlan({
      id: req.params.id,
      userId: req.user.id,
      projectId: req.project.id
    });
    if (!deleted) {
      res.status(404).json({ error: "PLAN_NOT_FOUND", message: "学习计划不存在。" });
      return;
    }
    res.status(204).end();
  }));

  return router;
}
