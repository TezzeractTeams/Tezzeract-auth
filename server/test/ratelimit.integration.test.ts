import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyTestEnv } from "./helpers/env.js";
import type * as RateLimiter from "../src/services/ratelimit.js";
import type * as Pool from "../src/db/pool.js";

/**
 * The limiter's SQL, exercised against a real Postgres.
 *
 * The window and backoff arithmetic is pure and covered in config.test.ts.
 * What needs a database is the part that cannot be unit-tested: that the
 * UPSERT is atomic under concurrency, and that the failure-decay CASE
 * expression behaves as intended.
 *
 * Skipped unless DATABASE_URL_TEST points at a disposable database, so the
 * suite stays green on a machine without Postgres. Run it with:
 *
 *   DATABASE_URL_TEST=postgres://localhost:5432/tezzeract_auth_test \
 *     pnpm --filter server test
 */
const DATABASE_URL = process.env["DATABASE_URL_TEST"];
const describeWithDb = DATABASE_URL ? describe : describe.skip;

describeWithDb("rate limiting against Postgres", () => {
  let limiter: typeof RateLimiter;
  let pool: typeof Pool;

  beforeAll(async () => {
    applyTestEnv({ DATABASE_URL: DATABASE_URL as string });
    pool = await import("../src/db/pool.js");
    limiter = await import("../src/services/ratelimit.js");
    const { migrate } = await import("../src/db/migrate.js");

    await migrate();
    await pool.query("TRUNCATE auth_rate_limits, auth_lockouts");
  });

  afterAll(async () => {
    await pool.closePool();
  });

  it("allows up to the limit and then refuses, with a Retry-After", async () => {
    const key = `ip-${Date.now()}`;
    const policy = 10; // login:account

    for (let attempt = 1; attempt <= policy; attempt += 1) {
      const result = await limiter.consume("login:account", key);
      expect(result.allowed, `attempt ${attempt}`).toBe(true);
    }

    const refused = await limiter.consume("login:account", key);
    expect(refused.allowed).toBe(false);
    expect(refused.remaining).toBe(0);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("counts concurrent requests exactly once each", async () => {
    const key = `race-${Date.now()}`;

    // Twenty simultaneous requests against a limit of ten. A read-then-write
    // limiter would let most of them through; the single UPSERT must not.
    const results = await Promise.all(
      Array.from({ length: 20 }, () => limiter.consume("login:account", key)),
    );

    expect(results.filter((r) => r.allowed)).toHaveLength(10);
    expect(results.filter((r) => !r.allowed)).toHaveLength(10);
  });

  it("keys per account, so one user cannot lock out another", async () => {
    const suffix = Date.now();
    for (let attempt = 0; attempt < 11; attempt += 1) {
      await limiter.consume("login:account", `victim-${suffix}`);
    }

    expect((await limiter.consume("login:account", `victim-${suffix}`)).allowed).toBe(false);
    expect((await limiter.consume("login:account", `bystander-${suffix}`)).allowed).toBe(true);
  });

  it("locks out only after the threshold, then backs off exponentially", async () => {
    const key = `lock-${Date.now()}`;

    for (let failure = 1; failure < 5; failure += 1) {
      expect(await limiter.recordFailure("login", key), `failure ${failure}`).toBe(0);
    }
    expect(await limiter.lockoutRemaining("login", key)).toBe(0);

    expect(await limiter.recordFailure("login", key)).toBe(60);
    expect(await limiter.lockoutRemaining("login", key)).toBeGreaterThan(0);

    expect(await limiter.recordFailure("login", key)).toBe(120);
    expect(await limiter.recordFailure("login", key)).toBe(240);
  });

  it("clears the failure count on a success", async () => {
    const key = `clear-${Date.now()}`;
    for (let failure = 0; failure < 5; failure += 1) await limiter.recordFailure("login", key);
    expect(await limiter.lockoutRemaining("login", key)).toBeGreaterThan(0);

    await limiter.recordSuccess("login", key);
    expect(await limiter.lockoutRemaining("login", key)).toBe(0);
    // The next failure starts from one, not from six.
    expect(await limiter.recordFailure("login", key)).toBe(0);
  });

  it("decays the failure count after a long quiet period", async () => {
    const key = `decay-${Date.now()}`;
    const now = new Date();
    const longAgo = new Date(now.getTime() - 2 * 86_400 * 1000);

    for (let failure = 0; failure < 4; failure += 1) {
      await limiter.recordFailure("login", key, longAgo);
    }

    // Four stale failures plus one now must not trip a lockout: an honest
    // user who mistyped a password two days ago does not start one attempt
    // away from being locked out.
    expect(await limiter.recordFailure("login", key, now)).toBe(0);
  });

  it("stores no email address or IP in the clear", async () => {
    const email = `plain-${Date.now()}@tezzeract.com`;
    await limiter.consume("login:account", email);
    await limiter.recordFailure("login", email);

    const limits = await pool.query<{ key: string }>("SELECT key FROM auth_rate_limits");
    const lockouts = await pool.query<{ key: string }>("SELECT key FROM auth_lockouts");

    for (const row of [...limits, ...lockouts]) {
      expect(row.key).not.toContain("@");
      expect(row.key).not.toContain(email);
      // SHA-256, hex.
      expect(row.key).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
