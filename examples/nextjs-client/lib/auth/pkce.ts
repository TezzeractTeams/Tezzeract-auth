import { randomBytes, createHash } from "node:crypto";

/** base64url, no padding — what PKCE and OAuth state both need. */
function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateCodeVerifier(): string {
  return base64url(randomBytes(32));
}

/** S256 challenge — the only method this provider accepts (pkce.required is unconditional). */
export function codeChallengeFromVerifier(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

export function generateState(): string {
  return base64url(randomBytes(16));
}
