function enumerateInclusiveDates(startDate, endDate) {
  if (!startDate || !endDate || startDate > endDate) return [];
  const dates = [];
  const end = new Date(`${endDate}T00:00:00Z`);
  for (const day = new Date(`${startDate}T00:00:00Z`); day <= end; day.setUTCDate(day.getUTCDate() + 1)) dates.push(day.toISOString().slice(0, 10));
  return dates;
}

function warningId(kind, values) {
  return `${kind}:${values.slice().sort().join(":")}`;
}

function findCycles(tasks, dependencies) {
  const taskIds = new Set(tasks.map((task) => task.id));
  const adjacency = new Map([...taskIds].map((id) => [id, []]));
  for (const dependency of dependencies) {
    if (taskIds.has(dependency.predecessorId) && taskIds.has(dependency.successorId)) adjacency.get(dependency.predecessorId).push(dependency);
  }
  const visited = new Set();
  const active = new Set();
  const edgeStack = [];
  const result = new Map();
  function visit(taskId) {
    visited.add(taskId);
    active.add(taskId);
    for (const edge of adjacency.get(taskId)) {
      if (active.has(edge.successorId)) {
        const firstEdgeIndex = edgeStack.findIndex((item) => item.predecessorId === edge.successorId);
        const cycleEdges = [...edgeStack.slice(Math.max(firstEdgeIndex, 0)), edge];
        const dependencyIds = cycleEdges.map((item) => item.id).sort();
        const taskIds = [...new Set(cycleEdges.flatMap((item) => [item.predecessorId, item.successorId]))].sort();
        result.set(dependencyIds.join(":"), { dependencyIds, taskIds });
      } else if (!visited.has(edge.successorId)) {
        edgeStack.push(edge);
        visit(edge.successorId);
        edgeStack.pop();
      }
    }
    active.delete(taskId);
  }
  for (const taskId of taskIds) if (!visited.has(taskId)) visit(taskId);
  return [...result.values()];
}

export function calculateWarnings({ people = [], tasks = [], dependencies = [] }) {
  const warnings = [];
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  for (const dependency of dependencies) {
    const predecessor = tasksById.get(dependency.predecessorId);
    const successor = tasksById.get(dependency.successorId);
    if (predecessor?.endDate && successor?.startDate && successor.startDate < predecessor.endDate) {
      warnings.push({
        id: warningId("dependency_date", [dependency.id]), severity: "error", kind: "dependency_date",
        taskIds: [predecessor.id, successor.id], dependencyIds: [dependency.id], personId: null,
        message: `“${successor.title}”开始时间早于前置事项“${predecessor.title}”的结束时间。`
      });
    }
  }
  for (const cycle of findCycles(tasks, dependencies)) {
    warnings.push({
      id: warningId("cycle", cycle.dependencyIds), severity: "error", kind: "cycle",
      taskIds: cycle.taskIds, dependencyIds: cycle.dependencyIds, personId: null,
      message: "事项依赖形成了循环，需检查前后置关系。"
    });
  }
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const loads = new Map();
  for (const task of tasks) {
    const person = peopleById.get(task.assigneeId);
    const dates = enumerateInclusiveDates(task.startDate, task.endDate);
    const estimatedHours = Number(task.estimatedHours);
    if (!person || !dates.length || !(estimatedHours > 0)) continue;
    const hoursPerDay = estimatedHours / dates.length;
    for (const date of dates) {
      const key = `${person.id}:${date}`;
      const entry = loads.get(key) || { person, date, hours: 0, taskIds: [] };
      entry.hours += hoursPerDay;
      entry.taskIds.push(task.id);
      loads.set(key, entry);
    }
  }
  for (const entry of loads.values()) {
    if (entry.hours <= Number(entry.person.dailyCapacityHours)) continue;
    const taskIds = [...new Set(entry.taskIds)].sort();
    warnings.push({
      id: warningId("resource_overload", [entry.person.id, entry.date]), severity: "warning", kind: "resource_overload",
      taskIds, dependencyIds: [], personId: entry.person.id,
      message: `“${entry.person.name}”在 ${entry.date} 的预计负荷为 ${entry.hours.toFixed(1)} 小时，超过 ${entry.person.dailyCapacityHours} 小时容量。`
    });
  }
  const severityOrder = { error: 0, warning: 1 };
  return warnings.sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity] || left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
}
