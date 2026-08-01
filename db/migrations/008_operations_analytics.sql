CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  event_date date NOT NULL DEFAULT current_date,
  visitor_id uuid NOT NULL,
  session_id uuid NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'page_view', 'sign_up', 'login', 'project_enter', 'wearable_equipment_add',
    'wearable_scheme_save', 'study_plan_create', 'admin_group_create',
    'admin_membership_change', 'admin_project_access_change'
  )),
  page_path text NOT NULL,
  project_code text,
  referrer_host text NOT NULL DEFAULT 'direct',
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  device_type text NOT NULL DEFAULT 'unknown' CHECK (device_type IN ('desktop', 'mobile', 'tablet', 'unknown')),
  browser_name text,
  os_name text,
  language text,
  screen_width integer CHECK (screen_width IS NULL OR screen_width BETWEEN 1 AND 10000),
  screen_height integer CHECK (screen_height IS NULL OR screen_height BETWEEN 1 AND 10000),
  ip_hash text,
  country_code char(2),
  properties jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX analytics_events_date_idx ON analytics_events (event_date DESC, occurred_at DESC);
CREATE INDEX analytics_events_type_date_idx ON analytics_events (event_type, event_date DESC);
CREATE INDEX analytics_events_project_date_idx ON analytics_events (project_code, event_date DESC) WHERE project_code IS NOT NULL;
CREATE INDEX analytics_events_visitor_date_idx ON analytics_events (visitor_id, event_date DESC);
CREATE INDEX analytics_events_user_date_idx ON analytics_events (user_id, event_date DESC) WHERE user_id IS NOT NULL;

CREATE TABLE analytics_daily_metrics (
  metric_date date NOT NULL,
  metric_key text NOT NULL,
  dimension_type text NOT NULL,
  dimension_value text NOT NULL,
  metric_value bigint NOT NULL CHECK (metric_value >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (metric_date, metric_key, dimension_type, dimension_value)
);
