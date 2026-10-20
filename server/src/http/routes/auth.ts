import { Router } from "express";
import type Provider from "oidc-provider";
import {
  ForgotPasswordRequestSchema,
  LoginRequestSchema,
  LogoutRequestSchema,
  MfaVerifyRequestSchema,
  ResendVerificationRequestSchema,
  ResetPasswordRequestSchema,
  SignupRequestSchema,
} from "../../contracts/api.js";
import { credentials } from "../../services/credentials.js";
import {
  abandonInteraction,
  completeInteraction,
  currentInteraction,
  destroySession,
  readPendingMfa,
  readSessionAccountId,
  storePendingMfa,
} from "../../services/sessions.js";
import { lockoutRemaining, recordFailure, recordSuccess } from "../../services/ratelimit.js";
import { env } from "../../config/env.js";
import { AppError, asyncRoute, fail } from "../errors.js";
import { csrfProtection } from "../middleware/csrf.js";
import { ipKey, limit } from "../middleware/ratelimit.js";
import { withConstantTime } from "../timing.js";
import { logger } from "../../util/logger.js";
import {
  POST_LOGIN_REDIRECT_COOKIE,
  clearPostLoginRedirectCookie,
  hasPostLoginWelcomeAccess,
  postLoginWelcome,
  setPostLoginRedirectCookie,
} from "../post-login-welcome.js";

/**
 * Transport for the authentication endpoints.
 *
 * Every handler is thin: validate with a contract schema, call a service,
 * serialise the result. No business rule lives here, and nothing in this file
 * constructs a redirect URL — `redirect_to` always comes from the provider.
 */

/** Read the email from an already-validated body, for per-account limiting. */
const emailFromBody = (req: { body?: unknown }): string | undefined => {
  const body = req.body;
  if (typeof body !== "object" || body === null) return undefined;
  const email = (body as { email?: unknown }).email;
  return typeof email === "string" ? email.trim().toLowerCase() : undefined;
};

