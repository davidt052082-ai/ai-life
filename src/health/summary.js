import { getDailyPlan, getHighlightedTask } from "./plan.js";

const COMPARISON_METRICS = {
  cardio: { name: "有氧训练", unit: "次" },
  strength: { name: "力量训练", unit: "次" },
  walks: { name: "饭后步行", unit: "次" },
  hydration: { name: "总液体摄入", unit: "ml" },
  alcoholFree: { name: "无酒天数", unit: "天" },
  mealPhotos: { name: "餐食照片", unit: "餐" },
  waist: { name: "腰围记录", unit: "次" }
};

export function buildDailySummary({ date, timezone = "Asia/Shanghai", settings = {}, events = [], meals = [], measurements = [] }) {
  const hydration = events.filter((event) => event.eventType === "hydration").reduce((total, event) => {
    const volume = Number(event.payload?.volumeMl) || 0;
    if (event.payload?.type === "tea") total.teaMl += volume;
    else total.waterMl += volume;
    return total;
  }, { waterMl: 0, teaMl: 0 });
  hydration.totalMl = hydration.waterMl + hydration.teaMl;
  const completed = new Set(events.map((event) => event.eventType));
  const mealTypes = Object.fromEntries(meals.map((meal) => [meal.mealType, true]));
  const actionEvents = Object.fromEntries(events
    .filter((event) => ["lunch-walk", "dinner-walk", "training"].includes(event.payload?.taskId))
    .map((event) => [event.payload.taskId, event.id]));
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
    measurementRecorded: measurements.length > 0, actionEvents,
    completionPercent: Math.round(completedCount * 100 / plan.tasks.length), remainingTasks,
    highlightedTask: getHighlightedTask(new Date(), { meals: mealTypes, remainingTasks, plan }, timezone)
  };
}

export function buildWeeklyComparison({ targets, actuals }) {
  return Object.entries(targets).map(([id, target]) => {
    const actual = Number(actuals[id] || 0);
    const metric = COMPARISON_METRICS[id] || { name: id, unit: "" };
    return { id, ...metric, planned: target, actual, completionRate: target ? Math.round(actual * 100 / target) : null, difference: actual - target };
  });
}

export { COMPARISON_METRICS };

function addDays(date, amount) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function dateFromValue(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Date(value).toISOString().slice(0, 10);
}

function latestValue(series) {
  return [...series].reverse().find((value) => value !== null && value !== undefined) ?? null;
}

function average(values) {
  const valid = values.filter((value) => value !== null && value !== undefined);
  return valid.length ? Number((valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(1)) : null;
}

function metric(value, unit, series, options = {}) {
  const latest = latestValue(series);
  const first = series.find((item) => item !== null && item !== undefined) ?? null;
  const resolved = value ?? latest;
  return {
    value: resolved,
    unit,
    series,
    change: latest !== null && first !== null && latest !== first ? Number((latest - first).toFixed(1)) : null,
    status: resolved === null ? "empty" : "ready",
    ...options
  };
}

export function buildMetricTrends({ startDate, endDate, measurements = [], events = [], meals = [] }) {
  const days = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    days.push({ date, cardioSessions: 0, strengthSessions: 0, postMealWalks: 0, waterMl: 0, teaMl: 0, fluidMl: 0, mealPhotos: 0, noAlcohol: 0, noLateSnack: 0, noSugaryDrink: 0 });
  }
  const byDate = new Map(days.map((day) => [day.date, day]));
  for (const event of events) {
    const day = byDate.get(dateFromValue(event.planDate));
    if (!day) continue;
    if (event.eventType === "hydration") {
      const volume = Number(event.payload?.volumeMl) || 0;
      if (event.payload?.type === "tea") day.teaMl += volume;
      else day.waterMl += volume;
      day.fluidMl += volume;
    }
    if (event.eventType === "workout" && event.payload?.sessionType === "cardio") day.cardioSessions += 1;
    if (event.eventType === "workout" && event.payload?.sessionType === "strength") day.strengthSessions += 1;
    if (event.eventType === "post_meal_walk") day.postMealWalks += 1;
    if (event.eventType === "no_alcohol") day.noAlcohol = 1;
    if (event.eventType === "no_late_snack") day.noLateSnack = 1;
    if (event.eventType === "no_sugary_drink") day.noSugaryDrink = 1;
  }
  for (const meal of meals) {
    const day = byDate.get(dateFromValue(meal.planDate));
    if (day) day.mealPhotos += 1;
  }
  const weightByDate = new Map(); const waistByDate = new Map();
  for (const item of measurements) {
    const date = dateFromValue(item.occurredAt);
    if (item.weightKg !== null && item.weightKg !== undefined) weightByDate.set(date, Number(item.weightKg));
    if (item.waistCm !== null && item.waistCm !== undefined) waistByDate.set(date, Number(item.waistCm));
  }
  const weightSeries = days.map((day) => weightByDate.get(day.date) ?? null);
  const waistSeries = days.map((day) => waistByDate.get(day.date) ?? null);
  const lastSevenWeights = weightSeries.slice(-7);
  const current = {
    weight: metric(latestValue(weightSeries), "kg", weightSeries, { average7: average(lastSevenWeights) }),
    waist: metric(latestValue(waistSeries), "cm", waistSeries),
    cardio: metric(days.slice(-7).reduce((sum, day) => sum + day.cardioSessions, 0), "次", days.map((day) => day.cardioSessions)),
    strength: metric(days.slice(-7).reduce((sum, day) => sum + day.strengthSessions, 0), "次", days.map((day) => day.strengthSessions)),
    walks: metric(days.slice(-7).reduce((sum, day) => sum + day.postMealWalks, 0), "次", days.map((day) => day.postMealWalks)),
    water: metric(latestValue(days.map((day) => day.waterMl)), "ml", days.map((day) => day.waterMl)),
    tea: metric(latestValue(days.map((day) => day.teaMl)), "ml", days.map((day) => day.teaMl)),
    fluid: metric(latestValue(days.map((day) => day.fluidMl)), "ml", days.map((day) => day.fluidMl)),
    mealPhotos: metric(latestValue(days.map((day) => day.mealPhotos)), "餐", days.map((day) => day.mealPhotos)),
    noAlcohol: metric(days.slice(-7).reduce((sum, day) => sum + day.noAlcohol, 0), "天", days.map((day) => day.noAlcohol)),
    noLateSnack: metric(days.slice(-7).reduce((sum, day) => sum + day.noLateSnack, 0), "天", days.map((day) => day.noLateSnack)),
    noSugaryDrink: metric(days.slice(-7).reduce((sum, day) => sum + day.noSugaryDrink, 0), "天", days.map((day) => day.noSugaryDrink))
  };
  return { startDate, endDate, daily: days, current };
}

export function buildReminderCandidates({ now, summary, timezone = "Asia/Shanghai" }) {
  const task = getHighlightedTask(now, summary, timezone);
  if (!task) return [];
  const message = task.id.endsWith("-photo") ? `${task.label}，拍一张即可完成` : `今天还差：${task.label}`;
  return [{ kind: task.id, message }];
}
