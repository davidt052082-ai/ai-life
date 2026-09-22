import { randomUUID } from "node:crypto";

function dateValue(value) {
  if (!value) return null;
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  return [value.getFullYear(), String(value.getMonth() + 1).padStart(2, "0"), String(value.getDate()).padStart(2, "0")].join("-");
}
function toWorkspace(row) {
  return row && { id: row.id, name: row.name, description: row.description, createdAt: row.created_at };
}
function toPerson(row) {
  return row && { id: row.id, name: row.name, color: row.color, dailyCapacityHours: Number(row.daily_capacity_hours), createdAt: row.created_at, updatedAt: row.updated_at };
}
function toTask(row) {
  return row && { id: row.id, title: row.title, description: row.description, assigneeId: row.assignee_id,
    startDate: dateValue(row.start_date), endDate: dateValue(row.end_date),
    estimatedHours: Number(row.estimated_hours), actualHours: Number(row.actual_hours),
    status: row.status, priority: row.priority, isMilestone: Boolean(row.is_milestone),
    createdAt: row.created_at, updatedAt: row.updated_at };
}
function toDependency(row) {
  return row && { id: row.id, predecessorId: row.predecessor_id, successorId: row.successor_id, createdAt: row.created_at };
}
function toLog(row) {
  return { id: row.id, entityType: row.entity_type, entityId: row.entity_id, action: row.action,
    beforeState: row.before_state, afterState: row.after_state, createdAt: row.created_at };
}

// Fixed internal descriptors only; table/column names never come from a request.
const entities = {
  person: { table: "task_people", map: toPerson, fields: { name: "name", color: "color", dailyCapacityHours: "daily_capacity_hours" } },
  task: { table: "task_items", map: toTask, fields: { title: "title", description: "description", assigneeId: "assignee_id",
    startDate: "start_date", endDate: "end_date", estimatedHours: "estimated_hours", actualHours: "actual_hours",
    status: "status", priority: "priority", isMilestone: "is_milestone" } },
  dependency: { table: "task_dependencies", map: toDependency, fields: { predecessorId: "predecessor_id", successorId: "successor_id" } }
};
const rowScope = "id = $1 AND user_id = $2 AND project_id = $3 AND workspace_id = $4";
const ownerScope = "user_id = $1 AND project_id = $2 AND workspace_id = $3";
function scopeValues({ userId, projectId, workspaceId }) {
  if (!userId || !projectId || !workspaceId) throw new Error("Task workspace scope is required.");
  return [userId, projectId, workspaceId];
}

export function createTaskManagementRepository(pool) {
  async function mutate(type, action, input) {
    const owner = scopeValues(input);
    const { table, fields, map } = entities[type];
    const id = input.id;
    const values = [id, ...owner];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const beforeRow = action === "create" ? null :
        (await client.query("SELECT * FROM " + table + " WHERE " + rowScope + " FOR UPDATE", values)).rows[0];
      if (action !== "create" && !beforeRow) {
        await client.query("ROLLBACK");
        return null;
      }
      let result;
      if (action === "delete") {
        result = await client.query("DELETE FROM " + table + " WHERE " + rowScope + " RETURNING *", values);
      } else {
        const entries = Object.entries(fields);
        values.push(...entries.map(([key]) => input[type][key]));
        if (action === "create") {
          const columns = ["id", "user_id", "project_id", "workspace_id", ...entries.map(([, column]) => column)];
          result = await client.query("INSERT INTO " + table + " (" + columns.join(", ") + ") VALUES (" +
            values.map((_, index) => "$" + (index + 1)).join(", ") + ") RETURNING *", values);
        } else {
          const assignments = entries.map(([, column], index) => column + " = $" + (index + 5));
          assignments.push("updated_at = now()");
          result = await client.query("UPDATE " + table + " SET " + assignments.join(", ") + " WHERE " + rowScope + " RETURNING *", values);
        }
      }
      const before = beforeRow ? map(beforeRow) : null;
      const after = action === "delete" ? null : map(result.rows[0]);
      await client.query(
        "INSERT INTO task_audit_logs (id, user_id, project_id, workspace_id, entity_type, entity_id, action, before_state, after_state) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [randomUUID(), ...owner, type, id, action, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null]
      );
      await client.query("COMMIT");
      return action === "delete" ? before : after;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  return {
    async listWorkspaces({ userId, projectId }) {
      const result = await pool.query("SELECT * FROM task_workspaces WHERE user_id = $1 AND project_id = $2 ORDER BY created_at, id", [userId, projectId]);
      return result.rows.map(toWorkspace);
    },
    async findWorkspace({ userId, projectId, workspaceId }) {
      const result = await pool.query("SELECT * FROM task_workspaces WHERE user_id = $1 AND project_id = $2 AND id = $3", scopeValues({ userId, projectId, workspaceId }));
      return toWorkspace(result.rows[0]);
    },
    async createWorkspace({ id, userId, projectId, workspace }) {
      const result = await pool.query("INSERT INTO task_workspaces (id, user_id, project_id, name, description) VALUES ($1,$2,$3,$4,$5) RETURNING *",
        [id, userId, projectId, workspace.name, workspace.description]);
      return toWorkspace(result.rows[0]);
    },
    async loadWorkspace(scope) {
      const values = scopeValues(scope);
      const [people, tasks, dependencies] = await Promise.all([
        pool.query("SELECT * FROM task_people WHERE " + ownerScope + " ORDER BY name, id", values),
        pool.query("SELECT * FROM task_items WHERE " + ownerScope + " ORDER BY start_date NULLS LAST, created_at, id", values),
        pool.query("SELECT * FROM task_dependencies WHERE " + ownerScope + " ORDER BY created_at, id", values)
      ]);
      return { people: people.rows.map(toPerson), tasks: tasks.rows.map(toTask), dependencies: dependencies.rows.map(toDependency) };
    },
    async listLogs(scope) {
      const result = await pool.query("SELECT * FROM task_audit_logs WHERE " + ownerScope + " ORDER BY created_at DESC, id DESC LIMIT 100", scopeValues(scope));
      return result.rows.map(toLog);
    },
    createPerson: (input) => mutate("person", "create", input),
    updatePerson: (input) => mutate("person", "update", input),
    deletePerson: (input) => mutate("person", "delete", input),
    createTask: (input) => mutate("task", "create", input),
    updateTask: (input) => mutate("task", "update", input),
    deleteTask: (input) => mutate("task", "delete", input),
    createDependency: (input) => mutate("dependency", "create", input),
    deleteDependency: (input) => mutate("dependency", "delete", input)
  };
}
