function toPlanDate(value, timezone = "UTC") {
  if (typeof value === "string") {
    const match = value.match(/^\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    })
      .formatToParts(date)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value: partValue }) => [type, partValue])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function toEvent(row) {
  if (!row) return null;
  return { id: row.id, eventId: row.event_id, eventType: row.event_type, payload: row.payload, occurredAt: row.occurred_at, timezone: row.timezone, planDate: toPlanDate(row.plan_date, row.timezone), syncStatus: row.sync_status, version: Number(row.version), undoneEventId: row.undone_event_id, createdAt: row.created_at };
}

function toMeasurement(row) {
  if (!row) return null;
  return { id: row.id, weightKg: row.weight_kg === null ? null : Number(row.weight_kg), waistCm: row.waist_cm === null ? null : Number(row.waist_cm), occurredAt: row.occurred_at, timezone: row.timezone, version: Number(row.version) };
}

function toMeal(row) {
  if (!row) return null;
  return { id: row.id, mealType: row.meal_type, capturedAt: row.captured_at, timezone: row.timezone, planDate: toPlanDate(row.plan_date, row.timezone), status: row.status, mimeType: row.mime_type, byteSize: Number(row.byte_size), createdAt: row.created_at };
}

function toSettings(row) {
  if (!row) return null;
  return { timezone: row.timezone, hydrationTargetMl: Number(row.hydration_target_ml), planDayCutoff: String(row.plan_day_cutoff).slice(0, 5), abdominalMassageEnabled: Boolean(row.abdominal_massage_enabled), updatedAt: row.updated_at };
}

