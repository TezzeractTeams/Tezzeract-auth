import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { env } from "../config/env.js";
import { logger } from "../util/logger.js";

/**
 * The single Postgres pool. Backs OIDC provider storage, rate limiting and
 * read-only membership lookups.
 */

let pool: Pool | undefined;

function poolOptions(): ConstructorParameters<typeof Pool>[0] {
  const connectionString = env().DATABASE_URL;
  const options: ConstructorParameters<typeof Pool>[0] = {
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  };

  // Supabase Postgres (direct or pooler) requires TLS. The hosted CA is not
  // always in local trust stores, so verification is relaxed here only for
  // *.supabase.co hosts.
  if (connectionString.includes("supabase.co")) {
    options.ssl = { rejectUnauthorized: false };
  }

  return options;
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool(poolOptions());
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
