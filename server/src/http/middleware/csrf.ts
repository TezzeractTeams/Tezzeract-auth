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

/**
 * The cookie holds `token|hash`, but only the `token` half is compared
 * against the request header. A client that echoes the whole cookie value
 * fails validation, so the delimiter is part of the contract with the
 * frontend; web/src/api/auth.ts splits on it.
 */
export const CSRF_DELIMITER = "|";

/**
 * Built on first use, not at import.
 *
 * cookieOptions.secure depends on the parsed environment, and reading it at
 * module scope meant env was parsed as a side effect of an import — before
 * server.ts had a chance to call parseEnv() and report every missing variable
 * at once. A missing secret then surfaced as an uncaught error with a stack
 * trace instead of the startup report.
 */
let utilities: ReturnType<typeof doubleCsrf> | undefined;

function csrf(): ReturnType<typeof doubleCsrf> {
  utilities ??= doubleCsrf({
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
    getTokenFromRequest: (req): string | undefined => {
      const header: unknown = req.headers[CSRF_HEADER];
      if (typeof header === "string") return header;
      if (Array.isArray(header) && typeof header[0] === "string") return header[0];
      return undefined;
    },
    /**
     * Binds the token to the browser's session where there is one, falling back
     * to the address before sign-in. The session cookie is signed, so
     * cookie-parser moves it to signedCookies.
     */
    getSessionIdentifier: (req): string => {
      const signed: unknown = (req as { signedCookies?: Record<string, unknown> }).signedCookies?.[
        "_session"
      ];
      if (typeof signed === "string") return signed;
      const plain: unknown = (req as { cookies?: Record<string, unknown> }).cookies?.["_session"];
      if (typeof plain === "string") return plain;
      return req.ip ?? "anonymous";
    },
  });
  return utilities;
}

/** Issue or refresh the CSRF cookie. Called by the token-seeding route. */
export const issueCsrfToken: ReturnType<typeof doubleCsrf>["generateToken"] = (req, res, ...rest) =>
  csrf().generateToken(req, res, ...rest);

/** Reject a state-changing request without a matching token. */
export const csrfProtection: RequestHandler = (req, res, next) => {
  csrf().doubleCsrfProtection(req, res, (error?: unknown) => {
    // The library's own error carries a status and message; ours carries the
    // contract's error code, so the response shape stays uniform.
    if (error) {
      next(new AppError("csrf_failed"));
      return;
    }
    next();
  });
};

/** Test seam: rebuild the utilities after changing env. */
export function resetCsrfForTests(): void {
  utilities = undefined;
}
