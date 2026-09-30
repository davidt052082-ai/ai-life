import { createHash, randomUUID } from "node:crypto";

const PROVIDER = "huawei";
const hashState = (state) => createHash("sha256").update(String(state)).digest("hex");
const connection = (row) => row && ({ id: row.id, userId: row.user_id, projectId: row.project_id, status: row.status, grantedScopes: row.granted_scopes || [], accessTokenEnc: row.access_token_enc, refreshTokenEnc: row.refresh_token_enc, accessTokenExpiresAt: row.access_token_expires_at, lastSuccessfulSyncAt: row.last_successful_sync_at, lastAttemptSyncAt: row.last_attempt_sync_at, lastErrorCode: row.last_error_code });

export function createHuaweiHealthRepository(pool) {
  return {
    async createOAuthState({ state, userId, projectId, redirectPath, expiresAt }) {
      await pool.query("INSERT INTO health_oauth_states (id, state_hash, user_id, project_id, redirect_path, expires_at) VALUES ($1, $2, $3, $4, $5, $6)", [randomUUID(), hashState(state), userId, projectId, redirectPath, expiresAt]);
    },
    async consumeOAuthState(state) {
      const result = await pool.query("DELETE FROM health_oauth_states WHERE state_hash = $1 AND expires_at > now() RETURNING user_id, project_id, redirect_path", [hashState(state)]);
      const row = result.rows[0];
      return row && { userId: row.user_id, projectId: row.project_id, redirectPath: row.redirect_path };
    },
    async getConnection(userId) {
      const result = await pool.query("SELECT * FROM health_connections WHERE user_id = $1 AND provider = $2", [userId, PROVIDER]);
      return connection(result.rows[0]);
    },
    async upsertConnection({ userId, projectId, accessTokenEnc, refreshTokenEnc, accessTokenExpiresAt, grantedScopes = [], providerUserIdHash = null }) {
      const result = await pool.query(`INSERT INTO health_connections (id, user_id, project_id, provider, provider_user_id_hash, status, granted_scopes, access_token_enc, refresh_token_enc, access_token_expires_at)
        VALUES ($1, $2, $3, $4, $5, 'connected', $6, $7, $8, $9)
        ON CONFLICT (user_id, provider) DO UPDATE SET project_id = EXCLUDED.project_id, provider_user_id_hash = EXCLUDED.provider_user_id_hash, status = 'connected', granted_scopes = EXCLUDED.granted_scopes, access_token_enc = EXCLUDED.access_token_enc, refresh_token_enc = EXCLUDED.refresh_token_enc, access_token_expires_at = EXCLUDED.access_token_expires_at, last_error_code = NULL, last_error_at = NULL, updated_at = now() RETURNING *`, [randomUUID(), userId, projectId, PROVIDER, providerUserIdHash, JSON.stringify(grantedScopes), accessTokenEnc, refreshTokenEnc, accessTokenExpiresAt]);
      return connection(result.rows[0]);
    },
    async markReauthRequired(userId, errorCode = "HUAWEI_REAUTH_REQUIRED") {
      await pool.query("UPDATE health_connections SET status = 'reauth_required', last_error_code = $2, last_error_at = now(), updated_at = now() WHERE user_id = $1 AND provider = $3", [userId, errorCode, PROVIDER]);
    },
    async deleteConnectionTokens(userId) {
      await pool.query("UPDATE health_connections SET status = 'disconnected', access_token_enc = NULL, refresh_token_enc = NULL, access_token_expires_at = NULL, updated_at = now() WHERE user_id = $1 AND provider = $2", [userId, PROVIDER]);
    },
    async upsertSamples({ userId, projectId, samples }) {
      for (const sample of samples) await pool.query(`INSERT INTO health_samples (id, user_id, project_id, provider, metric_type, source_record_id, start_time_utc, end_time_utc, value_num, unit, raw_hash, source_device, source_modified_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (provider, user_id, metric_type, source_record_id) DO UPDATE SET end_time_utc = EXCLUDED.end_time_utc, value_num = EXCLUDED.value_num, unit = EXCLUDED.unit, raw_hash = EXCLUDED.raw_hash, source_device = EXCLUDED.source_device, source_modified_at = EXCLUDED.source_modified_at, updated_at = now()`, [sample.id || randomUUID(), userId, projectId, PROVIDER, sample.metricType, sample.sourceRecordId, sample.startTimeUtc, sample.endTimeUtc, sample.valueNum, sample.unit, sample.rawHash, sample.sourceDevice || null, sample.sourceModifiedAt || null]);
    },
    async upsertDaily({ userId, projectId, rows }) {
      for (const row of rows) await pool.query(`INSERT INTO health_daily (id, user_id, project_id, local_date, timezone, steps, active_calories_kcal, exercise_minutes, weight_kg, sleep_minutes, deep_sleep_minutes, resting_hr, source_flags)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (user_id, project_id, local_date) DO UPDATE SET timezone = EXCLUDED.timezone, steps = EXCLUDED.steps, active_calories_kcal = EXCLUDED.active_calories_kcal, exercise_minutes = EXCLUDED.exercise_minutes, weight_kg = EXCLUDED.weight_kg, sleep_minutes = EXCLUDED.sleep_minutes, deep_sleep_minutes = EXCLUDED.deep_sleep_minutes, resting_hr = EXCLUDED.resting_hr, source_flags = EXCLUDED.source_flags, calculated_at = now(), updated_at = now()`, [randomUUID(), userId, projectId, row.localDate, row.timezone, row.steps, row.activeCaloriesKcal, row.exerciseMinutes, row.weightKg, row.sleepMinutes, row.deepSleepMinutes, row.restingHr, JSON.stringify({ huawei: true })]);
    },
    async upsertWorkouts({ userId, projectId, workouts }) {
      for (const workout of workouts) await pool.query(`INSERT INTO health_workouts (id, user_id, project_id, provider, source_record_id, activity_type, start_time_utc, end_time_utc, duration_seconds, distance_m, calories_kcal, avg_hr, summary)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (provider, user_id, source_record_id) DO UPDATE SET activity_type = EXCLUDED.activity_type, end_time_utc = EXCLUDED.end_time_utc, duration_seconds = EXCLUDED.duration_seconds, distance_m = EXCLUDED.distance_m, calories_kcal = EXCLUDED.calories_kcal, avg_hr = EXCLUDED.avg_hr, summary = EXCLUDED.summary, updated_at = now()`, [workout.id || randomUUID(), userId, projectId, PROVIDER, workout.sourceRecordId, workout.activityType, workout.startTimeUtc, workout.endTimeUtc, workout.durationSeconds, workout.distanceM, workout.caloriesKcal, workout.avgHr, JSON.stringify(workout.summary || {})]);
    },
    async createSyncRun({ userId, projectId, trigger, windowStart, windowEnd, traceId }) {
      const result = await pool.query("INSERT INTO health_sync_runs (id, user_id, project_id, provider, trigger, window_start, window_end, status, trace_id) VALUES ($1,$2,$3,$4,$5,$6,$7,'running',$8) RETURNING id", [randomUUID(), userId, projectId, PROVIDER, trigger, windowStart, windowEnd, traceId]);
      return result.rows[0].id;
    },
    async finishSyncRun({ id, status, recordsRead = 0, recordsInserted = 0, recordsUpdated = 0, errorCode = null }) {
      await pool.query("UPDATE health_sync_runs SET status = $2, records_read = $3, records_inserted = $4, records_updated = $5, error_code = $6, finished_at = now() WHERE id = $1", [id, status, recordsRead, recordsInserted, recordsUpdated, errorCode]);
    },
    async markSyncSuccess(userId) {
      await pool.query("UPDATE health_connections SET last_successful_sync_at = now(), last_attempt_sync_at = now(), last_error_code = NULL, last_error_at = NULL, updated_at = now() WHERE user_id = $1 AND provider = $2", [userId, PROVIDER]);
    },
    async markSyncFailure(userId, errorCode) {
      await pool.query("UPDATE health_connections SET last_attempt_sync_at = now(), last_error_code = $2, last_error_at = now(), updated_at = now() WHERE user_id = $1 AND provider = $3", [userId, errorCode, PROVIDER]);
    },
    async listConnectedUsers() {
      const result = await pool.query("SELECT user_id, project_id FROM health_connections WHERE provider = $1 AND status = 'connected'", [PROVIDER]);
      return result.rows.map((row) => ({ userId: row.user_id, projectId: row.project_id }));
    },
    async tryAcquireSchedulerLock(key) {
      const result = await pool.query("SELECT pg_try_advisory_lock(hashtext($1)) AS acquired", [key]);
      return Boolean(result.rows[0]?.acquired);
    },
    async releaseSchedulerLock(key) {
      await pool.query("SELECT pg_advisory_unlock(hashtext($1))", [key]);
    },
    async getDailyRange({ userId, projectId, startDate, endDate }) {
      const result = await pool.query("SELECT local_date, timezone, steps, active_calories_kcal, exercise_minutes, weight_kg, sleep_minutes, deep_sleep_minutes, resting_hr, source_flags FROM health_daily WHERE user_id = $1 AND project_id = $2 AND local_date BETWEEN $3 AND $4 ORDER BY local_date", [userId, projectId, startDate, endDate]);
      return result.rows.map((row) => ({ localDate: String(row.local_date).slice(0, 10), timezone: row.timezone, steps: row.steps, activeCaloriesKcal: row.active_calories_kcal === null ? null : Number(row.active_calories_kcal), exerciseMinutes: row.exercise_minutes, weightKg: row.weight_kg === null ? null : Number(row.weight_kg), sleepMinutes: row.sleep_minutes, deepSleepMinutes: row.deep_sleep_minutes, restingHr: row.resting_hr, source: PROVIDER }));
    }
  };
}
