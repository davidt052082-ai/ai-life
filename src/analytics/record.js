export function recordAnalytics(analytics, event) {
  if (!analytics) return;
  Promise.resolve(analytics.record(event)).catch((error) => console.error("Analytics event record failed:", error));
}
