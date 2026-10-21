import Provider from "oidc-provider";
import { env } from "../config/env.js";
import { buildConfiguration } from "./configuration.js";
import { logger } from "../util/logger.js";
import { installLogoutRevocation } from "./logoutRevocation.js";

/**
 * The OIDC provider instance.
 *
 * Mounted by http/app.ts. Owns /authorize, /token, /jwks, /userinfo,
 * /.well-known/openid-configuration and /session/end.
 */

let provider: Provider | undefined;

export function getProvider(): Provider {
  if (!provider) {
    provider = new Provider(env().AUTH_ISSUER, buildConfiguration());

    // The provider sits behind a proxy in every deployed environment; without
    // this it builds redirect URLs from the internal http origin.
    provider.proxy = env().TRUST_PROXY_HOPS > 0;

    installLogoutRevocation(provider);

    // Endpoint-level failures. The event names are not all present in the
    // published event map, so the listener is attached through a narrow cast
    // rather than widening the provider type.
    const onEvent = provider.on.bind(provider) as unknown as (
      event: string,
      listener: (ctx: unknown, error: Error) => void,
    ) => void;

    for (const event of ["grant.error", "revocation.error", "authorization.error", "token.error"]) {
      onEvent(event, (_ctx, error) => {
        logger.warn({ event, err: error }, "oidc endpoint error");
      });
    }

    // Reuse of a rotated refresh token. The provider has already revoked the
    // grant by the time this fires; this is the signal worth alerting on.
    onEvent("grant.revoked", (_ctx, error) => {
      logger.warn({ err: error }, "grant revoked");
    });

    onEvent("server_error", (_ctx, error) => {
      logger.error({ err: error }, "oidc server error");
    });
  }
  return provider;
}

/** Test seam: drop the provider so a test can build one with a fresh config. */
export function resetProviderForTests(): void {
  provider = undefined;
}
