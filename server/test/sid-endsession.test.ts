import { beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { decodeJwt } from "jose";
import { applyTestEnv } from "./helpers/env.js";

/**
 * Step 0 evidence for SSO logout:
 *  1. Both the access token and the id_token carry a `sid`, and it is the
 *     same value, so a backchannel logout_token `sid` can revoke either.
 *  2. RP-initiated /end_session makes the old refresh token unusable.
 */

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

const { createTestApp, makePkce, authorizeQuery, APP_REDIRECT_URI, csrfFromCookies } = await import(
  "./helpers/app.js"
);

type Agent = ReturnType<typeof request.agent>;

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
}

let app: Awaited<ReturnType<typeof createTestApp>>["app"];

beforeAll(() => {
  app = createTestApp().app;
});

async function signIn(): Promise<{ agent: Agent; tokens: TokenResponse }> {
  const agent = request.agent(app);
  const pkce = makePkce();

  await agent.get(`/authorize?${authorizeQuery(pkce.challenge)}`).expect(303);
  const cfg = await agent.get("/api/client-config?client_id=app").expect(200);
  const csrf = csrfFromCookies(
    (cfg.headers["set-cookie"] as unknown as string[] | undefined) ?? [],
  ) as string;
  const login = await agent
    .post("/api/login")
    .set("x-csrf-token", csrf)
    .send({ email: USER.email, password: "correct horse battery" })
    .expect(200);

  const resume = await agent.get(new URL(login.body.redirect_to as string).pathname).expect(303);
  const code = new URL(resume.headers["location"] as string).searchParams.get("code") as string;

  const exchange = await agent
    .post("/token")
    .type("form")
    .send({
      grant_type: "authorization_code",
      code,
      redirect_uri: APP_REDIRECT_URI,
      client_id: "app",
      code_verifier: pkce.verifier,
    })
    .expect(200);

  return { agent, tokens: exchange.body as TokenResponse };
}

describe("sid claim", () => {
  it("is present and identical in the access token and the id_token", async () => {
    const { tokens } = await signIn();
    expect(tokens.id_token).toBeTruthy();

    const access = decodeJwt(tokens.access_token);
    const id = decodeJwt(tokens.id_token as string);

    expect(typeof access["sid"], "access token must carry sid").toBe("string");
    expect(typeof id["sid"], "id_token must carry sid").toBe("string");
    expect(access["sid"]).toBe(id["sid"]);
  });
});

describe("RP-initiated /end_session", () => {
  it("makes the old refresh token unusable", async () => {
    const { agent, tokens } = await signIn();
    const idToken = tokens.id_token as string;

    const page = await agent
      .get("/end_session")
      .query({
        id_token_hint: idToken,
        post_logout_redirect_uri: "https://auth.tezzeract.com/signed-out",
        state: "app",
      })
      .expect(200);

    const xsrf = /name="xsrf" value="([^"]+)"/.exec(page.text)?.[1];
    expect(xsrf, "logout form must carry the provider xsrf field").toBeTruthy();

    const confirm = await agent
      .post("/end_session/confirm")
      .type("form")
      .send({ xsrf, logout: "yes" });
    expect([302, 303]).toContain(confirm.status);

    const refreshed = await agent.post("/token").type("form").send({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token as string,
      client_id: "app",
    });

    expect(refreshed.status).toBe(400);
    expect(refreshed.body.error).toBe("invalid_grant");
  });
});
