import helmet from "helmet";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { isProduction } from "../../config/env.js";

/**
 * Security headers.
 *
 * The CSP is strict and has no nonce or 'unsafe-inline' anywhere: this origin
 * serves a login form, so script injection here is credential theft. That
 * constraint is why the RP-initiated logout page renders a real submit button
 * instead of the provider's auto-submitting inline script, and why web/ must
 * not use dangerouslySetInnerHTML or inline event handlers.
 */
/**
 * RP-initiated logout lands here from another product's origin (e.g.
 * app.tezzeract.com) and immediately auto-submits a same-origin form to
 * /end_session/confirm. Chrome performs a browsing-context-group swap when a
 * cross-site navigation lands on a COOP: same-origin page, and that swap can
 * race the auto-submit, causing the browser to misreport the CSP
 * `form-action 'self'` check on an otherwise same-origin submission. COOP's
 * purpose — stopping a malicious opener from reading window.opener — has
 * nothing to do with this redirect-only page, so it is dropped here rather
 * than kept and worked around.
 */
function isEndSessionPath(path: string): boolean {
  return path === "/end_session" || path.startsWith("/end_session/");
}

const baseHelmetOptions = {
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      "default-src": ["'self'"],
      // Vite emits a single stylesheet; no inline style is needed.
      "style-src": ["'self'"],
      "script-src": ["'self'"],
      // Client logos are served from this origin, and data: covers the
      // inlined favicon. No remote image host is permitted.
      "img-src": ["'self'", "data:"],
      "font-src": ["'self'"],
      // Same-origin API only. There is no cross-origin call to make.
      "connect-src": ["'self'"],
      "form-action": ["'self'"],
      // Clickjacking a login form is phishing, so framing is forbidden
      // outright rather than restricted to same-origin.
      "frame-ancestors": ["'none'"],
      "frame-src": ["'none'"],
      "object-src": ["'none'"],
      "base-uri": ["'none'"],
      ...(isProduction() ? { "upgrade-insecure-requests": [] } : {}),
    },
  },
  // One year, subdomains included, preload-eligible.
  strictTransportSecurity: isProduction()
    ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
    : false,
  referrerPolicy: { policy: "no-referrer" },
  xContentTypeOptions: true,
  xFrameOptions: { action: "deny" },
  // Discloses the framework version; nothing needs it.
  xPoweredBy: false,
} as const;

const defaultHelmet = helmet({
  ...baseHelmetOptions,
  // Isolate this origin from any window that opens it.
  crossOriginOpenerPolicy: { policy: "same-origin" },
  crossOriginResourcePolicy: { policy: "same-origin" },
});

const endSessionHelmet = helmet({
  ...baseHelmetOptions,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
});

export function securityHeaders(): RequestHandler {
  return (req, res, next) => {
    if (isEndSessionPath(req.path)) {
      endSessionHelmet(req, res, next);
      return;
    }
    defaultHelmet(req, res, next);
  };
}

/**
 * Keep every page of this service out of search indexes.
 *
 * Paired with the noindex meta tag in web/index.html: the header covers API
 * responses and anything a crawler reaches without executing the page.
 */
export function noIndex(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  next();
}

/** API responses are never cacheable: they are per-session by definition. */
export function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  next();
}
