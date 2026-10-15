import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import {
  ERROR_MESSAGES,
  ERROR_STATUS,
  type ErrorCode,
  type ErrorResponse,
} from "../contracts/errors.js";
import { logger } from "../util/logger.js";

/**
 * The one way this service reports a failure.
 *
 * Handlers throw an AppError with a code; the body sent to the client is built
 * from the code's canned message, never from the thrown error's own message.
 * That keeps provider detail, stack traces and SQL text out of responses by
 * construction rather than by remembering to sanitise at each call site.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  /** Seconds to advertise in Retry-After, for rate limit responses. */
  readonly retryAfterSeconds?: number;
  /** Detail for the log only. Never serialised to the client. */
  readonly detail?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    options: { retryAfterSeconds?: number; detail?: Record<string, unknown> } = {},
  ) {
    super(code);
    this.name = "AppError";
    this.code = code;
    if (options.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = options.retryAfterSeconds;
    }
    if (options.detail !== undefined) this.detail = options.detail;
  }
}

/**
 * Throw an AppError.
 *
 * Declared as a function rather than an arrow const so TypeScript applies
 * never-returning narrowing at the call site: after `if (!x) fail(...)`, x is
 * narrowed in the code that follows.
 */
export function fail(
  code: ErrorCode,
  options?: { retryAfterSeconds?: number; detail?: Record<string, unknown> },
): never {
  throw new AppError(code, options);
}

function body(code: ErrorCode): ErrorResponse {
  return { error: { code, message: ERROR_MESSAGES[code] } };
}

/** Terminal error handler. Must be registered last. */
export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof AppError) {
    if (error.retryAfterSeconds !== undefined) {
      res.setHeader("Retry-After", String(error.retryAfterSeconds));
    }
    // Logged at info: these are expected outcomes, not faults.
    logger.info({ code: error.code, detail: error.detail }, "request rejected");
    res.status(ERROR_STATUS[error.code]).json(body(error.code));
    return;
  }

  if (error instanceof ZodError) {
    // The issue list can echo submitted values, so only paths are logged.
    logger.info(
      { paths: error.issues.map((issue) => issue.path.join(".")) },
      "request failed validation",
    );
    res.status(ERROR_STATUS.validation_error).json(body("validation_error"));
    return;
  }

  logger.error({ err: error }, "unhandled error");
  res.status(500).json(body("internal_error"));
}

/** 404 for an unmatched /api route. */
export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json(body("validation_error"));
}

/** Wrap an async handler so a rejected promise reaches errorHandler. */
export function asyncRoute<T extends Request>(handler: (req: T, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req as T, res).catch(next);
  };
}
