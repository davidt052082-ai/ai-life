const WEEKLY_TRAINING = [
  { type: "review", label: "休息 + 周复盘", minMinutes: 5, maxMinutes: 10, countsTowardScore: false },
  { type: "cardio", label: "快走", minMinutes: 40, maxMinutes: 40, countsTowardScore: true },
  { type: "strength", label: "弹力带 + 徒手力量", minMinutes: 30, maxMinutes: 35, countsTowardScore: true },
  { type: "cardio", label: "快走", minMinutes: 40, maxMinutes: 40, countsTowardScore: true },
  { type: "baduanjin", label: "八段锦恢复训练", minMinutes: 15, maxMinutes: 25, countsTowardScore: false },
  { type: "strength", label: "壶铃基础力量", minMinutes: 30, maxMinutes: 35, countsTowardScore: true },
  { type: "cardio", label: "长距离快走", minMinutes: 60, maxMinutes: 60, countsTowardScore: true }
];

function partsAt(instant, timezone) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(instant)).filter(({ type }) => type !== "literal").map(({ type, value }) => [type, value]));
}

function shiftDate(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function getPlanDate(instant, eventType, timezone = "Asia/Shanghai", cutoff = "01:00") {
  const parts = partsAt(instant, timezone);
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  if (!["workout", "baduanjin"].includes(eventType)) return date;
  return `${parts.hour}:${parts.minute}` < cutoff ? shiftDate(date, -1) : date;
}

function getDailySchedule(training) {
  return [
    { id: "measurement", time: "07:00–07:30", label: "起床、如厕后称体重", frequency: "每天 1 次", detail: "记录体重", action: "measurement" },
    { id: "breakfast-photo", time: "07:30", label: "早餐", frequency: "每天", detail: "拍照一次", action: "meal" },
    { id: "morning-hydration", time: "10:30", label: "饮水检查", frequency: "每天", detail: "摄入不足时轻提醒", action: "hydration" },
    { id: "lunch-photo", time: "12:30", label: "午餐", frequency: "每天", detail: "拍照一次", action: "meal" },
    { id: "lunch-walk", time: "12:50–13:05", label: "饭后快走 10–15 分钟", frequency: "每天 1–2 次", detail: "一键打卡", action: "walk" },
    { id: "afternoon-hydration", time: "15:30", label: "饮水/无糖茶检查", frequency: "每天", detail: "摄入不足时轻提醒", action: "hydration" },
    { id: "dinner-photo", time: "18:30", label: "晚餐", frequency: "每天", detail: "拍照一次", action: "meal" },
    { id: "dinner-walk", time: "18:50–19:05", label: "饭后快走 10–15 分钟", frequency: "建议每天", detail: "一键打卡", action: "walk" },
    { id: "training", time: "20:00", label: training.label, frequency: "按周计划", detail: "训练提醒 + 完成打卡", action: "training" },
    { id: "missing-items", time: "21:30", label: "当天漏项检查", frequency: "每天", detail: "只提示未完成重点任务", action: "reminder" },
    { id: "sleep-prep", time: "22:30", label: "减少屏幕刺激，准备睡眠", frequency: "每天", detail: "可选提醒", action: "reminder" },
    { id: "sleep", time: "23:00 前后", label: "睡眠", frequency: "每天", detail: "后续由手环自动采集", action: "reminder" }
  ];
}

export function getDailyPlan(date, timezone = "Asia/Shanghai", settings = {}) {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const tasks = [
    { id: "breakfast-photo", label: "早餐拍照", priority: "high" },
    { id: "lunch-photo", label: "午餐拍照", priority: "high" },
    { id: "dinner-photo", label: "晚餐拍照", priority: "high" },
    { id: "hydration", label: "饮水/茶", priority: "high" },
    { id: "post-meal-walk", label: "饭后走路", priority: "high" },
    { id: "no-alcohol", label: "无酒", priority: "medium" },
    { id: "no-late-snack", label: "无夜宵", priority: "medium" },
    { id: "no-sugary-drink", label: "无含糖饮料", priority: "medium" }
  ];
  const training = WEEKLY_TRAINING[weekday];
  tasks.push({ id: "training", label: training.label, priority: "high", countsTowardScore: training.countsTowardScore });
  if (settings.abdominalMassageEnabled) tasks.push({ id: "abdominal-massage", label: "揉腹 5–10 分钟（舒适辅助）", priority: "low", countsTowardScore: false });
  return { date, timezone, hydrationTargetMl: settings.hydrationTargetMl || 1700, training, tasks, schedule: getDailySchedule(training) };
}

export function getHighlightedTask(instant, summary = {}, timezone = "Asia/Shanghai") {
  const { hour, minute } = partsAt(instant, timezone);
  const time = Number(hour) * 60 + Number(minute);
  const meals = summary.meals || {};
  if (time >= 420 && time < 630 && !meals.breakfast) return { id: "breakfast-photo", label: "早餐拍照" };
  if (time >= 690 && time < 870 && !meals.lunch) return { id: "lunch-photo", label: "午餐拍照" };
  if (time >= 1050 && time < 1200 && !meals.dinner) return { id: "dinner-photo", label: "晚餐拍照" };
  const training = summary.plan?.training;
  const trainingIncomplete = (summary.remainingTasks || []).some((task) => task.id === "training");
  if (trainingIncomplete && training && ((training.type === "baduanjin" && time >= 1170 && time < 1290) || (training.type !== "baduanjin" && time >= 1140 && time < 1260))) {
    return { id: "training", label: training.label };
  }
  return (summary.remainingTasks || []).find((task) => task.priority === "high") || null;
}
