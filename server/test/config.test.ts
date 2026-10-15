import { beforeEach, describe, expect, it } from "vitest";
import { parseEnv } from "../src/config/env.js";
import { testEnv, TEST_SIGNING_KEY } from "./helpers/env.js";

describe("environment parsing", () => {
  it("accepts a complete environment", () => {
    const env = parseEnv(testEnv());
    expect(env.AUTH_ISSUER).toBe("https://auth.tezzeract.com");
    expect(env.OIDC_SIGNING_KEYS).toHaveLength(1);
  });

  it("reports every missing variable at once rather than the first", () => {
    const partial = testEnv();
    delete partial["SUPABASE_URL"];
    delete partial["COOKIE_SECRET"];
    expect(() => parseEnv(partial)).toThrow(/SUPABASE_URL[\s\S]*COOKIE_SECRET/);
  });

  it("never echoes a secret value in the failure report", () => {
    const secret = "super-secret-value-that-is-long-enough";
    try {
      parseEnv(testEnv({ COOKIE_SECRET: "short", SUPABASE_SERVICE_ROLE_KEY: secret }));
      expect.unreachable("expected parseEnv to throw");
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
      expect((error as Error).message).not.toContain("short");
    }
  });

  it("refuses a short cookie or csrf secret", () => {
    expect(() => parseEnv(testEnv({ COOKIE_SECRET: "tooshort" }))).toThrow(/COOKIE_SECRET/);
    expect(() => parseEnv(testEnv({ CSRF_SECRET: "tooshort" }))).toThrow(/CSRF_SECRET/);
  });

  it("refuses localhost clients in production", () => {
    expect(() =>
      parseEnv(testEnv({ NODE_ENV: "production", ALLOW_LOCALHOST_CLIENTS: "true" })),
    ).toThrow(/localhost redirect URIs cannot be enabled in production/);
  });

  it("refuses a non-https issuer in production", () => {
    expect(() =>
      parseEnv(testEnv({ NODE_ENV: "production", AUTH_ISSUER: "http://auth.tezzeract.com" })),
    ).toThrow(/https in production/);
  });

  it("requires the issuer to be a bare origin", () => {
    expect(() => parseEnv(testEnv({ AUTH_ISSUER: "https://auth.tezzeract.com/login" }))).toThrow(
      /bare origin/,
    );
  });

  it("refuses more than two active signing keys", () => {
    const three = Buffer.from(
      JSON.stringify([TEST_SIGNING_KEY, TEST_SIGNING_KEY, TEST_SIGNING_KEY]),
    ).toString("base64");
    expect(() => parseEnv(testEnv({ OIDC_SIGNING_KEYS: three }))).toThrow(/at most two keys/);
  });

  it("requires every signing key to carry a kid so /jwks is addressable", () => {
    const { kid: _kid, ...noKid } = TEST_SIGNING_KEY;
    const encoded = Buffer.from(JSON.stringify([noKid])).toString("base64");
    expect(() => parseEnv(testEnv({ OIDC_SIGNING_KEYS: encoded }))).toThrow(/kid/);
  });

  it("caps the access token lifetime at fifteen minutes", () => {
    expect(() => parseEnv(testEnv({ ACCESS_TOKEN_TTL: "3600" }))).toThrow(/ACCESS_TOKEN_TTL/);
    expect(parseEnv(testEnv({ ACCESS_TOKEN_TTL: "600" })).ACCESS_TOKEN_TTL).toBe(600);
  });
});

describe("rate limit arithmetic", () => {
  beforeEach(() => undefined);

  it("aligns fixed windows so concurrent requests share a bucket", async () => {
    const { windowStart } = await import("../src/services/ratelimit.js");
    const a = windowStart(300, new Date("2026-10-15T12:01:00Z"));
    const b = windowStart(300, new Date("2026-10-15T12:04:59Z"));
    expect(a.toISOString()).toBe("2026-10-15T12:00:00.000Z");
    expect(b.toISOString()).toBe(a.toISOString());
    expect(windowStart(300, new Date("2026-10-15T12:05:00Z")).toISOString()).toBe(
      "2026-10-15T12:05:00.000Z",
    );
  });

  it("backs off exponentially past the threshold and respects the cap", async () => {
    const { computeLockoutSeconds, LOCKOUT_POLICIES } = await import(
      "../src/services/ratelimit.js"
    );
    const policy = LOCKOUT_POLICIES.login;
    expect(computeLockoutSeconds(policy, 4)).toBe(0);
    expect(computeLockoutSeconds(policy, 5)).toBe(60);
    expect(computeLockoutSeconds(policy, 6)).toBe(120);
    expect(computeLockoutSeconds(policy, 7)).toBe(240);
    expect(computeLockoutSeconds(policy, 50)).toBe(policy.maxSeconds);
  });
});
