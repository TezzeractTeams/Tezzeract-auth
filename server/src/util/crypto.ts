import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * SHA-256, hex encoded.
 *
 * Used for two jobs: keying rate-limit rows so an email or IP is not stored in
 * the clear, and keying token storage so a database dump yields no usable
 * bearer token. Both inputs are high-entropy or low-value, so a plain digest
 * is the right tool; this is not password hashing, which Supabase owns.
 */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Compare two strings without leaking their common prefix through timing. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // timingSafeEqual throws on a length mismatch, which would itself be a leak.
  // Compare digests so the buffers are always the same size.
  return timingSafeEqual(
    createHash("sha256").update(left).digest(),
    createHash("sha256").update(right).digest(),
  );
}

/** URL-safe random token, for values we mint ourselves (CSRF, nonces). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
