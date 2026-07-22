import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultMigrationsDir = path.resolve(__dirname, "../../db/migrations");

export const WEARABLE_PROJECT_ID = "d3cc3af9-cd25-477e-a16e-50c957f1650f";
export const WEARABLE_PROJECT_CODE = "wearable-monitoring";

export function validateDatabaseUrl(connectionString) {
  if (typeof connectionString !== "string" || !/^postgres(?:ql)?:\/\//i.test(connectionString)) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection string.");
  }
  return true;
}

export async function listMigrationFiles(migrationsDir = defaultMigrationsDir) {
  const files = await fs.readdir(migrationsDir, { withFileTypes: true });
  return files
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();
}

async function ensureMigrationTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function seedWearableProject(client) {
  await client.query(
    `INSERT INTO projects (id, code, name, description, route, cover_image_url, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (code) DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       route = EXCLUDED.route,
       cover_image_url = EXCLUDED.cover_image_url,
       sort_order = EXCLUDED.sort_order`,
    [
      WEARABLE_PROJECT_ID,
      WEARABLE_PROJECT_CODE,
      "智能穿戴监测系统",
      "整合人体锚点、装备库、监测覆盖与系统评测。",
      "/projects/wearable",
      "/assets/cyber-body-base.png",
      1
    ]
  );
}

export async function applyMigrations(pool, options = {}) {
  const migrationsDir = options.migrationsDir || defaultMigrationsDir;
  const client = await pool.connect();

  try {
    await ensureMigrationTable(client);
    const applied = new Set((await client.query("SELECT filename FROM schema_migrations")).rows.map((row) => row.filename));
    const files = await listMigrationFiles(migrationsDir);

    for (const filename of files) {
      if (applied.has(filename)) continue;
      const sql = await fs.readFile(path.join(migrationsDir, filename), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [filename]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    await seedWearableProject(client);
  } finally {
    client.release();
  }
}
