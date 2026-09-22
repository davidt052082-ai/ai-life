const API_ROOT = "/api/projects/task-management/task-management";
const $ = (selector) => document.querySelector(selector);
const emptyWorkspace = () => ({ people: [], tasks: [], dependencies: [], warnings: [] });
const S = {
  projects: [], workspaceId: "", workspace: emptyWorkspace(), view: "command",
  filter: "", taskId: null, personId: null, focus: new Set(),
  loading: true, saving: false, loadVersion: 0, renderVersion: 0, failed: false
};
const content = $("#content");
const projectSelect = $("#workspace-select");
const projectDialog = $("#project-dialog");
const projectForm = $("#project-form");
const taskDialog = $("#task-dialog");
const taskForm = $("#task-form");
const personDialog = $("#person-dialog");
const personForm = $("#person-form");
const statusLabels = { not_started: "未开始", in_progress: "进行中", blocked: "阻塞", completed: "已完成" };

async function api(path, options = {}) {
  const response = await fetch(API_ROOT + path, {
    ...options, headers: { "Content-Type": "application/json", ...options.headers }
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.message || "请求失败，请稍后重试。");
  return body;
}
function scopedPath(path, workspaceId = S.workspaceId) {
  if (!workspaceId) throw new Error("请先选择项目。");
  return "/workspaces/" + encodeURIComponent(workspaceId) + path;
}
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
const tasks = () => S.workspace.tasks.filter((task) => !S.filter || task.assigneeId === S.filter);
function notice(message = "", error = false) {
  $("#notice").textContent = message;
  $("#notice").classList.toggle("error", error);
}
function lockControls() {
  projectSelect.disabled = S.saving || !S.projects.length;
  $("#new-project").disabled = S.saving || S.loading;
  $("#new-task").disabled = S.saving || S.loading || S.failed || !S.workspaceId;
  $("#assignee-filter").disabled = S.saving || S.loading || S.failed || !S.workspaceId;
  document.querySelectorAll("dialog button, dialog input, dialog select, dialog textarea").forEach((element) => {
    element.disabled = S.saving;
  });
}
function options() {
  projectSelect.innerHTML = S.projects.length
    ? S.projects.map((project) => '<option value="' + esc(project.id) + '">' + esc(project.name) + "</option>").join("")
    : '<option value="">暂无项目</option>';
  projectSelect.value = S.workspaceId;
  const project = S.projects.find((item) => item.id === S.workspaceId);
  $("#project-description").textContent = project ? project.name + (project.description ? " · " + project.description : "") : "";
  const peopleOptions = S.workspace.people.map((person) =>
    '<option value="' + esc(person.id) + '">' + esc(person.name) + "</option>").join("");
  $("#assignee-filter").innerHTML = '<option value="">全部负责人</option>' + peopleOptions;
  $("#assignee-filter").value = S.filter;
  taskForm.elements.assigneeId.innerHTML = '<option value="">未分配</option>' + peopleOptions;
  document.querySelectorAll("nav button").forEach((button) => button.classList.toggle("active", button.dataset.view === S.view));
  lockControls();
}
function warnings() {
  $("#warning-panel").innerHTML = S.workspace.warnings.map((warning) =>
    '<button class="' + esc(warning.severity) + '" data-warning="' + esc(warning.id) + '">' +
    (warning.severity === "error" ? "逻辑冲突" : "资源预警") + "<br><small>" + esc(warning.message) + "</small></button>"
  ).join("") || '<p class="muted">' + (S.workspaceId ? "当前项目没有预警" : "选择项目后查看预警") + "</p>";
}
function card(task) {
  return '<div class="panel ' + (S.focus.has(task.id) ? "focused" : "") + '" data-task="' + esc(task.id) + '" draggable="true">' +
    "<b>" + (task.isMilestone ? "◆ " : "") + esc(task.title) + '</b><p class="muted">' +
    esc(task.startDate || "未排期") + " → " + esc(task.endDate || "未设置") + " · 预计 " + task.estimatedHours +
    "h / 实际 " + task.actualHours + "h · " + esc(statusLabels[task.status] || task.status) + "</p>" +
    '<button class="button" data-edit-task="' + esc(task.id) + '">编辑</button> ' +
    '<button class="button" data-delete-task="' + esc(task.id) + '">删除</button></div>';
}
function command() {
  const all = S.workspace.tasks;
  const done = all.filter((task) => task.status === "completed").length;
  content.innerHTML = '<h1>项目指挥中心</h1><div class="people-grid">' +
    [["全部事项", all.length], ["进行中", all.filter((task) => task.status === "in_progress").length],
      ["风险", S.workspace.warnings.length], ["完成度", (all.length ? Math.round(done / all.length * 100) : 0) + "%"]]
      .map(([title, value]) => '<article class="panel">' + title + "<br><b>" + value + "</b></article>").join("") +
    "</div><h2>关注事项</h2>" + (tasks().map(card).join("") || '<p class="muted">当前项目暂无事项，点击“新建事项”开始。</p>');
}
function timeline() { content.innerHTML = "<h1>时间线</h1>" + (tasks().map(card).join("") || '<p class="muted">当前项目暂无事项</p>'); }
function list() { content.innerHTML = "<h1>任务清单</h1>" + (tasks().map(card).join("") || '<p class="muted">当前项目暂无事项</p>'); }
function board() {
  content.innerHTML = '<h1>状态看板</h1><div class="people-grid">' + Object.entries(statusLabels).map(([status, label]) =>
    '<section class="panel column" data-status="' + status + '"><b>' + label + "</b>" +
    tasks().filter((task) => task.status === status).map(card).join("") + "</section>").join("") + "</div>";
}
function network() {
  const taskOptions = S.workspace.tasks.map((task) => '<option value="' + esc(task.id) + '">' + esc(task.title) + "</option>").join("");
  content.innerHTML = '<h1>依赖网络</h1><form id="dependency-form" class="panel"><div class="twocol">' +
    '<label>前置<select name="predecessorId">' + taskOptions + '</select></label><label>后置<select name="successorId">' +
    taskOptions + '</select></label></div><button class="button primary"' + (taskOptions ? "" : " disabled") + ">添加依赖</button></form>" +
    S.workspace.dependencies.map((edge) => '<div class="panel ' +
      (S.focus.has(edge.predecessorId) || S.focus.has(edge.successorId) ? "focused" : "") + '">' +
      esc(S.workspace.tasks.find((task) => task.id === edge.predecessorId)?.title || "?") + " → " +
      esc(S.workspace.tasks.find((task) => task.id === edge.successorId)?.title || "?") +
      ' <button class="button" data-delete-dependency="' + esc(edge.id) + '">删除</button></div>').join("");
}
async function logs(version) {
  content.innerHTML = '<h1>操作日志</h1><p class="muted">正在加载…</p>';
  const workspaceId = S.workspaceId;
  const result = await api(scopedPath("/logs", workspaceId));
  if (version !== S.renderVersion || workspaceId !== S.workspaceId || S.view !== "logs") return;
  const actions = { create: "新增", update: "修改", delete: "删除" };
  content.innerHTML = "<h1>操作日志</h1>" + (result.logs.map((log) =>
    '<div class="panel"><b>' + esc(actions[log.action] || log.action) + "</b> " +
    esc(log.afterState?.title || log.afterState?.name || log.beforeState?.title || log.beforeState?.name || "依赖关系") +
    ' <span class="muted">' + esc(new Date(log.createdAt).toLocaleString()) + "</span></div>").join("") ||
    '<p class="muted">当前项目暂无日志</p>');
}
function people() {
  content.innerHTML = '<h1>责任人 <button class="button primary" id="new-person">＋ 新增责任人</button></h1><div class="people-grid">' +
    (S.workspace.people.map((person) => '<article class="person" style="--color:' +
      (/^#[0-9a-f]{6}$/i.test(person.color) ? person.color : "#38BDF8") + '"><b>' + esc(person.name) +
      '</b><p class="muted">每日容量 ' + person.dailyCapacityHours + ' 小时</p><button class="button" data-edit-person="' +
      esc(person.id) + '">编辑</button> <button class="button" data-delete-person="' + esc(person.id) +
      '">删除</button></article>').join("") || '<p class="muted">当前项目暂无责任人，请先新增。</p>') + "</div>";
}
function render() {
  const version = ++S.renderVersion;
  options();
  warnings();
  if (S.loading) { content.innerHTML = '<p class="panel">正在加载项目…</p>'; return; }
  if (S.failed) { content.innerHTML = '<p class="panel">项目加载失败。<button class="button" id="retry-project">重试</button></p>'; return; }
  if (!S.workspaceId) {
    content.innerHTML = '<section class="panel"><h1>创建你的第一个项目</h1><p class="muted">每个项目独立管理事项、责任人、依赖和操作日志。</p><button class="button primary" id="empty-new-project">＋ 新建项目</button></section>';
    return;
  }
  Promise.resolve(({ command, timeline, tasks: list, network, board, people, logs }[S.view])(version))
    .catch((error) => { if (version === S.renderVersion) notice(error.message, true); });
}
function rememberProject(id) {
  const url = new URL(location.href);
  if (id) url.searchParams.set("workspace", id); else url.searchParams.delete("workspace");
  history.replaceState(null, "", url);
}
async function switchProject(id) {
  if (S.saving) return;
  const version = ++S.loadVersion;
  S.workspaceId = id;
  S.workspace = emptyWorkspace();
  S.filter = "";
  S.focus.clear();
  S.taskId = S.personId = null;
  [taskDialog, personDialog].forEach((dialog) => dialog.close());
  S.loading = Boolean(id);
  S.failed = false;
  notice();
  render();
  if (!id) { rememberProject(""); return; }
  try {
    const result = await api(scopedPath("/workspace", id));
    if (version !== S.loadVersion) return;
    S.workspace = result;
    rememberProject(id);
  } catch (error) {
    if (version !== S.loadVersion) return;
    S.failed = true;
    notice(error.message, true);
  } finally {
    if (version === S.loadVersion) { S.loading = false; render(); }
  }
}
async function initialize() {
  S.loading = true;
  S.failed = false;
  render();
  try {
    const result = await api("/workspaces");
    S.projects = result.workspaces;
    const requested = new URL(location.href).searchParams.get("workspace");
    await switchProject(S.projects.find((project) => project.id === requested)?.id || S.projects[0]?.id || "");
  } catch (error) {
    S.loading = false;
    S.failed = true;
    notice(error.message, true);
    render();
  }
}
async function save(path, method, body, dialog) {
  if (S.saving || S.loading || S.failed || !S.workspaceId) return;
  const workspaceId = S.workspaceId; // Capture the destination before the asynchronous request.
  S.saving = true;
  lockControls();
  try {
    const result = await api(scopedPath(path, workspaceId), { method, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (S.workspaceId === workspaceId) {
      S.workspace = result.workspace;
      if (!S.workspace.people.some((person) => person.id === S.filter)) S.filter = "";
      dialog?.close();
      notice("已保存到当前项目。");
    }
  } catch (error) { notice(error.message, true); }
  finally {
    S.saving = false;
    // Do not reset an open task's assignee field when a save failed.
    if (dialog?.open) lockControls(); else render();
  }
}
function openTask(id) {
  const task = S.workspace.tasks.find((item) => item.id === id);
  if (id && !task) return;
  S.taskId = id;
  taskForm.reset();
  $("#task-title").textContent = id ? "编辑事项" : "新建事项";
  if (task) for (const [key, value] of Object.entries(task)) {
    const field = taskForm.elements.namedItem(key);
    if (!field) continue;
    if (field.type === "checkbox") field.checked = value; else field.value = value ?? "";
  }
  taskDialog.showModal();
}
function openPerson(id) {
  const person = S.workspace.people.find((item) => item.id === id);
  if (id && !person) return;
  S.personId = id;
  personForm.reset();
  $("#person-title").textContent = id ? "编辑责任人" : "新增责任人";
  if (person) for (const key of ["name", "color", "dailyCapacityHours"]) personForm.elements.namedItem(key).value = person[key];
  personDialog.showModal();
}
document.addEventListener("click", (event) => {
  const target = event.target;
  if (S.saving) return;
  if (target.closest("#new-project, #empty-new-project")) {
    projectForm.reset();
    projectDialog.showModal();
    return;
  }
  if (target.closest("#retry-project")) { if (S.workspaceId) switchProject(S.workspaceId); else initialize(); return; }
  const nav = target.closest("[data-view]");
  if (nav) { S.view = nav.dataset.view; render(); return; }
  if (S.loading || S.failed || !S.workspaceId) return;
  const warning = target.closest("[data-warning]");
  if (warning) {
    const entry = S.workspace.warnings.find((item) => item.id === warning.dataset.warning);
    if (!entry) return;
    S.filter = "";
    S.focus = new Set(entry.taskIds);
    S.view = entry.kind === "cycle" ? "network" : "timeline";
    render();
    content.querySelector(".focused")?.scrollIntoView({ block: "center" });
    return;
  }
  if (target.closest("#new-task")) return openTask(null);
  if (target.closest("#new-person")) return openPerson(null);
  const edit = target.closest("[data-edit-task]");
  if (edit) return openTask(edit.dataset.editTask);
  const personEdit = target.closest("[data-edit-person]");
  if (personEdit) return openPerson(personEdit.dataset.editPerson);
  const deletion = target.closest("[data-delete-task], [data-delete-person], [data-delete-dependency]");
  if (deletion && confirm("确认删除当前项目中的这条记录？")) {
    const [path, id] = deletion.dataset.deleteTask ? ["tasks", deletion.dataset.deleteTask] :
      deletion.dataset.deletePerson ? ["people", deletion.dataset.deletePerson] : ["dependencies", deletion.dataset.deleteDependency];
    save("/" + path + "/" + encodeURIComponent(id), "DELETE");
  }
});
projectSelect.addEventListener("change", () => switchProject(projectSelect.value));
$("#assignee-filter").addEventListener("change", () => { S.filter = $("#assignee-filter").value; render(); });
$("#cancel").onclick = () => taskDialog.close();
$("#person-cancel").onclick = () => personDialog.close();
$("#project-cancel").onclick = () => projectDialog.close();
for (const dialog of [projectDialog, taskDialog, personDialog]) dialog.addEventListener("cancel", (event) => { if (S.saving) event.preventDefault(); });
taskForm.onsubmit = (event) => {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(taskForm));
  Object.assign(body, { assigneeId: body.assigneeId || null, startDate: body.startDate || null, endDate: body.endDate || null,
    estimatedHours: Number(body.estimatedHours), actualHours: Number(body.actualHours), isMilestone: taskForm.elements.isMilestone.checked });
  save(S.taskId ? "/tasks/" + encodeURIComponent(S.taskId) : "/tasks", S.taskId ? "PATCH" : "POST", body, taskDialog);
};
personForm.onsubmit = (event) => {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(personForm));
  body.dailyCapacityHours = Number(body.dailyCapacityHours);
  save(S.personId ? "/people/" + encodeURIComponent(S.personId) : "/people", S.personId ? "PATCH" : "POST", body, personDialog);
};
projectForm.onsubmit = async (event) => {
  event.preventDefault();
  if (S.saving) return;
  const body = Object.fromEntries(new FormData(projectForm));
  S.saving = true;
  lockControls();
  try {
    const result = await api("/workspaces", { method: "POST", body: JSON.stringify(body) });
    S.projects.push(result.workspace);
    projectDialog.close();
    S.saving = false;
    await switchProject(result.workspace.id);
  } catch (error) { notice(error.message, true); }
  finally { S.saving = false; lockControls(); }
};
document.addEventListener("submit", (event) => {
  if (event.target.id !== "dependency-form") return;
  event.preventDefault();
  save("/dependencies", "POST", Object.fromEntries(new FormData(event.target)));
});
document.addEventListener("dragstart", (event) => {
  const task = event.target.closest("[data-task]");
  if (!task || S.saving) return;
  event.dataTransfer.setData("text/plain", JSON.stringify({ id: task.dataset.task, workspaceId: S.workspaceId }));
});
document.addEventListener("dragover", (event) => { if (event.target.closest(".column")) event.preventDefault(); });
document.addEventListener("drop", (event) => {
  const column = event.target.closest(".column");
  if (!column) return;
  event.preventDefault();
  let payload;
  try { payload = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { return; }
  if (payload.workspaceId !== S.workspaceId) return;
  const task = S.workspace.tasks.find((item) => item.id === payload.id);
  if (!task || task.status === column.dataset.status) return;
  save("/tasks/" + encodeURIComponent(task.id), "PATCH", { ...task, status: column.dataset.status });
});
initialize();
