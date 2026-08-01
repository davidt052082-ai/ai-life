import { Router } from "express";
import { requireAdmin, requireUser } from "../auth/middleware.js";
import { ANALYTICS_EVENT_TYPES } from "../analytics/normalizeEvent.js";

const DIMENSIONS = new Set(["source", "device", "page", "project", "country"]);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const projectCodePattern = /^[a-z0-9][a-z0-9-]{0,79}$/;

function queryError(message) {
  const error = new Error(message);
  error.code = "INVALID_ANALYTICS_QUERY";
  return error;
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function validateDate(value, field) {
  if (typeof value !== "string" || !datePattern.test(value)) throw queryError(`${field}必须是 YYYY-MM-DD 格式。`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || toIsoDate(date) !== value) throw queryError(`${field}不是有效日期。`);
  return date;
}

function readRange(query = {}) {
  const today = new Date();
  const defaultTo = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const defaultFrom = new Date(defaultTo);
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 6);
  const from = query.from ? validateDate(query.from, "开始日期") : defaultFrom;
  const to = query.to ? validateDate(query.to, "结束日期") : defaultTo;
  const difference = Math.floor((to - from) / 86_400_000);
  if (difference < 0 || difference > 89) throw queryError("日期范围最多为 90 天。");
  return { from: toIsoDate(from), to: toIsoDate(to) };
}

function readDimension(query = {}) {
  const dimension = typeof query.dimension === "string" ? query.dimension : "";
  if (!DIMENSIONS.has(dimension)) throw queryError("统计维度无效。");
  return dimension;
}

function readEventsQuery(query = {}) {
  const range = readRange(query);
  const type = typeof query.type === "string" && query.type ? query.type : null;
  const projectCode = typeof query.projectCode === "string" && query.projectCode ? query.projectCode.toLowerCase() : null;
  if (type && !ANALYTICS_EVENT_TYPES.has(type)) throw queryError("事件类型无效。");
  if (projectCode && !projectCodePattern.test(projectCode)) throw queryError("项目代码无效。");
  const limit = query.limit == null ? 50 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw queryError("每页数量无效。");
  const cursor = typeof query.cursor === "string" && query.cursor ? query.cursor : null;
  if (cursor && cursor.length > 240) throw queryError("分页标识无效。");
  return { ...range, type, projectCode, limit, cursor };
}

function route(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error.code === "INVALID_ANALYTICS_QUERY") {
        res.status(400).json({ error: error.code, message: error.message });
        return;
      }
      console.error("Analytics admin query failed:", error);
      res.status(500).json({ error: "ANALYTICS_QUERY_FAILED", message: "运营数据暂时无法读取。" });
    }
  };
}

export function createAdminAnalyticsRouter({ repository, sessionService, adminEmail }) {
  const router = Router();
  router.use(requireUser(sessionService));
  router.use(requireAdmin({ adminEmail }));

  router.get("/summary", route(async (req, res) => {
    res.json(await repository.getSummary(readRange(req.query)));
  }));
  router.get("/breakdown", route(async (req, res) => {
    const range = readRange(req.query);
    res.json({ dimension: readDimension(req.query), items: await repository.getBreakdown({ ...range, dimension: readDimension(req.query) }) });
  }));
  router.get("/funnel", route(async (req, res) => {
    res.json({ stages: await repository.getFunnel(readRange(req.query)) });
  }));
  router.get("/events", route(async (req, res) => {
    res.json(await repository.listEvents(readEventsQuery(req.query)));
  }));

  return router;
}
