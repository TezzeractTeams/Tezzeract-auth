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

vi.mock("../src/services/credentials.js", () => ({
  credentials: {
    authenticate: vi.fn(async ({ password }: { password: string }) =>
      password === "correct horse battery"
        ? { kind: "authenticated", user: USER }
        : { kind: "rejected" },
    ),
    verifyMfa: vi.fn(),
    beginOAuth: vi.fn(),
    completeOAuth: vi.fn(),
    register: vi.fn(async () => undefined),
    requestPasswordReset: vi.fn(async () => undefined),
    resetPassword: vi.fn(async () => ({ ok: true })),
    resendVerification: vi.fn(async () => undefined),
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

const { createTestApp, makePkce, authorizeQuery, csrfFromCookies } = await import(
  "./helpers/app.js"
);

const DRIVE_REDIRECT_URI = "https://drive.tezzeract.com/auth/callback";

function driveAuthorizeQuery(challenge: string): string {
  const params = new URLSearchParams({
    client_id: "drive",
    response_type: "code",
    redirect_uri: DRIVE_REDIRECT_URI,
    scope: "openid email profile offline_access",
    state: "drive-state",
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "consent",
  });
  return params.toString();
}

async function loginAppClient(agent: ReturnType<typeof request.agent>): Promise<void> {
  const pkce = makePkce();
  const authRes = await agent.get(`/authorize?${authorizeQuery(pkce.challenge)}`).expect(303);
  expect(authRes.headers.location).toMatch(/^\/login\?/);

  const clientConfig = await agent.get("/api/client-config?client_id=app").expect(200);
  const csrf = csrfFromCookies(
    (clientConfig.headers["set-cookie"] as string[] | undefined) ?? [],
  );
  const login = await agent
    .post("/api/login")
    .set("x-csrf-token", csrf as string)
    .send({ email: USER.email, password: "correct horse battery" })
    .expect(200);

  const resume = await agent
    .get(new URL(login.body.redirect_to as string).pathname)
    .expect(303);
  expect(resume.headers.location).toContain("app.tezzeract.com");
}

describe("cross-client SSO (app session, drive authorize)", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>["app"];

  beforeAll(() => {
    app = createTestApp().app;
  });

  it("routes a second client authorize to /login for consent (prompt=consent)", async () => {
    const agent = request.agent(app);
    await loginAppClient(agent);

    const drivePkce = makePkce();
    const driveAuth = await agent
      .get(`/authorize?${driveAuthorizeQuery(drivePkce.challenge)}`)
      .expect(303);

    const location = driveAuth.headers.location as string;
    expect(location).toMatch(/^\/login\?/);
    expect(location).toContain("client_id=drive");
  });

  it("completes drive authorize via continue-interaction when a session already exists", async () => {
    const agent = request.agent(app);
    await loginAppClient(agent);

    const drivePkce = makePkce();
    const driveAuth = await agent
      .get(`/authorize?${driveAuthorizeQuery(drivePkce.challenge)}`)
      .expect(303);
    const loginLocation = driveAuth.headers.location as string;
    expect(loginLocation).toMatch(/^\/login\?/);

    const clientConfig = await agent.get("/api/client-config?client_id=drive").expect(200);
    const csrf = csrfFromCookies(
      (clientConfig.headers["set-cookie"] as string[] | undefined) ?? [],
    );
    const session = await agent.get("/api/session").expect(200);
    expect(session.body).toEqual({ signed_in: true });

    const continued = await agent
      .post("/api/continue-interaction")
      .set("x-csrf-token", csrf as string)
      .send({})
      .expect(200);

    const resume = await agent
      .get(new URL(continued.body.redirect_to as string).pathname)
      .expect(303);
    const callback = resume.headers.location as string;
    expect(callback).toContain(DRIVE_REDIRECT_URI);
    expect(new URL(callback).searchParams.get("code")).toBeTruthy();
  });
});
