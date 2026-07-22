function toUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    passwordHash: row.password_hash,
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
    role: row.role,
    sortOrder: row.sort_order
  };
}

export function createUserRepository(pool) {
  return {
    async registerUser({ id, email, displayName, passwordHash, defaultProjectCode }) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const userResult = await client.query(
          `INSERT INTO users (id, email, display_name, password_hash)
           VALUES ($1, $2, $3, $4)
           RETURNING id, email, display_name, password_hash, created_at`,
          [id, email, displayName, passwordHash]
        );
        const accessResult = await client.query(
          `INSERT INTO project_access (project_id, user_id, role)
           SELECT id, $1, 'member' FROM projects WHERE code = $2 AND is_active = true
           ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role, is_enabled = true
           RETURNING project_id`,
          [id, defaultProjectCode]
        );
        if (accessResult.rowCount !== 1) throw new Error("默认项目不存在或不可用。");
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
        "SELECT id, email, display_name, password_hash, created_at FROM users WHERE email = $1",
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
        `SELECT u.id, u.email, u.display_name, u.password_hash, u.created_at
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
        `SELECT p.id, p.code, p.name, p.description, p.route, p.cover_image_url, p.sort_order, pa.role
         FROM project_access pa
         JOIN projects p ON p.id = pa.project_id
         WHERE pa.user_id = $1 AND pa.is_enabled = true AND p.is_active = true
         ORDER BY p.sort_order ASC, p.name ASC`,
        [userId]
      );
      return result.rows.map(toProject);
    },

    async findProjectAccess({ userId, projectCode }) {
      const result = await pool.query(
        `SELECT p.id, p.code, p.name, p.description, p.route, p.cover_image_url, p.sort_order, pa.role
         FROM project_access pa
         JOIN projects p ON p.id = pa.project_id
         WHERE pa.user_id = $1 AND p.code = $2 AND pa.is_enabled = true AND p.is_active = true`,
        [userId, projectCode]
      );
      return toProject(result.rows[0]);
    }
  };
}
