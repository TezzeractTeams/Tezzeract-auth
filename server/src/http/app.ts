import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cookieParser from "cookie-parser";
import express, { type Express } from "express";
import { pinoHttp } from "pino-http";
import type Provider from "oidc-provider";
import { env } from "../config/env.js";
import { getProvider } from "../oidc/provider.js";
import { logger, safeUrl } from "../util/logger.js";
import { errorHandler, notFoundHandler } from "./errors.js";
import { noIndex, noStore, securityHeaders } from "./middleware/security.js";
import { authRoutes } from "./routes/auth.js";
import { clientConfigRoutes } from "./routes/client-config.js";
import { healthRoutes } from "./routes/health.js";

/**
 * The Express application.
 *
 * One origin serves the API, the OIDC endpoints and the built frontend, which
 * is what makes the session cookie first-party and means there is no CORS
 * configuration anywhere in this service. Nothing here enables cross-origin
 * requests, and that is deliberate.
 */

export interface AppOptions {
  provider?: Provider;
  /** Directory holding web/dist. Discovered automatically when omitted. */
  webDistPath?: string | undefined;
  /** Set false in tests, which have no built frontend to serve. */
  serveWeb?: boolean;
  version?: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));

/** web/dist, as laid out in the Docker image and in a local build. */
export function defaultWebDistPath(): string | undefined {
  for (const candidate of [
    resolve(HERE, "../../../web/dist"),
    resolve(HERE, "../../web/dist"),
    resolve(process.cwd(), "web/dist"),
  ]) {
    if (existsSync(join(candidate, "index.html"))) return candidate;
  }
  return undefined;
}

export function createApp(options: AppOptions = {}): Express {
  const provider = options.provider ?? getProvider();
  const version = options.version ?? "0.1.0";
  const app = express();

  // Must match the deployment, or req.ip is the proxy and per-IP limiting
  // throttles every user as one.
  app.set("trust proxy", env().TRUST_PROXY_HOPS);
  app.disable("x-powered-by");
  // No ETag on API responses: they are per-session and never revalidated.
  app.set("etag", false);

  app.use(
    pinoHttp({
      logger,
      // The default includes the full URL, which carries reset tokens.
      customSuccessMessage: (req: { method?: string; url?: string }) =>
        `${req.method ?? "?"} ${safeUrl(req.url ?? "")}`,
      customErrorMessage: (req: { method?: string; url?: string }) =>
        `${req.method ?? "?"} ${safeUrl(req.url ?? "")} failed`,
      // Health checks would otherwise dominate the log.
      autoLogging: { ignore: (req: { url?: string }) => req.url === "/healthz" },
    }),
  );

  app.use(securityHeaders());
  app.use(noIndex);
  app.use(cookieParser(env().COOKIE_SECRET));

  app.use("/", healthRoutes(version));

  // Body parsing is scoped to /api. The provider's endpoints parse their own
  // form bodies, and double-parsing breaks the token endpoint.
  app.use("/api", noStore, express.json({ limit: "16kb" }));
  app.use("/api", clientConfigRoutes());
  app.use("/api", authRoutes(provider));
  app.use("/api", notFoundHandler);

  /**
   * The OIDC provider owns /authorize, /token, /jwks, /userinfo,
   * /.well-known/openid-configuration and /session/end. Mounted at the root
   * because the discovery document advertises issuer-relative paths.
   */
  app.use("/", provider.callback());

  if (options.serveWeb !== false) {
    const dist = options.webDistPath ?? defaultWebDistPath();
    if (dist) {
      // Hashed asset filenames, so they are safe to cache for a long time.
      app.use(
        "/assets",
        express.static(join(dist, "assets"), {
          immutable: true,
          maxAge: "1y",
          index: false,
        }),
      );
      app.use(express.static(dist, { index: false, maxAge: "5m" }));

      // SPA fallback. The login screens are client-side routes, so any
      // remaining GET returns index.html and React routes it. index.html is
      // never cached, so a deploy takes effect immediately.
      app.get("*", (_req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.sendFile(join(dist, "index.html"));
      });
    } else {
      logger.warn("web/dist not found; serving the API only");
    }
  }

  app.use(errorHandler);
  return app;
}
