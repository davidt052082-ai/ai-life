# 管理组与全项目授权 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a protected management group that contains exactly administrators and automatically receives every AI Life project permission.

**Architecture:** PostgreSQL owns the invariant through one migration: a system-group flag, an administrator-membership trigger, and a project-grant trigger. The existing admin repository continues to list the group but rejects every manual mutation of system groups; the existing project-access query then grants administrators all projects through normal group relationships.

**Tech Stack:** PostgreSQL triggers and migrations, Node.js ESM, Express, vanilla JavaScript, Node built-in test runner.

---

## File structure

- `db/migrations/005_admin_group.sql`: creates/backfills the management group and installs database triggers.
- `src/repositories/adminRepository.js`: returns `isSystem` and blocks manual system-group mutation.
- `admin.html`: labels the management group and removes mutable controls for it.
- `test/database-config.test.js`: verifies migration discovery.
- `test/admin-group-migration.test.js`: inspects the migration’s explicit trigger and backfill statements.
- `test/admin-repository.test.js`: verifies protected-group mutation is rejected before member/project writes.
- `test/admin-page.test.js`: verifies system-group UI behavior is present.
- `README.md`: documents automatic management-group membership and permissions.

### Task 1: Add the database-owned management-group invariant

**Files:**
- Create: `db/migrations/005_admin_group.sql`
- Create: `test/admin-group-migration.test.js`
- Modify: `test/database-config.test.js`

- [ ] **Step 1: Write failing migration-discovery and invariant tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("admin-group migration creates both automatic synchronization triggers", async () => {
  const migration = await fs.readFile(new URL("../db/migrations/005_admin_group.sql", import.meta.url), "utf8");
  assert.match(migration, /code, name, description, is_default, is_system/);
  assert.match(migration, /CREATE TRIGGER admin_group_membership_trigger/);
  assert.match(migration, /AFTER INSERT OR UPDATE OF is_admin ON users/);
  assert.match(migration, /CREATE TRIGGER admin_group_project_access_trigger/);
  assert.match(migration, /AFTER INSERT ON projects/);
  assert.match(migration, /DELETE FROM user_groups/);
  assert.match(migration, /INSERT INTO group_project_access/);
});
```

Extend `listMigrationFiles` expectation with `"005_admin_group.sql"`.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `node --test test/database-config.test.js test/admin-group-migration.test.js`

Expected: FAIL because migration `005_admin_group.sql` does not exist and migration discovery stops at `004`.

- [ ] **Step 3: Create the idempotent migration**

```sql
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
DECLARE admin_group_id uuid;
BEGIN
  SELECT id INTO admin_group_id FROM groups WHERE code = 'admin';
  IF NEW.is_admin THEN
    INSERT INTO user_groups (user_id, group_id) VALUES (NEW.id, admin_group_id) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM user_groups WHERE user_id = NEW.id AND group_id = admin_group_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS admin_group_membership_trigger ON users;
CREATE TRIGGER admin_group_membership_trigger
AFTER INSERT OR UPDATE OF is_admin ON users
FOR EACH ROW EXECUTE FUNCTION sync_admin_group_membership();
```

Add the project trigger exactly as follows, then finish with the backfills:

```sql
CREATE OR REPLACE FUNCTION grant_admin_group_project_access()
RETURNS trigger AS $$
DECLARE admin_group_id uuid;
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
```

Finish with the backfills:

```sql
INSERT INTO user_groups (user_id, group_id)
SELECT u.id, g.id FROM users u CROSS JOIN groups g
WHERE g.code = 'admin' AND u.is_admin = true
ON CONFLICT DO NOTHING;

DELETE FROM user_groups ug USING groups g, users u
WHERE ug.group_id = g.id AND ug.user_id = u.id AND g.code = 'admin' AND u.is_admin = false;

INSERT INTO group_project_access (group_id, project_id, is_enabled)
SELECT g.id, p.id, true FROM groups g CROSS JOIN projects p WHERE g.code = 'admin'
ON CONFLICT (group_id, project_id) DO UPDATE SET is_enabled = true;
```

The migration must not modify default-group membership or remove any ordinary group relation.

- [ ] **Step 4: Run migration tests to verify they pass**

Run: `node --test test/database-config.test.js test/admin-group-migration.test.js`

Expected: PASS. The migration list ends at `005`; the SQL explicitly creates administrator and project authorization triggers plus both backfills.

- [ ] **Step 5: Commit the database invariant**

```bash
git add db/migrations/005_admin_group.sql test/database-config.test.js test/admin-group-migration.test.js
git commit -m "feat: add automatic admin group permissions"
```

### Task 2: Protect system-group mutations in the backend

**Files:**
- Modify: `src/repositories/adminRepository.js`
- Create: `test/admin-repository.test.js`

- [ ] **Step 1: Write failing protected-group repository tests**

```js
test("system groups cannot be manually changed", async () => {
  const { createAdminRepository } = await import("../src/repositories/adminRepository.js");
  const writes = [];
  const client = {
    query: async (text, values) => {
      writes.push({ text, values });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(text)) return { rows: [] };
      if (text.includes("FROM groups WHERE id")) return { rows: [{ id: "group-a", code: "admin", is_default: false, is_system: true }] };
      throw new Error(`Unexpected query: ${text}`);
    },
    release() {}
  };
  const repository = createAdminRepository({ connect: async () => client });
  await assert.rejects(() => repository.addMember({ groupId: "group-a", userId: "user-a" }), { code: "GROUP_PROTECTED" });
  assert.equal(writes.some(({ text }) => text.includes("INSERT INTO user_groups")), false);
});
```

After creating `repository`, assert every mutable repository method rejects the same protected group:

```js
await assert.rejects(() => repository.updateGroup({ groupId: "group-a", name: "管理组", description: "系统" }), { code: "GROUP_PROTECTED" });
await assert.rejects(() => repository.deleteEmptyGroup("group-a"), { code: "GROUP_PROTECTED" });
await assert.rejects(() => repository.removeMember({ groupId: "group-a", userId: "user-a" }), { code: "GROUP_PROTECTED" });
await assert.rejects(() => repository.grantProject({ groupId: "group-a", projectId: "project-a" }), { code: "GROUP_PROTECTED" });
await assert.rejects(() => repository.revokeProject({ groupId: "group-a", projectId: "project-a" }), { code: "GROUP_PROTECTED" });
assert.equal(writes.some(({ text }) => /UPDATE groups|DELETE FROM groups|DELETE FROM user_groups|INSERT INTO group_project_access|DELETE FROM group_project_access/.test(text)), false);
```

- [ ] **Step 2: Run the repository test to verify it fails**

Run: `node --test test/admin-repository.test.js`

Expected: FAIL because `requireGroup` does not read `is_system` and `addMember` proceeds to user validation.

- [ ] **Step 3: Add system-group mapping and one shared guard**

```js
function toAdminGroup(row) {
  return {
    id: row.id, code: row.code, name: row.name, description: row.description,
    isDefault: Boolean(row.is_default), isSystem: Boolean(row.is_system),
    createdAt: row.created_at, memberCount: Number(row.member_count || 0), projectIds: row.project_ids || []
  };
}

