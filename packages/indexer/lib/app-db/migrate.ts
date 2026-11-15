// Applies the zal_app migrations. The container runs this before `ponder start`; it is safe to run on every boot.

import { join } from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (url === undefined) throw new Error("DATABASE_URL is not set");

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  await migrate(drizzle(pool), {
    migrationsFolder: join(import.meta.dirname, "..", "..", "drizzle"),
    migrationsSchema: "zal_app",
  });
  console.log("zal_app migrations applied");
} finally {
  await pool.end();
}
