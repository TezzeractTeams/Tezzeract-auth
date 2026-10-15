import { z } from "zod";

/**
 * Every error this service returns uses one of these codes. The set is closed
 * so that the frontend can switch on it exhaustively, and so that no code
 * carries information we are not willing to disclose to an anonymous caller.
 *
 * Deliberately absent: anything that distinguishes "no such account" from
 * "wrong password", or "email already registered" from "email available".
 */
export const ERROR_CODES = [
  /** Request body or query failed schema validation. */
  "validation_error",
  /** Wrong email or password, unknown account, or unusable credential. */
  "invalid_credentials",
  /** Too many attempts from this IP or against this account. */
  "rate_limited",
  /** Account temporarily locked after repeated failures. */
  "account_locked",
  /** Reset or verification link is malformed, expired or already used. */
  "invalid_token",
  /** client_id is unknown, or redirect_uri is not an exact allowlist match. */
  "invalid_redirect",
  /** No OIDC interaction is in progress for this browser. */
  "no_interaction",
  /** MFA is required before the interaction can be completed. */
  "mfa_required",
  /** Missing or mismatched CSRF token on a state-changing request. */
  "csrf_failed",
  /** Caller is not authenticated for this operation. */
  "unauthenticated",
  /** Anything unexpected. Never carries internal detail. */
  "internal_error",
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/** The single error envelope shape for the whole API. */
export const ErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: ErrorCodeSchema,
        message: z.string(),
      })
      .strict(),
  })
  .strict();

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/**
 * Client-facing copy for each code. These strings are intentionally vague:
 * they are the only thing an attacker learns from a failed request.
 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  validation_error: "Please check the information you entered and try again.",
  invalid_credentials: "Incorrect email or password.",
  rate_limited: "Too many attempts. Please wait a moment and try again.",
  account_locked: "Too many attempts. Please wait a moment and try again.",
  invalid_token: "This link is invalid or has expired.",
  invalid_redirect: "This sign-in link is not valid.",
  no_interaction: "Your sign-in session has expired. Please start again.",
  mfa_required: "A verification code is required.",
  csrf_failed: "Your session has expired. Please refresh and try again.",
  unauthenticated: "Please sign in to continue.",
  internal_error: "Something went wrong. Please try again.",
};

/** HTTP status for each code. */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  validation_error: 400,
  invalid_credentials: 401,
  rate_limited: 429,
  account_locked: 429,
  invalid_token: 400,
  invalid_redirect: 400,
  no_interaction: 400,
  mfa_required: 401,
  csrf_failed: 403,
  unauthenticated: 401,
  internal_error: 500,
};
