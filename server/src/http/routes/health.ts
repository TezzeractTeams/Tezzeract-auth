import { Router } from "express";
import { query } from "../../db/pool.js";
import { asyncRoute } from "../errors.js";
import { logger } from "../../util/logger.js";

/**
 * Liveness and readiness.
 *
 * Reports whether the dependencies this service cannot work without are
 * reachable, and nothing else: no version detail of the database, no
 * configuration, no counts. A health endpoint is unauthenticated, so it is
 * treated as public.
 */
export function healthRoutes(version: string): Router {
  const router = Router();

  router.get(
    "/healthz",
    asyncRoute(async (_req, res) => {
      let database: "ok" | "fail" = "ok";
      try {
        await query("SELECT 1");
      } catch (error) {
        database = "fail";
        logger.error({ err: error }, "health check: database unreachable");
      }

      const status = database === "ok" ? "ok" : "degraded";
      res.setHeader("Cache-Control", "no-store");
      res.status(status === "ok" ? 200 : 503).json({
        status,
        version,
        checks: { database },
      });
    }),
  );

  return router;
}
