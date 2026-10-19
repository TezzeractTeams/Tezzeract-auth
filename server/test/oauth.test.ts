import { beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { applyTestEnv } from "./helpers/env.js";

applyTestEnv({ ALLOW_LOCALHOST_CLIENTS: "false" });

const USER = {
  userId: "11111111-1111-4111-8111-111111111111",
  email: "ada@tezzeract.com",
  name: "Ada Lovelace",
  emailVerified: true,
};

const beginOAuth = vi.fn();
const completeOAuth = vi.fn();

vi.mock("../src/services/credentials.js", () => ({
  credentials: {
    authenticate: vi.fn(),
    verifyMfa: vi.fn(),
    beginOAuth,
    completeOAuth,
    register: vi.fn(),
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
    resendVerification: vi.fn(),
    getUser: vi.fn(async () => USER),
  },
}));

vi.mock("../src/services/memberships.js", () => ({
  getMemberships: vi.fn(async () => []),
  getStanding: vi.fn(async () => "active"),
  getSnapshot: vi.fn(async () => ({ memberships: [], standing: "active" })),
}));

vi.mock("../src/services/ratelimit.js", () => ({
  consume: vi.fn(async () => ({ allowed: true, remaining: 99, retryAfterSeconds: 0 })),
  lockoutRemaining: vi.fn(async () => 0),
  recordFailure: vi.fn(async () => 0),
  recordSuccess: vi.fn(async () => undefined),
  sweepExpired: vi.fn(async () => undefined),
  POLICIES: {},
  LOCKOUT_POLICIES: {},
}));

vi.mock("../src/db/pool.js", () => ({
  query: vi.fn(async () => []),
  getPool: vi.fn(),
  transaction: vi.fn(),
  closePool: vi.fn(async () => undefined),
}));

const { createTestApp, makePkce, authorizeQuery } = await import("./helpers/app.js");

let app: Awaited<ReturnType<typeof createTestApp>>["app"];

beforeAll(() => {
  app = createTestApp().app;
});

async function startAuthorize(agent: ReturnType<typeof request.agent>): Promise<string> {
  const pkce = makePkce();
  const response = await agent.get(`/authorize?${authorizeQuery(pkce.challenge)}`).expect(303);
  const location = response.headers["location"] as string;
  const uid = new URLSearchParams(location.slice(location.indexOf("?"))).get("interaction");
  expect(uid).toBeTruthy();
  return uid as string;
}

describe("google oauth routes", () => {
  it("refuses to start without an OIDC interaction", async () => {
    const agent = request.agent(app);
    const response = await agent.get("/api/oauth/google").expect(303);
    expect(response.headers["location"]).toBe("/error?reason=no_interaction");
    expect(beginOAuth).not.toHaveBeenCalled();
  });

  it("redirects to Supabase when an interaction is in progress", async () => {
    beginOAuth.mockResolvedValueOnce({
      ok: true,
      authorizationUrl: "https://project.supabase.co/auth/v1/authorize?provider=google",
      codeVerifier: "test-verifier",
    });

    const agent = request.agent(app);
    await startAuthorize(agent);

    const response = await agent.get("/api/oauth/google").expect(302);
    expect(response.headers["location"]).toBe(
      "https://project.supabase.co/auth/v1/authorize?provider=google",
    );
    expect(beginOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "google",
        redirectTo: expect.stringMatching(/\/api\/oauth\/callback$/),
      }),
    );
  });

  it("sends the callback back to login when oauth state is missing", async () => {
    const agent = request.agent(app);
    const uid = await startAuthorize(agent);

    const response = await agent
      .get("/api/oauth/callback?code=abc")
      .expect(303);

    expect(response.headers["location"]).toMatch(new RegExp(`^/login\\?interaction=${uid}`));
    expect(completeOAuth).not.toHaveBeenCalled();
  });
});
