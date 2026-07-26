function toPerson(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function createStudyPeopleRepository(pool) {
  return {
    async listPeople({ userId, projectId }) {
      const result = await pool.query("SELECT id, name, created_at, updated_at FROM study_people WHERE user_id = $1 AND project_id = $2 ORDER BY created_at ASC, name ASC", [userId, projectId]);
      return result.rows.map(toPerson);
    },
    async findPerson({ id, userId, projectId }) {
      const result = await pool.query("SELECT id, name, created_at, updated_at FROM study_people WHERE id = $1 AND user_id = $2 AND project_id = $3", [id, userId, projectId]);
      return toPerson(result.rows[0]);
    },
    async createPerson({ id, userId, projectId, name }) {
      const result = await pool.query("INSERT INTO study_people (id, user_id, project_id, name) VALUES ($1, $2, $3, $4) RETURNING id, name, created_at, updated_at", [id, userId, projectId, name]);
      return toPerson(result.rows[0]);
    },
    async renamePerson({ id, userId, projectId, name }) {
      const result = await pool.query("UPDATE study_people SET name = $4, updated_at = now() WHERE id = $1 AND user_id = $2 AND project_id = $3 RETURNING id, name, created_at, updated_at", [id, userId, projectId, name]);
      return toPerson(result.rows[0]);
    },
    async personHasPlans({ id, userId, projectId }) {
      const result = await pool.query("SELECT EXISTS(SELECT 1 FROM study_plans WHERE person_id = $1 AND user_id = $2 AND project_id = $3) AS exists", [id, userId, projectId]);
      return Boolean(result.rows[0]?.exists);
    },
    async deletePerson({ id, userId, projectId }) {
      const result = await pool.query("DELETE FROM study_people WHERE id = $1 AND user_id = $2 AND project_id = $3", [id, userId, projectId]);
      return result.rowCount === 1;
    }
  };
}
