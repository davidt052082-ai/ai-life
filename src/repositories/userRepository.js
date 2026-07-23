function toUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    isAdmin: Boolean(row.is_admin),
    createdAt: row.created_at
  };
}

function toProject(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    route: row.route,
    coverImageUrl: row.cover_image_url,
    role: row.role ?? null,
    sortOrder: row.sort_order
  };
}

export function createUserRepository(pool) {
  return {
    async registerUser({ id, email, displayName, passwordHash, defaultGroupCode, isAdmin }) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const userResult = await client.query(
          `INSERT INTO users (id, email, display_name, password_hash, is_admin)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, email, display_name, password_hash, is_admin, created_at`,
          [id, email, displayName, passwordHash, Boolean(isAdmin)]
        );
        const accessResult = await client.query(
          `INSERT INTO user_groups (user_id, group_id)
           SELECT $1, id FROM groups WHERE code = $2 AND is_default = true
           ON CONFLICT DO NOTHING
           RETURNING group_id`,
          [id, defaultGroupCode]
        );
        if (accessResult.rowCount !== 1) throw new Error("默认分组不存在或不可用。");
        await client.query("COMMIT");
        return toUser(userResult.rows[0]);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async findUserByEmail(email) {
      const result = await pool.query(
        "SELECT id, email, display_name, password_hash, is_admin, created_at FROM users WHERE email = $1",
        [email]
      );
      return toUser(result.rows[0]);
    },

    async createSession({ id, userId, expiresAt }) {
      await pool.query(
        "INSERT INTO user_sessions (id, user_id, expires_at) VALUES ($1, $2, $3)",
        [id, userId, expiresAt]
      );
    },

    async findActiveSession(sessionId) {
      const result = await pool.query(
        `SELECT u.id, u.email, u.display_name, u.password_hash, u.is_admin, u.created_at
         FROM user_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.id = $1 AND s.expires_at > now()`,
        [sessionId]
      );
      return toUser(result.rows[0]);
    },

    async deleteSession(sessionId) {
      await pool.query("DELETE FROM user_sessions WHERE id = $1", [sessionId]);
    },

    async listProjectsForUser(userId) {
      const result = await pool.query(
        `SELECT DISTINCT p.id, p.code, p.name, p.description, p.route, p.cover_image_url, p.sort_order
         FROM user_groups ug
         JOIN group_project_access gpa ON gpa.group_id = ug.group_id AND gpa.is_enabled = true
         JOIN projects p ON p.id = gpa.project_id
         WHERE ug.user_id = $1 AND p.is_active = true
         ORDER BY p.sort_order ASC, p.name ASC`,
        [userId]
      );
      return result.rows.map(toProject);
    },

    async findProjectAccess({ userId, projectCode }) {
      const result = await pool.query(
        `SELECT DISTINCT p.id, p.code, p.name, p.description, p.route, p.cover_image_url, p.sort_order
         FROM user_groups ug
         JOIN group_project_access gpa ON gpa.group_id = ug.group_id AND gpa.is_enabled = true
         JOIN projects p ON p.id = gpa.project_id
         WHERE ug.user_id = $1 AND p.code = $2 AND p.is_active = true`,
        [userId, projectCode]
      );
      return toProject(result.rows[0]);
    }
  };
}
