import type { Configuration, KoaContextWithOIDC } from "oidc-provider";
import { cookieSecure, env } from "../config/env.js";
import { listClients } from "../services/clients.js";
import { getSnapshot } from "../services/memberships.js";
import { credentials } from "../services/credentials.js";
import { postgresAdapter } from "./adapter.pg.js";
import { signingAlg, signingKeys } from "./keys.js";
import { logger } from "../util/logger.js";

/**
 * oidc-provider configuration.
 *
 * Shape of the deployment: every Tezzeract product is a public client using
 * Authorization Code + PKCE. There are no client secrets to leak, no implicit
 * flow and no password grant. Access tokens are JWTs signed with our keystore
 * so other services verify them from /jwks alone, with no call back here.
 */

/**
 * The resource server identifier.
 *
 * JWT access tokens exist only for resource-indicated tokens in
 * oidc-provider v8 (see lib/models/mixins/has_format.js), so a default
 * resource is configured rather than left to the client to request. The
 * `audience` returned below overrides the identifier in the `aud` claim, which
 * is how aud ends up as the client_id that contracts/claims.ts specifies.
 */
export const RESOURCE_IDENTIFIER = "https://api.tezzeract.com";

/** Scopes a client may ask for. Claims are attached per scope below. */
const SCOPES = ["openid", "offline_access", "profile", "email"];

