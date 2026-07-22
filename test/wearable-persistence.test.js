import test from "node:test";
import assert from "node:assert/strict";

test("workspace updates reject an outdated version", async () => {
  const { VersionConflictError, createWearableRepository } = await import("../src/repositories/wearableRepository.js");
  const pool = {
    query: async (text) => {
      if (text.includes("UPDATE wearable_workspace")) return { rowCount: 0, rows: [] };
      if (text.includes("SELECT version FROM wearable_workspace")) return { rowCount: 1, rows: [{ version: 3 }] };
      throw new Error(`Unexpected query: ${text}`);
    }
  };
  const repository = createWearableRepository(pool);

  await assert.rejects(
    () => repository.saveWorkspace({
      userId: "u1",
      projectId: "p1",
      anchors: [],
      deviceLayout: { left: [], right: [] },
      removedEquipmentIds: [],
      version: 2
    }),
    (error) => error instanceof VersionConflictError && error.currentVersion === 3
  );
});

test("equipment queries are always scoped to the owning user and project", async () => {
  const { createWearableRepository } = await import("../src/repositories/wearableRepository.js");
  const calls = [];
  const repository = createWearableRepository({
    query: async (text, values) => {
      calls.push({ text, values });
      return { rows: [] };
    }
  });

  await repository.listEquipment({ userId: "u1", projectId: "p1" });
  assert.match(calls[0].text, /WHERE user_id = \$1 AND project_id = \$2/);
  assert.deepEqual(calls[0].values, ["u1", "p1"]);
});

test("local migration is recorded once and returns alreadyMigrated on retry", async () => {
  const { createWearableRepository } = await import("../src/repositories/wearableRepository.js");
  let migrated = false;
  const pool = {
    connect: async () => ({
      query: async (text) => {
        if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") return { rows: [] };
        if (text.includes("FROM local_data_migrations")) return { rowCount: migrated ? 1 : 0, rows: migrated ? [{ migration_key: "legacy-local-storage-v1" }] : [] };
        if (text.includes("INSERT INTO local_data_migrations")) {
          migrated = true;
          return { rows: [] };
        }
        return { rows: [], rowCount: 1 };
      },
      release() {}
    })
  };
  const repository = createWearableRepository(pool);
  const payload = { anchors: [], customEquipment: [], deletedEquipmentIds: [], equipmentOverrides: {}, deviceLayout: { left: [], right: [] }, removedEquipmentIds: [], schemes: [] };

  const first = await repository.migrateLocalData({ userId: "u1", projectId: "p1", payload });
  const second = await repository.migrateLocalData({ userId: "u1", projectId: "p1", payload });
  assert.equal(first.alreadyMigrated, false);
  assert.equal(second.alreadyMigrated, true);
});
