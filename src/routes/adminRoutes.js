import { randomUUID } from "node:crypto";
import { Router } from "express";
import { requireAdmin, requireUser } from "../auth/middleware.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function route(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error.code === "23505") {
        res.status(409).json({ error: "GROUP_NAME_CONFLICT", message: "分组名称已存在。" });
        return;
      }
      if (error.code === "NOT_FOUND") {
        res.status(404).json({ error: "NOT_FOUND", message: error.message });
        return;
      }
      if (error.code === "INVALID_INPUT") {
        res.status(400).json({ error: "INVALID_INPUT", message: error.message });
        return;
      }
      if (error.code === "GROUP_PROTECTED" || error.code === "GROUP_NOT_EMPTY") {
        res.status(409).json({ error: error.code, message: error.message });
        return;
      }
      console.error("Admin request failed:", error);
      res.status(500).json({ error: "ADMIN_REQUEST_FAILED", message: "后台操作失败，请稍后重试。" });
    }
  };
}

function readGroupInput(body) {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  if (!name || name.length > 80 || description.length > 240) {
    const error = new Error("请填写不超过 80 字的分组名称和不超过 240 字的说明。");
    error.code = "INVALID_INPUT";
    throw error;
  }
  return { name, description };
}

function requireUuid(value) {
  if (!uuidPattern.test(String(value || ""))) {
    const error = new Error("标识格式无效。");
    error.code = "INVALID_INPUT";
    throw error;
  }
  return value;
}

export function createAdminRouter({ repository, sessionService, adminEmail }) {
  const router = Router();
  router.use(requireUser(sessionService));
  router.use(requireAdmin({ adminEmail }));

  router.get("/overview", route(async (_req, res) => {
    res.json(await repository.listOverview());
  }));

  router.get("/users", route(async (req, res) => {
    res.json({ users: await repository.searchUsers(req.query?.q) });
  }));

  router.post("/groups", route(async (req, res) => {
    const { name, description } = readGroupInput(req.body);
    const id = randomUUID();
    const group = await repository.createGroup({
      id,
      code: `group-${id.replaceAll("-", "")}`,
      name,
      description
    });
    res.status(201).json({ group });
  }));

  router.patch("/groups/:groupId", route(async (req, res) => {
    const { name, description } = readGroupInput(req.body);
    const group = await repository.updateGroup({ groupId: requireUuid(req.params.groupId), name, description });
    res.json({ group });
  }));

  router.delete("/groups/:groupId", route(async (req, res) => {
    await repository.deleteEmptyGroup(requireUuid(req.params.groupId));
    res.status(204).end();
  }));

  router.put("/groups/:groupId/members/:userId", route(async (req, res) => {
    await repository.addMember({ groupId: requireUuid(req.params.groupId), userId: requireUuid(req.params.userId) });
    res.status(204).end();
  }));

  router.delete("/groups/:groupId/members/:userId", route(async (req, res) => {
    await repository.removeMember({ groupId: requireUuid(req.params.groupId), userId: requireUuid(req.params.userId) });
    res.status(204).end();
  }));

  router.put("/groups/:groupId/projects/:projectId", route(async (req, res) => {
    await repository.grantProject({ groupId: requireUuid(req.params.groupId), projectId: requireUuid(req.params.projectId) });
    res.status(204).end();
  }));

  router.delete("/groups/:groupId/projects/:projectId", route(async (req, res) => {
    await repository.revokeProject({ groupId: requireUuid(req.params.groupId), projectId: requireUuid(req.params.projectId) });
    res.status(204).end();
  }));

  return router;
}
