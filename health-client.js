import { createHealthOfflineQueue, isNetworkFailure } from "/health-offline.js";

const API_ROOT = "/api/projects/health/health";
const state = { today: null, planDate: null, undoEventId: null, undoTimer: null, trends: null, trendMetric: null, trendRange: "28" };
const $ = (selector) => document.querySelector(selector);
const OFFLINE_QUEUEABLE_PATHS = new Set(["/hydration", "/checkins", "/measurements", "/meals"]);
let deferredInstallPrompt = null;
let offlineQueue = null;
try { offlineQueue = createHealthOfflineQueue(); } catch { /* 浏览器不支持 IndexedDB 时继续使用在线模式。 */ }

const WEEK_TRAINING = [
  { label: "休息 + 周复盘", duration: "5–10 分钟" }, { label: "快走", duration: "40 分钟" },
  { label: "弹力带 + 徒手力量", duration: "30–35 分钟" }, { label: "快走", duration: "40 分钟" },
  { label: "八段锦恢复训练", duration: "15–25 分钟" }, { label: "壶铃基础力量", duration: "30–35 分钟" },
  { label: "长距离快走", duration: "60 分钟" }
];
const TRAINING_DETAILS = {
  cardio: "中等强度：可以讲话，但不轻松唱歌。",
  strength: "动作稳定优先；训练前轻度收紧核心，过程中保持呼吸。",
  baduanjin: "低强度主动恢复，可加少量拉伸；不替代周二或周五力量训练，不计入核心减脂评分。",
  review: "量腰围、看周报，并只调整下周最重要的一两件事。"
};
const TUESDAY_EXERCISES = [["徒手/抱物深蹲", "10–12 次", "3 组", "45–60 秒"], ["俯卧撑或桌边俯卧撑", "8–12 次", "3 组", "45–60 秒"], ["弹力带划船", "10–15 次", "3 组", "45–60 秒"], ["臀桥", "12–15 次", "3 组", "45–60 秒"], ["平板支撑", "20–40 秒", "3 组", "45–60 秒"]];
const FRIDAY_EXERCISES = [["壶铃硬拉", "10 次", "3 组", "先学髋铰链"], ["高脚杯深蹲", "8–12 次", "3 组", "动作稳定优先"], ["单臂壶铃划船", "每侧 10 次", "3 组", "保持躯干稳定"], ["农夫走", "30–60 秒", "3 组", "核心和握力"], ["Dead Bug / 平板支撑", "约 30 秒", "3 组", "核心稳定"]];

function key() { return globalThis.crypto?.randomUUID?.() || `health_${Date.now()}_${Math.random().toString(16).slice(2)}`; }
function errorMessage(error) { return error instanceof Error ? error.message : "操作失败，请重试。"; }
function showError(message = "") { $("#status").textContent = message; }
function escapeHtml(value) { const node = document.createElement("span"); node.textContent = String(value ?? ""); return node.innerHTML; }
function addDays(date, amount) { const value = new Date(`${date}T12:00:00`); value.setDate(value.getDate() + amount); return value.toISOString().slice(0, 10); }
function mondayOf(date) { const value = new Date(`${date}T12:00:00`); value.setDate(value.getDate() - ((value.getDay() + 6) % 7)); return value.toISOString().slice(0, 10); }
function dateLabel(date) { return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", weekday: "short" }).format(new Date(`${date}T12:00:00`)); }
function tableRows(rows) { return rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join(""); }
function scheduleRows(schedule) { return schedule.map((item) => [item.time, item.label, item.frequency, item.detail]); }
function formatMetric(value, unit) { return `${Number(value).toLocaleString("zh-CN")}${unit ? ` ${unit}` : ""}`; }

async function updatePwaStatus() {
  const element = $("#pwaStatus");
  const pending = offlineQueue ? await offlineQueue.count().catch(() => 0) : 0;
  if (!navigator.onLine) {
    element.textContent = pending ? `当前离线，${pending} 项记录待联网同步。` : "当前离线，可继续记录，联网后自动同步。";
    element.className = "pwa-status offline";
    element.hidden = false;
    return;
  }
  if (pending) {
    element.textContent = `${pending} 项记录待同步。`;
    element.className = "pwa-status";
    element.hidden = false;
    return;
  }
  element.hidden = true;
}

function canQueueOffline(path, options) {
  return Boolean(offlineQueue && options.method === "POST" && OFFLINE_QUEUEABLE_PATHS.has(path));
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (["POST", "PATCH", "DELETE"].includes(options.method)) headers.set("Idempotency-Key", key());
  let response;
  try { response = await fetch(`${API_ROOT}${path}`, { ...options, headers }); }
  catch (error) {
    if (!canQueueOffline(path, options) || !isNetworkFailure(error)) throw error;
    await offlineQueue.enqueue({ path, method: options.method, headers: Object.fromEntries(headers), body: options.body });
    await updatePwaStatus();
    return { queued: true };
  }
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "请求失败，请稍后重试。");
  return data;
}

