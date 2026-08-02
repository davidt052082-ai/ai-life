import { createHash } from "node:crypto";

export const ANALYTICS_EVENT_TYPES = new Set([
  "page_view",
  "sign_up",
  "login",
  "project_enter",
  "wearable_equipment_add",
  "wearable_scheme_save",
  "study_plan_create",
  "admin_group_create",
  "admin_membership_change",
  "admin_project_access_change"
]);

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const projectCodePattern = /^[a-z0-9][a-z0-9-]{0,79}$/;
const operationValues = new Set(["grant", "revoke"]);
const sourceTypeValues = new Set(["custom", "builtin", "import"]);
const deviceTypeValues = new Set(["desktop", "mobile", "tablet", "unknown"]);

function inputError(message) {
  const error = new Error(message);
  error.code = "INVALID_ANALYTICS_EVENT";
  error.status = 400;
  return error;
}

function trimString(value, maximum, field, { required = false } = {}) {
  if (value == null || value === "") {
    if (required) throw inputError(`${field}不能为空。`);
    return null;
  }
  if (typeof value !== "string") throw inputError(`${field}格式无效。`);
  const normalized = value.trim();
  if (!normalized) {
    if (required) throw inputError(`${field}不能为空。`);
    return null;
  }
  if (normalized.length > maximum) throw inputError(`${field}长度超出限制。`);
  return normalized;
}

function normalizeUuid(value, field) {
  const normalized = trimString(value, 36, field, { required: true });
  if (!uuidPattern.test(normalized)) throw inputError(`${field}格式无效。`);
  return normalized.toLowerCase();
}

function normalizePath(value) {
  const raw = trimString(value, 2048, "页面路径", { required: true });
  if (!raw.startsWith("/") || raw.startsWith("//")) throw inputError("页面路径必须是站内路径。");
  const path = raw.split(/[?#]/, 1)[0] || "/";
  if (path.length > 240 || /[\r\n]/.test(path)) throw inputError("页面路径长度或格式无效。");
  return path;
}

function normalizeReferrer(value) {
  if (value == null || value === "") return "direct";
  if (typeof value !== "string" || value.length > 2048) throw inputError("来源地址格式无效。");
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.hostname.length > 180) {
      throw inputError("来源地址格式无效。");
    }
    return url.hostname.toLowerCase();
  } catch (error) {
    if (error.code === "INVALID_ANALYTICS_EVENT") throw error;
    throw inputError("来源地址格式无效。");
  }
}

function normalizeUtm(value) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw inputError("UTM 参数格式无效。");
  return {
    utmSource: trimString(value.source, 120, "utm_source"),
    utmMedium: trimString(value.medium, 120, "utm_medium"),
    utmCampaign: trimString(value.campaign, 120, "utm_campaign"),
    utmTerm: trimString(value.term, 120, "utm_term"),
    utmContent: trimString(value.content, 120, "utm_content")
  };
}

function normalizeScreen(value) {
  if (value == null) return { screenWidth: null, screenHeight: null };
  if (typeof value !== "object" || Array.isArray(value)) throw inputError("屏幕尺寸格式无效。");
  const normalizeSize = (size, field) => {
    if (size == null) return null;
    if (!Number.isInteger(size) || size < 1 || size > 10_000) throw inputError(`${field}格式无效。`);
    return size;
  };
  return {
    screenWidth: normalizeSize(value.width, "屏幕宽度"),
    screenHeight: normalizeSize(value.height, "屏幕高度")
  };
}

