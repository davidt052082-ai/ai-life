const API_ROOT = "/api/projects/health/health";
const state = { today: null, planDate: null, undoEventId: null, undoTimer: null };
const $ = (selector) => document.querySelector(selector);

const DAILY_SCHEDULE = [
  ["07:00–07:30", "起床、如厕后称体重", "每天 1 次", "记录体重"],
  ["07:30", "早餐", "每天", "拍照一次"],
  ["10:30", "饮水检查", "每天", "摄入不足时轻提醒"],
  ["12:30", "午餐", "每天", "拍照一次"],
  ["12:50–13:05", "饭后快走 10–15 分钟", "每天 1–2 次", "一键打卡"],
  ["15:30", "饮水/无糖茶检查", "每天", "摄入不足时轻提醒"],
  ["18:30", "晚餐", "每天", "拍照一次"],
  ["18:50–19:05", "饭后快走 10–15 分钟", "建议每天", "一键打卡"],
  ["20:00", "当日主训练", "按周计划", "训练提醒 + 完成打卡"],
  ["21:30", "当天漏项检查", "每天", "只提示未完成重点任务"],
  ["22:30", "减少屏幕刺激，准备睡眠", "每天", "可选提醒"],
  ["23:00 前后", "睡眠", "每天", "后续由手环自动采集"]
];
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
function formatMetric(value, unit) { return `${Number(value).toLocaleString("zh-CN")}${unit ? ` ${unit}` : ""}`; }

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (["POST", "PATCH", "DELETE"].includes(options.method)) headers.set("Idempotency-Key", key());
  const response = await fetch(`${API_ROOT}${path}`, { ...options, headers });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "请求失败，请稍后重试。");
  return data;
}

