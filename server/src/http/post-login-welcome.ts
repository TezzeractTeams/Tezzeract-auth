import type { Response } from "express";
import { cookieSecure, env, postLoginWelcome } from "../config/env.js";

/** Signed cookie holding the OIDC resume URL until the user leaves /welcome. */
export const POST_LOGIN_REDIRECT_COOKIE = "tz_post_login";

function authorizeResumePath(redirectTo: string): string {
  const url = new URL(redirectTo, env().AUTH_ISSUER);
  const issuer = new URL(env().AUTH_ISSUER);
  if (url.origin !== issuer.origin) {
    throw new Error("post-login redirect is not on AUTH_ISSUER");
  }
  const path = `${url.pathname}${url.search}`;
  if (path !== "/authorize" && !path.startsWith("/authorize/")) {
    throw new Error("post-login redirect is not an authorize resume path");
  }
  return path;
}

/** True when a recent sign-in parked an OIDC resume URL for /welcome. */
export function hasPostLoginWelcomeAccess(req: {
  signedCookies?: Record<string, unknown>;
}): boolean {
  const signed = req.signedCookies?.[POST_LOGIN_REDIRECT_COOKIE];
  return typeof signed === "string" && signed.length > 0;
}

export function setPostLoginRedirectCookie(res: Response, redirectTo: string): void {
  const path = authorizeResumePath(redirectTo);
  res.cookie(POST_LOGIN_REDIRECT_COOKIE, path, {
    httpOnly: true,
    signed: true,
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60 * 1000,
    secure: cookieSecure(),
  });
}

export function clearPostLoginRedirectCookie(res: Response): void {
  res.clearCookie(POST_LOGIN_REDIRECT_COOKIE, { path: "/" });
}

export { postLoginWelcome };
