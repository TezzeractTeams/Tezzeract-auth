import { query } from "../db/pool.js";
import { sha256Hex } from "../util/crypto.js";

/**
 * Rate limiting and lockout, backed by Postgres so the counters are shared
 * across server instances.
 *
 * Two independent mechanisms, because they stop different attacks:
 *
 *  - A fixed-window counter caps request volume. It is keyed per IP and,
 *    separately, per account, so one noisy address cannot lock out a user and
 *    a distributed attack against one account is still capped.
 *  - A failure counter with exponential backoff survives the rate-limit
 *    window, so slow patient guessing — a handful of attempts an hour, well
 *    under any volume cap — still trips a lockout.
 *
 * Keys are hashed before storage: the tables are useful for throttling but
 * not as a list of user emails or client IP addresses.
 */

export interface RateLimitPolicy {
  /** Window length in seconds. */
  windowSeconds: number;
  /** Requests permitted per key per window. */
  max: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Requests left in this window. Zero once the limit is reached. */
  remaining: number;
  /** Seconds until the caller may retry. Zero when allowed. */
  retryAfterSeconds: number;
}

export interface LockoutPolicy {
  /** Consecutive failures tolerated before the first lockout. */
  threshold: number;
  /** Lockout length for the first trip, in seconds. Doubles thereafter. */
  baseSeconds: number;
  /** Ceiling on the backoff, in seconds. */
  maxSeconds: number;
  /** Idle period after which the failure count decays back to zero. */
  resetAfterSeconds: number;
}

/**
 * Per-endpoint policies.
 *
 * The per-account limits are deliberately tighter than the per-IP ones: many
 * users legitimately share an office IP, but nobody legitimately attempts to
 * sign in to one account thirty times a minute.
 */
export const POLICIES = {
  "login:ip": { windowSeconds: 300, max: 30 },
  "login:account": { windowSeconds: 300, max: 10 },
  "signup:ip": { windowSeconds: 3600, max: 10 },
  "forgot:ip": { windowSeconds: 3600, max: 20 },
  "forgot:account": { windowSeconds: 3600, max: 5 },
  "mfa:ip": { windowSeconds: 300, max: 30 },
  "mfa:session": { windowSeconds: 300, max: 10 },
  "resend:ip": { windowSeconds: 3600, max: 10 },
  "resend:account": { windowSeconds: 3600, max: 5 },
} as const satisfies Record<string, RateLimitPolicy>;

export type PolicyName = keyof typeof POLICIES;

export const LOCKOUT_POLICIES = {
  login: { threshold: 5, baseSeconds: 60, maxSeconds: 3600, resetAfterSeconds: 86_400 },
  mfa: { threshold: 5, baseSeconds: 60, maxSeconds: 900, resetAfterSeconds: 3600 },
} as const satisfies Record<string, LockoutPolicy>;

export type LockoutName = keyof typeof LOCKOUT_POLICIES;

/**
 * Start of the fixed window containing `now`, aligned to the window length.
 *
 * Exported because this and computeLockoutSeconds are the only parts of this
 * service with interesting arithmetic, and they are unit-testable without a
 * database.
 */
export function windowStart(windowSeconds: number, now: Date): Date {
  const ms = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
}

/**
 * Lockout length for a given consecutive-failure count: zero below the
 * threshold, then doubling per further failure up to the cap.
 */
export function computeLockoutSeconds(policy: LockoutPolicy, failures: number): number {
  if (failures < policy.threshold) return 0;
  const trips = failures - policy.threshold;
  return Math.min(policy.maxSeconds, policy.baseSeconds * 2 ** trips);
}

/**
 * Count one request against `bucket`/`key`.
 *
 * The UPSERT is a single statement, so concurrent requests cannot both read a
 * stale count and each decide they are under the limit.
 */
