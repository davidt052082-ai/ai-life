// UTC calendar dates avoid daylight-saving and local-time offsets in day counts.
export function calendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : null;
}

export function calculateEstimatedHours(startDate, endDate) {
  const start = calendarDate(startDate);
  const end = calendarDate(endDate);
  if (start === null || end === null || end < start) return 0;
  return ((end - start) / 86400000 + 1) * 8;
}

// Project the real dependency graph onto milestones. Stop at the next milestone;
// ordinary tasks between two milestones are represented by a dashed connection.
export function milestoneRelations(tasks, dependencies) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const milestones = tasks.filter((task) => task.isMilestone).slice().sort((a, b) =>
    (a.startDate || a.endDate || "9999").localeCompare(b.startDate || b.endDate || "9999") || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const adjacency = new Map(tasks.map((task) => [task.id, []]));
  for (const edge of dependencies) {
    if (byId.has(edge.predecessorId) && byId.has(edge.successorId)) adjacency.get(edge.predecessorId).push(edge.successorId);
  }
  const edges = [];
  for (const source of milestones) {
    const visited = new Set([source.id]);
    const targets = new Map();
    const queue = [{ id: source.id, viaTaskIds: [] }];
    for (let index = 0; index < queue.length; index++) {
      const entry = queue[index];
      for (const id of adjacency.get(entry.id)) {
        if (byId.get(id).isMilestone) {
          if (!targets.has(id)) targets.set(id, { predecessorId: source.id, successorId: id, viaTaskIds: entry.viaTaskIds, indirect: entry.viaTaskIds.length > 0 });
        } else if (!visited.has(id)) {
          visited.add(id);
          queue.push({ id, viaTaskIds: [...entry.viaTaskIds, id] });
        }
      }
    }
    edges.push(...targets.values());
  }
  return { milestones, edges };
}
