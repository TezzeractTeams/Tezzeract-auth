import { createApp } from "./http/app.js";
import { env, parseEnv } from "./config/env.js";
import { migrate } from "./db/migrate.js";
import { closePool } from "./db/pool.js";
import { logger } from "./util/logger.js";
import { sweepExpired } from "./services/ratelimit.js";
import { sweepExpiredPayloads } from "./oidc/adapter.pg.js";

/**
 * Process entry point.
 *
 * Configuration is validated before anything else binds, so a missing secret
 * stops the process rather than surfacing on the first login attempt.
 */

const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

async function main(): Promise<void> {
  // Throws with a report naming every problem. Nothing is logged from it,
  // because the report would otherwise be the first thing in the log.
  parseEnv();

  const applied = await migrate();
  if (applied.length > 0) logger.info({ applied }, "database migrations applied");

  const app = createApp();
  const server = app.listen(env().PORT, () => {
    logger.info(
      { port: env().PORT, issuer: env().AUTH_ISSUER, env: env().NODE_ENV },
      "tezzeract-auth listening",
    );
  });

  // Expired records are dropped on a timer rather than on the request path,
  // so a login never pays for someone else's housekeeping.
  const sweep = setInterval(() => {
    void Promise.all([sweepExpired(), sweepExpiredPayloads()]).catch((error: unknown) => {
      logger.error({ err: error }, "sweep failed");
    });
  }, SWEEP_INTERVAL_MS);
  sweep.unref();

  const shutdown = (signal: string): void => {
    logger.info({ signal }, "shutting down");
    clearInterval(sweep);
    server.close(() => {
      void closePool().finally(() => process.exit(0));
    });
    // Do not wait indefinitely for a hung connection to drain.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  // Configuration and migration failures land here. Printed rather than
  // logged so the message survives a logger that is not yet configured.
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
