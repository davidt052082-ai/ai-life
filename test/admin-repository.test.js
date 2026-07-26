import test from "node:test";
import assert from "node:assert/strict";

function protectedRepository() {
  const writes = [];
  const client = {
    query: async (text, values) => {
      writes.push({ text, values });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(text)) return { rows: [] };
      if (text.includes("FROM groups WHERE id")) {
        return { rows: [{ id: "group-a", code: "admin", is_default: false, is_system: true }] };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
    release() {}
  };
  return {
    writes,
    pool: { connect: async () => client }
  };
}

test("system groups cannot be manually changed", async () => {
  const { createAdminRepository } = await import("../src/repositories/adminRepository.js");
  const { pool, writes } = protectedRepository();
  const repository = createAdminRepository(pool);

  await assert.rejects(() => repository.updateGroup({ groupId: "group-a", name: "管理组", description: "系统" }), { code: "GROUP_PROTECTED" });
  await assert.rejects(() => repository.deleteEmptyGroup("group-a"), { code: "GROUP_PROTECTED" });
  await assert.rejects(() => repository.addMember({ groupId: "group-a", userId: "user-a" }), { code: "GROUP_PROTECTED" });
  await assert.rejects(() => repository.removeMember({ groupId: "group-a", userId: "user-a" }), { code: "GROUP_PROTECTED" });
  await assert.rejects(() => repository.grantProject({ groupId: "group-a", projectId: "project-a" }), { code: "GROUP_PROTECTED" });
  await assert.rejects(() => repository.revokeProject({ groupId: "group-a", projectId: "project-a" }), { code: "GROUP_PROTECTED" });

  assert.equal(writes.some(({ text }) => /UPDATE groups|DELETE FROM groups|INSERT INTO user_groups|DELETE FROM user_groups|INSERT INTO group_project_access|DELETE FROM group_project_access/.test(text)), false);
});