export async function consume(
  bucket: PolicyName,
  rawKey: string,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const policy = POLICIES[bucket];
  const start = windowStart(policy.windowSeconds, now);
  const key = sha256Hex(rawKey);

  const rows = await query<{ hits: number }>(
    `INSERT INTO auth_rate_limits (bucket, key, window_start, hits)
          VALUES ($1, $2, $3, 1)
     ON CONFLICT (bucket, key, window_start)
       DO UPDATE SET hits = auth_rate_limits.hits + 1
       RETURNING hits`,
    [bucket, key, start],
  );

  const hits = rows[0]?.hits ?? 1;
  const resetAt = start.getTime() + policy.windowSeconds * 1000;
  const allowed = hits <= policy.max;

  return {
    allowed,
    remaining: Math.max(0, policy.max - hits),
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((resetAt - now.getTime()) / 1000)),
  };
}

/** Seconds remaining on an active lockout, or 0 when not locked. */
export async function lockoutRemaining(
  bucket: LockoutName,
  rawKey: string,
  now: Date = new Date(),
): Promise<number> {
  const rows = await query<{ locked_until: Date | null }>(
    `SELECT locked_until FROM auth_lockouts WHERE bucket = $1 AND key = $2`,
    [bucket, sha256Hex(rawKey)],
  );
  const lockedUntil = rows[0]?.locked_until ?? null;
  if (!lockedUntil) return 0;
  const seconds = Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000);
  return seconds > 0 ? seconds : 0;
}

/**
 * Record a failed attempt and return the resulting lockout, in seconds.
 *
 * Backoff doubles per trip beyond the threshold and is capped. A quiet period
 * longer than resetAfterSeconds decays the count, so an honest user who
 * mistyped a password last week does not start halfway to a lockout.
 */
export async function recordFailure(
  bucket: LockoutName,
  rawKey: string,
  now: Date = new Date(),
): Promise<number> {
  const policy = LOCKOUT_POLICIES[bucket];
  const key = sha256Hex(rawKey);

  const rows = await query<{ failures: number }>(
    `INSERT INTO auth_lockouts (bucket, key, failures, last_failure)
          VALUES ($1, $2, 1, $3)
     ON CONFLICT (bucket, key) DO UPDATE SET
          failures = CASE
              WHEN auth_lockouts.last_failure < $3::timestamptz - make_interval(secs => $4)
              THEN 1
              ELSE auth_lockouts.failures + 1
          END,
          last_failure = $3
       RETURNING failures`,
    [bucket, key, now, policy.resetAfterSeconds],
  );

  const failures = rows[0]?.failures ?? 1;
  const seconds = computeLockoutSeconds(policy, failures);
  if (seconds === 0) return 0;

  const lockedUntil = new Date(now.getTime() + seconds * 1000);

  await query(`UPDATE auth_lockouts SET locked_until = $3 WHERE bucket = $1 AND key = $2`, [
    bucket,
    key,
    lockedUntil,
  ]);
  return seconds;
}

/** Clear the failure count after a success. */
export async function recordSuccess(bucket: LockoutName, rawKey: string): Promise<void> {
  await query(`DELETE FROM auth_lockouts WHERE bucket = $1 AND key = $2`, [
    bucket,
    sha256Hex(rawKey),
  ]);
}

/** Drop counters and lockouts that can no longer affect a decision. */
export async function sweepExpired(now: Date = new Date()): Promise<void> {
  const longestWindow = Math.max(...Object.values(POLICIES).map((p) => p.windowSeconds));
  await query(
    `DELETE FROM auth_rate_limits
      WHERE window_start < $1::timestamptz - make_interval(secs => $2)`,
    [now, longestWindow * 2],
  );
  const longestReset = Math.max(...Object.values(LOCKOUT_POLICIES).map((p) => p.resetAfterSeconds));
  await query(
    `DELETE FROM auth_lockouts
      WHERE last_failure < $1::timestamptz - make_interval(secs => $2)
        AND (locked_until IS NULL OR locked_until < $1)`,
    [now, longestReset],
  );
}