function scheduleButton(item, data) {
  const label = `${item.time} · ${item.label}`;
  if (item.action === "meal") {
    const mealType = item.id.replace("-photo", ""); const done = Boolean(data.meals[mealType]);
    return `<button class="action${done ? " done" : ""}" type="button" data-meal-action="${mealType}">${escapeHtml(label)}${done ? " · 已完成" : ""}</button>`;
  }
  if (item.action === "measurement") {
    const done = Boolean(data.measurementRecorded);
    return `<button class="action${done ? " done" : ""}" type="button" data-measurement-action>${escapeHtml(label)}${done ? " · 已记录" : ""}</button>`;
  }
  const type = item.action === "training" ? (data.plan.training.type === "baduanjin" ? "baduanjin" : "workout") : item.action === "walk" ? "post_meal_walk" : item.action === "checkin" ? item.checkinType : null;
  if (type) {
    const eventId = data.actionEvents?.[item.id] || ""; const done = Boolean(eventId);
    return `<button class="action${done ? " done" : ""}" type="button" data-checkin-type="${type}" data-task-id="${item.id}" data-event-id="${eventId}">${escapeHtml(label)}${done ? " · 已完成 · 再点取消" : ""}</button>`;
  }
  return `<button class="action" type="button" disabled>${escapeHtml(label)} · 计划提醒</button>`;
}

function renderTodaySchedule(data) {
  $("#todaySchedule").innerHTML = data.plan.schedule.filter((item) => item.action !== "hydration").map((item) => scheduleButton(item, data)).join("");
}

function showFluidValue(type, value) {
  $(`#${type === "tea" ? "teaMl" : "waterMl"}`).textContent = `${value} ml`;
}

function renderFluidEditor(data) {
  for (const [type, value] of [["water", data.hydration.waterMl], ["tea", data.hydration.teaMl]]) {
    const slider = $(`[data-fluid-slider="${type}"]`);
    slider.max = String(Math.max(5000, value)); slider.value = String(value); showFluidValue(type, value);
  }
}

function renderToday(data) {
  state.today = data;
  renderTodaySchedule(data);
  $("#completion").textContent = `${data.completionPercent}%`;
  $("#completionBar").style.width = `${data.completionPercent}%`;
  $("#remaining").textContent = data.remainingTasks.length ? `还差：${data.remainingTasks.map((item) => item.label).join("、")}` : "今天的计划都完成了。";
  renderFluidEditor(data);
  $("#highlight").textContent = data.highlightedTask ? `此刻优先：${data.highlightedTask.label}` : "此刻优先：今天的重点事项已完成。";
  const card = $("#notificationCard"); const notifications = data.notifications || [];
  card.hidden = notifications.length === 0;
  $("#notifications").innerHTML = notifications.map((item) => `<button class="item secondary" data-notification="${escapeHtml(item.id)}" type="button">${escapeHtml(item.message)}${item.readAt ? "（已读）" : ""}</button>`).join("");
}

function renderWeekOverview(selectedDate) {
  const today = state.today?.date || selectedDate;
  const weekStart = mondayOf(selectedDate);
  $("#weekOverview").innerHTML = Array.from({ length: 7 }, (_, offset) => {
    const date = addDays(weekStart, offset);
    const training = WEEK_TRAINING[new Date(`${date}T12:00:00`).getDay()];
    const classes = ["day-card", date === selectedDate ? "selected" : "", date === today ? "today" : ""].filter(Boolean).join(" ");
    return `<button type="button" class="${classes}" data-plan-date="${date}" aria-pressed="${date === selectedDate}"><strong>${escapeHtml(dateLabel(date))}</strong><small>${escapeHtml(training.label)}<br>${escapeHtml(training.duration)}</small></button>`;
  }).join("");
}