export function createHealthRepository(pool) {
  return {
    async getSettings({ userId, projectId }) {
      await pool.query(
        `INSERT INTO health_settings (user_id, project_id) VALUES ($1, $2)
         ON CONFLICT (user_id, project_id) DO NOTHING`, [userId, projectId]
      );
      const result = await pool.query(
        `SELECT timezone, hydration_target_ml, plan_day_cutoff, abdominal_massage_enabled, updated_at
         FROM health_settings WHERE user_id = $1 AND project_id = $2`, [userId, projectId]
      );
      return toSettings(result.rows[0]);
    },

    async updateSettings({ userId, projectId, settings }) {
      const result = await pool.query(
        `INSERT INTO health_settings (user_id, project_id, timezone, hydration_target_ml, plan_day_cutoff, abdominal_massage_enabled)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, project_id) DO UPDATE SET timezone = EXCLUDED.timezone,
           hydration_target_ml = EXCLUDED.hydration_target_ml, plan_day_cutoff = EXCLUDED.plan_day_cutoff,
           abdominal_massage_enabled = EXCLUDED.abdominal_massage_enabled, updated_at = now()
         RETURNING timezone, hydration_target_ml, plan_day_cutoff, abdominal_massage_enabled, updated_at`,
        [userId, projectId, settings.timezone, settings.hydrationTargetMl, settings.planDayCutoff, settings.abdominalMassageEnabled]
      );
      return toSettings(result.rows[0]);
    },

    async createEvent({ id, userId, projectId, eventId, idempotencyKey, eventType, payload, occurredAt, timezone, planDate }) {
      const result = await pool.query(
        `INSERT INTO health_events (id, user_id, project_id, event_id, idempotency_key, event_type, payload, occurred_at, timezone, plan_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (user_id, idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
         RETURNING id, event_id, event_type, payload, occurred_at, timezone, plan_date, sync_status, version, undone_event_id, created_at`,
        [id, userId, projectId, eventId, idempotencyKey, eventType, payload, occurredAt, timezone, planDate]
      );
      return toEvent(result.rows[0]);
    },

    async undoEvent({ id, userId, projectId, eventId, idempotencyKey, occurredAt, timezone }) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const original = await client.query(
          `SELECT id, event_type, payload, plan_date FROM health_events
           WHERE id = $1 AND user_id = $2 AND project_id = $3 AND undone_event_id IS NULL FOR UPDATE`,
          [id, userId, projectId]
        );
        if (!original.rows[0]) { await client.query("ROLLBACK"); return null; }
        const row = original.rows[0];
        const undone = await client.query(
          `INSERT INTO health_events (id, user_id, project_id, event_id, idempotency_key, event_type, payload, occurred_at, timezone, plan_date, undone_event_id)
           VALUES ($1, $2, $3, $4, $5, 'undo', $6, $7, $8, $9, NULL)
           ON CONFLICT (user_id, idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
           RETURNING id, event_id, event_type, payload, occurred_at, timezone, plan_date, sync_status, version, undone_event_id, created_at`,
          [eventId, userId, projectId, `undo_${eventId}`, idempotencyKey, { originalEventType: row.event_type, originalPayload: row.payload }, occurredAt, timezone, row.plan_date]
        );
        await client.query("UPDATE health_events SET undone_event_id = $1, updated_at = now() WHERE id = $2", [undone.rows[0].id, row.id]);
        await client.query("COMMIT");
        return toEvent(undone.rows[0]);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    },

    async listEvents({ userId, projectId, startDate, endDate }) {
      const result = await pool.query(
        `SELECT id, event_id, event_type, payload, occurred_at, timezone, plan_date, sync_status, version, undone_event_id, created_at
         FROM health_events WHERE user_id = $1 AND project_id = $2 AND plan_date BETWEEN $3 AND $4
           AND event_type <> 'undo' AND undone_event_id IS NULL ORDER BY occurred_at ASC`,
        [userId, projectId, startDate, endDate]
      );
      return result.rows.map(toEvent);
    },

    async createMeasurement({ id, userId, projectId, idempotencyKey, weightKg, waistCm, occurredAt, timezone }) {
      const result = await pool.query(
        `INSERT INTO health_measurements (id, user_id, project_id, idempotency_key, weight_kg, waist_cm, occurred_at, timezone)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (user_id, idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
         RETURNING id, weight_kg, waist_cm, occurred_at, timezone, version`,
        [id, userId, projectId, idempotencyKey, weightKg, waistCm, occurredAt, timezone]
      );
      return toMeasurement(result.rows[0]);
    },

    async listMeasurements({ userId, projectId, startDate = "1900-01-01", endDate = "2999-12-31" }) {
      const result = await pool.query(
        `SELECT id, weight_kg, waist_cm, occurred_at, timezone, version FROM health_measurements
         WHERE user_id = $1 AND project_id = $2 AND occurred_at::date BETWEEN $3 AND $4 ORDER BY occurred_at ASC`,
        [userId, projectId, startDate, endDate]
      );
      return result.rows.map(toMeasurement);
    },

    async createMeal({ id, userId, projectId, idempotencyKey, mealType, storageKey, originalName, mimeType, byteSize, capturedAt, timezone, planDate }) {
      const result = await pool.query(
        `INSERT INTO health_meals (id, user_id, project_id, idempotency_key, meal_type, storage_key, original_name, mime_type, byte_size, captured_at, timezone, plan_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (user_id, idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
         RETURNING id, meal_type, captured_at, timezone, plan_date, status, mime_type, byte_size, created_at`,
        [id, userId, projectId, idempotencyKey, mealType, storageKey, originalName, mimeType, byteSize, capturedAt, timezone, planDate]
      );
      return toMeal(result.rows[0]);
    },

    async listMeals({ userId, projectId, startDate, endDate = startDate }) {
      const result = await pool.query(
        `SELECT id, meal_type, captured_at, timezone, plan_date, status, mime_type, byte_size, created_at
         FROM health_meals WHERE user_id = $1 AND project_id = $2 AND plan_date BETWEEN $3 AND $4 ORDER BY captured_at ASC`,
        [userId, projectId, startDate, endDate]
      );
      return result.rows.map(toMeal);
    },

    async deleteMeal({ id, userId, projectId }) {
      const result = await pool.query("DELETE FROM health_meals WHERE id = $1 AND user_id = $2 AND project_id = $3", [id, userId, projectId]);
      return result.rowCount === 1;
    },

    async listNotifications({ userId, projectId, date }) {
      const result = await pool.query(
        `SELECT id, notification_date, reminder_kind, message, read_at, created_at FROM health_notifications
         WHERE user_id = $1 AND project_id = $2 AND notification_date = $3 ORDER BY created_at DESC`, [userId, projectId, date]
      );
      return result.rows.map((row) => ({ id: row.id, date: String(row.notification_date).slice(0, 10), kind: row.reminder_kind, message: row.message, readAt: row.read_at, createdAt: row.created_at }));
    },

    async createNotificationsIfAbsent({ userId, projectId, date, notifications }) {
      for (const notification of notifications) {
        await pool.query(
          `INSERT INTO health_notifications (id, user_id, project_id, notification_date, reminder_kind, message)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (user_id, project_id, notification_date, reminder_kind) DO NOTHING`,
          [notification.id, userId, projectId, date, notification.kind, notification.message]
        );
      }
    },

    async markNotificationRead({ id, userId, projectId }) {
      const result = await pool.query(
        `UPDATE health_notifications SET read_at = now() WHERE id = $1 AND user_id = $2 AND project_id = $3
         RETURNING id, notification_date, reminder_kind, message, read_at, created_at`, [id, userId, projectId]
      );
      const row = result.rows[0];
      return row && { id: row.id, date: String(row.notification_date).slice(0, 10), kind: row.reminder_kind, message: row.message, readAt: row.read_at, createdAt: row.created_at };
    }
  };
}