function normalizeProperties(eventType, value, { trusted = false } = {}) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw inputError("事件属性格式无效。");

  const allowed = new Set();
  if (eventType === "page_view") allowed.add("title");
  if (eventType === "project_enter") allowed.add("projectCode");
  if (eventType === "wearable_equipment_add") allowed.add("sourceType");
  if (eventType === "admin_membership_change" || eventType === "admin_project_access_change") allowed.add("operation");
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.some((key) => key !== "userId" && !trusted)) throw inputError("事件属性不受支持。");
  if (unknown.some((key) => key !== "userId" && trusted)) throw inputError("事件属性不受支持。");

  const properties = {};
  if (allowed.has("title") && value.title != null) properties.title = trimString(value.title, 160, "页面标题");
  if (allowed.has("projectCode") && value.projectCode != null) {
    const projectCode = trimString(value.projectCode, 80, "项目代码", { required: true }).toLowerCase();
    if (!projectCodePattern.test(projectCode)) throw inputError("项目代码格式无效。");
    properties.projectCode = projectCode;
  }
  if (allowed.has("sourceType") && value.sourceType != null) {
    const sourceType = trimString(value.sourceType, 20, "装备来源", { required: true }).toLowerCase();
    if (!sourceTypeValues.has(sourceType)) throw inputError("装备来源格式无效。");
    properties.sourceType = sourceType;
  }
  if (allowed.has("operation") && value.operation != null) {
    const operation = trimString(value.operation, 12, "操作类型", { required: true }).toLowerCase();
    if (!operationValues.has(operation)) throw inputError("操作类型格式无效。");
    properties.operation = operation;
  }
  return properties;
}

function normalizeEvent(body, { trusted = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw inputError("事件数据格式无效。");
  const eventType = trimString(body.eventType, 80, "事件类型", { required: true });
  if (!ANALYTICS_EVENT_TYPES.has(eventType)) throw inputError("不支持的事件类型。");
  const properties = normalizeProperties(eventType, body.properties, { trusted });
  const suppliedProjectCode = body.projectCode == null ? null : trimString(body.projectCode, 80, "项目代码").toLowerCase();
  const projectCode = suppliedProjectCode || properties.projectCode || null;
  if (projectCode && !projectCodePattern.test(projectCode)) throw inputError("项目代码格式无效。");

  const deviceType = trimString(body.deviceType, 20, "设备类型")?.toLowerCase() || "unknown";
  if (!deviceTypeValues.has(deviceType)) throw inputError("设备类型格式无效。");

  return {
    visitorId: normalizeUuid(body.visitorId, "访客标识"),
    sessionId: normalizeUuid(body.sessionId, "会话标识"),
    userId: trusted && body.userId ? normalizeUuid(body.userId, "用户标识") : null,
    eventType,
    pagePath: normalizePath(body.pagePath),
    projectCode,
    referrerHost: normalizeReferrer(body.referrer),
    ...normalizeUtm(body.utm),
    deviceType,
    browserName: trimString(body.browserName, 80, "浏览器名称"),
    osName: trimString(body.osName, 80, "操作系统名称"),
    language: trimString(body.language, 80, "语言"),
    ...normalizeScreen(body.screen),
    properties
  };
}

export function normalizeClientEvent(body) {
  return normalizeEvent(body);
}

export function normalizeServerEvent(body) {
  return { ...normalizeEvent(body, { trusted: true }), id: normalizeUuid(body?.id, "事件标识") };
}

export function requestAnalyticsContext(req, { ipSalt = "", trustProxy = false } = {}) {
  const salt = typeof ipSalt === "string" ? ipSalt.trim() : "";
  const ip = typeof req?.ip === "string" ? req.ip : "";
  const ipHash = salt && ip ? createHash("sha256").update(`${salt}:${ip}`).digest("hex") : null;
  const countryHeader = trustProxy ? (req?.headers?.["cf-ipcountry"] || req?.headers?.["x-country-code"]) : null;
  const countryCode = typeof countryHeader === "string" && /^[a-z]{2}$/i.test(countryHeader.trim())
    ? countryHeader.trim().toUpperCase()
    : null;
  const cityHeader = trustProxy ? (req?.headers?.["cf-ipcity"] || req?.headers?.["x-geo-city"]) : null;
  const cityName = typeof cityHeader === "string" && cityHeader.trim()
    ? cityHeader.trim().slice(0, 80)
    : null;
  return { ipHash, countryCode, cityName };
}
