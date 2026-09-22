function toPerson(row) { return row && { id: row.id, name: row.name, color: row.color, dailyCapacityHours: Number(row.daily_capacity_hours), createdAt: row.created_at, updatedAt: row.updated_at }; }
function toTask(row) { return row && { id: row.id, title: row.title, description: row.description, assigneeId: row.assignee_id, startDate: row.start_date ? String(row.start_date).slice(0, 10) : null, endDate: row.end_date ? String(row.end_date).slice(0, 10) : null, estimatedHours: Number(row.estimated_hours), actualHours: Number(row.actual_hours), status: row.status, priority: row.priority, isMilestone: Boolean(row.is_milestone), createdAt: row.created_at, updatedAt: row.updated_at }; }
function toDependency(row) { return row && { id: row.id, predecessorId: row.predecessor_id, successorId: row.successor_id, createdAt: row.created_at }; }
function toLog(row) { return row && { id: row.id, entityType: row.entity_type, entityId: row.entity_id, action: row.action, beforeState: row.before_state, afterState: row.after_state, createdAt: row.created_at }; }

const scoped = "user_id = $2 AND project_id = $3";

export function createTaskManagementRepository(pool) {
  async function mutate({ id, userId, projectId, entityType, action, selectSql, mutationSql, values, map }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const before = id ? map((await client.query(selectSql, [id, userId, projectId])).rows[0]) : null;
      const result = await client.query(mutationSql, values);
      const after = map(result.rows[0]);
      if (!after && action !== "delete") { await client.query("ROLLBACK"); return null; }
      await client.query("INSERT INTO task_audit_logs (id, user_id, project_id, entity_type, entity_id, action, before_state, after_state) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", [crypto.randomUUID(), userId, projectId, entityType, id || after.id, action, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null]);
      await client.query("COMMIT");
      return after || before;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  return {
    async loadWorkspace({ userId, projectId }) {
      const [people, tasks, dependencies] = await Promise.all([
        pool.query("SELECT * FROM task_people WHERE user_id = $1 AND project_id = $2 ORDER BY name", [userId, projectId]),
        pool.query("SELECT * FROM task_items WHERE user_id = $1 AND project_id = $2 ORDER BY start_date NULLS LAST, created_at", [userId, projectId]),
        pool.query("SELECT * FROM task_dependencies WHERE user_id = $1 AND project_id = $2 ORDER BY created_at", [userId, projectId])
      ]);
      return { people: people.rows.map(toPerson), tasks: tasks.rows.map(toTask), dependencies: dependencies.rows.map(toDependency) };
    },
    async listLogs({ userId, projectId, limit = 100 }) { const result = await pool.query("SELECT * FROM task_audit_logs WHERE user_id = $1 AND project_id = $2 ORDER BY created_at DESC LIMIT $3", [userId, projectId, limit]); return result.rows.map(toLog); },
    createPerson(input) { const { id, userId, projectId, person } = input; return mutate({ id: null, userId, projectId, entityType: "person", action: "create", map: toPerson, mutationSql: "INSERT INTO task_people (id,user_id,project_id,name,color,daily_capacity_hours) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *", values: [id,userId,projectId,person.name,person.color,person.dailyCapacityHours] }); },
    updatePerson(input) { const { id,userId,projectId,person }=input; return mutate({ id,userId,projectId,entityType:"person",action:"update",map:toPerson,selectSql:`SELECT * FROM task_people WHERE id = $1 AND ${scoped}`,mutationSql:`UPDATE task_people SET name=$4,color=$5,daily_capacity_hours=$6,updated_at=now() WHERE id=$1 AND ${scoped} RETURNING *`,values:[id,userId,projectId,person.name,person.color,person.dailyCapacityHours] }); },
    deletePerson({ id,userId,projectId }) { return mutate({ id,userId,projectId,entityType:"person",action:"delete",map:toPerson,selectSql:`SELECT * FROM task_people WHERE id = $1 AND ${scoped}`,mutationSql:`DELETE FROM task_people WHERE id=$1 AND ${scoped} RETURNING *`,values:[id,userId,projectId] }); },
    createTask(input) { const { id,userId,projectId,task }=input; return mutate({ id:null,userId,projectId,entityType:"task",action:"create",map:toTask,mutationSql:"INSERT INTO task_items (id,user_id,project_id,title,description,assignee_id,start_date,end_date,estimated_hours,actual_hours,status,priority,is_milestone) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *",values:[id,userId,projectId,task.title,task.description,task.assigneeId,task.startDate,task.endDate,task.estimatedHours,task.actualHours,task.status,task.priority,task.isMilestone] }); },
    updateTask(input) { const { id,userId,projectId,task }=input; return mutate({ id,userId,projectId,entityType:"task",action:"update",map:toTask,selectSql:`SELECT * FROM task_items WHERE id = $1 AND ${scoped}`,mutationSql:`UPDATE task_items SET title=$4,description=$5,assignee_id=$6,start_date=$7,end_date=$8,estimated_hours=$9,actual_hours=$10,status=$11,priority=$12,is_milestone=$13,updated_at=now() WHERE id=$1 AND ${scoped} RETURNING *`,values:[id,userId,projectId,task.title,task.description,task.assigneeId,task.startDate,task.endDate,task.estimatedHours,task.actualHours,task.status,task.priority,task.isMilestone] }); },
    deleteTask({ id,userId,projectId }) { return mutate({ id,userId,projectId,entityType:"task",action:"delete",map:toTask,selectSql:`SELECT * FROM task_items WHERE id = $1 AND ${scoped}`,mutationSql:`DELETE FROM task_items WHERE id=$1 AND ${scoped} RETURNING *`,values:[id,userId,projectId] }); },
    createDependency(input) { const { id,userId,projectId,dependency }=input; return mutate({ id:null,userId,projectId,entityType:"dependency",action:"create",map:toDependency,mutationSql:"INSERT INTO task_dependencies (id,user_id,project_id,predecessor_id,successor_id) VALUES ($1,$2,$3,$4,$5) RETURNING *",values:[id,userId,projectId,dependency.predecessorId,dependency.successorId] }); },
    deleteDependency({ id,userId,projectId }) { return mutate({ id,userId,projectId,entityType:"dependency",action:"delete",map:toDependency,selectSql:`SELECT * FROM task_dependencies WHERE id = $1 AND ${scoped}`,mutationSql:`DELETE FROM task_dependencies WHERE id=$1 AND ${scoped} RETURNING *`,values:[id,userId,projectId] }); }
  };
}
