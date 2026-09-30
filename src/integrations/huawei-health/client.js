import { randomUUID } from "node:crypto";
import { huaweiError } from "./errors.js";

const DAILY_TYPES = [
  { dataTypeName: "com.huawei.continuous.steps.delta", field: "steps", target: "steps" },
  { dataTypeName: "com.huawei.continuous.calories.burned", field: "calories", target: "activeCaloriesKcal" },
  { dataTypeName: "com.huawei.continuous.activity.intensity", field: "intensity", target: "exerciseMinutes" }
];

function millis(value) { const number = Number(value); return number > 10_000_000_000_000 ? Math.floor(number / 1_000_000) : number; }
function localDate(value, timezone) {
  const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(millis(value)));
  const valueFor = (type) => parts.find((part) => part.type === type)?.value;
  return `${valueFor("year")}-${valueFor("month")}-${valueFor("day")}`;
}
function samplePoints(payload) {
  if (Array.isArray(payload?.samplePoints)) return payload.samplePoints;
  if (Array.isArray(payload?.group)) return payload.group.flatMap((group) => samplePoints(group));
  if (Array.isArray(payload?.sampleSet)) return payload.sampleSet.flatMap((item) => item.samplePoints || []);
  if (Array.isArray(payload?.sampleSets)) return payload.sampleSets.flatMap((item) => item.samplePoints || []);
  return [];
}
function sampleValue(point, expectedField) {
  const value = (point.value || []).find((item) => item.fieldName === expectedField) || point.value?.[0];
  return Number(value?.integerValue ?? value?.floatValue ?? value?.doubleValue ?? value?.longValue);
}

function allowedRedirect(value) {
  try { const url = new URL(value); return url.protocol === "https:" && /^health-api\.cloud\.huawei\./.test(url.hostname) ? url.toString() : null; } catch { return null; }
}

export function createHuaweiHealthClient({ config, fetchImpl = fetch }) {
  async function request(path, { token, method = "GET", body, traceId = randomUUID(), retried = false } = {}) {
    const response = await fetchImpl(new URL(path, config.apiBase).toString(), { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "x-client-id": config.clientId, "x-version": "1", "x-caller-trace-id": traceId }, body: body && JSON.stringify(body) });
    if (response.ok) return response.json();
    const payload = await response.json().catch(() => ({}));
    const relocated = !retried && response.status === 403 && payload?.error?.code === 121001 && allowedRedirect(response.headers.get("location"));
    if (relocated) return request(allowedRedirect(response.headers.get("location")), { token, method, body, traceId, retried: true });
    throw huaweiError({ status: response.status, code: payload?.error?.code });
  }
  const polymerizeDaily = (token, input) => request("/sampleSet:polymerize", { token, method: "POST", body: { polymerizeWith: [{ dataTypeName: input.dataTypeName }], startTime: input.startTime, endTime: input.endTime, groupByTime: { groupPeriod: { unit: "day", value: 1, timeZone: input.timezone } } } });
  async function collectDaily({ token, window, timezone }) {
    const input = { startTime: window.start.getTime(), endTime: window.end.getTime(), timezone };
    const settled = await Promise.allSettled(DAILY_TYPES.map(async (metric) => ({ metric, payload: await polymerizeDaily(token, { ...input, dataTypeName: metric.dataTypeName }) })));
    const daily = new Map(); let partial = false; let firstError;
    for (const item of settled) {
      if (item.status === "rejected") { partial = true; firstError ||= item.reason; continue; }
      for (const point of samplePoints(item.value.payload)) {
        const value = sampleValue(point, item.value.metric.field);
        if (!Number.isFinite(value)) continue;
        const date = localDate(point.startTime ?? point.endTime, timezone);
        const row = daily.get(date) || { localDate: date, timezone };
        row[item.value.metric.target] = value;
        daily.set(date, row);
      }
    }
    if (!daily.size && firstError) throw firstError;
    return { daily: [...daily.values()], samples: [], workouts: [], recordsRead: [...daily.values()].length, partial, errorCode: partial ? firstError?.code || "HUAWEI_PARTIAL_DATA" : null };
  }
  return { polymerizeDaily, collectDaily, request };
}
