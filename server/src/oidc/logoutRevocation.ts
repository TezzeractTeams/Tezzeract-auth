import type Provider from "oidc-provider";
import { logger } from "../util/logger.js";

/**
 * RP-initiated logout revokes the grants of the session being ended.
 *
 * oidc-provider deliberately keeps grants that were issued with
 * `offline_access` alive across /end_session (its `persistsLogout` flag), so
 * every Tezzeract client, which always requests offline_access, would keep a
 * working refresh token after SSO logout. A product holding such a token can
 * mint new access tokens indefinitely, which defeats logging out.
 *
 * This hooks `end_session.success`. At that point the session object is
 * already destroyed but still carries its `authorizations`, so each grant id
 * is read synchronously and revoked before the response is sent. Only the
 * grants of the session being logged out are touched, never the whole
 * account.
 */

const PENDING = Symbol("tz.logoutRevocation");

type SessionLike = { authorizations?: Record<string, { grantId?: string }> };
type CtxLike = {
  oidc?: { params?: { logout?: unknown }; session?: SessionLike };
  [PENDING]?: Promise<unknown>;
};

export function installLogoutRevocation(provider: Provider): void {
  const onEvent = provider.on.bind(provider) as unknown as (
    event: string,
    listener: (ctx: CtxLike) => void,
  ) => void;

  onEvent("end_session.success", (ctx) => {
    if (!ctx.oidc?.params?.logout) return;

    const grantIds = Object.values(ctx.oidc.session?.authorizations ?? {})
      .map((authorization) => authorization.grantId)
      .filter((id): id is string => typeof id === "string");

    ctx[PENDING] = Promise.all(
      grantIds.map(async (grantId) => {
        await Promise.all([
          provider.AccessToken.revokeByGrantId(grantId),
          provider.RefreshToken.revokeByGrantId(grantId),
          provider.Grant.adapter.destroy(grantId),
        ]);
      }),
    ).catch((error: unknown) => {
      logger.error({ err: error }, "failed to revoke grants on end_session");
    });
  });

  // The listener above is fire-and-forget from the provider's point of view;
  // awaiting here keeps the redirect from reaching the browser before the
  // revocation has finished.
  provider.use(async (ctx, next) => {
    await next();
    const pending = (ctx as unknown as CtxLike)[PENDING];
    if (pending) await pending;
  });
}
