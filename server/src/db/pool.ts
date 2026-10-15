import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { env } from "../config/env.js";
import { logger } from "../util/logger.js";

/**
 * The single Postgres pool. Backs OIDC provider storage, rate limiting and
 * read-only membership lookups.
 */

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: env().DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    // An idle client erroring must not take the process down.
    pool.on("error", (error) => {
      logger.error({ err: error }, "idle postgres client error");
    });
  }
  return pool;
}

/** Run a parameterised query. Never build SQL by interpolation. */
export async function query<T extends QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query<T>(sql, params as unknown[]);
  return result.rows;
}

/** Run `fn` inside a transaction, rolling back if it throws. */
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
