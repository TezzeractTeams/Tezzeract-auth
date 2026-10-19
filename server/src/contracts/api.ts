import { z } from "zod";

/**
 * The single source of truth for the /api surface.
 *
 * Every request schema is .strict(): unknown fields are a validation error
 * rather than being silently dropped. web/src/api mirrors these types; if the
 * two drift, this file is the one that is right.
 */

/** Normalised email. Lowercased so rate limiting and lookups agree on a key. */
export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .email("Enter a valid email address.");

/**
 * Password policy: length only, no composition rules, per NIST SP 800-63B.
 * The upper bound exists because bcrypt-family hashes truncate and because an
 * unbounded body is a cheap denial-of-service.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const PasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters.`);

export const NameSchema = z.string().trim().min(1, "Enter your name.").max(100);

/** Opaque single-use token from a password-reset or verification email. */
export const OpaqueTokenSchema = z.string().min(16).max(4096);

/** Six digits. Whitespace is stripped so a pasted "123 456" still works. */
export const MfaCodeSchema = z
  .string()
  .transform((value) => value.replace(/\s+/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "Enter the 6-digit code."));

/**
 * A completed interaction. The frontend treats redirect_to as opaque and only
 * calls window.location.assign on it; it never parses or rebuilds the URL.
 */
export const RedirectResponseSchema = z.object({ redirect_to: z.string().url() }).strict();
export type RedirectResponse = z.infer<typeof RedirectResponseSchema>;

/* ---------------------------------- login --------------------------------- */

export const LoginRequestSchema = z
  .object({ email: EmailSchema, password: PasswordSchema })
  .strict();
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/** Signals that credentials were accepted but a second factor is outstanding. */
export const MfaRequiredResponseSchema = z.object({ mfa_required: z.literal(true) }).strict();
export type MfaRequiredResponse = z.infer<typeof MfaRequiredResponseSchema>;

/** Sign-in succeeded; the UI should route to /welcome before OIDC resume. */
export const WelcomeResponseSchema = z.object({ welcome: z.literal(true) }).strict();
export type WelcomeResponse = z.infer<typeof WelcomeResponseSchema>;

export const LoginResponseSchema = z.union([
  RedirectResponseSchema,
  MfaRequiredResponseSchema,
  WelcomeResponseSchema,
]);
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

/* --------------------------------- signup --------------------------------- */

export const SignupRequestSchema = z
  .object({ name: NameSchema, email: EmailSchema, password: PasswordSchema })
  .strict();
export type SignupRequest = z.infer<typeof SignupRequestSchema>;

/**
 * Always { verify_email: true } on success, whether or not the address was
 * already registered. An existing address gets a "someone tried to sign up"
 * email instead of a verification link, so the response cannot be used to
 * enumerate accounts.
 */
export const SignupResponseSchema = z.object({ verify_email: z.literal(true) }).strict();
export type SignupResponse = z.infer<typeof SignupResponseSchema>;

/* ----------------------------- password reset ----------------------------- */

export const ForgotPasswordRequestSchema = z.object({ email: EmailSchema }).strict();
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequestSchema>;

export const ResetPasswordRequestSchema = z
  .object({ token: OpaqueTokenSchema, password: PasswordSchema })
  .strict();
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>;

/* ------------------------------- mfa + email ------------------------------ */

export const MfaVerifyRequestSchema = z.object({ code: MfaCodeSchema }).strict();
export type MfaVerifyRequest = z.infer<typeof MfaVerifyRequestSchema>;

export const MfaVerifyResponseSchema = z.union([RedirectResponseSchema, WelcomeResponseSchema]);
export type MfaVerifyResponse = z.infer<typeof MfaVerifyResponseSchema>;

export const ResendVerificationRequestSchema = z.object({ email: EmailSchema }).strict();
export type ResendVerificationRequest = z.infer<typeof ResendVerificationRequestSchema>;

/* -------------------------------- logout ---------------------------------- */

/** POST /api/logout takes no body. Authority comes from the session cookie. */
export const LogoutRequestSchema = z.object({}).strict();
export type LogoutRequest = z.infer<typeof LogoutRequestSchema>;

/* -------------------------------- health ---------------------------------- */

export const HealthResponseSchema = z
  .object({
    status: z.enum(["ok", "degraded"]),
    version: z.string(),
    checks: z.record(z.enum(["ok", "fail"])),
  })
  .strict();
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
