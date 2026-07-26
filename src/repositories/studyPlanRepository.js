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
    personId: row.person_id,
    personName: row.person_name,
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

const PLAN_FIELDS = `sp.id, sp.person_id, p.name AS person_name, sp.subject, sp.location, sp.start_date, sp.start_time, sp.end_time,
  sp.study_days, sp.rest_days, sp.target_study_days, sp.created_at, sp.updated_at`;
const INSERT_PLAN_FIELDS = `id, person_id, subject, location, start_date, start_time, end_time,
  study_days, rest_days, target_study_days, created_at, updated_at`;

export function createStudyPlanRepository(pool) {
  return {
    async listPlans({ userId, projectId }) {
      const result = await pool.query(
        `SELECT ${PLAN_FIELDS}
         FROM study_plans sp
         JOIN study_people p ON p.id = sp.person_id AND p.user_id = sp.user_id AND p.project_id = sp.project_id
         WHERE sp.user_id = $1 AND sp.project_id = $2
         ORDER BY sp.start_date ASC, sp.start_time ASC, sp.created_at ASC`,
        [userId, projectId]
      );
      return result.rows.map(toStudyPlan);
    },

    async createPlan({ id, userId, projectId, plan }) {
      const result = await pool.query(
        `INSERT INTO study_plans (
           id, user_id, project_id, person_id, subject, location,
           start_date, start_time, end_time, study_days, rest_days, target_study_days
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING ${INSERT_PLAN_FIELDS}`,
        [
          id, userId, projectId, plan.personId, plan.subject, plan.location,
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
