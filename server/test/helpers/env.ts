import { resetEnvForTests } from "../../src/config/env.js";
import { resetClientsForTests } from "../../src/services/clients.js";

/** A valid signing key for tests. Generated for this repo; not a real secret. */
export const TEST_SIGNING_KEY = {
  kty: "EC",
  kid: "test-key-1",
  alg: "ES256",
  crv: "P-256",
  x: "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU",
  y: "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0",
  d: "jpsQnnGQmL-YBIffH1136cspYG6-0iY7X1fCE9-E9LI",
};

/** A complete, valid environment for tests. No real secrets. */
export function testEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    AUTH_ISSUER: "https://auth.tezzeract.com",
    DATABASE_URL: "postgres://localhost:5432/tezzeract_auth_test",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key-not-real",
    SUPABASE_ANON_KEY: "test-anon-key-not-real",
    COOKIE_SECRET: "x".repeat(32),
    CSRF_SECRET: "y".repeat(32),
    OIDC_SIGNING_KEYS: Buffer.from(JSON.stringify([TEST_SIGNING_KEY])).toString("base64"),
    ...overrides,
  };
}

/** Install a test environment and clear every memoised module-level cache. */
export function applyTestEnv(overrides: Record<string, string> = {}): void {
  for (const key of Object.keys(testEnv())) delete process.env[key];
  Object.assign(process.env, testEnv(overrides));
  resetEnvForTests();
  resetClientsForTests();
}