export function buildConfiguration(): Configuration {
  const ttl = env().ACCESS_TOKEN_TTL;

  return {
    adapter: postgresAdapter,

    jwks: { keys: signingKeys() },

    clients: listClients().map((client) => ({
      client_id: client.client_id,
      client_name: client.name,
      redirect_uris: client.redirect_uris,
      post_logout_redirect_uris: client.post_logout_redirect_uris,
      // Public client: no secret to distribute or rotate. PKCE is the proof.
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      application_type: "web",
    })),

    // Authorization Code only. Listing just this response type is what makes
    // the implicit and hybrid flows unavailable rather than merely discouraged.
    /**
     * Endpoint paths.
     *
     * Declared explicitly because the library's defaults are /auth, /me and
     * /session/end, while the API contract specifies /authorize, /userinfo
     * and /end_session. The discovery document is generated from these, so
     * clients pick them up without any hardcoded paths.
     */
    routes: {
      authorization: "/authorize",
      token: "/token",
      jwks: "/jwks",
      userinfo: "/userinfo",
      end_session: "/end_session",
      revocation: "/revocation",
    },

    // Authorization Code only. Grant types are constrained per client below
    // and by the disabled features, so there is no provider-level list.
    responseTypes: ["code"],

    pkce: {
      // Mandatory for every client, with no per-client escape hatch.
      required: () => true,
    },

    scopes: SCOPES,
    claims: {
      openid: ["sub"],
      email: ["email", "email_verified"],
      profile: ["name"],
    },

    /**
     * Our own screens, served by web/. The provider's dev UI stays off.
     *
     * client_id rides along so the login screen can theme itself on first
     * paint. It is echoed from the provider's own record of the authorization
     * request, not from anything the browser supplied to this endpoint.
     */
    interactions: {
      url(_ctx, interaction) {
        const params = new URLSearchParams({ interaction: interaction.uid });
        const clientId = interaction.params["client_id"];
        if (typeof clientId === "string") params.set("client_id", clientId);
        return `/login?${params.toString()}`;
      },
    },

    /**
     * Session and interaction cookies.
     *
     * `short.path` is '/' rather than the default per-interaction path so that
     * POST /api/login receives the interaction cookie. That is what lets the
     * API keep the body as { email, password }: the interaction uid is never
     * carried in a request body, only in the provider's own signed cookie.
     */
    cookies: {
      keys: [env().COOKIE_SECRET],
      long: {
        httpOnly: true,
        secure: cookieSecure(),
        sameSite: "lax",
        path: "/",
        signed: true,
      },
      short: {
        httpOnly: true,
        secure: cookieSecure(),
        sameSite: "lax",
        path: "/",
        signed: true,
      },
    },

    ttl: {
      AccessToken: ttl,
      AuthorizationCode: 60,
      IdToken: ttl,
      // Rotation means a refresh token is single-use, so a long absolute
      // lifetime is bounded by reuse detection rather than by the clock.
      RefreshToken: 14 * 24 * 60 * 60,
      Interaction: 15 * 60,
      Session: 14 * 24 * 60 * 60,
      Grant: 14 * 24 * 60 * 60,
    },

    /**
     * Refresh token rotation with reuse detection.
     *
     * Returning true rotates on every exchange. oidc-provider marks the old
     * token consumed via Adapter#consume, and presenting a consumed token
     * revokes the entire grant — which is why the adapter marks records
     * consumed instead of deleting them.
     */
    rotateRefreshToken: () => true,

    /** Issue a refresh token whenever offline_access was granted. */
    issueRefreshToken(_ctx, client, code) {
      return client.grantTypeAllowed("refresh_token") && code.scopes.has("offline_access");
    },

    features: {
      // The provider's built-in interaction screens must never be reachable.
      devInteractions: { enabled: false },
      revocation: { enabled: true },
      // Not enabled: other services verify from /jwks, so no introspection
      // endpoint is needed and none is exposed.
      introspection: { enabled: false },
      registration: { enabled: false },
      clientCredentials: { enabled: false },
      deviceFlow: { enabled: false },
      rpInitiatedLogout: {
        enabled: true,
        /**
         * RP-initiated logout confirmation.
         *
         * The provider's default page auto-submits with an inline script,
         * which the strict CSP (`default-src 'self'`, no unsafe-inline)
         * blocks. Rather than weaken the CSP with a nonce for one page, this
         * auto-submits via /logout-confirm.js (same-origin, CSP-safe). A real
         * submit button remains for noscript and as a fallback. The usual
         * sign-out path is web/'s /logout screen calling POST /api/logout;
         * this page is only reached when another product starts logout at
         * /end_session.
         */
        logoutSource(ctx, form) {
          ctx.body = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Signing you out</title>
<link rel="stylesheet" href="/logout-confirm.css">
<script src="/logout-confirm.js" defer></script></head>
<body><main><div class="card"><h1>Signing you out…</h1>
<p class="lead">Ending your Tezzeract session on this device.</p>
<div class="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span>
<span>Please wait a moment.</span></div>
${form}
<div class="actions"><button type="submit" form="op.logoutForm">Sign out</button></div>
</div></main></body></html>`;
        },
      },
      resourceIndicators: {
        enabled: true,
        defaultResource: () => RESOURCE_IDENTIFIER,
        useGrantedResource: () => true,
        getResourceServerInfo(_ctx, _resourceIndicator, client) {
          return {
            scope: SCOPES.join(" "),
            // aud = client_id, per contracts/claims.ts. ResourceServer uses
            // `audience || identifier()` for the audience claim.
            audience: client.clientId,
            accessTokenTTL: ttl,
            accessTokenFormat: "jwt",
            jwt: { sign: { alg: signingAlg() } },
          };
        },
      },
    },

    enabledJWA: {
      idTokenSigningAlgValues: [signingAlg()],
      // No HS* anywhere: a symmetric algorithm would require sharing a secret
      // with every consuming service, which defeats verification via /jwks.
      requestObjectSigningAlgValues: [signingAlg()],
    },

    clientDefaults: {
      id_token_signed_response_alg: signingAlg(),
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },

    /**
     * Who the subject is, and what the userinfo endpoint returns.
     */
    async findAccount(_ctx, sub) {
      const user = await credentials.getUser(sub);
      if (!user) return undefined;
      return {
        accountId: sub,
        // Not async: the provider awaits the result either way, and there
        // is nothing here to await.
        claims() {
          return {
            sub,
            email: user.email,
            email_verified: user.emailVerified,
            name: user.name,
          };
        },
      };
    },

    /**
     * Extra access token claims: the profile and authorization hint.
     *
     * Spread before the registered claims in lib/models/formats/jwt.js, so
     * nothing here can overwrite iss, aud, sub, exp or iat.
     *
     * `memberships` is read at issue time and is a HINT with a lifetime of at
     * most one access token. Consuming services re-check it. See the README.
     */
    async extraTokenClaims(_ctx: KoaContextWithOIDC, token) {
      const sub = "accountId" in token ? token.accountId : undefined;
      if (typeof sub !== "string") return undefined;

      const user = await credentials.getUser(sub);
      if (!user) return undefined;

      const { memberships, standing } = await getSnapshot(sub);
      return {
        email: user.email,
        name: user.name,
        standing,
        memberships,
      };
    },

    renderError(ctx, _out, error) {
      // Provider-level failures hand off to our own /error screen rather than
      // rendering the default HTML, which echoes request detail back.
      logger.warn({ err: error }, "oidc provider error");
      ctx.status = 303;
      ctx.redirect("/error?reason=oidc");
    },

    clockTolerance: 15,
  };
}
