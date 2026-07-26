import { STUDENTS, expandPlan, isRestDate, sortEvents, toIsoDate, validatePlanInput } from "/study-plan/schedule.js";

const API_ROOT = "/api/projects/study-plan/study-plans";
const state = {
  view: "overview",
  month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  plans: []
};

const content = document.querySelector("#app-content");
const dialog = document.querySelector("#plan-dialog");
const form = document.querySelector("#plan-form");
const formError = document.querySelector("#form-error");
const saveButton = document.querySelector("#save-plan");
const status = document.querySelector("#sync-status");

function setStatus(message = "", error = false) {
  status.textContent = message;
  status.classList.toggle("error", error);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function studentClass(student) {
  return student === "大公主" ? "rose" : "blue";
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(date) {
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
}

function durationMinutes(startTime, endTime) {
  const [startHour, startMinute] = startTime.split(":").map(Number);
  const [endHour, endMinute] = endTime.split(":").map(Number);
  return endHour * 60 + endMinute - startHour * 60 - startMinute;
}

function formatHours(minutes) {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} 小时` : `${hours.toFixed(1)} 小时`;
}

async function apiFetch(path = "", options = {}) {
  const response = await fetch(`${API_ROOT}${path}`, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  if (response.status === 401) {
    window.location.assign("/login?next=/projects/study-plan");
    throw new Error("请先登录。");
  }
  if (response.status === 403) {
    window.location.assign("/");
    throw new Error("你没有访问此项目的权限。");
  }
  return response;
}

async function responseMessage(response, fallback) {
  const payload = await response.json().catch(() => ({}));
  return payload.message || fallback;
}

function allEvents() {
  return sortEvents(state.plans.flatMap(expandPlan));
}

function visibleEvents(student = "") {
  return allEvents().filter((event) => event.date.startsWith(monthKey(state.month)) && (!student || event.student === student));
}

function metricCard(accent, label, value, note) {
  return `<article class="metric-card ${accent}"><div class="metric-label">${label}</div><div class="metric-value">${value}</div><div class="metric-note">${note}</div></article>`;
}

function planCard(plan) {
  const accent = studentClass(plan.student);
  return `<article class="plan-card ${accent}">
    <button class="delete-plan" type="button" data-delete-plan="${escapeHtml(plan.id)}" aria-label="删除 ${escapeHtml(plan.subject)} 计划">×</button>
    <h3><span class="student-tag ${accent}">${escapeHtml(plan.student)}</span> ${escapeHtml(plan.subject)}</h3>
    <p>${escapeHtml(plan.startDate)} 起 · 学 ${plan.studyDays} 天／休 ${plan.restDays} 天 · 共 ${plan.targetStudyDays} 个学习日</p>
    <div class="tag-row"><span class="tag">${escapeHtml(plan.startTime)}–${escapeHtml(plan.endTime)}</span><span class="tag">${escapeHtml(plan.location)}</span></div>
  </article>`;
}

function eventChip(event) {
  const accent = studentClass(event.student);
  const title = `${event.student} · ${event.subject} · ${event.startTime}–${event.endTime} · ${event.location}`;
  return `<span class="event-chip ${accent}" title="${escapeHtml(title)}">${escapeHtml(event.startTime)} ${escapeHtml(event.subject)}</span>`;
}

function restNotes(isoDate, student = "") {
  return state.plans
    .filter((plan) => (!student || plan.student === student) && isRestDate(plan, isoDate))
    .map((plan) => `<div class="rest-note">${student ? "休息日" : `${escapeHtml(plan.student)} · 休息日`}</div>`)
    .join("");
}

function renderCalendar(events, student = "") {
  const monthStart = new Date(state.month.getFullYear(), state.month.getMonth(), 1);
  const offset = (monthStart.getDay() + 6) % 7;
  const gridStart = new Date(monthStart);
  gridStart.setDate(1 - offset);
  const eventMap = new Map();
  for (const event of events) {
    const onDate = eventMap.get(event.date) || [];
    onDate.push(event);
    eventMap.set(event.date, onDate);
  }
  const today = toIsoDate(new Date());
  const days = [];
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const isoDate = toIsoDate(date);
    const inMonth = date.getMonth() === state.month.getMonth();
    days.push(`<div class="day ${inMonth ? "" : "muted"} ${isoDate === today ? "today" : ""}">
      <span class="day-number">${date.getDate()}</span>
      ${(eventMap.get(isoDate) || []).map(eventChip).join("")}
      ${restNotes(isoDate, student)}
    </div>`);
  }
  return `<div class="month-controls"><h2 class="month-title">${monthLabel(state.month)}</h2><div class="month-actions">
    <button class="month-button" type="button" data-month-change="-1" aria-label="上个月">‹</button>
    <button class="month-button" type="button" data-month-change="0" aria-label="本月">·</button>
    <button class="month-button" type="button" data-month-change="1" aria-label="下个月">›</button>
  </div></div>
  <div class="weekdays"><span class="weekday">一</span><span class="weekday">二</span><span class="weekday">三</span><span class="weekday">四</span><span class="weekday">五</span><span class="weekday">六</span><span class="weekday">日</span></div>
  <div class="calendar-grid">${days.join("")}</div>
  <div class="calendar-legend"><span><i class="legend-dot rose"></i>大公主</span><span><i class="legend-dot blue"></i>小公主</span><span>灰字：休息日</span></div>`;
}

function renderEmpty() {
  return `<section class="empty-state"><div><div class="empty-icon">🗓️</div><h2>把第一条学习计划写下来</h2><p>填写科目、地点和“学习几天／休息几天”，系统会自动把整段计划放进日历。</p><button class="primary-button" data-open-dialog type="button">＋ 新增计划</button></div></section>`;
}

function renderDashboard(events, student) {
  const monthEvents = visibleEvents();
  const visiblePlans = state.plans
    .filter((plan) => !student || plan.student === student)
    .sort((left, right) => left.startDate.localeCompare(right.startDate) || left.startTime.localeCompare(right.startTime));
  const bigDays = new Set(monthEvents.filter((event) => event.student === "大公主").map((event) => event.date)).size;
  const smallDays = new Set(monthEvents.filter((event) => event.student === "小公主").map((event) => event.date)).size;
  const minutes = events.reduce((total, event) => total + durationMinutes(event.startTime, event.endTime), 0);
  const personMetric = student === "大公主"
    ? metricCard("rose", "大公主 · 本月学习日", `${bigDays} 天`, `本月 ${events.length} 节课程`)
    : student === "小公主"
      ? metricCard("blue", "小公主 · 本月学习日", `${smallDays} 天`, `本月 ${events.length} 节课程`)
      : `${metricCard("rose", "大公主 · 本月学习日", `${bigDays} 天`, `本月 ${monthEvents.filter((event) => event.student === "大公主").length} 节课程`)}${metricCard("blue", "小公主 · 本月学习日", `${smallDays} 天`, `本月 ${monthEvents.filter((event) => event.student === "小公主").length} 节课程`)}`;
  const heading = student ? `${student}的学习计划` : "本月学习总览";
  return `<section class="summary-grid">${personMetric}${metricCard("gold", student ? "本月课程时长" : "两人合计课程时长", formatHours(minutes), `${monthLabel(state.month)}已排 ${events.length} 节`)}</section>
  <section class="content-grid"><section class="panel"><div class="panel-header"><h2 class="panel-title">${heading}</h2><span class="panel-hint">${visiblePlans.length} 条计划</span></div><div class="plan-list">${visiblePlans.map(planCard).join("")}</div></section><section class="panel">${renderCalendar(events, student)}</section></section>`;
}

function render() {
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === state.view));
  if (!state.plans.length) {
    content.innerHTML = renderEmpty();
    return;
  }
  const student = STUDENTS.includes(state.view) ? state.view : "";
  const events = visibleEvents(student);
  content.innerHTML = state.view === "calendar"
    ? `<section class="panel">${renderCalendar(events)}</section>`
    : renderDashboard(events, student);
}

function openDialog() {
  form.reset();
  document.querySelector("#start-date").value = toIsoDate(new Date());
  formError.textContent = "";
  dialog.showModal();
  document.querySelector("#subject").focus();
}

function readFormPlan() {
  const data = new FormData(form);
  return {
    student: data.get("student"),
    subject: String(data.get("subject") || "").trim(),
    location: String(data.get("location") || "").trim(),
    startDate: data.get("startDate"),
    startTime: data.get("startTime"),
    endTime: data.get("endTime"),
    studyDays: Number(data.get("studyDays")),
    restDays: Number(data.get("restDays")),
    targetStudyDays: Number(data.get("targetStudyDays"))
  };
}

async function loadPlans() {
  setStatus("正在加载云端计划…");
  const response = await apiFetch();
  if (!response.ok) throw new Error(await responseMessage(response, "无法读取学习计划，请稍后重试。"));
  const payload = await response.json();
  state.plans = Array.isArray(payload.plans) ? payload.plans : [];
  setStatus("");
  render();
}

async function createPlan() {
  const plan = readFormPlan();
  const validation = validatePlanInput(plan);
  if (validation) {
    formError.textContent = validation;
    return;
  }
  formError.textContent = "";
  saveButton.disabled = true;
  saveButton.textContent = "正在保存…";
  try {
    const response = await apiFetch("", { method: "POST", body: JSON.stringify(plan) });
    if (!response.ok) throw new Error(await responseMessage(response, "学习计划保存失败，请稍后重试。"));
    const payload = await response.json();
    state.plans.push(payload.plan);
    dialog.close();
    setStatus("同步完成");
    render();
  } catch (error) {
    formError.textContent = error.message;
    setStatus("同步失败，计划尚未保存。", true);
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "保存计划";
  }
}

async function deletePlan(id) {
  const plan = state.plans.find((item) => item.id === id);
  if (!plan || !window.confirm(`删除“${plan.subject}”计划及其所有生成课程？`)) return;
  try {
    const response = await apiFetch(`/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) throw new Error(await responseMessage(response, "学习计划删除失败，请稍后重试。"));
    state.plans = state.plans.filter((item) => item.id !== id);
    setStatus("同步完成");
    render();
  } catch (error) {
    setStatus(error.message, true);
  }
}

