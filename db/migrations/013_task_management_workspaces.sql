-- Business projects live inside the existing task-management application project.
CREATE TABLE task_workspaces (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id, project_id)
);
CREATE INDEX task_workspaces_owner_idx ON task_workspaces(user_id, project_id, created_at, id);

-- Preserve all existing records, including accounts with only audit history.
INSERT INTO task_workspaces(id, user_id, project_id, name, description)
SELECT md5(user_id::text || ':' || project_id::text || ':task-default')::uuid,
       user_id, project_id, '默认项目', '原有事项管理数据'
FROM (
  SELECT user_id, project_id FROM task_people
  UNION SELECT user_id, project_id FROM task_items
  UNION SELECT user_id, project_id FROM task_dependencies
  UNION SELECT user_id, project_id FROM task_audit_logs
) owners;

ALTER TABLE task_people ADD COLUMN workspace_id uuid;
ALTER TABLE task_items ADD COLUMN workspace_id uuid;
ALTER TABLE task_dependencies ADD COLUMN workspace_id uuid;
ALTER TABLE task_audit_logs ADD COLUMN workspace_id uuid;
UPDATE task_people SET workspace_id = md5(user_id::text || ':' || project_id::text || ':task-default')::uuid;
UPDATE task_items SET workspace_id = md5(user_id::text || ':' || project_id::text || ':task-default')::uuid;
UPDATE task_dependencies SET workspace_id = md5(user_id::text || ':' || project_id::text || ':task-default')::uuid;
UPDATE task_audit_logs SET workspace_id = md5(user_id::text || ':' || project_id::text || ':task-default')::uuid;

ALTER TABLE task_people ALTER COLUMN workspace_id SET NOT NULL,
  ADD CONSTRAINT task_people_workspace_fk FOREIGN KEY (workspace_id, user_id, project_id) REFERENCES task_workspaces(id, user_id, project_id),
  ADD CONSTRAINT task_people_scope_unique UNIQUE (id, user_id, project_id, workspace_id);
ALTER TABLE task_items ALTER COLUMN workspace_id SET NOT NULL,
  ADD CONSTRAINT task_items_workspace_fk FOREIGN KEY (workspace_id, user_id, project_id) REFERENCES task_workspaces(id, user_id, project_id),
  ADD CONSTRAINT task_items_scope_unique UNIQUE (id, user_id, project_id, workspace_id),
  ADD CONSTRAINT task_items_assignee_scope_fk FOREIGN KEY (assignee_id, user_id, project_id, workspace_id) REFERENCES task_people(id, user_id, project_id, workspace_id);
ALTER TABLE task_dependencies ALTER COLUMN workspace_id SET NOT NULL,
  ADD CONSTRAINT task_dependencies_workspace_fk FOREIGN KEY (workspace_id, user_id, project_id) REFERENCES task_workspaces(id, user_id, project_id),
  ADD CONSTRAINT task_dependencies_predecessor_scope_fk FOREIGN KEY (predecessor_id, user_id, project_id, workspace_id) REFERENCES task_items(id, user_id, project_id, workspace_id) ON DELETE CASCADE,
  ADD CONSTRAINT task_dependencies_successor_scope_fk FOREIGN KEY (successor_id, user_id, project_id, workspace_id) REFERENCES task_items(id, user_id, project_id, workspace_id) ON DELETE CASCADE;
ALTER TABLE task_audit_logs ALTER COLUMN workspace_id SET NOT NULL,
  ADD CONSTRAINT task_audit_logs_workspace_fk FOREIGN KEY (workspace_id, user_id, project_id) REFERENCES task_workspaces(id, user_id, project_id);

CREATE INDEX task_people_workspace_idx ON task_people(user_id, project_id, workspace_id);
CREATE INDEX task_items_workspace_idx ON task_items(user_id, project_id, workspace_id, start_date);
CREATE INDEX task_dependencies_workspace_idx ON task_dependencies(user_id, project_id, workspace_id);
CREATE INDEX task_audit_logs_workspace_idx ON task_audit_logs(user_id, project_id, workspace_id, created_at DESC);
