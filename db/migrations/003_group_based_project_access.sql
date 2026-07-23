ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

CREATE TABLE groups (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX groups_one_default_idx ON groups (is_default) WHERE is_default;

CREATE TABLE user_groups (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, group_id)
);

CREATE TABLE group_project_access (
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  is_enabled boolean NOT NULL DEFAULT true,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, project_id)
);

INSERT INTO groups (id, code, name, description, is_default)
VALUES (
  'ab24182d-b513-4f42-b7b8-5a7bd5eeea29',
  'default',
  '默认分组',
  '所有新注册用户自动加入的分组。',
  true
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO group_project_access (group_id, project_id, is_enabled)
SELECT 'ab24182d-b513-4f42-b7b8-5a7bd5eeea29', id, true
FROM projects
WHERE code = 'wearable-monitoring' AND is_active = true
ON CONFLICT (group_id, project_id) DO UPDATE SET is_enabled = true;

INSERT INTO user_groups (user_id, group_id)
SELECT id, 'ab24182d-b513-4f42-b7b8-5a7bd5eeea29'
FROM users
ON CONFLICT DO NOTHING;

INSERT INTO groups (id, code, name, description, is_default)
SELECT DISTINCT
  (
    substr(md5(pa.user_id::text || ':legacy'), 1, 8) || '-' ||
    substr(md5(pa.user_id::text || ':legacy'), 9, 4) || '-' ||
    substr(md5(pa.user_id::text || ':legacy'), 13, 4) || '-' ||
    substr(md5(pa.user_id::text || ':legacy'), 17, 4) || '-' ||
    substr(md5(pa.user_id::text || ':legacy'), 21, 12)
  )::uuid,
  'legacy-' || replace(pa.user_id::text, '-', ''),
  '历史授权 ' || pa.user_id::text,
  '从用户直接授权迁移的专属分组。',
  false
FROM project_access pa
JOIN projects p ON p.id = pa.project_id
WHERE pa.is_enabled = true AND p.code <> 'wearable-monitoring'
ON CONFLICT (code) DO NOTHING;

INSERT INTO user_groups (user_id, group_id)
SELECT DISTINCT
  pa.user_id,
  g.id
FROM project_access pa
JOIN projects p ON p.id = pa.project_id
JOIN groups g ON g.code = 'legacy-' || replace(pa.user_id::text, '-', '')
WHERE pa.is_enabled = true AND p.code <> 'wearable-monitoring'
ON CONFLICT DO NOTHING;

INSERT INTO group_project_access (group_id, project_id, is_enabled)
SELECT DISTINCT
  g.id,
  pa.project_id,
  true
FROM project_access pa
JOIN projects p ON p.id = pa.project_id
JOIN groups g ON g.code = 'legacy-' || replace(pa.user_id::text, '-', '')
WHERE pa.is_enabled = true AND p.code <> 'wearable-monitoring'
ON CONFLICT (group_id, project_id) DO UPDATE SET is_enabled = true;

DROP TABLE project_access;

CREATE INDEX user_groups_user_idx ON user_groups (user_id, group_id);
CREATE INDEX group_project_access_project_idx ON group_project_access (project_id, group_id)
  WHERE is_enabled;
