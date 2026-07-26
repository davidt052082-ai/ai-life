CREATE TABLE study_plans (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  student text NOT NULL CHECK (student IN ('大公主', '小公主')),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 30),
  location text NOT NULL CHECK (length(location) BETWEEN 1 AND 50),
  start_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL CHECK (end_time > start_time),
  study_days integer NOT NULL CHECK (study_days >= 1),
  rest_days integer NOT NULL CHECK (rest_days >= 0),
  target_study_days integer NOT NULL CHECK (target_study_days >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX study_plans_owner_updated_idx ON study_plans (user_id, project_id, updated_at DESC);

INSERT INTO projects (id, code, name, description, route, cover_image_url, sort_order)
VALUES (
  'b406a418-20d1-4c15-a797-33ad4c904492',
  'study-plan',
  '学习计划日历',
  '按学习与休息循环安排两位小公主的课程日历。',
  '/projects/study-plan',
  NULL,
  2
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  route = EXCLUDED.route,
  cover_image_url = EXCLUDED.cover_image_url,
  sort_order = EXCLUDED.sort_order;
