function toIsoDate(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function toTime(value) {
  return String(value).slice(0, 5);
}

function toStudyPlan(row) {
  if (!row) return null;
  return {
    id: row.id,
    student: row.student,
    subject: row.subject,
    location: row.location,
    startDate: toIsoDate(row.start_date),
    startTime: toTime(row.start_time),
    endTime: toTime(row.end_time),
    studyDays: Number(row.study_days),
    restDays: Number(row.rest_days),
    targetStudyDays: Number(row.target_study_days),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const PLAN_FIELDS = `id, student, subject, location, start_date, start_time, end_time,
  study_days, rest_days, target_study_days, created_at, updated_at`;

export function createStudyPlanRepository(pool) {
  return {
    async listPlans({ userId, projectId }) {
      const result = await pool.query(
        `SELECT ${PLAN_FIELDS}
         FROM study_plans
         WHERE user_id = $1 AND project_id = $2
         ORDER BY start_date ASC, start_time ASC, created_at ASC`,
        [userId, projectId]
      );
      return result.rows.map(toStudyPlan);
    },

    async createPlan({ id, userId, projectId, plan }) {
      const result = await pool.query(
        `INSERT INTO study_plans (
           id, user_id, project_id, student, subject, location,
           start_date, start_time, end_time, study_days, rest_days, target_study_days
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING ${PLAN_FIELDS}`,
        [
          id, userId, projectId, plan.student, plan.subject, plan.location,
          plan.startDate, plan.startTime, plan.endTime,
          plan.studyDays, plan.restDays, plan.targetStudyDays
        ]
      );
      return toStudyPlan(result.rows[0]);
    },

    async deletePlan({ id, userId, projectId }) {
      const result = await pool.query(
        "DELETE FROM study_plans WHERE id = $1 AND user_id = $2 AND project_id = $3",
        [id, userId, projectId]
      );
      return result.rowCount === 1;
    }
  };
}
