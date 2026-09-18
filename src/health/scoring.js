const WEIGHTS = { cardio: 30, strength: 20, walks: 10, hydration: 10, alcoholFree: 10, sleep: 8, mealPhotos: 7, waist: 5 };

export function weeklyExecutionScore(ratios) {
  const active = Object.entries(WEIGHTS).filter(([key]) => ratios[key] !== null && ratios[key] !== undefined);
  if (!active.length) return 0;
  const activeWeight = active.reduce((sum, [, weight]) => sum + weight, 0);
  return Math.round(active.reduce((sum, [key, weight]) => sum + Math.max(0, Math.min(1, Number(ratios[key]) || 0)) * weight, 0) * 100 / activeWeight);
}

export function getOutcomeStatus({ weeklyScore, weights = [], waists = [] }) {
  if (weights.length < 4 || waists.length < 4) return { status: "accumulating_data", label: "数据积累中" };
  const weightChanged = Number(weights.at(-1)) < Number(weights[0]);
  const waistChange = Number(waists.at(-1)) - Number(waists[0]);
  if (waistChange <= -1) return { status: "effective", label: "有效" };
  if (weightChanged) return { status: "observe", label: "观察" };
  if (weeklyScore >= 80) return { status: "adjust", label: "需调整" };
  return { status: "execution_insufficient", label: "执行不足" };
}

export { WEIGHTS };
