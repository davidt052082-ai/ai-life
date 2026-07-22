import { randomUUID } from "node:crypto";
import { Router } from "express";
import { requireProjectAccess, requireUser } from "../auth/middleware.js";
import { VersionConflictError, WearableNotFoundError } from "../repositories/wearableRepository.js";

function expectObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    const error = new Error(`${name} 格式无效。`);
    error.status = 400;
    error.code = "INVALID_INPUT";
    throw error;
  }
  return value;
}

function expectArray(value, name) {
  if (!Array.isArray(value)) {
    const error = new Error(`${name} 格式无效。`);
    error.status = 400;
    error.code = "INVALID_INPUT";
    throw error;
  }
  return value;
}

function expectVersion(value) {
  if (!Number.isInteger(value) || value < 1) {
    const error = new Error("version 必须为正整数。");
    error.status = 400;
    error.code = "INVALID_VERSION";
    throw error;
  }
  return value;
}

function sendRouteError(res, error) {
  if (error instanceof VersionConflictError) {
    res.status(409).json({ error: error.code, message: error.message, currentVersion: error.currentVersion });
    return;
  }
  if (error instanceof WearableNotFoundError) {
    res.status(404).json({ error: error.code, message: error.message });
    return;
  }
  if (error.status && error.code) {
    res.status(error.status).json({ error: error.code, message: error.message });
    return;
  }
  console.error("Wearable API failed:", error);
  res.status(500).json({ error: "WEARABLE_SAVE_FAILED", message: "数据保存失败，请稍后重试。" });
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

export function createWearableRouter({ repository, projectRepository = repository, sessionService, wearableProjectCode }) {
  const router = Router({ mergeParams: true });
  router.use(requireUser(sessionService));
  router.use(requireProjectAccess(projectRepository));
  router.use((req, res, next) => {
    if (req.params.code !== wearableProjectCode) {
      res.status(404).json({ error: "PROJECT_NOT_FOUND", message: "未找到智能穿戴项目。" });
      return;
    }
    next();
  });

  router.get("/state", route(async (req, res) => {
    res.json(await repository.getState({ userId: req.user.id, projectId: req.project.id }));
  }));

  router.put("/state", route(async (req, res) => {
    const body = expectObject(req.body, "请求数据");
    const workspace = await repository.saveWorkspace({
      userId: req.user.id,
      projectId: req.project.id,
      anchors: expectArray(body.anchors, "anchors"),
      deviceLayout: expectObject(body.deviceLayout, "deviceLayout"),
      removedEquipmentIds: expectArray(body.removedEquipmentIds, "removedEquipmentIds"),
      version: Number.isInteger(body.version) && body.version === 0 ? 0 : expectVersion(body.version)
    });
    res.json({ workspace });
  }));

  router.get("/equipment", route(async (req, res) => {
    res.json({ equipment: await repository.listEquipment({ userId: req.user.id, projectId: req.project.id }) });
  }));

  router.post("/equipment", route(async (req, res) => {
    const body = expectObject(req.body, "请求数据");
    const equipment = await repository.createEquipment({
      id: typeof body.id === "string" && body.id ? body.id : `custom-${randomUUID()}`,
      userId: req.user.id,
      projectId: req.project.id,
      data: expectObject(body.data, "data")
    });
    res.status(201).json({ equipment });
  }));

  router.patch("/equipment/:id", route(async (req, res) => {
    const body = expectObject(req.body, "请求数据");
    const data = expectObject(body.data, "data");
    if (body.sourceType === "builtin_override") {
      const equipment = await repository.upsertBuiltinOverride({
        id: req.params.id,
        userId: req.user.id,
        projectId: req.project.id,
        data,
        isDeleted: Boolean(body.isDeleted)
      });
      res.json({ equipment });
      return;
    }
    const equipment = await repository.updateEquipment({
      id: req.params.id,
      userId: req.user.id,
      projectId: req.project.id,
      data,
      isDeleted: Boolean(body.isDeleted),
      version: expectVersion(body.version)
    });
    res.json({ equipment });
  }));

  router.delete("/equipment/:id", route(async (req, res) => {
    const equipment = await repository.deleteEquipment({
      id: req.params.id,
      userId: req.user.id,
      projectId: req.project.id,
      version: expectVersion(req.body?.version)
    });
    res.json({ equipment });
  }));

  router.get("/schemes", route(async (req, res) => {
    res.json({ schemes: await repository.listSchemes({ userId: req.user.id, projectId: req.project.id }) });
  }));

  router.post("/schemes", route(async (req, res) => {
    const body = expectObject(req.body, "请求数据");
    if (typeof body.title !== "string" || !body.title.trim()) {
      const error = new Error("方案名称不能为空。");
      error.status = 400;
      error.code = "INVALID_INPUT";
      throw error;
    }
    const scheme = await repository.createScheme({
      id: typeof body.id === "string" && body.id ? body.id : `scheme-${randomUUID()}`,
      userId: req.user.id,
      projectId: req.project.id,
      title: body.title.trim(),
      evaluation: expectObject(body.evaluation, "evaluation"),
      thumbnailUrl: typeof body.thumbnailUrl === "string" ? body.thumbnailUrl : "",
      snapshot: expectObject(body.snapshot, "snapshot")
    });
    res.status(201).json({ scheme });
  }));

  router.delete("/schemes/:id", route(async (req, res) => {
    await repository.deleteScheme({ id: req.params.id, userId: req.user.id, projectId: req.project.id });
    res.status(204).end();
  }));

  router.post("/migrate-local-data", route(async (req, res) => {
    const payload = expectObject(req.body, "迁移数据");
    const requiredArrays = ["anchors", "customEquipment", "deletedEquipmentIds", "removedEquipmentIds", "schemes"];
    for (const key of requiredArrays) expectArray(payload[key], key);
    expectObject(payload.equipmentOverrides, "equipmentOverrides");
    expectObject(payload.deviceLayout, "deviceLayout");
    const result = await repository.migrateLocalData({ userId: req.user.id, projectId: req.project.id, payload });
    const state = result.alreadyMigrated ? null : await repository.getState({ userId: req.user.id, projectId: req.project.id });
    res.json({ ...result, state });
  }));

  return router;
}
