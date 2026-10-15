import type Provider from "oidc-provider";
import { query } from "../db/pool.js";
import { logger } from "../util/logger.js";
import type { PendingMfa } from "./credentials.js";

/**
 * Sessions and interaction state.
 *
 * There is deliberately no second session store. The provider's own Session
 * is the server-side session: it is persisted through the Postgres adapter and
 * carried by the provider's signed, HttpOnly, SameSite=Lax cookie scoped to
 * this origin and nothing wider. Running a parallel session concept alongside
 * it would mean two sources of truth for "is this person signed in", and the
 * two drifting is a security bug rather than a cosmetic one.
 *
 * No Express types appear here; the provider instance is passed in.
 */

export interface InteractionContext {
  uid: string;
  clientId: string | undefined;
  /** Parameters the login screens must preserve, as the provider recorded them. */
  params: Record<string, unknown>;
}

/** The interaction in progress for this browser, or undefined. */
export async function currentInteraction(
  provider: Provider,
  req: unknown,
  res: unknown,
): Promise<InteractionContext | undefined> {
  try {
    const details = await provider.interactionDetails(
      req as Parameters<Provider["interactionDetails"]>[0],
      res as Parameters<Provider["interactionDetails"]>[1],
    );
    const clientId = details.params["client_id"];
    return {
      uid: details.uid,
      clientId: typeof clientId === "string" ? clientId : undefined,
      params: details.params,
    };
  } catch {
    // No interaction cookie, or it expired. Not an error worth logging at
    // warn: it is the normal state for someone visiting /login directly.
    return undefined;
  }
}

/**
 * Complete an interaction with a signed-in account and return where to send
 * the browser.
 */
export async function completeInteraction(
  provider: Provider,
  req: unknown,
  res: unknown,
  accountId: string,
  options: { remember?: boolean; amr?: string[] } = {},
): Promise<string> {
  type DetailsArgs = Parameters<Provider["interactionDetails"]>;
  const details = await provider.interactionDetails(req as DetailsArgs[0], res as DetailsArgs[1]);

  const clientId = details.params["client_id"];
  if (typeof clientId !== "string") {
    throw new Error("interaction has no client_id");
  }

  /**
   * Grant the requested scopes explicitly.
   *
   * Finishing with a consent result that carries no grantId means "reuse the
   * existing grant", and on a first sign-in there is none — the provider then
   * re-prompts and the browser bounces back to /login. Consent is implicit
   * for these first-party Tezzeract clients, so the grant is created here
   * rather than by asking the user a question they cannot meaningfully answer
   * about their own company's products.
   *
   * An existing grant is reused and extended, so returning to a product the
   * user has already authorised does not accumulate grant records.
   */
  const existing =
    typeof details.grantId === "string" ? await provider.Grant.find(details.grantId) : undefined;

  const grant = existing ?? new provider.Grant({ accountId, clientId });

  const scope = details.params["scope"];
  if (typeof scope === "string") grant.addOIDCScope(scope);

  // Resource scopes are what make the access token a JWT (see
  // oidc/configuration.ts), so the granted resource has to be recorded too.
  const resource = details.params["resource"];
  if (typeof resource === "string" && typeof scope === "string") {
    grant.addResourceScope(resource, scope);
  }

  const grantId = await grant.save();

  /**
   * interactionResult is used rather than interactionFinished because the
   * latter writes a 302 to the response itself, and these endpoints answer
   * with JSON so that the frontend never builds a redirect URL — it only
   * calls window.location.assign on the opaque string returned here.
   */
  type ResultArgs = Parameters<Provider["interactionResult"]>;
  return provider.interactionResult(
    req as ResultArgs[0],
    res as ResultArgs[1],
    {
      login: {
        accountId,
        remember: options.remember ?? true,
        ...(options.amr ? { amr: options.amr } : {}),
      },
      consent: { grantId },
    },
    { mergeWithLastSubmission: false },
  );
}

/**
 * Park a half-finished authentication — password accepted, second factor
 * outstanding — in the interaction record.
 *
 * This lives in server-side interaction storage, never in a cookie or a
 * response body, so the Supabase session that completes the MFA challenge is
 * never exposed to the browser.
 */
export async function storePendingMfa(
  provider: Provider,
  req: unknown,
  res: unknown,
  pending: PendingMfa,
): Promise<void> {
  await provider.interactionResult(
    req as Parameters<Provider["interactionResult"]>[0],
    res as Parameters<Provider["interactionResult"]>[1],
    { mfa: pending },
    { mergeWithLastSubmission: true },
  );
}

/** Read back a parked MFA challenge, if one is outstanding. */
export async function readPendingMfa(
  provider: Provider,
  req: unknown,
  res: unknown,
): Promise<PendingMfa | undefined> {
  try {
    const details = await provider.interactionDetails(
      req as Parameters<Provider["interactionDetails"]>[0],
      res as Parameters<Provider["interactionDetails"]>[1],
    );
    const result = details.result as { mfa?: PendingMfa } | undefined;
    return result?.mfa;
  } catch {
    return undefined;
  }
}

/**
 * End the session and revoke every refresh token issued through it.
 *
 * Deleting the Session record alone would leave outstanding refresh tokens
 * usable, so the grants are revoked explicitly. Access tokens already issued
 * cannot be recalled — they are self-contained JWTs — which is why their
 * lifetime is capped at fifteen minutes.
 */
export async function destroySession(
  provider: Provider,
  req: unknown,
  res: unknown,
): Promise<void> {
  const ctx = provider.app.createContext(
    req as Parameters<Provider["app"]["createContext"]>[0],
    res as Parameters<Provider["app"]["createContext"]>[1],
  );

  let accountId: string | undefined;
  try {
    const session = await provider.Session.get(ctx);
    accountId = session.accountId;
    if (session.grantIdFor) {
      // Revoke the grant for each client this session authorised.
      for (const clientId of Object.keys(session.authorizations ?? {})) {
        const grantId = session.grantIdFor(clientId);
        if (grantId) await provider.Grant.adapter.destroy(grantId);
      }
    }
    await session.destroy();
  } catch (error) {
    logger.warn({ err: error }, "no session to destroy");
  }

  if (accountId) {
    // Belt and braces: drop any refresh token still recorded for this
    // account, including grants from a session that was already gone.
    await query(
      `DELETE FROM oidc_payloads
        WHERE type = 'RefreshToken'
          AND payload ->> 'accountId' = $1`,
      [accountId],
    ).catch((error: unknown) => {
      logger.error({ err: error }, "failed to revoke refresh tokens on logout");
    });
  }
}
