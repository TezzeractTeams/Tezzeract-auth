import { migrate } from "../db/migrate.js";
import { closePool } from "../db/pool.js";
import { parseEnv } from "../config/env.js";

/**
 * Apply pending migrations and exit.
 *
 * The server also migrates on boot; this exists for a deploy that prefers to
 * migrate as a separate step before rolling new instances.
 */
async function main(): Promise<void> {
  parseEnv();
  const applied = await migrate();
  process.stdout.write(
    applied.length === 0
      ? "No pending migrations.\n"
      : `Applied:\n${applied.map((name) => `  - ${name}`).join("\n")}\n`,
  );
  await closePool();
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
