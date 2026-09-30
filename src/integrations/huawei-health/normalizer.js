const integer = (value) => Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value))) : null;
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

export function normalizeDailyGroup({ localDate, values = {} }) {
  return {
    localDate,
    steps: integer(values.steps),
    activeCaloriesKcal: number(values.calories),
    exerciseMinutes: integer(values.intensityMinutes),
    weightKg: number(values.weightKg),
    sleepMinutes: integer(values.sleepMinutes),
    deepSleepMinutes: integer(values.deepSleepMinutes),
    restingHr: integer(values.restingHr)
  };
}
