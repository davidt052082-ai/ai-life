const LOCK_KEY = "ai-life:huawei-health-sync";

export function startHuaweiScheduler({ repository, syncService, intervalHours, setIntervalImpl = setInterval }) {
  let running = false;
  const run = async () => {
    if (running || !await repository.tryAcquireSchedulerLock(LOCK_KEY)) return;
    running = true;
    try {
      for (const user of await repository.listConnectedUsers()) {
        try { await syncService.syncUser({ ...user, trigger: "scheduled" }); } catch (error) { console.error("Huawei Health scheduled sync failed:", error.code || error.message); }
      }
    } finally {
      running = false;
      await repository.releaseSchedulerLock(LOCK_KEY);
    }
  };
  const timer = setIntervalImpl(() => void run(), intervalHours * 3_600_000);
  return { run, stop: () => clearInterval(timer) };
}
