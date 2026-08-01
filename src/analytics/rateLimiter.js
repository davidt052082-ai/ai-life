export function createSlidingWindowRateLimiter({ limit = 60, windowMs = 60_000, now = Date.now } = {}) {
  const entries = new Map();

  function allow(key) {
    const current = now();
    const start = current - windowMs;
    const timestamps = (entries.get(key) || []).filter((timestamp) => timestamp > start);
    if (timestamps.length >= limit) {
      entries.set(key, timestamps);
      return false;
    }
    timestamps.push(current);
    entries.set(key, timestamps);
    return true;
  }

  return {
    allow,
    clear() {
      entries.clear();
    }
  };
}
