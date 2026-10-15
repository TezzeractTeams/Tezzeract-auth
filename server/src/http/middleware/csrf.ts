import { doubleCsrf } from "csrf-csrf";
import type { RequestHandler } from "express";
import { env, isProduction } from "../../config/env.js";
import { AppError } from "../errors.js";

/**
 * CSRF protection for cookie-authenticated, state-changing endpoints.
 *
 * The session cookie is SameSite=Lax, which stops cross-site POSTs in current
 * browsers, but SameSite is a single mitigation and not a guarantee: it does
 * not cover same-site subdomain attacks and has been relaxed by browsers
 * before. Double-submit is the second, independent layer.
 *
 * The token cookie is deliberately NOT HttpOnly — the frontend has to read it
 * to echo it in a header. It carries no authority on its own: an attacker who
 * can read it cross-origin cannot, which is the whole point.
 */

const CSRF_COOKIE = "tz_csrf";
export const CSRF_HEADER = "x-csrf-token";

const { doubleCsrfProtection, generateToken } = doubleCsrf({
  getSecret: () => env().CSRF_SECRET,
  cookieName: CSRF_COOKIE,
  cookieOptions: {
    httpOnly: false,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
  },
  size: 32,
  // GET/HEAD/OPTIONS change nothing and are exempt. Every other method,
  // including the password and MFA endpoints, is checked.
  ignoredMethods: ["GET", "HEAD", "OPTIONS"],
  getTokenFromRequest: (req) => req.headers[CSRF_HEADER],
  getSessionIdentifier: (req) => req.cookies?.["_session"] ?? req.ip ?? "anonymous",
});

/** Issue or refresh the CSRF cookie. Mounted on the token-seeding route. */
export const issueCsrfToken = generateToken;

/** Reject a state-changing request without a matching token. */
export const csrfProtection: RequestHandler = (req, res, next) => {
  doubleCsrfProtection(req, res, (error?: unknown) => {
    if (error) {
      next(new AppError("csrf_failed"));
      return;
    }
    next();
  });
};