function requireMutableGroup(group) {
  if (group.is_default || group.is_system) throw createRepositoryError("GROUP_PROTECTED", group.is_system ? "管理组由系统自动维护。" : "默认分组不能修改。");
}
```

Select `is_system` in `requireGroup`, `groupListSql`, and every `RETURNING` projection converted through `toAdminGroup`. Call `requireMutableGroup(group)` immediately after `requireGroup` in `updateGroup`, `deleteEmptyGroup`, `addMember`, `removeMember`, `grantProject`, and `revokeProject`. Keep the existing default-group wearable-project revoke restriction after this guard for normal default-group behavior.

- [ ] **Step 4: Run the protected-group repository test to verify it passes**

Run: `node --test test/admin-repository.test.js`

Expected: PASS. Every manual mutation fails with `GROUP_PROTECTED` before any member or project-permission write.

- [ ] **Step 5: Commit backend protections**

```bash
git add src/repositories/adminRepository.js test/admin-repository.test.js
git commit -m "feat: protect automatic admin group"
```

### Task 3: Represent the system group clearly in the administrator UI and document it

**Files:**
- Modify: `admin.html`
- Modify: `test/admin-page.test.js`
- Modify: `README.md`

- [ ] **Step 1: Write failing UI and documentation assertions**

```js
test("admin page marks system groups as read-only", async () => {
  const html = await fs.readFile(new URL("../admin.html", import.meta.url), "utf8");
  assert.match(html, /isSystem/);
  assert.match(html, /系统维护/);
  assert.match(html, /protectedGroup/);
});

test("README explains automatic management-group authorization", async () => {
  const readme = await fs.readFile(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, /管理组/);
  assert.match(readme, /管理员身份自动加入或移出/);
  assert.match(readme, /所有现有及未来项目/);
});
```

- [ ] **Step 2: Run the UI and documentation tests to verify they fail**

Run: `node --test test/admin-page.test.js`

Expected: FAIL because the page has no system-group state and README has no management-group explanation.

- [ ] **Step 3: Render system groups as read-only**

Inside `renderGroups`, define and use the shared boolean:

```js
const protectedGroup = Boolean(selected.isDefault || selected.isSystem);
const systemBadge = selected.isSystem ? '<span class="pill default">系统维护</span>' : "";
```

Render `systemBadge` beside the group name in both the group list and detail heading. When `protectedGroup` is true, replace the edit/delete toolbar with `<span class="subtle-text">系统维护</span>`, replace member add/remove controls with `<span class="subtle-text">系统自动维护</span>`, and render every project checkbox with `disabled`. Retain the default group’s existing wearable checkbox protection and all controls for normal groups. Do not change API request paths.

Add the following README bullet under “数据与授权”:

```markdown
- “管理组”只包含管理员；管理员身份自动加入或移出该组，并通过该组获得所有现有及未来项目的访问权限。管理组由系统维护，不能在后台手动修改成员或项目授权。
```

- [ ] **Step 4: Run UI and documentation tests to verify they pass**

Run: `node --test test/admin-page.test.js`

Expected: PASS. The page consumes `isSystem`, shows system-maintenance copy, and README describes automatic membership and full project access.

- [ ] **Step 5: Run complete regression and apply the migration locally**

Run: `npm test && npm run db:migrate`

Expected: all tests pass; migration output reports success. In `/admin`, the 管理组 shows all projects but no editable controls. Restarting the app after setting `ADMIN_EMAIL` verifies its account is automatically in 管理组; changing `users.is_admin` to false in a controlled development database removes that membership.

- [ ] **Step 6: Commit UI, documentation, and tests**

```bash
git add admin.html README.md test/admin-page.test.js
git commit -m "docs: explain automatic admin group"
```

## Review notes

- Spec coverage: Task 1 implements creation, existing-data backfill, administrator promotion/demotion, and future-project grants. Task 2 makes database-owned relationships immutable from the backend. Task 3 makes the restriction visible in the existing admin UI and verifies deployment behavior.
- Placeholder scan: all mutations, trigger names, protected routes, SQL scope, and test commands are explicit.
- Type consistency: the database field is `is_system`, the admin API field is `isSystem`, and the management group code is consistently `admin`.
