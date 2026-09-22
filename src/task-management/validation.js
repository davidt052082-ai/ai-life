const STATUS_VALUES = new Set(["not_started", "in_progress", "completed", "blocked"]);
const PRIORITY_VALUES = new Set(["high", "medium", "low"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function inputError(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = "INVALID_INPUT";
  return error;
}

export function readWorkspaceInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw inputError("项目数据格式无效。");
  if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 120) throw inputError("项目名称需为 1 到 120 个字符。");
  if (body.description !== undefined && (typeof body.description !== "string" || body.description.length > 2000)) throw inputError("项目说明不能超过 2000 个字符。");
  return { name: body.name.trim(), description: (body.description || "").trim() };
}

function readOptionalDate(value, message) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !ISO_DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw inputError(message);
  return value;
}

function readOptionalUuid(value, message) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !UUID.test(value)) throw inputError(message);
  return value;
}

function readHours(value, message) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw inputError(message);
  return value;
}

function readChoice(value, values, message) {
  if (typeof value !== "string" || !values.has(value)) throw inputError(message);
  return value;
}

export function readPersonInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw inputError("请求数据格式无效。");
  const name = String(body.name || "").trim();
  if (!name || name.length > 80) throw inputError("负责人名称需为 1 到 80 个字符。");
  const color = typeof body.color === "string" ? body.color.trim() : "";
  if (!/^#[0-9A-Fa-f]{6}$/.test(color)) throw inputError("负责人颜色必须为 #RRGGBB。");
  const dailyCapacityHours = body.dailyCapacityHours;
  if (typeof dailyCapacityHours !== "number" || !Number.isFinite(dailyCapacityHours) || dailyCapacityHours <= 0) throw inputError("每日容量必须是正数。");
  return { name, color, dailyCapacityHours };
}

export function readTaskInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw inputError("请求数据格式无效。");
  const title = String(body.title || "").trim();
  if (!title || title.length > 160) throw inputError("事项名称需为 1 到 160 个字符。");
  if (body.description !== undefined && typeof body.description !== "string") throw inputError("事项描述格式无效。");
  if (typeof body.isMilestone !== "boolean") throw inputError("里程碑标记格式无效。");
  return {
    title,
    description: String(body.description || "").trim(),
    assigneeId: readOptionalUuid(body.assigneeId, "负责人无效。"),
    startDate: readOptionalDate(body.startDate, "开始日期格式无效。"),
    endDate: readOptionalDate(body.endDate, "结束日期格式无效。"),
    estimatedHours: readHours(body.estimatedHours, "预计工时必须是非负数字。"),
    actualHours: readHours(body.actualHours, "实际工时必须是非负数字。"),
    status: readChoice(body.status, STATUS_VALUES, "事项状态无效。"),
    priority: readChoice(body.priority, PRIORITY_VALUES, "事项优先级无效。"),
    isMilestone: body.isMilestone
  };
}

export function readDependencyInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw inputError("请求数据格式无效。");
  if (typeof body.predecessorId !== "string" || typeof body.successorId !== "string") throw inputError("依赖事项无效。");
  return {
    predecessorId: readOptionalUuid(body.predecessorId, "前置事项无效。"),
    successorId: readOptionalUuid(body.successorId, "后置事项无效。")
  };
}