function renderExerciseTable(title, rows) {
  return `<div class="plan-section"><h3>${escapeHtml(title)}</h3><table class="plan-table"><thead><tr><th>动作</th><th>次数/时长</th><th>组数</th><th>说明/休息</th></tr></thead><tbody>${tableRows(rows)}</tbody></table></div>`;
}

function renderPlanDetail(data) {
  const training = data.plan.training;
  const schedule = `<div class="plan-section"><h3>${escapeHtml(dateLabel(data.date))} · 每日时间表</h3><table class="plan-table"><thead><tr><th>时间</th><th>事项</th><th>频次</th><th>系统动作</th></tr></thead><tbody>${tableRows(scheduleRows(data.plan.schedule))}</tbody></table></div>`;
  const trainingCard = `<div class="plan-section"><h3>20:00 左右主训练</h3><div class="item"><strong>${escapeHtml(training.label)}</strong> · ${training.minMinutes === training.maxMinutes ? training.minMinutes : `${training.minMinutes}–${training.maxMinutes}`} 分钟<br><span class="muted">${escapeHtml(TRAINING_DETAILS[training.type] || "按计划完成训练。")}</span>${training.countsTowardScore === false ? "<br><span class=\"muted\">恢复任务，不计入核心减脂评分。</span>" : ""}</div></div>`;
  const details = [schedule, trainingCard];
  if (training.type === "strength" && training.label.includes("徒手")) details.push(renderExerciseTable("周二力量训练模板", TUESDAY_EXERCISES));
  if (training.type === "strength" && training.label.includes("壶铃")) details.push(renderExerciseTable("周五壶铃训练模板", FRIDAY_EXERCISES));
  $("#planDetail").innerHTML = details.join("");
}

async function selectPlanDate(date) {
  const data = await request(`/today?date=${encodeURIComponent(date)}`);
  state.planDate = data.date;
  renderWeekOverview(data.date);
  renderPlanDetail(data);
}

async function refreshToday() { renderToday(await request("/today")); }
async function syncQueuedRequests() {
  if (!offlineQueue || !navigator.onLine) { await updatePwaStatus(); return; }
  const completed = await offlineQueue.replay(API_ROOT);
  await updatePwaStatus();
  if (completed) await refreshToday();
}
function showUndo(eventId, text) {
  state.undoEventId = eventId; clearTimeout(state.undoTimer); $("#snackbarText").textContent = text; $("#snackbar").classList.add("show");
  state.undoTimer = setTimeout(() => { state.undoEventId = null; $("#snackbar").classList.remove("show"); }, 6000);
}
async function submitAction(button, path, body, undoText) {
  const original = button.textContent; button.disabled = true; button.textContent = "提交中…"; showError();
  try { const data = await request(path, { method: "POST", body: JSON.stringify(body) }); if (data?.queued) { showError("已离线保存，待联网同步。"); return; } await refreshToday(); await syncQueuedRequests(); if (data.event?.id) showUndo(data.event.id, undoText); }
  catch (error) { showError(errorMessage(error)); button.textContent = "记录失败，点击重试"; return; }
  finally { button.disabled = false; if (button.textContent === "提交中…") button.textContent = original; }
}

async function submitFluidDelta(type, slider) {
  const property = type === "tea" ? "teaMl" : "waterMl";
  const current = state.today.hydration[property]; const delta = Number(slider.value) - current;
  if (!delta) return;
  slider.disabled = true; showError();
  try {
    const data = await request("/hydration", { method: "POST", body: JSON.stringify({ type, volumeMl: delta }) });
    if (data?.queued) {
      state.today.hydration[property] += delta; state.today.hydration.totalMl += delta;
      showFluidValue(type, state.today.hydration[property]);
      showError("已离线保存，待联网同步。");
      return;
    }
    await refreshToday(); await syncQueuedRequests();
    if (data.event?.id) showUndo(data.event.id, `已调整 ${delta > 0 ? "+" : ""}${delta} ml`);
  } catch (error) {
    slider.value = String(current); showFluidValue(type, current); showError(errorMessage(error));
  } finally { slider.disabled = false; }
}

async function compressImage(file) {
  const image = await createImageBitmap(file); const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas"); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale); canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("图片压缩失败。")), "image/webp", .8));
}

