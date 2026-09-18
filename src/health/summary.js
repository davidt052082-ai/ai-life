import { getDailyPlan, getHighlightedTask } from "./plan.js";

export function buildDailySummary({ date, timezone = "Asia/Shanghai", settings = {}, events = [], meals = [] }) {
  const hydration = events.filter((event) => event.eventType === "hydration").reduce((total, event) => {
    const volume = Number(event.payload?.volumeMl) || 0;
    if (event.payload?.type === "tea") total.teaMl += volume;
    else total.waterMl += volume;
    return total;
  }, { waterMl: 0, teaMl: 0 });
  hydration.totalMl = hydration.waterMl + hydration.teaMl;
  const completed = new Set(events.map((event) => event.eventType));
  const mealTypes = Object.fromEntries(meals.map((meal) => [meal.mealType, true]));
  const plan = getDailyPlan(date, timezone, settings);
  const remainingTasks = plan.tasks.filter((task) => {
    if (task.id.endsWith("-photo")) return !mealTypes[task.id.replace("-photo", "")];
    if (task.id === "hydration") return hydration.totalMl < plan.hydrationTargetMl;
    if (task.id === "training") return !completed.has(plan.training.type === "baduanjin" ? "baduanjin" : "workout");
    return !completed.has(task.id.replaceAll("-", "_"));
  });
  const completedCount = plan.tasks.length - remainingTasks.length;
  return {
    date, plan, meals: mealTypes, mealPhotoCount: meals.length, hydration, completedCount,
    completionPercent: Math.round(completedCount * 100 / plan.tasks.length), remainingTasks,
    highlightedTask: getHighlightedTask(new Date(), { meals: mealTypes, remainingTasks, plan }, timezone)
  };
}

export function buildWeeklyComparison({ targets, actuals }) {
  return Object.entries(targets).map(([id, target]) => {
    const actual = Number(actuals[id] || 0);
    return { id, planned: target, actual, completionRate: target ? Math.round(actual * 100 / target) : null, difference: actual - target };
  });
}

export function buildReminderCandidates({ now, summary, timezone = "Asia/Shanghai" }) {
  const task = getHighlightedTask(now, summary, timezone);
  if (!task) return [];
  const message = task.id.endsWith("-photo") ? `${task.label}，拍一张即可完成` : `今天还差：${task.label}`;
  return [{ kind: task.id, message }];
}
