function createRepositoryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function toAdminUser(row) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    isAdmin: Boolean(row.is_admin),
    createdAt: row.created_at,
    groups: row.groups || []
  };
}

function toAdminGroup(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at,
    memberCount: Number(row.member_count || 0),
    projectIds: row.project_ids || []
  };
}

function toAdminProject(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    isActive: Boolean(row.is_active),
    route: row.route,
    groupIds: row.group_ids || []
  };
}

async function requireGroup(client, groupId, { lock = false } = {}) {
  const result = await client.query(
    `SELECT id, code, name, description, is_default, created_at
     FROM groups WHERE id = $1${lock ? " FOR UPDATE" : ""}`,
    [groupId]
  );
  if (!result.rows[0]) throw createRepositoryError("NOT_FOUND", "分组不存在。");
  return result.rows[0];
}

async function requireExisting(client, table, id, message) {
  const result = await client.query(`SELECT id FROM ${table} WHERE id = $1`, [id]);
  if (!result.rows[0]) throw createRepositoryError("NOT_FOUND", message);
}

const userListSql = `
  SELECT u.id, u.email, u.display_name, u.is_admin, u.created_at,
         COALESCE(
           jsonb_agg(DISTINCT jsonb_build_object('id', g.id, 'name', g.name, 'isDefault', g.is_default))
           FILTER (WHERE g.id IS NOT NULL),
           '[]'::jsonb
         ) AS groups
  FROM users u
  LEFT JOIN user_groups ug ON ug.user_id = u.id
  LEFT JOIN groups g ON g.id = ug.group_id
`;

const groupListSql = `
  SELECT g.id, g.code, g.name, g.description, g.is_default, g.created_at,
         COUNT(DISTINCT ug.user_id)::int AS member_count,
         COALESCE(jsonb_agg(DISTINCT gpa.project_id) FILTER (WHERE gpa.project_id IS NOT NULL AND gpa.is_enabled), '[]'::jsonb) AS project_ids
  FROM groups g
  LEFT JOIN user_groups ug ON ug.group_id = g.id
  LEFT JOIN group_project_access gpa ON gpa.group_id = g.id
`;

const projectListSql = `
  SELECT p.id, p.code, p.name, p.description, p.route, p.is_active,
         COALESCE(jsonb_agg(DISTINCT gpa.group_id) FILTER (WHERE gpa.group_id IS NOT NULL AND gpa.is_enabled), '[]'::jsonb) AS group_ids
  FROM projects p
  LEFT JOIN group_project_access gpa ON gpa.project_id = p.id
`;

export function createAdminRepository(pool) {
  return {
    async syncConfiguredAdmin(email) {
      const normalizedEmail = String(email || "").trim().toLowerCase();
      if (!normalizedEmail) return;
      await pool.query("UPDATE users SET is_admin = true WHERE lower(email) = $1", [normalizedEmail]);
    },

    async listOverview() {
      const [users, groups, projects] = await Promise.all([
        pool.query(`${userListSql} GROUP BY u.id ORDER BY u.created_at DESC`),
        pool.query(`${groupListSql} GROUP BY g.id ORDER BY g.is_default DESC, g.name ASC`),
        pool.query(`${projectListSql} GROUP BY p.id ORDER BY p.sort_order ASC, p.name ASC`)
      ]);
      return {
        users: users.rows.map(toAdminUser),
        groups: groups.rows.map(toAdminGroup),
        projects: projects.rows.map(toAdminProject)
      };
    },

    async searchUsers(query) {
      const value = String(query || "").trim();
      const result = await pool.query(
        `${userListSql}
         WHERE $1 = '' OR u.email ILIKE '%' || $1 || '%' OR u.display_name ILIKE '%' || $1 || '%'
         GROUP BY u.id
         ORDER BY u.created_at DESC`,
        [value]
      );
      return result.rows.map(toAdminUser);
    },

    async createGroup({ id, code, name, description }) {
      const result = await pool.query(
        `INSERT INTO groups (id, code, name, description)
         VALUES ($1, $2, $3, $4)
         RETURNING id, code, name, description, is_default, created_at`,
        [id, code, name, description]
      );
      return toAdminGroup({ ...result.rows[0], member_count: 0, project_ids: [] });
    },

    async updateGroup({ groupId, name, description }) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const group = await requireGroup(client, groupId, { lock: true });
        if (group.is_default) throw createRepositoryError("GROUP_PROTECTED", "默认分组不能修改。");
        const result = await client.query(
          `UPDATE groups SET name = $2, description = $3 WHERE id = $1
           RETURNING id, code, name, description, is_default, created_at`,
          [groupId, name, description]
        );
        await client.query("COMMIT");
        return toAdminGroup({ ...result.rows[0], member_count: 0, project_ids: [] });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async deleteEmptyGroup(groupId) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const group = await requireGroup(client, groupId, { lock: true });
        if (group.is_default) throw createRepositoryError("GROUP_PROTECTED", "默认分组不能删除。");
        const usage = await client.query(
          `SELECT
             (SELECT count(*) FROM user_groups WHERE group_id = $1)::int AS member_count,
             (SELECT count(*) FROM group_project_access WHERE group_id = $1)::int AS project_count`,
          [groupId]
        );
        if (usage.rows[0].member_count > 0 || usage.rows[0].project_count > 0) {
          throw createRepositoryError("GROUP_NOT_EMPTY", "请先移除分组成员和项目权限。");
        }
        await client.query("DELETE FROM groups WHERE id = $1", [groupId]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async addMember({ groupId, userId }) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await requireGroup(client, groupId, { lock: true });
        await requireExisting(client, "users", userId, "用户不存在。");
        await client.query("INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [userId, groupId]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async removeMember({ groupId, userId }) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const group = await requireGroup(client, groupId, { lock: true });
        if (group.is_default) throw createRepositoryError("GROUP_PROTECTED", "默认分组成员不能移除。");
        await requireExisting(client, "users", userId, "用户不存在。");
        await client.query("DELETE FROM user_groups WHERE user_id = $1 AND group_id = $2", [userId, groupId]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async grantProject({ groupId, projectId }) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await requireGroup(client, groupId, { lock: true });
        await requireExisting(client, "projects", projectId, "项目不存在。");
        await client.query(
          `INSERT INTO group_project_access (group_id, project_id, is_enabled)
           VALUES ($1, $2, true)
           ON CONFLICT (group_id, project_id) DO UPDATE SET is_enabled = true`,
          [groupId, projectId]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async revokeProject({ groupId, projectId }) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const group = await requireGroup(client, groupId, { lock: true });
        const projectResult = await client.query("SELECT id, code FROM projects WHERE id = $1", [projectId]);
        if (!projectResult.rows[0]) throw createRepositoryError("NOT_FOUND", "项目不存在。");
        if (group.is_default && projectResult.rows[0].code === "wearable-monitoring") {
          throw createRepositoryError("GROUP_PROTECTED", "默认分组必须保留智能穿戴监测系统权限。");
        }
        await client.query("DELETE FROM group_project_access WHERE group_id = $1 AND project_id = $2", [groupId, projectId]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
  };
}