async function uploadMeal(input) {
  const file = input.files?.[0]; if (!file) return; showError(); input.disabled = true;
  try { const blob = await compressImage(file); const form = new FormData(); form.append("image", blob, "meal.webp"); form.append("mealType", input.dataset.meal); form.append("capturedAt", new Date().toISOString()); const data = await request("/meals", { method: "POST", body: form }); if (data?.queued) { showError("已离线保存，待联网同步。"); return; } await refreshToday(); await syncQueuedRequests(); }
  catch (error) { showError(errorMessage(error)); } finally { input.disabled = false; input.value = ""; }
}

function buildTrendSvg(series) {
  const points = series.map((value, index) => ({ value, index })).filter((point) => point.value !== null && point.value !== undefined);
  if (points.length < 2) return "";
  const values = points.map((point) => point.value); const minimum = Math.min(...values); const maximum = Math.max(...values); const span = maximum - minimum || 1;
  const path = points.map((point, index) => `${index ? "L" : "M"}${(point.index * 100 / Math.max(1, series.length - 1)).toFixed(1)},${(30 - ((point.value - minimum) * 26 / span)).toFixed(1)}`).join(" ");
  return `<svg class="trend-svg" viewBox="0 0 100 34" preserveAspectRatio="none" aria-label="近 28 天趋势"><path d="${path}" fill="none" stroke="#2c8054" stroke-width="3" stroke-linecap="round" /></svg>`;
}

function trendDescription(metric, options = {}) {
  if (metric.status === "empty") return options.emptyHint || "暂无记录";
  if (metric.summary) return metric.summary;
  if (options.average7 !== undefined) return options.average7 === null ? "数据积累中" : `7 日平均 ${formatMetric(options.average7, metric.unit)}`;
  if (metric.change === null) return "数据积累中";
  return metric.change === 0 ? "与本周期起点持平" : `较本周期起点 ${metric.change > 0 ? "+" : ""}${formatMetric(metric.change, metric.unit)}`;
}

function metricCard(name, metric, options = {}) {
  const empty = metric.status === "empty";
  const source = metric.source === "huawei" ? `<span class="metric-source">华为运动健康</span>` : metric.source === "manual" ? `<span class="metric-source">手动记录</span>` : "";
  const content = empty ? `<div class="metric-name">${escapeHtml(name)}</div><div class="metric-value">0 ${escapeHtml(metric.unit)}</div><p class="metric-empty">${escapeHtml(trendDescription(metric, options))}</p>${source}` : `<div class="metric-name">${escapeHtml(name)}</div><div class="metric-value">${formatMetric(metric.value, metric.unit)}</div><div class="metric-trend">${escapeHtml(trendDescription(metric, options))}</div>${buildTrendSvg(metric.series)}${source}`;
  if (options.detailMetric && (metric.status !== "empty" || metric.status === "empty")) return `<button class="metric-card metric-card-button" type="button" data-trend-metric="${options.detailMetric}" aria-label="查看${escapeHtml(name)}变化详情">${content}</button>`;
  return `<article class="metric-card">${content}</article>`;
}

function measurementPoints(measurements, field) {
  const byDate = new Map();
  for (const item of measurements || []) {
    const value = Number(item[field]);
    if (!Number.isFinite(value)) continue;
    const date = typeof item.occurredAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.occurredAt) ? item.occurredAt : new Date(item.occurredAt).toISOString().slice(0, 10);
    byDate.set(date, value);
  }
  return [...byDate].sort(([left], [right]) => left.localeCompare(right)).map(([date, value]) => ({ date, value }));
}

function filterMeasurementPoints(points, range, endDate) {
  return range === "28" ? points.filter((point) => point.date >= addDays(endDate, -27) && point.date <= endDate) : points;
}

const EXECUTION_DETAIL_METRICS = {
  cardio: { label: "有氧训练", unit: "次", event: (item) => item.eventType === "workout" && item.payload?.sessionType === "cardio" },
  strength: { label: "力量训练", unit: "次", event: (item) => item.eventType === "workout" && item.payload?.sessionType === "strength" },
  walks: { label: "饭后步行", unit: "次", event: (item) => item.eventType === "post_meal_walk" },
  fluid: { label: "总饮水量", unit: "ml", event: (item) => item.eventType === "hydration", value: (item) => Number(item.payload?.volumeMl) || 0 },
  tea: { label: "无糖茶量", unit: "ml", event: (item) => item.eventType === "hydration" && item.payload?.type === "tea", value: (item) => Number(item.payload?.volumeMl) || 0 },
  mealPhotos: { label: "餐食照片", unit: "餐", meal: true },
  noAlcohol: { label: "无酒天数", unit: "天", event: (item) => item.eventType === "no_alcohol", daily: true },
  noLateSnack: { label: "无夜宵天数", unit: "天", event: (item) => item.eventType === "no_late_snack", daily: true },
  noSugaryDrink: { label: "无含糖饮料天数", unit: "天", event: (item) => item.eventType === "no_sugary_drink", daily: true }
};

