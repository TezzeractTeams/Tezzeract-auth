import { exportJWK, generateKeyPair } from "jose";
import { env } from "../config/env.js";

/**
 * Signing keys for access tokens and id tokens.
 *
 * Two keys may be active at once. The first signs; both are published at
 * /jwks, so tokens signed before a rotation keep verifying until they expire.
 * The rotation procedure is in the README under "Rotating keys".
 */

export type Jwk = Record<string, unknown> & { kid: string; alg?: string };

/** Keys in signing order: index 0 signs new tokens. */
export function signingKeys(): Jwk[] {
  return env().OIDC_SIGNING_KEYS as unknown as Jwk[];
}

/** The key new tokens are signed with. */
export function activeKey(): Jwk {
  const [key] = signingKeys();
  if (!key) throw new Error("no signing key configured");
  return key;
}

/** The JWS algorithm to sign with, inferred from the active key. */
export function signingAlg(): "RS256" | "ES256" {
  const key = activeKey();
  if (key.alg === "RS256" || key.alg === "ES256") return key.alg;
  return key.kty === "RSA" ? "RS256" : "ES256";
}

/**
 * Generate a key pair for a rotation, as a private JWK ready to prepend to
 * OIDC_SIGNING_KEYS. Used by `pnpm --filter server keygen`; never called at
 * runtime, so a deployed process has no key-generation path.
 */
export async function generateSigningKey(
  alg: "RS256" | "ES256" = "ES256",
  kid = `tz-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 8)}`,
): Promise<Jwk> {
  const { privateKey } = await generateKeyPair(alg, { extractable: true });
  const jwk = await exportJWK(privateKey);
  return { ...jwk, kid, alg, use: "sig" } as Jwk;
}
