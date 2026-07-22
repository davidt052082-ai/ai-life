const LEGACY_MIGRATION_KEY = "legacy-local-storage-v1";

function asJson(value) {
  return JSON.stringify(value);
}

export class VersionConflictError extends Error {
  constructor(currentVersion) {
    super("数据已在其他位置更新，请刷新后重试。");
    this.code = "VERSION_CONFLICT";
    this.status = 409;
    this.currentVersion = currentVersion;
  }
}

export class WearableNotFoundError extends Error {
  constructor() {
    super("未找到对应的数据记录。");
    this.code = "WEARABLE_NOT_FOUND";
    this.status = 404;
  }
}

function workspaceFromRow(row) {
  return row
    ? {
      anchors: row.anchors,
      deviceLayout: row.device_layout,
      removedEquipmentIds: row.removed_equipment_ids,
      version: row.version,
      updatedAt: row.updated_at
    }
    : { anchors: [], deviceLayout: { left: [], right: [] }, removedEquipmentIds: [], version: 0, updatedAt: null };
}

function equipmentFromRow(row) {
  return {
    id: row.id,
    sourceType: row.source_type,
    sourceKey: row.source_key,
    data: row.data,
    isDeleted: row.is_deleted,
    version: row.version,
    updatedAt: row.updated_at
  };
}

function schemeFromRow(row) {
  return {
    id: row.id,
    title: row.title,
    evaluation: row.evaluation,
    thumbnailUrl: row.thumbnail_url,
    snapshot: row.snapshot,
    savedAt: row.saved_at,
    updatedAt: row.updated_at,
    version: row.version
  };
}

async function currentWorkspaceVersion(pool, userId, projectId) {
  const result = await pool.query(
    "SELECT version FROM wearable_workspace WHERE user_id = $1 AND project_id = $2",
    [userId, projectId]
  );
  return result.rows[0]?.version ?? null;
}

