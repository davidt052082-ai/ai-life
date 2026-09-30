import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import multer from "multer";
import { Router } from "express";
import { requireProjectAccess, requireUser } from "../auth/middleware.js";
import { getDailyPlan, getPlanDate } from "../health/plan.js";
import { getOutcomeStatus, weeklyExecutionScore } from "../health/scoring.js";
import { buildDailySummary, buildMetricTrends, buildReminderCandidates, buildWeeklyComparison } from "../health/summary.js";

const CHECKIN_TYPES = new Set(["post_meal_walk", "workout", "baduanjin", "no_alcohol", "no_late_snack", "no_sugary_drink", "abdominal_massage"]);
const SCHEDULE_TASK_TYPES = {
  "lunch-walk": ["post_meal_walk"],
  "dinner-walk": ["post_meal_walk"],
  training: ["workout", "baduanjin"],
  "no-alcohol": ["no_alcohol"],
  "no-late-snack": ["no_late_snack"],
  "no-sugary-drink": ["no_sugary_drink"]
};
const MIME_EXTENSIONS = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };

function inputError(message) { const error = new Error(message); error.status = 400; error.code = "INVALID_INPUT"; return error; }
function toDate(value, name = "日期") {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw inputError(`${name}格式无效。`);
  return value;
}
function idempotencyKey(req) {
  const value = req.get("Idempotency-Key");
  if (!value || value.length > 200) throw inputError("请提供有效的 Idempotency-Key。");
  return value;
}
function nowDate(timezone) { return getPlanDate(new Date(), "hydration", timezone); }
function validHydrationVolume(volumeMl) {
  return [200, 500, 1000].includes(volumeMl)
    || (Number.isInteger(volumeMl) && volumeMl !== 0 && Math.abs(volumeMl) <= 5000 && volumeMl % 100 === 0);
}
function dateRangeStart(date) { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() - 6); return value.toISOString().slice(0, 10); }
function weekStart(value) {
  const date = new Date(`${value}T12:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}
function addDays(date, amount) { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + amount); return value.toISOString().slice(0, 10); }
function inPlanDateRange(items, startDate, endDate) {
  return items.filter((item) => {
    const date = String(item.planDate).slice(0, 10);
    return date >= startDate && date <= endDate;
  });
}
function sendRouteError(res, error) {
  if (error instanceof multer.MulterError) {
    res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: "INVALID_IMAGE", message: error.code === "LIMIT_FILE_SIZE" ? "图片不能超过 2MB。" : "图片上传失败。" });
    return;
  }
  if (error?.status && error?.code) { res.status(error.status).json({ error: error.code, message: error.message }); return; }
  console.error("Health API failed:", error);
  res.status(500).json({ error: "HEALTH_SAVE_FAILED", message: "健康数据保存失败，请稍后重试。" });
}
function route(handler) {
  return async (req, res) => {
    try { await handler(req, res); }
    catch (error) {
      if (req.file?.path) await fs.unlink(req.file.path).catch(() => {});
      sendRouteError(res, error);
    }
  };
}

async function collectDay(repository, scope, date, settings) {
  const [events, meals, measurements] = await Promise.all([
    repository.listEvents({ ...scope, startDate: date, endDate: date }),
    repository.listMeals({ ...scope, startDate: date, endDate: date }),
    repository.listMeasurements({ ...scope, startDate: date, endDate: date })
  ]);
  return { events, meals, measurements, summary: buildDailySummary({ date, timezone: settings.timezone, settings, events, meals, measurements }) };
}

function responseEvent(event) { return { event, event_id: event.eventId, sync_status: event.syncStatus, server_version: event.version }; }

export function createHealthRouter({ repository, projectRepository = repository, sessionService, healthProjectCode, uploadDirectory, huaweiService = null, huaweiRepository = null }) {
  const router = Router({ mergeParams: true });
  const storage = multer.diskStorage({
    destination: async (_req, _file, callback) => { try { await fs.mkdir(uploadDirectory, { recursive: true }); callback(null, uploadDirectory); } catch (error) { callback(error); } },
    filename: (_req, file, callback) => callback(null, `${randomUUID()}${MIME_EXTENSIONS[file.mimetype] || ""}`)
  });
  const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024, files: 1 }, fileFilter: (_req, file, callback) => callback(MIME_EXTENSIONS[file.mimetype] ? null : inputError("仅支持 JPEG、PNG 或 WebP 图片。"), Boolean(MIME_EXTENSIONS[file.mimetype])) });
  const scope = (req) => ({ userId: req.user.id, projectId: req.project.id });

  router.use(requireUser(sessionService));
  router.use(requireProjectAccess(projectRepository));
  router.use((req, res, next) => {
    if (req.params.code !== healthProjectCode) { res.status(404).json({ error: "PROJECT_NOT_FOUND", message: "未找到健康管理项目。" }); return; }
    next();
  });

  router.get("/today", route(async (req, res) => {
    const settings = await repository.getSettings(scope(req));
    const date = req.query.date ? toDate(req.query.date) : nowDate(settings.timezone);
    const day = await collectDay(repository, scope(req), date, settings);
    const candidates = buildReminderCandidates({ now: new Date(), summary: day.summary, timezone: settings.timezone });
    await repository.createNotificationsIfAbsent({ ...scope(req), date, notifications: candidates.map((item) => ({ ...item, id: randomUUID() })) });
    res.json({ ...day.summary, notifications: await repository.listNotifications({ ...scope(req), date }) });
  }));

  router.post("/hydration", route(async (req, res) => {
    const body = req.body || {};
    if (!["water", "tea"].includes(body.type) || !validHydrationVolume(body.volumeMl)) throw inputError("饮水类型或容量无效。");
    const settings = await repository.getSettings(scope(req));
    const occurredAt = body.occurredAt ? new Date(body.occurredAt) : new Date();
    if (Number.isNaN(occurredAt.valueOf())) throw inputError("发生时间无效。");
    const planDate = getPlanDate(occurredAt, "hydration", settings.timezone, settings.planDayCutoff);
    if (body.volumeMl < 0) {
      const events = await repository.listEvents({ ...scope(req), startDate: planDate, endDate: planDate });
      const current = events.filter((event) => event.eventType === "hydration" && event.payload?.type === body.type)
        .reduce((total, event) => total + Number(event.payload?.volumeMl || 0), 0);
      if (current + body.volumeMl < 0) throw inputError("调整后饮水量不能小于 0 ml。");
    }
    const event = await repository.createEvent({ id: randomUUID(), eventId: `hydration_${randomUUID()}`, ...scope(req), idempotencyKey: idempotencyKey(req), eventType: "hydration", payload: { type: body.type, volumeMl: body.volumeMl }, occurredAt, timezone: settings.timezone, planDate });
    res.status(201).json(responseEvent(event));
  }));

  router.post("/checkins", route(async (req, res) => {
    const body = req.body || {};
    if (!CHECKIN_TYPES.has(body.type)) throw inputError("打卡类型无效。");
    if (body.taskId && !SCHEDULE_TASK_TYPES[body.taskId]?.includes(body.type)) throw inputError("计划事项无效。");
    const settings = await repository.getSettings(scope(req));
    const occurredAt = body.occurredAt ? new Date(body.occurredAt) : new Date();
    if (Number.isNaN(occurredAt.valueOf())) throw inputError("发生时间无效。");
    const sessionType = ["cardio", "strength"].includes(body.sessionType) ? body.sessionType : null;
    const event = await repository.createEvent({ id: randomUUID(), eventId: `${body.type}_${randomUUID()}`, ...scope(req), idempotencyKey: idempotencyKey(req), eventType: body.type, payload: { value: true, sessionType, taskId: body.taskId || null }, occurredAt, timezone: settings.timezone, planDate: getPlanDate(occurredAt, body.type, settings.timezone, settings.planDayCutoff) });
    res.status(201).json(responseEvent(event));
  }));

  router.post("/measurements", route(async (req, res) => {
    const body = req.body || {};
    const weightKg = body.weightKg === null || body.weightKg === undefined || body.weightKg === "" ? null : Number(body.weightKg);
    const waistCm = body.waistCm === null || body.waistCm === undefined || body.waistCm === "" ? null : Number(body.waistCm);
    if (!Number.isFinite(weightKg) && !Number.isFinite(waistCm)) throw inputError("请填写体重或腰围。");
    if (weightKg !== null && (weightKg < 20 || weightKg > 400)) throw inputError("体重范围无效。");
    if (waistCm !== null && (waistCm < 30 || waistCm > 250)) throw inputError("腰围范围无效。");
    const settings = await repository.getSettings(scope(req));
    const occurredAt = body.occurredAt ? new Date(body.occurredAt) : new Date();
    const measurement = await repository.createMeasurement({ id: randomUUID(), ...scope(req), idempotencyKey: idempotencyKey(req), weightKg, waistCm, occurredAt, timezone: settings.timezone });
    res.status(201).json({ measurement, event_id: measurement.id, sync_status: "synced", server_version: measurement.version });
  }));

  router.post("/events/:eventId/undo", route(async (req, res) => {
    const settings = await repository.getSettings(scope(req));
    const event = await repository.undoEvent({ id: req.params.eventId, eventId: randomUUID(), ...scope(req), idempotencyKey: idempotencyKey(req), occurredAt: new Date(), timezone: settings.timezone });
    if (!event) { res.status(404).json({ error: "EVENT_NOT_FOUND", message: "记录不存在或已撤销。" }); return; }
    res.status(201).json(responseEvent(event));
  }));

  router.post("/meals", upload.single("image"), route(async (req, res) => {
    if (!req.file) throw inputError("请选择一张餐食图片。");
    if (!["breakfast", "lunch", "dinner", "snack"].includes(req.body?.mealType)) throw inputError("餐次无效。");
    const settings = await repository.getSettings(scope(req));
    const capturedAt = req.body.capturedAt ? new Date(req.body.capturedAt) : new Date();
    if (Number.isNaN(capturedAt.valueOf())) throw inputError("拍摄时间无效。");
    const id = randomUUID();
    const meal = await repository.createMeal({ id, ...scope(req), idempotencyKey: idempotencyKey(req), mealType: req.body.mealType, storageKey: req.file.filename, originalName: path.basename(req.file.originalname || "meal"), mimeType: req.file.mimetype, byteSize: req.file.size, capturedAt, timezone: settings.timezone, planDate: getPlanDate(capturedAt, "meal", settings.timezone, settings.planDayCutoff) });
    if (meal.id !== id) await fs.unlink(req.file.path).catch(() => {});
    res.status(201).json({ meal, sync_status: "synced", server_version: 1 });
  }));

  router.get("/meals", route(async (req, res) => { const settings = await repository.getSettings(scope(req)); const date = req.query.date ? toDate(req.query.date) : nowDate(settings.timezone); res.json({ meals: await repository.listMeals({ ...scope(req), startDate: date }) }); }));
  router.delete("/meals/:id", route(async (req, res) => { if (!await repository.deleteMeal({ id: req.params.id, ...scope(req) })) { res.status(404).json({ error: "MEAL_NOT_FOUND", message: "餐食照片不存在。" }); return; } res.status(204).end(); }));

  router.get("/trends", route(async (req, res) => {
    const settings = await repository.getSettings(scope(req));
    const endDate = req.query.endDate ? toDate(req.query.endDate) : nowDate(settings.timezone);
    const startDate = req.query.startDate ? toDate(req.query.startDate) : addDays(endDate, -27);
    const fullRange = { ...scope(req), startDate: "1900-01-01", endDate: "2999-12-31" };
    const [allMeasurements, allEvents, allMeals, huaweiDaily] = await Promise.all([
      repository.listMeasurements({ ...scope(req) }),
      repository.listEvents(fullRange),
      repository.listMeals(fullRange),
      huaweiRepository ? huaweiRepository.getDailyRange({ ...scope(req), startDate, endDate }) : []
    ]);
    const events = inPlanDateRange(allEvents, startDate, endDate);
    const meals = inPlanDateRange(allMeals, startDate, endDate);
    const measurements = allMeasurements.filter((item) => {
      const date = new Date(item.occurredAt).toISOString().slice(0, 10);
      return date >= startDate && date <= endDate;
    });
    res.set("Cache-Control", "no-store");
    res.json({ measurements: allMeasurements, history: { events: allEvents, meals: allMeals }, ...buildMetricTrends({ startDate, endDate, measurements, events, meals, huaweiDaily }) });
  }));

  async function weekly(req, res, includeOutcome) {
    const settings = await repository.getSettings(scope(req));
    const startDate = weekStart(req.query.date ? toDate(req.query.date) : nowDate(settings.timezone));
    const endDate = addDays(startDate, 6);
    const [events, meals, measurements] = await Promise.all([repository.listEvents({ ...scope(req), startDate, endDate }), repository.listMeals({ ...scope(req), startDate, endDate }), repository.listMeasurements({ ...scope(req), startDate: addDays(startDate, -27), endDate })]);
    const actuals = { cardio: events.filter((e) => e.eventType === "workout" && e.payload?.sessionType === "cardio").length, strength: events.filter((e) => e.eventType === "workout" && e.payload?.sessionType === "strength").length, walks: events.filter((e) => e.eventType === "post_meal_walk").length, hydration: events.filter((e) => e.eventType === "hydration").reduce((sum, e) => sum + (Number(e.payload?.volumeMl) || 0), 0), alcoholFree: events.filter((e) => e.eventType === "no_alcohol").length, mealPhotos: meals.length, waist: measurements.some((item) => item.waistCm !== null) ? 1 : 0 };
    const targets = { cardio: 3, strength: 2, walks: 10, hydration: settings.hydrationTargetMl * 7, alcoholFree: 7, mealPhotos: 21, waist: 1 };
    const ratios = Object.fromEntries(Object.keys(targets).map((key) => [key, Math.min(1, actuals[key] / targets[key])]));
    const comparison = buildWeeklyComparison({ targets, actuals });
    const result = { weekStart: startDate, weekEnd: endDate, comparison, executionScore: weeklyExecutionScore({ cardio: ratios.cardio, strength: ratios.strength, walks: ratios.walks, hydration: ratios.hydration, alcoholFree: ratios.alcoholFree, sleep: null, mealPhotos: ratios.mealPhotos, waist: ratios.waist }) };
    if (includeOutcome) result.outcome = getOutcomeStatus({ weeklyScore: result.executionScore, weights: measurements.filter((item) => item.weightKg !== null).map((item) => item.weightKg), waists: measurements.filter((item) => item.waistCm !== null).map((item) => item.waistCm) });
    res.json(result);
  }
  router.get("/plan-vs-actual", route((req, res) => weekly(req, res, false)));
  router.get("/weekly-report", route((req, res) => weekly(req, res, true)));
  router.get("/settings", route(async (req, res) => res.json({ settings: await repository.getSettings(scope(req)) })));
  router.get("/integrations/huawei/status", route(async (req, res) => {
    res.json(huaweiService ? await huaweiService.status(scope(req)) : { enabled: false, status: "disabled" });
  }));
  router.post("/integrations/huawei/connect", route(async (req, res) => {
    if (!huaweiService) throw Object.assign(new Error("华为健康接入尚未启用。"), { status: 409, code: "HUAWEI_DISABLED" });
    res.json({ authorizationUrl: await huaweiService.beginConnection(scope(req)) });
  }));
  router.post("/integrations/huawei/sync", route(async (req, res) => {
    if (!huaweiService) throw Object.assign(new Error("华为健康接入尚未启用。"), { status: 409, code: "HUAWEI_DISABLED" });
    await huaweiService.requestManualSync(scope(req));
    res.status(202).json({ status: "syncing" });
  }));
  router.delete("/integrations/huawei", route(async (req, res) => {
    if (huaweiService) await huaweiService.disconnect(scope(req));
    res.status(204).end();
  }));
  router.patch("/settings", route(async (req, res) => {
    const body = req.body || {}; const current = await repository.getSettings(scope(req));
    const settings = { timezone: typeof body.timezone === "string" ? body.timezone : current.timezone, hydrationTargetMl: body.hydrationTargetMl === undefined ? current.hydrationTargetMl : Number(body.hydrationTargetMl), planDayCutoff: typeof body.planDayCutoff === "string" ? body.planDayCutoff : current.planDayCutoff, abdominalMassageEnabled: body.abdominalMassageEnabled === undefined ? current.abdominalMassageEnabled : Boolean(body.abdominalMassageEnabled) };
    if (!Number.isInteger(settings.hydrationTargetMl) || settings.hydrationTargetMl < 500 || settings.hydrationTargetMl > 5000 || !/^\d{2}:\d{2}$/.test(settings.planDayCutoff)) throw inputError("设置值无效。");
    res.json({ settings: await repository.updateSettings({ ...scope(req), settings }) });
  }));
  router.get("/notifications", route(async (req, res) => { const settings = await repository.getSettings(scope(req)); const date = req.query.date ? toDate(req.query.date) : nowDate(settings.timezone); res.json({ notifications: await repository.listNotifications({ ...scope(req), date }) }); }));
  router.patch("/notifications/:id", route(async (req, res) => { const notification = await repository.markNotificationRead({ id: req.params.id, ...scope(req) }); if (!notification) { res.status(404).json({ error: "NOTIFICATION_NOT_FOUND", message: "提醒不存在。" }); return; } res.json({ notification }); }));
  router.use(async (error, req, res, _next) => {
    if (req.file?.path) await fs.unlink(req.file.path).catch(() => {});
    sendRouteError(res, error);
  });
  return router;
}
