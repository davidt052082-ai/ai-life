import "dotenv/config";
import { createDatabasePool } from "../src/db/pool.js";
import { applyMigrations } from "../src/db/migrate.js";

const pool = createDatabasePool();

try {
  await applyMigrations(pool);
  console.log("Applied database migrations.");
} finally {
  await pool.end();
}
