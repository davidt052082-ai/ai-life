export const STUDENTS = ["大公主", "小公主"];

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime()) && toIsoDate(date) === value;
}

function isTime(value) {
  if (!/^\d{2}:\d{2}$/.test(value)) return false;
  const [hours, minutes] = value.split(":").map(Number);
  return hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60;
}

export function toIsoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function validatePlanInput(plan) {
  if (!STUDENTS.includes(plan?.student)) return "请选择学习者。";
  if (![plan.subject, plan.location].every((value) => typeof value === "string" && value.trim())) return "请完整填写计划信息。";
  if (!isIsoDate(plan.startDate) || !isTime(plan.startTime) || !isTime(plan.endTime)) return "日期或时间格式无效。";
  if (plan.subject.trim().length > 30 || plan.location.trim().length > 50) return "科目或地点内容过长。";
  if (plan.startTime >= plan.endTime) return "结束时间必须晚于开始时间。";
  if (!Number.isInteger(plan.studyDays) || plan.studyDays < 1 || !Number.isInteger(plan.restDays) || plan.restDays < 0 || !Number.isInteger(plan.targetStudyDays) || plan.targetStudyDays < 1) return "学习天数和目标学习天数至少为 1；休息天数可为 0。";
  return "";
}

export function expandPlan(plan) {
  const cursor = new Date(`${plan.startDate}T00:00:00`);
  const events = [];
  let completed = 0;

  while (completed < plan.targetStudyDays) {
    for (let day = 0; day < plan.studyDays && completed < plan.targetStudyDays; day += 1) {
      events.push({ ...plan, date: toIsoDate(cursor) });
      completed += 1;
      cursor.setDate(cursor.getDate() + 1);
    }
    cursor.setDate(cursor.getDate() + plan.restDays);
  }

  return events;
}

export function sortEvents(events) {
  return [...events].sort((left, right) => left.date.localeCompare(right.date) || left.startTime.localeCompare(right.startTime) || left.subject.localeCompare(right.subject));
}

export function isRestDate(plan, isoDate) {
  if (plan.restDays === 0) return false;
  const events = expandPlan(plan);
  const finalStudyDate = events.at(-1)?.date;
  if (!finalStudyDate || isoDate < plan.startDate || isoDate > finalStudyDate || events.some((event) => event.date === isoDate)) return false;

  const start = new Date(`${plan.startDate}T00:00:00`);
  const date = new Date(`${isoDate}T00:00:00`);
  const elapsedDays = Math.round((date - start) / 86400000);
  const cycleLength = plan.studyDays + plan.restDays;
  return elapsedDays % cycleLength >= plan.studyDays;
}