function validTrendDate(value) {
  const date = String(value ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
  return date;
}

function executionPoints(history, metricId) {
  const config = EXECUTION_DETAIL_METRICS[metricId]; const byDate = new Map();
  const add = (dateValue, value, daily = false) => {
    const date = validTrendDate(dateValue); if (!date) return;
    byDate.set(date, daily ? 1 : (byDate.get(date) || 0) + value);
  };
  if (config.meal) for (const meal of history?.meals || []) add(meal.planDate, 1);
  else for (const event of history?.events || []) if (config.event(event)) add(event.planDate, config.value ? config.value(event) : 1, config.daily);
  return [...byDate].filter(([, value]) => value !== 0).sort(([left], [right]) => left.localeCompare(right)).map(([date, value]) => ({ date, value }));
}

function detailTrendSvg(label, range, points, unit) {
  const rangeLabel = range === "28" ? "近 28 天" : "全部";
  const values = points.map((point) => point.chartValue ?? point.value); const minimum = Math.min(...values); const maximum = Math.max(...values); const span = maximum - minimum || 1;
  const x = (index) => 30 + (index * 270 / Math.max(1, points.length - 1));
  const y = (value) => 155 - ((value - minimum) * 120 / span);
  const path = points.length > 1 ? `<path d="${points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point.chartValue ?? point.value).toFixed(1)}`).join(" ")}" fill="none" stroke="#2c8054" stroke-width="3" stroke-linecap="round" />` : "";
  const dots = points.map((point, index) => `<circle cx="${x(index).toFixed(1)}" cy="${y(point.chartValue ?? point.value).toFixed(1)}" r="4" fill="#2c8054"><title>${escapeHtml(`${dateLabel(point.date)} · ${formatMetric(point.chartValue ?? point.value, unit)}`)}</title></circle>`).join("");
  return `<svg class="trend-detail-chart" viewBox="0 0 320 190" role="img" aria-label="${escapeHtml(`${label}${rangeLabel}变化折线图`)}"><line x1="30" y1="155" x2="300" y2="155" stroke="#d7e6dc" /><line x1="30" y1="35" x2="30" y2="155" stroke="#d7e6dc" /><text x="4" y="39" fill="#617369" font-size="11">${escapeHtml(formatMetric(maximum, unit))}</text><text x="4" y="159" fill="#617369" font-size="11">${escapeHtml(formatMetric(minimum, unit))}</text>${path}${dots}<text x="30" y="178" fill="#617369" font-size="11">${escapeHtml(dateLabel(points[0].date))}</text><text x="300" y="178" text-anchor="end" fill="#617369" font-size="11">${escapeHtml(dateLabel(points.at(-1).date))}</text></svg>`;
}

