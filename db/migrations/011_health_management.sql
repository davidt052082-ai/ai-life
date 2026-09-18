CREATE TABLE health_settings (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  timezone text NOT NULL DEFAULT 'Asia/Shanghai',
  hydration_target_ml integer NOT NULL DEFAULT 1700 CHECK (hydration_target_ml BETWEEN 500 AND 5000),
  plan_day_cutoff time NOT NULL DEFAULT '01:00',
  abdominal_massage_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, project_id)
);

CREATE TABLE health_events (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  idempotency_key text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('hydration', 'post_meal_walk', 'workout', 'baduanjin', 'no_alcohol', 'no_late_snack', 'no_sugary_drink', 'abdominal_massage', 'undo')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  timezone text NOT NULL,
  plan_date date NOT NULL,
  source text NOT NULL DEFAULT 'web_manual' CHECK (source IN ('web_manual', 'ai', 'wearable', 'device_api')),
  sync_status text NOT NULL DEFAULT 'synced' CHECK (sync_status IN ('synced', 'pending', 'failed')),
  undone_event_id uuid REFERENCES health_events(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key),
  UNIQUE (user_id, event_id)
);

CREATE TABLE health_measurements (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  weight_kg numeric(5,2) CHECK (weight_kg IS NULL OR weight_kg BETWEEN 20 AND 400),
  waist_cm numeric(5,1) CHECK (waist_cm IS NULL OR waist_cm BETWEEN 30 AND 250),
  occurred_at timestamptz NOT NULL,
  timezone text NOT NULL,
  source text NOT NULL DEFAULT 'web_manual',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (weight_kg IS NOT NULL OR waist_cm IS NOT NULL),
  UNIQUE (user_id, idempotency_key)
);

CREATE TABLE health_meals (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  meal_type text NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
  storage_key text NOT NULL,
  original_name text NOT NULL,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 2097152),
  captured_at timestamptz NOT NULL,
  timezone text NOT NULL,
  plan_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending_analysis' CHECK (status = 'pending_analysis'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);

CREATE TABLE health_notifications (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  notification_date date NOT NULL,
  reminder_kind text NOT NULL,
  message text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, project_id, notification_date, reminder_kind)
);

CREATE INDEX health_events_owner_plan_idx ON health_events (user_id, project_id, plan_date, occurred_at DESC);
CREATE INDEX health_measurements_owner_occurred_idx ON health_measurements (user_id, project_id, occurred_at DESC);
CREATE INDEX health_meals_owner_plan_idx ON health_meals (user_id, project_id, plan_date, captured_at DESC);

INSERT INTO projects (id, code, name, description, route, cover_image_url, sort_order)
VALUES ('8d82f809-4b39-4054-8718-3fec10c1f3cb', 'health', '健康管理', '腹型减脂的计划、打卡、趋势与周报。', '/projects/health', NULL, 4)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  route = EXCLUDED.route,
  sort_order = EXCLUDED.sort_order;

INSERT INTO group_project_access (group_id, project_id, is_enabled)
SELECT g.id, p.id, true
FROM groups g CROSS JOIN projects p
WHERE g.code = 'default' AND p.code = 'health'
ON CONFLICT (group_id, project_id) DO UPDATE SET is_enabled = true;
