import type { NextFunction, Request, Response } from "express";
import { consume, type PolicyName } from "../../services/ratelimit.js";
import { AppError } from "../errors.js";

/**
 * Express binding for the rate limiter.
 *
 * The service holds the policy and the counters; this is transport only. Keys
 * come from a function so the same middleware covers per-IP limits (where the
 * key is req.ip) and per-account limits (where it is the submitted email, read
 * after Zod has normalised the body).
 */

/** req.ip, or a stable placeholder. Depends on TRUST_PROXY_HOPS being right. */
export function ipKey(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

export function limit(policy: PolicyName, key: (req: Request) => string | undefined) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const raw = key(req);
      // No key means nothing to limit on — a body that failed validation, for
      // instance. Validation will reject it a moment later.
      if (raw === undefined || raw === "") {
        next();
        return;
      }
      const result = await consume(policy, `${policy}:${raw}`);
      if (!result.allowed) {
        next(new AppError("rate_limited", { retryAfterSeconds: result.retryAfterSeconds }));
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
