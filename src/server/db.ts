import { Pool, type QueryResultRow } from "pg";
import { env } from "@/env";
const globalDb = globalThis as unknown as { recastPool?: Pool };
export const pool =
  globalDb.recastPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  });
if (env.NODE_ENV !== "production") globalDb.recastPool = pool;
export async function sql<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
) {
  return (await pool.query<T>(text, values)).rows;
}
