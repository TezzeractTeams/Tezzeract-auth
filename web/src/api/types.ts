/**
 * Types mirroring server/src/contracts.
 *
 * The server's Zod schemas are the single source of truth; these are the
 * hand-maintained mirror for the browser bundle, which must not import the
 * server. If the two ever disagree, the contract file is the one that is
 * right and this file is the bug.
 *
 * Mirrors: server/src/contracts/api.ts, errors.ts, clients.ts
 */

/** server/src/contracts/errors.ts — ERROR_CODES */
export type ErrorCode =
  | "validation_error"
  | "invalid_credentials"
  | "rate_limited"
  | "account_locked"
  | "invalid_token"
  | "invalid_redirect"
  | "no_interaction"
  | "mfa_required"
  | "csrf_failed"
  | "unauthenticated"
  | "internal_error";

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string };
}

/** Thrown by every function in auth.ts when a request fails. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor(code: ErrorCode, message: string, status: number, retryAfterSeconds?: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** POST /api/login */
export interface LoginRequest {
  email: string;
  password: string;
}
export type LoginResponse =
  | { redirect_to: string }
  | { mfa_required: true }
  | { welcome: true };

/** POST /api/signup */
export interface SignupRequest {
  name: string;
  email: string;
  password: string;
}
export interface SignupResponse {
  verify_email: true;
}

/** POST /api/forgot-password, POST /api/resend-verification — both 204 */
export interface EmailOnlyRequest {
  email: string;
}

/** POST /api/reset-password — 204 */
export interface ResetPasswordRequest {
  token: string;
  password: string;
}

/** POST /api/mfa/verify */
export interface MfaVerifyRequest {
  code: string;
}
export type MfaVerifyResponse = { redirect_to: string } | { welcome: true };

/** GET /api/client-config — server/src/contracts/clients.ts */
export interface ClientConfig {
  name: string;
  logoUrl: string;
  wordmarkUrl?: string;
  accentColor: string;
  postLoginWelcome: boolean;
  devRedirectUri?: string;
}

/** server/src/contracts/api.ts — PASSWORD_MIN_LENGTH / MAX */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