document.querySelector("#open-plan-dialog").addEventListener("click", openDialog);
document.querySelector("#close-plan-dialog").addEventListener("click", () => dialog.close());
document.querySelector("#cancel-plan").addEventListener("click", () => dialog.close());
form.addEventListener("submit", (event) => {
  event.preventDefault();
  createPlan();
});
document.addEventListener("click", (event) => {
  const tab = event.target.closest("[data-view]");
  if (tab) {
    state.view = tab.dataset.view;
    render();
    return;
  }
  if (event.target.closest("[data-open-dialog]")) {
    openDialog();
    return;
  }
  const monthControl = event.target.closest("[data-month-change]");
  if (monthControl) {
    const change = Number(monthControl.dataset.monthChange);
    state.month = change === 0
      ? new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      : new Date(state.month.getFullYear(), state.month.getMonth() + change, 1);
    render();
    return;
  }
  const remove = event.target.closest("[data-delete-plan]");
  if (remove) deletePlan(remove.dataset.deletePlan);
});

loadPlans().catch((error) => {
  content.innerHTML = `<section class="empty-state"><div><div class="empty-icon">☁️</div><h2>暂时无法读取计划</h2><p>${escapeHtml(error.message)}</p><button class="primary-button" data-reload type="button">重新加载</button></div></section>`;
  setStatus("云端计划加载失败。", true);
});

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-reload]")) loadPlans().catch((error) => setStatus(error.message, true));
});
