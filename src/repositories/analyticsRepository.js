const KEY_ACTION_EVENT_TYPES = ["wearable_equipment_add", "wearable_scheme_save", "study_plan_create"];

function number(value) {
  return Number(value || 0);
}

function toKpis(row = {}) {
  return {
    uniqueVisitors: number(row.unique_visitors),
    pageViews: number(row.page_views),
    signups: number(row.signups),
    projectEnters: number(row.project_enters),
    activeUsers: number(row.active_users),
    keyActions: number(row.key_actions)
  };
}

function encodeCursor(row) {
  if (!row) return null;
  return Buffer.from(JSON.stringify({ occurredAt: row.occurred_at, id: row.id })).toString("base64url");
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    return typeof value?.occurredAt === "string" && typeof value?.id === "string" ? value : null;
  } catch {
    return null;
  }
}

function eventFromRow(row) {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    eventType: row.event_type,
    pagePath: row.page_path,
    projectCode: row.project_code,
    referrerHost: row.referrer_host,
    deviceType: row.device_type,
    countryCode: row.country_code,
    userId: row.user_id,
    properties: row.properties || {}
  };
}

const breakdownFields = {
  source: "COALESCE(NULLIF(referrer_host, ''), 'direct')",
  device: "COALESCE(NULLIF(device_type, ''), 'unknown')",
  page: "COALESCE(NULLIF(page_path, ''), '/')",
  project: "COALESCE(NULLIF(project_code, ''), 'unknown')",
  country: "COALESCE(NULLIF(country_code, ''), 'unknown')"
};

