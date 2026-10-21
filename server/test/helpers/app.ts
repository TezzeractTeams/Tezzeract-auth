import { createHash, randomBytes } from "node:crypto";
import Provider from "oidc-provider";
import type { Express } from "express";
import { buildConfiguration } from "../../src/oidc/configuration.js";
import { createApp } from "../../src/http/app.js";
import { env } from "../../src/config/env.js";
import { installLogoutRevocation } from "../../src/oidc/logoutRevocation.js";

/**
 * A real app for integration tests.
 *
 * The provider is built from the production configuration with one change:
 * the adapter is removed, so oidc-provider falls back to its own in-memory
 * store. Everything else — PKCE enforcement, the redirect allowlist, refresh
 * rotation, the JWT access token format and the signing keys — is the
 * configuration that ships.
 *
 * The Postgres-backed modules (the rate limiter, memberships) and the Supabase
 * credential store are stubbed by the test files themselves with vi.mock, so
 * these tests need no database and no network.
 */
export function createTestApp(): { app: Express; provider: Provider } {
  const configuration = { ...buildConfiguration() };
  // Fall back to the provider's in-memory adapter.
  delete (configuration as { adapter?: unknown }).adapter;

  const provider = new Provider(env().AUTH_ISSUER, configuration);
  installLogoutRevocation(provider);
  const app = createApp({ provider, serveWeb: false, version: "test" });
  return { app, provider };
}

/* --------------------------------- PKCE ---------------------------------- */

export interface Pkce {
  verifier: string;
  challenge: string;
}

export function makePkce(): Pkce {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export const APP_REDIRECT_URI = "https://app.tezzeract.com/auth/callback";

/** Query for a correct authorization request. */
export function authorizeQuery(
  challenge: string,
  overrides: Record<string, string | undefined> = {},
): string {
  const params: Record<string, string> = {
    client_id: "app",
    response_type: "code",
    redirect_uri: APP_REDIRECT_URI,
    scope: "openid email profile offline_access",
    state: "state-value",
    code_challenge: challenge,
    code_challenge_method: "S256",
    // Required to receive a refresh token: OIDC says an authorization server
    // MUST ignore offline_access unless prompt contains consent, and
    // oidc-provider enforces it (lib/actions/authorization/check_scope.js).
    // Every Tezzeract client sends this; see the README.
    prompt: "consent",
  };

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete params[key];
    else params[key] = value;
  }

  return new URLSearchParams(params).toString();
}

/**
 * Read the CSRF token out of a Set-Cookie list, exactly as the browser does.
 *
 * The cookie is `token|hash` and only the token half goes in the header, so
 * this mirrors readCsrfToken() in web/src/api/auth.ts.
 */
export function csrfFromCookies(cookies: string[]): string | undefined {
  for (const cookie of cookies) {
    const match = /(?:^|;\s*)tz_csrf=([^;]+)/.exec(cookie);
    if (match?.[1]) return decodeURIComponent(match[1]).split("|")[0];
  }
  return undefined;
}
