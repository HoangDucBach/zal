import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "./schema.ts";

export const createAppDb = (connectionString: string) => {
  const pool = new pg.Pool({ connectionString, max: 10 });
  return { pool, db: drizzle(pool, { schema }) };
};

/** Any Postgres driver: node-postgres in the service, PGlite in tests. */
export type AppDb = PgDatabase<PgQueryResultHKT, typeof schema>;