export function createAnalyticsRepository(pool) {
  return {
    async recordEvent(event) {
      await pool.query(
        `INSERT INTO analytics_events (
           id, visitor_id, session_id, user_id, event_type, page_path, project_code,
           referrer_host, utm_source, utm_medium, utm_campaign, utm_term, utm_content,
           device_type, browser_name, os_name, language, screen_width, screen_height,
           ip_hash, country_code, properties
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
           $14, $15, $16, $17, $18, $19, $20, $21, $22::jsonb
         )`,
        [
          event.id, event.visitorId, event.sessionId, event.userId, event.eventType,
          event.pagePath, event.projectCode, event.referrerHost, event.utmSource,
          event.utmMedium, event.utmCampaign, event.utmTerm, event.utmContent,
          event.deviceType, event.browserName, event.osName, event.language,
          event.screenWidth, event.screenHeight, event.ipHash, event.countryCode,
          JSON.stringify(event.properties || {})
        ]
      );
    },

    async refreshDailyMetrics({ from, to }) {
      await pool.query(
        "DELETE FROM analytics_daily_metrics WHERE metric_date BETWEEN $1::date AND $2::date",
        [from, to]
      );
      await pool.query(
        `WITH scoped AS (
           SELECT * FROM analytics_events WHERE event_date BETWEEN $1::date AND $2::date
         ), metrics AS (
           SELECT event_date AS metric_date, 'unique_visitors' AS metric_key, 'all' AS dimension_type, 'all' AS dimension_value, COUNT(DISTINCT visitor_id)::bigint AS metric_value FROM scoped GROUP BY event_date
           UNION ALL SELECT event_date, 'page_views', 'all', 'all', COUNT(*)::bigint FROM scoped WHERE event_type = 'page_view' GROUP BY event_date
           UNION ALL SELECT event_date, 'signups', 'all', 'all', COUNT(*)::bigint FROM scoped WHERE event_type = 'sign_up' GROUP BY event_date
           UNION ALL SELECT event_date, 'project_enters', 'all', 'all', COUNT(*)::bigint FROM scoped WHERE event_type = 'project_enter' GROUP BY event_date
           UNION ALL SELECT event_date, 'active_users', 'all', 'all', COUNT(DISTINCT user_id)::bigint FROM scoped WHERE user_id IS NOT NULL AND event_type IN ('project_enter', 'wearable_equipment_add', 'wearable_scheme_save', 'study_plan_create') GROUP BY event_date
           UNION ALL SELECT event_date, 'key_actions', 'all', 'all', COUNT(*)::bigint FROM scoped WHERE event_type IN ('wearable_equipment_add', 'wearable_scheme_save', 'study_plan_create') GROUP BY event_date
           UNION ALL SELECT event_date, 'page_views', 'source', COALESCE(NULLIF(referrer_host, ''), 'direct'), COUNT(*)::bigint FROM scoped WHERE event_type = 'page_view' GROUP BY event_date, COALESCE(NULLIF(referrer_host, ''), 'direct')
           UNION ALL SELECT event_date, 'page_views', 'device', COALESCE(NULLIF(device_type, ''), 'unknown'), COUNT(*)::bigint FROM scoped WHERE event_type = 'page_view' GROUP BY event_date, COALESCE(NULLIF(device_type, ''), 'unknown')
           UNION ALL SELECT event_date, 'page_views', 'page', COALESCE(NULLIF(page_path, ''), '/'), COUNT(*)::bigint FROM scoped WHERE event_type = 'page_view' GROUP BY event_date, COALESCE(NULLIF(page_path, ''), '/')
           UNION ALL SELECT event_date, 'page_views', 'country', COALESCE(NULLIF(country_code, ''), 'unknown'), COUNT(*)::bigint FROM scoped WHERE event_type = 'page_view' GROUP BY event_date, COALESCE(NULLIF(country_code, ''), 'unknown')
           UNION ALL SELECT event_date, 'project_enters', 'project', COALESCE(NULLIF(project_code, ''), 'unknown'), COUNT(*)::bigint FROM scoped WHERE event_type = 'project_enter' GROUP BY event_date, COALESCE(NULLIF(project_code, ''), 'unknown')
         )
         INSERT INTO analytics_daily_metrics (metric_date, metric_key, dimension_type, dimension_value, metric_value)
         SELECT metric_date, metric_key, dimension_type, dimension_value, metric_value FROM metrics
         ON CONFLICT (metric_date, metric_key, dimension_type, dimension_value)
         DO UPDATE SET metric_value = EXCLUDED.metric_value, updated_at = now()`,
        [from, to]
      );
    },

    async purgeExpiredEvents() {
      const result = await pool.query("DELETE FROM analytics_events WHERE event_date < current_date - interval '180 days'");
      return result.rowCount;
    },

    async getSummary({ from, to }) {
      const values = [from, to, KEY_ACTION_EVENT_TYPES];
      const kpiResult = await pool.query(
        `SELECT
           COUNT(DISTINCT visitor_id) AS unique_visitors,
           COUNT(*) FILTER (WHERE event_type = 'page_view') AS page_views,
           COUNT(*) FILTER (WHERE event_type = 'sign_up') AS signups,
           COUNT(*) FILTER (WHERE event_type = 'project_enter') AS project_enters,
           COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL AND event_type IN ('project_enter', 'wearable_equipment_add', 'wearable_scheme_save', 'study_plan_create')) AS active_users,
           COUNT(*) FILTER (WHERE event_type = ANY($3::text[])) AS key_actions
         FROM analytics_events WHERE event_date BETWEEN $1::date AND $2::date`,
        values
      );
      const [trendResult, projectResult, eventsResult] = await Promise.all([
        pool.query(
          `SELECT event_date, COUNT(DISTINCT visitor_id) AS unique_visitors,
             COUNT(*) FILTER (WHERE event_type = 'page_view') AS page_views
          FROM analytics_events WHERE event_date BETWEEN $1::date AND $2::date
           GROUP BY event_date ORDER BY event_date ASC`,
          [from, to]
        ),
        pool.query(
          `SELECT COALESCE(NULLIF(project_code, ''), 'unknown') AS project_code,
             COUNT(*) FILTER (WHERE event_type = 'project_enter') AS project_enters,
             COUNT(*) FILTER (WHERE event_type = ANY($3::text[])) AS key_actions
           FROM analytics_events
           WHERE event_date BETWEEN $1::date AND $2::date
             AND project_code IS NOT NULL AND project_code <> ''
           GROUP BY COALESCE(NULLIF(project_code, ''), 'unknown')
           ORDER BY project_enters DESC, key_actions DESC LIMIT 20`,
          values
        ),
        pool.query(
          `SELECT id, occurred_at, event_type, page_path, project_code, referrer_host, device_type, country_code, user_id, properties
           FROM analytics_events
           WHERE event_date BETWEEN $1::date AND $2::date AND event_type <> 'page_view'
           ORDER BY occurred_at DESC, id DESC LIMIT 8`,
          [from, to]
        )
      ]);
      return {
        kpis: toKpis(kpiResult.rows[0]),
        trend: trendResult.rows.map((row) => ({ date: String(row.event_date).slice(0, 10), uniqueVisitors: number(row.unique_visitors), pageViews: number(row.page_views) })),
        projects: projectResult.rows.map((row) => ({ projectCode: row.project_code, projectEnters: number(row.project_enters), keyActions: number(row.key_actions) })),
        recentEvents: eventsResult.rows.map(eventFromRow)
      };
    },

    async getBreakdown({ from, to, dimension }) {
      const field = breakdownFields[dimension];
      if (!field) throw new Error("Unknown analytics breakdown dimension.");
      const result = await pool.query(
        `SELECT ${field} AS dimension_value, COUNT(*)::bigint AS metric_value,
           COUNT(DISTINCT visitor_id)::bigint AS unique_visitors
         FROM analytics_events WHERE event_date BETWEEN $1::date AND $2::date
         GROUP BY ${field} ORDER BY metric_value DESC, dimension_value ASC LIMIT 20`,
        [from, to]
      );
      return result.rows.map((row) => ({ value: row.dimension_value, count: number(row.metric_value), uniqueVisitors: number(row.unique_visitors) }));
    },

    async getFunnel({ from, to }) {
      const result = await pool.query(
        `SELECT
           COUNT(DISTINCT visitor_id) FILTER (WHERE event_type = 'page_view') AS page_views,
           COUNT(DISTINCT COALESCE(user_id::text, visitor_id::text)) FILTER (WHERE event_type = 'sign_up') AS signups,
           COUNT(DISTINCT COALESCE(user_id::text, visitor_id::text)) FILTER (WHERE event_type = 'project_enter') AS project_enters,
           COUNT(DISTINCT COALESCE(user_id::text, visitor_id::text)) FILTER (WHERE event_type IN ('wearable_equipment_add', 'wearable_scheme_save', 'study_plan_create')) AS key_actions
         FROM analytics_events WHERE event_date BETWEEN $1::date AND $2::date`,
        [from, to]
      );
      const row = result.rows[0] || {};
      return [
        { key: "pageViews", label: "访问", count: number(row.page_views) },
        { key: "signups", label: "注册", count: number(row.signups) },
        { key: "projectEnters", label: "进入项目", count: number(row.project_enters) },
        { key: "keyActions", label: "关键动作", count: number(row.key_actions) }
      ];
    },

    async listEvents({ from, to, type, projectCode, cursor, limit = 50 }) {
      const cursorValue = decodeCursor(cursor);
      const values = [from, to];
      const clauses = ["event_date BETWEEN $1::date AND $2::date"];
      if (type) {
        values.push(type);
        clauses.push(`event_type = $${values.length}`);
      }
      if (projectCode) {
        values.push(projectCode);
        clauses.push(`project_code = $${values.length}`);
      }
      if (cursorValue) {
        values.push(cursorValue.occurredAt, cursorValue.id);
        clauses.push(`(occurred_at, id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`);
      }
      const pageSize = Math.min(Math.max(Number(limit) || 50, 1), 100);
      values.push(pageSize + 1);
      const result = await pool.query(
        `SELECT id, occurred_at, event_type, page_path, project_code, referrer_host, device_type, country_code, user_id, properties
         FROM analytics_events WHERE ${clauses.join(" AND ")}
         ORDER BY occurred_at DESC, id DESC LIMIT $${values.length}`,
        values
      );
      const hasNext = result.rows.length > pageSize;
      const rows = hasNext ? result.rows.slice(0, pageSize) : result.rows;
      return { events: rows.map(eventFromRow), nextCursor: hasNext ? encodeCursor(rows.at(-1)) : null };
    }
  };
}