function renderTrendDetail() {
  const bodyConfig = { weight: { label: "体重", field: "weightKg", unit: "kg" }, waist: { label: "腰围", field: "waistCm", unit: "cm" } }[state.trendMetric];
  const config = bodyConfig || EXECUTION_DETAIL_METRICS[state.trendMetric];
  if (!config || !state.trends) return;
  const { label, field, unit } = config; const range = state.trendRange; const execution = !bodyConfig;
  const rawPoints = execution ? executionPoints(state.trends.history, state.trendMetric) : measurementPoints(state.trends.measurements, field);
  const points = filterMeasurementPoints(rawPoints, range, state.trends.endDate);
  $("#trendDetailTitle").textContent = `${label}变化`;
  document.querySelectorAll("[data-trend-range]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.trendRange === range)));
  if (!points.length) {
    $("#trendDetailChart").innerHTML = `<p class="trend-detail-empty">暂无${label}记录</p>`;
    $("#trendDetailPoints").innerHTML = "";
    return;
  }
  $("#trendDetailChart").innerHTML = detailTrendSvg(label, range, points, unit);
  $("#trendDetailPoints").innerHTML = points.map((point) => `<div class="item"><strong>${escapeHtml(dateLabel(point.date))}</strong> · ${execution ? `当日 ${escapeHtml(formatMetric(point.value, unit))}` : escapeHtml(formatMetric(point.value, unit))}</div>`).join("");
}

function unavailableCard(name, hint, screening = false) {
  return `<article class="metric-card"><div class="metric-name">${escapeHtml(name)}</div><p class="metric-empty">${screening ? "未录入体检数据" : "暂未采集"}<br>${escapeHtml(hint)}</p></article>`;
}

function metricGroup(title, copy, cards) {
  return `<section class="metric-group"><h2>${escapeHtml(title)}</h2><p class="muted">${escapeHtml(copy)}</p><div class="metric-grid">${cards.join("")}</div></section>`;
}

function renderMetricTrends(data) {
  state.trends = data;
  const current = data.current;
  const core = metricGroup("核心结果", "身体结果以腰围和体重趋势为主。", [
    metricCard("体重", current.weight, { average7: current.weight.average7, emptyHint: "每天起床、如厕后快速录入。", detailMetric: "weight" }),
    metricCard("腰围", current.waist, { emptyHint: "建议每周用软尺记录一次。", detailMetric: "waist" })
  ]);
  const execution = metricGroup("执行与行为", "近 28 日累计；折线展示近 28 天每日记录。", [
    metricCard("有氧训练", current.cardio, { detailMetric: "cardio" }), metricCard("力量训练", current.strength, { detailMetric: "strength" }), metricCard("饭后步行", current.walks, { detailMetric: "walks" }),
    metricCard("总饮水量", current.fluid, { detailMetric: "fluid" }), metricCard("无糖茶量", current.tea, { detailMetric: "tea" }), metricCard("餐食照片", current.mealPhotos, { detailMetric: "mealPhotos" }),
    metricCard("无酒天数", current.noAlcohol, { detailMetric: "noAlcohol" }), metricCard("无夜宵天数", current.noLateSnack, { detailMetric: "noLateSnack" }), metricCard("无含糖饮料天数", current.noSugaryDrink, { detailMetric: "noSugaryDrink" })
  ]);
  const huaweiMetrics = [["步数", current.steps], ["活动消耗", current.activeCalories], ["运动时长", current.exerciseMinutes], ["睡眠时长", current.sleep], ["深睡时长", current.deepSleep], ["静息心率", current.restingHr]];
  const availableHuawei = huaweiMetrics.filter(([, metric]) => metric.status !== "empty");
  const huawei = availableHuawei.length ? metricGroup("华为运动健康", "仅展示已授权并成功同步的指标。", availableHuawei.map(([name, metric]) => metricCard(name, metric))) : "";
  const unavailable = metricGroup("待接入指标", "这些指标还没有当前数据源，系统不会以估算值替代。", [
    !availableHuawei.some(([name]) => name === "步数") ? unavailableCard("步数", "连接华为运动健康后同步。") : "", !availableHuawei.some(([name]) => name === "睡眠时长") ? unavailableCard("睡眠时长", "连接华为运动健康后同步。") : "",
    !availableHuawei.some(([name]) => name === "静息心率") ? unavailableCard("静息心率 / HRV", "连接华为运动健康后同步。") : "", unavailableCard("血压", "需要时通过网页手动录入。"),
    unavailableCard("蛋白质 / 总碳水 / 脂肪", "待接入 AI 食物识别与营养数据库。")
  ]);
  const screening = metricGroup("阶段性体检", "低频体检指标；录入后再显示历史变化。", [
    unavailableCard("空腹血糖 FPG", "体检抽血后录入。", true), unavailableCard("HbA1c", "体检抽血后录入。", true),
    unavailableCard("TG / HDL-C / LDL-C", "体检抽血后录入。", true), unavailableCard("ALT / AST / GGT", "体检抽血后录入。", true),
    unavailableCard("尿酸", "体检抽血后录入。", true), unavailableCard("肝脏超声", "体检或医疗机构结果录入。", true)
  ]);
  $("#trendView").innerHTML = `${core}${execution}${huawei}${unavailable}${screening}`;
}

function renderHuaweiStatus(data) {
  const status = $("#huaweiHealthStatus"); const connect = $("#connectHuaweiHealth"); const sync = $("#syncHuaweiHealth"); const disconnect = $("#disconnectHuaweiHealth");
  if (!data.enabled) { status.textContent = "尚未在服务器启用华为运动健康接入。"; connect.disabled = true; sync.disabled = true; disconnect.disabled = true; return; }
  const labels = { connected: "已连接", reauth_required: "需要重新授权", disconnected: "尚未连接" };
  status.textContent = `状态：${labels[data.status] || data.status}${data.lastSuccessfulSyncAt ? `；最近同步：${new Date(data.lastSuccessfulSyncAt).toLocaleString("zh-CN")}` : ""}`;
  connect.disabled = data.status === "connected"; sync.disabled = data.status !== "connected"; disconnect.disabled = data.status === "disconnected";
}

async function loadTab(tab) {
  if (tab === "today") return refreshToday();
  if (tab === "plan") { if (!state.today) await refreshToday(); return selectPlanDate(state.planDate || state.today.date); }
  if (tab === "diet") { const data = await request("/meals"); $("#dietView").innerHTML = data.meals.length ? data.meals.map((meal) => `<div class="item">${escapeHtml(meal.mealType)} · 待 AI 分析</div>`).join("") : "暂无照片。"; }
  if (tab === "trends") { renderMetricTrends(await request("/trends", { cache: "no-store" })); }
  if (tab === "compare" || tab === "report") { const data = await request(tab === "compare" ? "/plan-vs-actual" : "/weekly-report"); const container = $(tab === "compare" ? "#compareView" : "#reportView"); container.innerHTML = `<p>本周执行分数：<strong>${data.executionScore}%</strong></p>${data.outcome ? `<p>4 周结果：${escapeHtml(data.outcome.label)}</p>` : ""}<table class="table"><thead><tr><th>项目</th><th>计划</th><th>实际</th><th>完成</th><th>偏差</th></tr></thead><tbody>${data.comparison.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${formatMetric(item.planned, item.unit)}</td><td>${formatMetric(item.actual, item.unit)}</td><td>${item.completionRate ?? "--"}%</td><td>${formatMetric(item.difference, item.unit)}</td></tr>`).join("")}</tbody></table>`; }
  if (tab === "settings") { const [data, huawei] = await Promise.all([request("/settings"), request("/integrations/huawei/status")]); $("#hydrationTarget").value = data.settings.hydrationTargetMl; $("#cutoff").value = data.settings.planDayCutoff; $("#massageEnabled").checked = data.settings.abdominalMassageEnabled; renderHuaweiStatus(huawei); }
}

document.addEventListener("click", async (event) => {
  const planDate = event.target.closest("[data-plan-date]"); if (planDate) { try { await selectPlanDate(planDate.dataset.planDate); } catch (error) { showError(errorMessage(error)); } return; }
  const tab = event.target.closest("[data-tab]"); if (tab) { document.querySelectorAll(".tab").forEach((item) => item.setAttribute("aria-selected", String(item === tab))); document.querySelectorAll(".panel").forEach((item) => item.classList.toggle("active", item.id === tab.dataset.tab)); try { await loadTab(tab.dataset.tab); } catch (error) { showError(errorMessage(error)); } return; }
  const trendMetric = event.target.closest("[data-trend-metric]"); if (trendMetric) { state.trendMetric = trendMetric.dataset.trendMetric; state.trendRange = "28"; renderTrendDetail(); const dialog = $("#trendDetailDialog"); if (typeof dialog.showModal === "function") dialog.showModal(); else showError("当前浏览器不支持趋势详情窗口。"); return; }
  const trendRange = event.target.closest("[data-trend-range]"); if (trendRange) { state.trendRange = trendRange.dataset.trendRange; renderTrendDetail(); return; }
  const connectHuawei = event.target.closest("#connectHuaweiHealth"); if (connectHuawei) { try { const data = await request("/integrations/huawei/connect", { method: "POST", body: "{}" }); window.location.assign(data.authorizationUrl); } catch (error) { showError(errorMessage(error)); } return; }
  const syncHuawei = event.target.closest("#syncHuaweiHealth"); if (syncHuawei) { try { await request("/integrations/huawei/sync", { method: "POST", body: "{}" }); showError("已开始同步，请稍后刷新趋势页。", false); await loadTab("settings"); } catch (error) { showError(errorMessage(error)); } return; }
  const disconnectHuawei = event.target.closest("#disconnectHuaweiHealth"); if (disconnectHuawei) { try { await request("/integrations/huawei", { method: "DELETE" }); await loadTab("settings"); } catch (error) { showError(errorMessage(error)); } return; }
  const mealAction = event.target.closest("[data-meal-action]"); if (mealAction) { const input = $("#mealPhotoInput"); input.dataset.meal = mealAction.dataset.mealAction; input.click(); return; }
  const measurementAction = event.target.closest("[data-measurement-action]"); if (measurementAction) { const dialog = $("#measurementDialog"); if (typeof dialog.showModal === "function") dialog.showModal(); else showError("当前浏览器不支持身体记录窗口。"); return; }
  const hydration = event.target.closest("[data-hydration], [data-tea]"); if (hydration) { const volume = Number(hydration.dataset.hydration || hydration.dataset.tea); submitAction(hydration, "/hydration", { type: hydration.dataset.tea ? "tea" : "water", volumeMl: volume }, `已记录 +${volume} ml`); return; }
  const task = event.target.closest("[data-checkin-type]"); if (task) {
    const eventId = task.dataset.eventId;
    if (eventId) {
      task.disabled = true; showError();
      try { await request(`/events/${eventId}/undo`, { method: "POST", body: "{}" }); await refreshToday(); }
      catch (error) { showError(errorMessage(error)); }
      finally { task.disabled = false; }
      return;
    }
    const sessionType = task.dataset.taskId === "training" && ["cardio", "strength"].includes(state.today.plan.training.type) ? state.today.plan.training.type : undefined;
    submitAction(task, "/checkins", { type: task.dataset.checkinType, sessionType, taskId: task.dataset.taskId }, "已记录，点击撤销"); return;
  }
  const notice = event.target.closest("[data-notification]"); if (notice) { try { await request(`/notifications/${notice.dataset.notification}`, { method: "PATCH" }); await refreshToday(); } catch (error) { showError(errorMessage(error)); } }
});
document.addEventListener("input", (event) => { const slider = event.target.closest("[data-fluid-slider]"); if (slider) showFluidValue(slider.dataset.fluidSlider, Number(slider.value)); });
document.addEventListener("change", async (event) => {
  if (event.target.matches("#mealPhotoInput")) { await uploadMeal(event.target); return; }
  const slider = event.target.closest("[data-fluid-slider]"); if (slider) await submitFluidDelta(slider.dataset.fluidSlider, slider);
});
$("#undoButton").addEventListener("click", async () => { if (!state.undoEventId) return; try { await request(`/events/${state.undoEventId}/undo`, { method: "POST", body: "{}" }); $("#snackbar").classList.remove("show"); await refreshToday(); } catch (error) { showError(errorMessage(error)); } });
$("#cancelMeasurement").addEventListener("click", () => $("#measurementDialog").close());
$("#closeTrendDetail").addEventListener("click", () => $("#trendDetailDialog").close());
$("#measurementForm").addEventListener("submit", async (event) => {
  event.preventDefault(); const button = $("#saveMeasurement"); button.disabled = true; showError();
  try {
    const data = await request("/measurements", { method: "POST", body: JSON.stringify({ weightKg: $("#weightKg").value || null, waistCm: $("#waistCm").value || null }) });
    if (data?.queued) { showError("已离线保存，待联网同步。"); return; }
    $("#measurementDialog").close(); await refreshToday(); await syncQueuedRequests();
  } catch (error) { showError(errorMessage(error)); }
  finally { button.disabled = false; }
});
$("#saveSettings").addEventListener("click", async () => { try { await request("/settings", { method: "PATCH", body: JSON.stringify({ hydrationTargetMl: Number($("#hydrationTarget").value), planDayCutoff: $("#cutoff").value, abdominalMassageEnabled: $("#massageEnabled").checked }) }); await refreshToday(); showError(); } catch (error) { showError(errorMessage(error)); } });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/health-sw.js", { scope: "/" }).catch(() => {});
window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); deferredInstallPrompt = event; $("#installHealthApp").hidden = false; });
$("#installHealthButton").addEventListener("click", async () => { if (!deferredInstallPrompt) return; await deferredInstallPrompt.prompt(); deferredInstallPrompt = null; $("#installHealthApp").hidden = true; });
$("#dismissInstall").addEventListener("click", () => { $("#installHealthApp").hidden = true; });
window.addEventListener("online", () => { syncQueuedRequests().catch(() => updatePwaStatus()); });
window.addEventListener("offline", () => { updatePwaStatus(); });
refreshToday().catch((error) => showError(errorMessage(error))).finally(() => { updatePwaStatus(); syncQueuedRequests().catch(() => updatePwaStatus()); });
