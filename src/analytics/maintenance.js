function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

export async function runAnalyticsMaintenance(repository, now = new Date()) {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 6);
  await repository.refreshDailyMetrics({ from: toIsoDate(from), to: toIsoDate(to) });
  await repository.purgeExpiredEvents();
}

export function startAnalyticsMaintenance(repository, { intervalMs = 86_400_000, logger = console } = {}) {
  const run = () => runAnalyticsMaintenance(repository).catch((error) => logger.error("Analytics maintenance failed:", error));
  void run();
  const interval = setInterval(run, intervalMs);
  interval.unref?.();
  return () => clearInterval(interval);
}