export function createWearableRepository(pool) {
  return {
    async getState({ userId, projectId }) {
      const [workspaceResult, equipmentResult, migrationResult, schemeResult] = await Promise.all([
        pool.query(
          "SELECT anchors, device_layout, removed_equipment_ids, version, updated_at FROM wearable_workspace WHERE user_id = $1 AND project_id = $2",
          [userId, projectId]
        ),
        pool.query(
          `SELECT id, source_type, source_key, data, is_deleted, version, updated_at
           FROM wearable_equipment WHERE user_id = $1 AND project_id = $2 ORDER BY updated_at ASC`,
          [userId, projectId]
        ),
        pool.query(
          "SELECT migration_key FROM local_data_migrations WHERE user_id = $1 AND project_id = $2 AND migration_key = $3",
          [userId, projectId, LEGACY_MIGRATION_KEY]
        ),
        pool.query(
          `SELECT id, title, evaluation, thumbnail_url, snapshot, saved_at, updated_at, version
           FROM wearable_schemes WHERE user_id = $1 AND project_id = $2 ORDER BY saved_at DESC`,
          [userId, projectId]
        )
      ]);
      return {
        workspace: workspaceFromRow(workspaceResult.rows[0]),
        equipment: equipmentResult.rows.map(equipmentFromRow),
        schemes: schemeResult.rows.map(schemeFromRow),
        migration: { completed: migrationResult.rowCount > 0 }
      };
    },

    async saveWorkspace({ userId, projectId, anchors, deviceLayout, removedEquipmentIds, version }) {
      if (version === 0) {
        try {
          const result = await pool.query(
            `INSERT INTO wearable_workspace (user_id, project_id, anchors, device_layout, removed_equipment_ids)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING anchors, device_layout, removed_equipment_ids, version, updated_at`,
            [userId, projectId, asJson(anchors), asJson(deviceLayout), asJson(removedEquipmentIds)]
          );
          return workspaceFromRow(result.rows[0]);
        } catch (error) {
          if (error.code !== "23505") throw error;
          throw new VersionConflictError(await currentWorkspaceVersion(pool, userId, projectId));
        }
      }

      const result = await pool.query(
        `UPDATE wearable_workspace
         SET anchors = $3, device_layout = $4, removed_equipment_ids = $5,
             version = version + 1, updated_at = now()
         WHERE user_id = $1 AND project_id = $2 AND version = $6
         RETURNING anchors, device_layout, removed_equipment_ids, version, updated_at`,
        [userId, projectId, asJson(anchors), asJson(deviceLayout), asJson(removedEquipmentIds), version]
      );
      if (result.rowCount) return workspaceFromRow(result.rows[0]);

      const currentVersion = await currentWorkspaceVersion(pool, userId, projectId);
      if (currentVersion === null) throw new WearableNotFoundError();
      throw new VersionConflictError(currentVersion);
    },

    async listEquipment({ userId, projectId }) {
      const result = await pool.query(
        `SELECT id, source_type, source_key, data, is_deleted, version, updated_at
         FROM wearable_equipment
         WHERE user_id = $1 AND project_id = $2
         ORDER BY updated_at ASC`,
        [userId, projectId]
      );
      return result.rows.map(equipmentFromRow);
    },

    async createEquipment({ id, userId, projectId, data }) {
      const result = await pool.query(
        `INSERT INTO wearable_equipment (id, user_id, project_id, source_type, source_key, data)
         VALUES ($1, $2, $3, 'custom', $1, $4)
         RETURNING id, source_type, source_key, data, is_deleted, version, updated_at`,
        [id, userId, projectId, asJson(data)]
      );
      return equipmentFromRow(result.rows[0]);
    },

    async upsertBuiltinOverride({ id, userId, projectId, data, isDeleted }) {
      const result = await pool.query(
        `INSERT INTO wearable_equipment (id, user_id, project_id, source_type, source_key, data, is_deleted)
         VALUES ($1, $2, $3, 'builtin_override', $1, $4, $5)
         ON CONFLICT (user_id, project_id, source_type, source_key)
         DO UPDATE SET data = EXCLUDED.data, is_deleted = EXCLUDED.is_deleted,
           version = wearable_equipment.version + 1, updated_at = now()
         RETURNING id, source_type, source_key, data, is_deleted, version, updated_at`,
        [id, userId, projectId, asJson(data), isDeleted]
      );
      return equipmentFromRow(result.rows[0]);
    },

    async updateEquipment({ id, userId, projectId, data, isDeleted, version }) {
      const result = await pool.query(
        `UPDATE wearable_equipment
         SET data = $4, is_deleted = $5, version = version + 1, updated_at = now()
         WHERE id = $1 AND user_id = $2 AND project_id = $3 AND version = $6
         RETURNING id, source_type, source_key, data, is_deleted, version, updated_at`,
        [id, userId, projectId, asJson(data), isDeleted, version]
      );
      if (result.rowCount) return equipmentFromRow(result.rows[0]);
      const current = await pool.query(
        "SELECT version FROM wearable_equipment WHERE id = $1 AND user_id = $2 AND project_id = $3",
        [id, userId, projectId]
      );
      if (!current.rowCount) throw new WearableNotFoundError();
      throw new VersionConflictError(current.rows[0].version);
    },

    async deleteEquipment({ id, userId, projectId, version }) {
      return this.updateEquipment({ id, userId, projectId, data: {}, isDeleted: true, version });
    },

    async listSchemes({ userId, projectId }) {
      const result = await pool.query(
        `SELECT id, title, evaluation, thumbnail_url, snapshot, saved_at, updated_at, version
         FROM wearable_schemes WHERE user_id = $1 AND project_id = $2 ORDER BY saved_at DESC`,
        [userId, projectId]
      );
      return result.rows.map(schemeFromRow);
    },

    async createScheme({ id, userId, projectId, title, evaluation, thumbnailUrl, snapshot }) {
      const result = await pool.query(
        `INSERT INTO wearable_schemes (id, user_id, project_id, title, evaluation, thumbnail_url, snapshot)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, title, evaluation, thumbnail_url, snapshot, saved_at, updated_at, version`,
        [id, userId, projectId, title, asJson(evaluation), thumbnailUrl, asJson(snapshot)]
      );
      return schemeFromRow(result.rows[0]);
    },

    async deleteScheme({ id, userId, projectId }) {
      const result = await pool.query(
        "DELETE FROM wearable_schemes WHERE id = $1 AND user_id = $2 AND project_id = $3 RETURNING id",
        [id, userId, projectId]
      );
      if (!result.rowCount) throw new WearableNotFoundError();
    },

    async migrateLocalData({ userId, projectId, payload }) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const existing = await client.query(
          `SELECT migration_key FROM local_data_migrations
           WHERE user_id = $1 AND project_id = $2 AND migration_key = $3 FOR UPDATE`,
          [userId, projectId, LEGACY_MIGRATION_KEY]
        );
        if (existing.rowCount) {
          await client.query("COMMIT");
          return { alreadyMigrated: true };
        }

        await client.query(
          `INSERT INTO wearable_workspace (user_id, project_id, anchors, device_layout, removed_equipment_ids)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (user_id, project_id) DO UPDATE SET
             anchors = EXCLUDED.anchors, device_layout = EXCLUDED.device_layout,
             removed_equipment_ids = EXCLUDED.removed_equipment_ids, version = wearable_workspace.version + 1, updated_at = now()`,
          [userId, projectId, asJson(payload.anchors), asJson(payload.deviceLayout), asJson(payload.removedEquipmentIds)]
        );

        for (const equipment of payload.customEquipment) {
          await client.query(
            `INSERT INTO wearable_equipment (id, user_id, project_id, source_type, source_key, data)
             VALUES ($1, $2, $3, 'custom', $1, $4)
             ON CONFLICT (id, user_id, project_id) DO NOTHING`,
            [equipment.id, userId, projectId, asJson(equipment)]
          );
        }

        const deleted = new Set(payload.deletedEquipmentIds);
        for (const [id, data] of Object.entries(payload.equipmentOverrides)) {
          await client.query(
            `INSERT INTO wearable_equipment (id, user_id, project_id, source_type, source_key, data, is_deleted)
             VALUES ($1, $2, $3, 'builtin_override', $1, $4, $5)
             ON CONFLICT (user_id, project_id, source_type, source_key) DO UPDATE SET
               data = EXCLUDED.data, is_deleted = EXCLUDED.is_deleted, version = wearable_equipment.version + 1, updated_at = now()`,
            [id, userId, projectId, asJson(data), deleted.has(id)]
          );
          deleted.delete(id);
        }
        for (const id of deleted) {
          await client.query(
            `INSERT INTO wearable_equipment (id, user_id, project_id, source_type, source_key, data, is_deleted)
             VALUES ($1, $2, $3, 'builtin_override', $1, '{}'::jsonb, true)
             ON CONFLICT (user_id, project_id, source_type, source_key) DO UPDATE SET
               is_deleted = true, version = wearable_equipment.version + 1, updated_at = now()`,
            [id, userId, projectId]
          );
        }

        for (const scheme of payload.schemes) {
          await client.query(
            `INSERT INTO wearable_schemes (id, user_id, project_id, title, evaluation, thumbnail_url, snapshot, saved_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (id, user_id, project_id) DO NOTHING`,
            [scheme.id, userId, projectId, scheme.title, asJson(scheme.evaluation), scheme.thumbnailUrl, asJson(scheme.snapshot), scheme.savedAt]
          );
        }

        await client.query(
          "INSERT INTO local_data_migrations (user_id, project_id, migration_key) VALUES ($1, $2, $3)",
          [userId, projectId, LEGACY_MIGRATION_KEY]
        );
        await client.query("COMMIT");
        return { alreadyMigrated: false };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
  };
}
