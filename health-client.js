const API_ROOT = "/api/projects/health/health";
const state = { today: null, undoEventId: null, undoTimer: null };
const $ = (selector) => document.querySelector(selector);

function key() { return globalThis.crypto?.randomUUID?.() || `health_${Date.now()}_${Math.random().toString(16).slice(2)}`; }
function errorMessage(error) { return error instanceof Error ? error.message : "操作失败，请重试。"; }
function showError(message = "") { $("#status").textContent = message; }
function escapeHtml(value) { const node = document.createElement("span"); node.textContent = String(value ?? ""); return node.innerHTML; }

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
  $("#planView").innerHTML = data.plan.tasks.map((item) => `<div class="item">${escapeHtml(item.label)}${item.countsTowardScore === false ? "（不计入核心评分）" : ""}</div>`).join("");
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

async function loadTab(tab) {
  if (tab === "today") return refreshToday();
  if (tab === "diet") { const data = await request("/meals"); $("#dietView").innerHTML = data.meals.length ? data.meals.map((meal) => `<div class="item">${escapeHtml(meal.mealType)} · 待 AI 分析</div>`).join("") : "暂无照片。"; }
  if (tab === "trends") { const data = await request("/trends"); $("#trendView").innerHTML = data.measurements.length ? data.measurements.map((item) => `<div class="item">${new Date(item.occurredAt).toLocaleDateString()}：${item.weightKg ?? "--"} kg / ${item.waistCm ?? "--"} cm</div>`).join("") : "暂无身体记录。"; }
  if (tab === "compare" || tab === "report") { const data = await request(tab === "compare" ? "/plan-vs-actual" : "/weekly-report"); const container = $(tab === "compare" ? "#compareView" : "#reportView"); container.innerHTML = `<p>本周执行分数：<strong>${data.executionScore}%</strong></p>${data.outcome ? `<p>4 周结果：${escapeHtml(data.outcome.label)}</p>` : ""}<table class="table"><thead><tr><th>项目</th><th>计划</th><th>实际</th><th>完成</th></tr></thead><tbody>${data.comparison.map((item) => `<tr><td>${escapeHtml(item.id)}</td><td>${item.planned}</td><td>${item.actual}</td><td>${item.completionRate ?? "--"}%</td></tr>`).join("")}</tbody></table>`; }
  if (tab === "settings") { const data = await request("/settings"); $("#hydrationTarget").value = data.settings.hydrationTargetMl; $("#cutoff").value = data.settings.planDayCutoff; $("#massageEnabled").checked = data.settings.abdominalMassageEnabled; }
}

document.addEventListener("click", async (event) => {
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
