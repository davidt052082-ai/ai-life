CREATE TABLE task_people (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  color text NOT NULL CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  daily_capacity_hours numeric(6,2) NOT NULL DEFAULT 8 CHECK (daily_capacity_hours > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE task_items (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
  description text NOT NULL DEFAULT '',
  assignee_id uuid REFERENCES task_people(id) ON DELETE RESTRICT,
  start_date date,
  end_date date,
  estimated_hours numeric(7,2) NOT NULL DEFAULT 0 CHECK (estimated_hours >= 0),
  actual_hours numeric(7,2) NOT NULL DEFAULT 0 CHECK (actual_hours >= 0),
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'completed', 'blocked')),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  is_milestone boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE task_dependencies (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  predecessor_id uuid NOT NULL REFERENCES task_items(id) ON DELETE CASCADE,
  successor_id uuid NOT NULL REFERENCES task_items(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, project_id, predecessor_id, successor_id)
);

CREATE TABLE task_audit_logs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('person', 'task', 'dependency')),
  entity_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX task_people_owner_idx ON task_people (user_id, project_id, name);
CREATE INDEX task_items_owner_idx ON task_items (user_id, project_id, start_date, updated_at DESC);
CREATE INDEX task_dependencies_owner_idx ON task_dependencies (user_id, project_id);
CREATE INDEX task_audit_logs_owner_idx ON task_audit_logs (user_id, project_id, created_at DESC);

INSERT INTO projects (id, code, name, description, route, cover_image_url, sort_order)
VALUES ('40c36068-6081-4a11-a1b2-7622b2058db5', 'task-management', '事项管理', '统筹任务、排期、依赖、状态与冲突预警。', '/projects/task-management', NULL, 5)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  route = EXCLUDED.route,
  sort_order = EXCLUDED.sort_order;

INSERT INTO group_project_access (group_id, project_id, is_enabled)
SELECT g.id, p.id, true
FROM groups g CROSS JOIN projects p
WHERE g.code = 'default' AND p.code = 'task-management'
ON CONFLICT (group_id, project_id) DO UPDATE SET is_enabled = true;
