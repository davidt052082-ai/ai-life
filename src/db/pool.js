import { Pool } from "pg";

export function createDatabasePool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString || !/^postgres(?:ql)?:\/\//i.test(connectionString)) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection string.");
  }

  return new Pool({ connectionString });
}
