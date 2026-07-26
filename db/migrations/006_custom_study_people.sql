DELETE FROM study_plans;

CREATE TABLE study_people (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 30),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id, project_id),
  UNIQUE (user_id, project_id, name)
);

ALTER TABLE study_plans DROP CONSTRAINT study_plans_student_check;
ALTER TABLE study_plans DROP COLUMN student;
ALTER TABLE study_plans ADD COLUMN person_id uuid NOT NULL;
ALTER TABLE study_plans ADD CONSTRAINT study_plans_person_scope_fk
  FOREIGN KEY (person_id, user_id, project_id)
  REFERENCES study_people (id, user_id, project_id)
  ON DELETE RESTRICT;

CREATE INDEX study_people_owner_created_idx ON study_people (user_id, project_id, created_at ASC);
CREATE INDEX study_plans_person_idx ON study_plans (user_id, project_id, person_id);