function renderToday(data) {
  state.today = data;
  $("#completion").textContent = `${data.completionPercent}%`;
  $("#completionBar").style.width = `${data.completionPercent}%`;
  $("#remaining").textContent = data.remainingTasks.length ? `还差：${data.remainingTasks.map((item) => item.label).join("、")}` : "今天的计划都完成了。";
  $("#hydration").textContent = `${data.hydration.totalMl} / ${data.plan.hydrationTargetMl} ml`;
  $("#hydrationBar").style.width = `${Math.min(100, Math.round(data.hydration.totalMl * 100 / data.plan.hydrationTargetMl))}%`;
  $("#highlight").textContent = data.highlightedTask ? data.highlightedTask.label : "保持节奏，今天已完成重点任务。";
  $("#quickActions").innerHTML = data.remainingTasks.filter((item) => !item.id.endsWith("-photo") && item.id !== "hydration").map((item) => `<button class="action" data-task="${escapeHtml(item.id)}" type="button">${escapeHtml(item.label)}</button>`).join("");
  $("#mealList").innerHTML = data.mealPhotoCount ? Object.keys(data.meals).map((type) => `<div class="item">${escapeHtml({ breakfast:"早餐", lunch:"午餐", dinner:"晚餐", snack:"加餐" }[type] || type)}：待 AI 分析</div>`).join("") : '<div class="muted">尚未上传餐食照片。</div>';
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
  const schedule = `<div class="plan-section"><h3>${escapeHtml(dateLabel(data.date))} · 每日时间表</h3><table class="plan-table"><thead><tr><th>时间</th><th>事项</th><th>频次</th><th>系统动作</th></tr></thead><tbody>${tableRows(DAILY_SCHEDULE)}</tbody></table></div>`;
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
function showUndo(eventId, text) {
  state.undoEventId = eventId; clearTimeout(state.undoTimer); $("#snackbarText").textContent = text; $("#snackbar").classList.add("show");
  state.undoTimer = setTimeout(() => { state.undoEventId = null; $("#snackbar").classList.remove("show"); }, 6000);
}
async function submitAction(button, path, body, undoText) {
  const original = button.textContent; button.disabled = true; button.textContent = "提交中…"; showError();
  try { const data = await request(path, { method: "POST", body: JSON.stringify(body) }); await refreshToday(); if (data.event?.id) showUndo(data.event.id, undoText); }
  catch (error) { showError(errorMessage(error)); button.textContent = "记录失败，点击重试"; return; }
  finally { button.disabled = false; if (button.textContent === "提交中…") button.textContent = original; }
}

async function compressImage(file) {
  const image = await createImageBitmap(file); const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas"); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale); canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("图片压缩失败。")), "image/webp", .8));
}

async function uploadMeal(input) {
  const file = input.files?.[0]; if (!file) return; showError(); input.disabled = true;
  try { const blob = await compressImage(file); const form = new FormData(); form.append("image", blob, "meal.webp"); form.append("mealType", input.dataset.meal); form.append("capturedAt", new Date().toISOString()); await request("/meals", { method: "POST", body: form }); await refreshToday(); }
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
  if (metric.status === "empty") return "暂未采集";
  if (options.average7 !== undefined) return options.average7 === null ? "数据积累中" : `7 日平均 ${formatMetric(options.average7, metric.unit)}`;
  if (metric.change === null) return "数据积累中";
  return metric.change === 0 ? "与本周期起点持平" : `较本周期起点 ${metric.change > 0 ? "+" : ""}${formatMetric(metric.change, metric.unit)}`;
}

function metricCard(name, metric, options = {}) {
  if (metric.status === "empty") return `<article class="metric-card"><div class="metric-name">${escapeHtml(name)}</div><p class="metric-empty">暂未采集<br>${escapeHtml(options.emptyHint || "记录后将在这里显示趋势。")}</p></article>`;
  return `<article class="metric-card"><div class="metric-name">${escapeHtml(name)}</div><div class="metric-value">${formatMetric(metric.value, metric.unit)}</div><div class="metric-trend">${escapeHtml(trendDescription(metric, options))}</div>${buildTrendSvg(metric.series)}</article>`;
}

function unavailableCard(name, hint, screening = false) {
  return `<article class="metric-card"><div class="metric-name">${escapeHtml(name)}</div><p class="metric-empty">${screening ? "未录入体检数据" : "暂未采集"}<br>${escapeHtml(hint)}</p></article>`;
}

function metricGroup(title, copy, cards) {
  return `<section class="metric-group"><h2>${escapeHtml(title)}</h2><p class="muted">${escapeHtml(copy)}</p><div class="metric-grid">${cards.join("")}</div></section>`;
}

function renderMetricTrends(data) {
  const current = data.current;
  const core = metricGroup("核心结果", "身体结果以腰围和体重趋势为主。", [
    metricCard("体重", current.weight, { average7: current.weight.average7, emptyHint: "每天起床、如厕后快速录入。" }),
    metricCard("腰围", current.waist, { emptyHint: "建议每周用软尺记录一次。" })
  ]);
  const execution = metricGroup("执行与行为", "近 7 天当前汇总；折线展示近 28 天每日记录。", [
    metricCard("有氧训练", current.cardio), metricCard("力量训练", current.strength), metricCard("饭后步行", current.walks),
    metricCard("总饮水量", current.fluid), metricCard("无糖茶量", current.tea), metricCard("餐食照片", current.mealPhotos),
    metricCard("无酒天数", current.noAlcohol), metricCard("无夜宵天数", current.noLateSnack), metricCard("无含糖饮料天数", current.noSugaryDrink)
  ]);
  const unavailable = metricGroup("待接入指标", "这些指标还没有当前数据源，系统不会以估算值替代。", [
    unavailableCard("步数", "待手环同步或手动周汇总。"), unavailableCard("睡眠时长", "待手环同步或手动录入。"),
    unavailableCard("静息心率 / HRV", "待手环自动同步。"), unavailableCard("血压", "需要时通过网页手动录入。"),
    unavailableCard("蛋白质 / 总碳水 / 脂肪", "待接入 AI 食物识别与营养数据库。")
  ]);
  const screening = metricGroup("阶段性体检", "低频体检指标；录入后再显示历史变化。", [
    unavailableCard("空腹血糖 FPG", "体检抽血后录入。", true), unavailableCard("HbA1c", "体检抽血后录入。", true),
    unavailableCard("TG / HDL-C / LDL-C", "体检抽血后录入。", true), unavailableCard("ALT / AST / GGT", "体检抽血后录入。", true),
    unavailableCard("尿酸", "体检抽血后录入。", true), unavailableCard("肝脏超声", "体检或医疗机构结果录入。", true)
  ]);
  $("#trendView").innerHTML = `${core}${execution}${unavailable}${screening}`;
}

async function loadTab(tab) {
  if (tab === "today") return refreshToday();
  if (tab === "plan") { if (!state.today) await refreshToday(); return selectPlanDate(state.planDate || state.today.date); }
  if (tab === "diet") { const data = await request("/meals"); $("#dietView").innerHTML = data.meals.length ? data.meals.map((meal) => `<div class="item">${escapeHtml(meal.mealType)} · 待 AI 分析</div>`).join("") : "暂无照片。"; }
  if (tab === "trends") { renderMetricTrends(await request("/trends")); }
  if (tab === "compare" || tab === "report") { const data = await request(tab === "compare" ? "/plan-vs-actual" : "/weekly-report"); const container = $(tab === "compare" ? "#compareView" : "#reportView"); container.innerHTML = `<p>本周执行分数：<strong>${data.executionScore}%</strong></p>${data.outcome ? `<p>4 周结果：${escapeHtml(data.outcome.label)}</p>` : ""}<table class="table"><thead><tr><th>项目</th><th>计划</th><th>实际</th><th>完成</th><th>偏差</th></tr></thead><tbody>${data.comparison.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${formatMetric(item.planned, item.unit)}</td><td>${formatMetric(item.actual, item.unit)}</td><td>${item.completionRate ?? "--"}%</td><td>${formatMetric(item.difference, item.unit)}</td></tr>`).join("")}</tbody></table>`; }
  if (tab === "settings") { const data = await request("/settings"); $("#hydrationTarget").value = data.settings.hydrationTargetMl; $("#cutoff").value = data.settings.planDayCutoff; $("#massageEnabled").checked = data.settings.abdominalMassageEnabled; }
}

document.addEventListener("click", async (event) => {
  const planDate = event.target.closest("[data-plan-date]"); if (planDate) { try { await selectPlanDate(planDate.dataset.planDate); } catch (error) { showError(errorMessage(error)); } return; }
  const tab = event.target.closest("[data-tab]"); if (tab) { document.querySelectorAll(".tab").forEach((item) => item.setAttribute("aria-selected", String(item === tab))); document.querySelectorAll(".panel").forEach((item) => item.classList.toggle("active", item.id === tab.dataset.tab)); try { await loadTab(tab.dataset.tab); } catch (error) { showError(errorMessage(error)); } return; }
  const hydration = event.target.closest("[data-hydration], [data-tea]"); if (hydration) { const volume = Number(hydration.dataset.hydration || hydration.dataset.tea); submitAction(hydration, "/hydration", { type: hydration.dataset.tea ? "tea" : "water", volumeMl: volume }, `已记录 +${volume} ml`); return; }
  const task = event.target.closest("[data-task]"); if (task) { const type = task.dataset.task === "training" ? (state.today.plan.training.type === "baduanjin" ? "baduanjin" : "workout") : task.dataset.task.replaceAll("-", "_"); const sessionType = task.dataset.task === "training" && ["cardio", "strength"].includes(state.today.plan.training.type) ? state.today.plan.training.type : undefined; submitAction(task, "/checkins", { type, sessionType }, "已记录，点击撤销"); return; }
  const notice = event.target.closest("[data-notification]"); if (notice) { try { await request(`/notifications/${notice.dataset.notification}`, { method: "PATCH" }); await refreshToday(); } catch (error) { showError(errorMessage(error)); } }
});
document.addEventListener("change", (event) => { if (event.target.matches(".photo-input")) uploadMeal(event.target); });
$("#undoButton").addEventListener("click", async () => { if (!state.undoEventId) return; try { await request(`/events/${state.undoEventId}/undo`, { method: "POST", body: "{}" }); $("#snackbar").classList.remove("show"); await refreshToday(); } catch (error) { showError(errorMessage(error)); } });
$("#saveMeasurement").addEventListener("click", async (event) => submitAction(event.currentTarget, "/measurements", { weightKg: $("#weightKg").value || null, waistCm: $("#waistCm").value || null }, "身体记录已保存"));
$("#saveSettings").addEventListener("click", async () => { try { await request("/settings", { method: "PATCH", body: JSON.stringify({ hydrationTargetMl: Number($("#hydrationTarget").value), planDayCutoff: $("#cutoff").value, abdominalMassageEnabled: $("#massageEnabled").checked }) }); await refreshToday(); showError(); } catch (error) { showError(errorMessage(error)); } });
refreshToday().catch((error) => showError(errorMessage(error)));
