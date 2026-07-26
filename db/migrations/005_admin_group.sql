ALTER TABLE groups ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;

INSERT INTO groups (id, code, name, description, is_default, is_system)
VALUES (
  'ec6d0284-4c0a-4fdd-8abe-5c2bd50b87e0',
  'admin',
  '管理组',
  '系统管理组：成员由管理员角色自动维护，并拥有所有项目权限。',
  false,
  true
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_system = true;

CREATE OR REPLACE FUNCTION sync_admin_group_membership()
RETURNS trigger AS $$
DECLARE
  admin_group_id uuid;
BEGIN
  SELECT id INTO admin_group_id FROM groups WHERE code = 'admin';
  IF NEW.is_admin THEN
    INSERT INTO user_groups (user_id, group_id)
    VALUES (NEW.id, admin_group_id)
    ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM user_groups
    WHERE user_id = NEW.id AND group_id = admin_group_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS admin_group_membership_trigger ON users;
CREATE TRIGGER admin_group_membership_trigger
AFTER INSERT OR UPDATE OF is_admin ON users
FOR EACH ROW EXECUTE FUNCTION sync_admin_group_membership();

CREATE OR REPLACE FUNCTION enforce_admin_group_membership()
RETURNS trigger AS $$
DECLARE
  affected_group_id uuid;
  affected_user_id uuid;
  is_admin_group boolean;
  is_admin_user boolean;
BEGIN
  affected_group_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.group_id ELSE NEW.group_id END;
  affected_user_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
  SELECT code = 'admin' INTO is_admin_group FROM groups WHERE id = affected_group_id;
  IF NOT is_admin_group THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  SELECT is_admin INTO is_admin_user FROM users WHERE id = affected_user_id;
  IF TG_OP = 'DELETE' AND is_admin_user THEN
    RAISE EXCEPTION '管理员必须保留管理组成员关系';
  END IF;
  IF TG_OP <> 'DELETE' AND NOT is_admin_user THEN
    RAISE EXCEPTION '非管理员不能加入管理组';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS admin_group_relation_guard_trigger ON user_groups;
CREATE TRIGGER admin_group_relation_guard_trigger
BEFORE INSERT OR UPDATE OR DELETE ON user_groups
FOR EACH ROW EXECUTE FUNCTION enforce_admin_group_membership();

CREATE OR REPLACE FUNCTION grant_admin_group_project_access()
RETURNS trigger AS $$
DECLARE
  admin_group_id uuid;
BEGIN
  SELECT id INTO admin_group_id FROM groups WHERE code = 'admin';
  INSERT INTO group_project_access (group_id, project_id, is_enabled)
  VALUES (admin_group_id, NEW.id, true)
  ON CONFLICT (group_id, project_id) DO UPDATE SET is_enabled = true;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS admin_group_project_access_trigger ON projects;
CREATE TRIGGER admin_group_project_access_trigger
AFTER INSERT ON projects
FOR EACH ROW EXECUTE FUNCTION grant_admin_group_project_access();

INSERT INTO user_groups (user_id, group_id)
SELECT u.id, g.id
FROM users u CROSS JOIN groups g
WHERE g.code = 'admin' AND u.is_admin = true
ON CONFLICT DO NOTHING;

DELETE FROM user_groups ug
USING groups g, users u
WHERE ug.group_id = g.id
  AND ug.user_id = u.id
  AND g.code = 'admin'
  AND u.is_admin = false;

INSERT INTO group_project_access (group_id, project_id, is_enabled)
SELECT g.id, p.id, true
FROM groups g CROSS JOIN projects p
WHERE g.code = 'admin'
ON CONFLICT (group_id, project_id) DO UPDATE SET is_enabled = true;
