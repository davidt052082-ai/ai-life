CREATE TABLE health_oauth_states (
  id uuid PRIMARY KEY,
  state_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  redirect_path text NOT NULL DEFAULT '/projects/health?tab=settings',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE health_connections (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider = 'huawei'),
  provider_user_id_hash text,
  status text NOT NULL CHECK (status IN ('connected', 'reauth_required', 'disconnected')),
  granted_scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  access_token_enc text,
  refresh_token_enc text,
  access_token_expires_at timestamptz,
  last_successful_sync_at timestamptz,
  last_attempt_sync_at timestamptz,
  last_error_code text,
  last_error_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

CREATE TABLE health_samples (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider = 'huawei'),
  metric_type text NOT NULL,
  source_record_id text NOT NULL,
  start_time_utc timestamptz NOT NULL,
  end_time_utc timestamptz NOT NULL,
  value_num numeric(12, 3) NOT NULL,
  unit text NOT NULL,
  raw_hash text NOT NULL,
  source_device text,
  source_modified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, user_id, metric_type, source_record_id)
);

CREATE TABLE health_daily (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  local_date date NOT NULL,
  timezone text NOT NULL,
  steps integer CHECK (steps IS NULL OR steps >= 0),
  distance_m numeric(12, 2) CHECK (distance_m IS NULL OR distance_m >= 0),
  active_calories_kcal numeric(10, 2) CHECK (active_calories_kcal IS NULL OR active_calories_kcal >= 0),
  exercise_minutes integer CHECK (exercise_minutes IS NULL OR exercise_minutes >= 0),
  weight_kg numeric(5, 2) CHECK (weight_kg IS NULL OR weight_kg BETWEEN 20 AND 400),
  sleep_minutes integer CHECK (sleep_minutes IS NULL OR sleep_minutes >= 0),
  deep_sleep_minutes integer CHECK (deep_sleep_minutes IS NULL OR deep_sleep_minutes >= 0),
  resting_hr integer CHECK (resting_hr IS NULL OR resting_hr BETWEEN 20 AND 300),
  source_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, project_id, local_date)
);

CREATE TABLE health_workouts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider = 'huawei'),
  source_record_id text NOT NULL,
  activity_type text NOT NULL,
  start_time_utc timestamptz NOT NULL,
  end_time_utc timestamptz NOT NULL,
  duration_seconds integer NOT NULL CHECK (duration_seconds >= 0),
  distance_m numeric(12, 2) CHECK (distance_m IS NULL OR distance_m >= 0),
  calories_kcal numeric(10, 2) CHECK (calories_kcal IS NULL OR calories_kcal >= 0),
  avg_hr integer CHECK (avg_hr IS NULL OR avg_hr BETWEEN 20 AND 300),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, user_id, source_record_id)
);

CREATE TABLE health_sync_runs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider = 'huawei'),
  trigger text NOT NULL CHECK (trigger IN ('scheduled', 'page', 'manual', 'initial')),
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'success', 'partial', 'failed')),
  records_read integer NOT NULL DEFAULT 0 CHECK (records_read >= 0),
  records_inserted integer NOT NULL DEFAULT 0 CHECK (records_inserted >= 0),
  records_updated integer NOT NULL DEFAULT 0 CHECK (records_updated >= 0),
  error_code text,
  trace_id uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX health_oauth_states_expiry_idx ON health_oauth_states (expires_at);
CREATE INDEX health_connections_project_idx ON health_connections (project_id);
CREATE INDEX health_samples_owner_metric_time_idx ON health_samples (user_id, project_id, metric_type, start_time_utc DESC);
CREATE INDEX health_daily_owner_date_idx ON health_daily (user_id, project_id, local_date DESC);
CREATE INDEX health_workouts_owner_started_idx ON health_workouts (user_id, project_id, start_time_utc DESC);
CREATE INDEX health_sync_runs_owner_started_idx ON health_sync_runs (user_id, project_id, started_at DESC);