export function authRoutes(provider: Provider): Router {
  const router = Router();

  /* ---------------------------------- login -------------------------------- */

  router.post(
    "/login",
    csrfProtection,
    limit("login:ip", ipKey),
    limit("login:account", emailFromBody),
    asyncRoute(async (req, res) => {
      const { email, password } = LoginRequestSchema.parse(req.body);

      // An interaction must already exist: this endpoint completes an
      // authorization request, it does not start one.
      const interaction = await currentInteraction(provider, req, res);
      if (!interaction) fail("no_interaction");

      const locked = await lockoutRemaining("login", email);
      if (locked > 0) {
        // Same shape as a wrong password, with Retry-After added. The lockout
        // is not disclosed as a distinct state beyond that.
        throw new AppError("account_locked", { retryAfterSeconds: locked });
      }

      const outcome = await credentials.authenticate({ email, password });

      if (outcome.kind === "rejected") {
        await recordFailure("login", email);
        fail("invalid_credentials");
      }

      if (outcome.kind === "email_unverified") {
        // Counted as a success for lockout purposes: the password was right,
        // so this is not a guessing attempt.
        await recordSuccess("login", email);
        fail("invalid_credentials");
      }

      await recordSuccess("login", email);

      if (outcome.kind === "mfa_required") {
        // The pending challenge, including the provider session that
        // completes it, is parked in server-side interaction storage.
        await storePendingMfa(provider, req, res, outcome.pending);
        res.status(200).json({ mfa_required: true });
        return;
      }

      const redirectTo = await completeInteraction(provider, req, res, outcome.user.userId, {
        amr: ["pwd"],
      });
      if (postLoginWelcome()) {
        setPostLoginRedirectCookie(res, redirectTo);
        await abandonInteraction(provider, req, res);
        res.status(200).json({ welcome: true });
        return;
      }
      res.status(200).json({ redirect_to: redirectTo });
    }),
  );

  /* --------------------------------- signup -------------------------------- */

  router.post(
    "/signup",
    csrfProtection,
    limit("signup:ip", ipKey),
    asyncRoute(async (req, res) => {
      const { name, email, password } = SignupRequestSchema.parse(req.body);

      // Held to the same floor as forgot-password: registering a new address
      // and declining to re-register an existing one must not be
      // distinguishable by duration.
      await withConstantTime(async () => {
        await credentials.register({
          name,
          email,
          password,
          redirectTo: `${env().AUTH_ISSUER}/verify-email?verified=true`,
        });
      });

      res.status(200).json({ verify_email: true });
    }),
  );

  /* ----------------------------- password reset ---------------------------- */

  router.post(
    "/forgot-password",
    csrfProtection,
    limit("forgot:ip", ipKey),
    limit("forgot:account", emailFromBody),
    asyncRoute(async (req, res) => {
      const parsed = ForgotPasswordRequestSchema.safeParse(req.body);

      // 204 even for a malformed address. A validation error here would
      // distinguish "not an email" from "an email we have no account for",
      // and the frontend already validates the field.
      await withConstantTime(async () => {
        if (parsed.success) {
          await credentials.requestPasswordReset({
            email: parsed.data.email,
            redirectTo: `${env().AUTH_ISSUER}/reset-password`,
          });
        }
      });

      res.status(204).end();
    }),
  );

  router.post(
    "/reset-password",
    csrfProtection,
    limit("forgot:ip", ipKey),
    asyncRoute(async (req, res) => {
      const { token, password } = ResetPasswordRequestSchema.parse(req.body);

      const result = await credentials.resetPassword({ token, password });
      if (!result.ok) fail("invalid_token");

      res.status(204).end();
    }),
  );

  /* ----------------------------------- mfa --------------------------------- */

  router.post(
    "/mfa/verify",
    csrfProtection,
    limit("mfa:ip", ipKey),
    asyncRoute(async (req, res) => {
      const { code } = MfaVerifyRequestSchema.parse(req.body);

      const interaction = await currentInteraction(provider, req, res);
      if (!interaction) fail("no_interaction");

      const pending = await readPendingMfa(provider, req, res);
      if (!pending) fail("no_interaction");

      // Keyed on the account behind the challenge, not on anything the client
      // sent, so a caller cannot dodge the limit by varying a parameter.
      const lockKey = pending.userId;
      const locked = await lockoutRemaining("mfa", lockKey);
      if (locked > 0) {
        throw new AppError("account_locked", { retryAfterSeconds: locked });
      }

      const outcome = await credentials.verifyMfa({ pending, code });
      if (outcome.kind !== "authenticated") {
        await recordFailure("mfa", lockKey);
        fail("invalid_credentials");
      }

      await recordSuccess("mfa", lockKey);

      const redirectTo = await completeInteraction(provider, req, res, outcome.user.userId, {
        amr: ["pwd", "otp"],
      });
      if (postLoginWelcome()) {
        setPostLoginRedirectCookie(res, redirectTo);
        await abandonInteraction(provider, req, res);
        res.status(200).json({ welcome: true });
        return;
      }
      res.status(200).json({ redirect_to: redirectTo });
    }),
  );

  /* ------------------------------ interaction ------------------------------ */

  router.get(
    "/interaction",
    asyncRoute(async (req, res) => {
      const interaction = await currentInteraction(provider, req, res);
      res.status(200).json({ active: Boolean(interaction) });
    }),
  );

  router.get(
    "/session",
    asyncRoute(async (req, res) => {
      const accountId = await readSessionAccountId(provider, req, res);
      res.status(200).json({ signed_in: Boolean(accountId) });
    }),
  );

  /**
   * Complete an in-flight authorization when the browser already has a provider
   * session (e.g. signed into app, then opens drive with prompt=consent).
   */
  router.post(
    "/continue-interaction",
    csrfProtection,
    asyncRoute(async (req, res) => {
      const interaction = await currentInteraction(provider, req, res);
      if (!interaction) fail("no_interaction");

      const accountId = await readSessionAccountId(provider, req, res);
      if (!accountId) fail("unauthenticated");

      const redirectTo = await completeInteraction(provider, req, res, accountId, {
        amr: ["pwd"],
      });
      if (postLoginWelcome()) {
        setPostLoginRedirectCookie(res, redirectTo);
        await abandonInteraction(provider, req, res);
        res.status(200).json({ welcome: true });
        return;
      }
      res.status(200).json({ redirect_to: redirectTo });
    }),
  );

  /* --------------------------- post-login welcome -------------------------- */

  router.get(
    "/welcome",
    asyncRoute(async (req, res) => {
      // interactionResult only parks login on the interaction; the provider
      // session cookie is created when the browser hits the authorize resume
      // URL. POST_LOGIN_WELCOME defers that hop, so access is gated on the
      // signed resume cookie set at sign-in success instead.
      if (postLoginWelcome()) {
        if (!hasPostLoginWelcomeAccess(req)) fail("unauthenticated");
      } else {
        const accountId = await readSessionAccountId(provider, req, res);
        if (!accountId) fail("unauthenticated");
      }
      res.status(200).json({ ok: true });
    }),
  );

  router.get(
    "/post-login-continue",
    asyncRoute(async (req, res) => {
      if (postLoginWelcome()) {
        if (!hasPostLoginWelcomeAccess(req)) fail("unauthenticated");
      } else {
        const accountId = await readSessionAccountId(provider, req, res);
        if (!accountId) fail("unauthenticated");
      }

      const signed = (req as { signedCookies?: Record<string, unknown> }).signedCookies?.[
        POST_LOGIN_REDIRECT_COOKIE
      ];
      res.clearCookie(POST_LOGIN_REDIRECT_COOKIE, { path: "/" });
      if (typeof signed !== "string") {
        res.status(204).end();
        return;
      }
      res.status(200).json({ redirect_to: signed });
    }),
  );

  /* ------------------------------ verification ----------------------------- */

  router.post(
    "/resend-verification",
    csrfProtection,
    limit("resend:ip", ipKey),
    limit("resend:account", emailFromBody),
    asyncRoute(async (req, res) => {
      const parsed = ResendVerificationRequestSchema.safeParse(req.body);

      await withConstantTime(async () => {
        if (parsed.success) {
          await credentials.resendVerification({
            email: parsed.data.email,
            redirectTo: `${env().AUTH_ISSUER}/verify-email?verified=true`,
          });
        }
      });

      res.status(204).end();
    }),
  );

  /* --------------------------------- logout -------------------------------- */

  router.post(
    "/logout",
    csrfProtection,
    asyncRoute(async (req, res) => {
      LogoutRequestSchema.parse(req.body ?? {});

      // Idempotent: logging out without a session is a success, not an error.
      await destroySession(provider, req, res).catch((error: unknown) => {
        logger.warn({ err: error }, "logout encountered an error");
      });
      await abandonInteraction(provider, req, res).catch((error: unknown) => {
        logger.warn({ err: error }, "logout could not abandon interaction");
      });
      clearPostLoginRedirectCookie(res);

      res.status(204).end();
    }),
  );

  return router;
}
