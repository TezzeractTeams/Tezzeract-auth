import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createLocalJWKSet, jwtVerify, decodeJwt } from "jose";
import { applyTestEnv } from "./helpers/env.js";

/**
 * End-to-end: a client starts /authorize, the user signs in, a code comes
 * back, it is exchanged for tokens, and the access token verifies against
 * /jwks. Plus the flow-level security properties: PKCE is mandatory, the
 * redirect allowlist is exact, and a reused refresh token kills the grant.
 *
 * The provider runs on its in-memory adapter (see helpers/app.ts); the
 * Supabase credential store and the Postgres-backed modules are stubbed, so
 * this suite needs neither a database nor a network.
 */

applyTestEnv({ ALLOW_LOCALHOST_CLIENTS: "false" });

const USER = {
  userId: "11111111-1111-4111-8111-111111111111",
  email: "ada@tezzeract.com",
  name: "Ada Lovelace",
  emailVerified: true,
};

const ORG_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

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
  getMemberships: vi.fn(async () => [{ orgId: ORG_ID, role: "admin" }]),
  getStanding: vi.fn(async () => "active"),
  getSnapshot: vi.fn(async () => ({
    memberships: [{ orgId: ORG_ID, role: "admin" }],
    standing: "active",
  })),
}));

// The limiter needs Postgres; its own behaviour is covered elsewhere.
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

let app: Awaited<ReturnType<typeof createTestApp>>["app"];

beforeAll(() => {
  app = createTestApp().app;
});

/** Seed the CSRF cookie the way every screen does, and return the token. */
async function seedCsrf(agent: Agent): Promise<string> {
  const response = await agent.get("/api/client-config?client_id=app").expect(200);
  const token = csrfFromCookies(
    (response.headers["set-cookie"] as unknown as string[] | undefined) ?? [],
  );
  expect(token, "client-config must seed the CSRF cookie").toBeDefined();
  return token as string;
}

/** Start an authorization request and return the interaction uid. */
async function startAuthorize(agent: Agent, challenge: string): Promise<string> {
  const response = await agent.get(`/authorize?${authorizeQuery(challenge)}`).expect(303);
  const location = response.headers["location"] as string;
  expect(location).toMatch(/^\/login\?/);
  const uid = new URLSearchParams(location.slice(location.indexOf("?"))).get("interaction");
  expect(uid).toBeTruthy();
  return uid as string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  token_type: string;
  expires_in: number;
}

describe("the happy path, end to end", () => {
  let tokens: TokenResponse;
  let jwks: { keys: unknown[] };

  it("completes authorize, login, code exchange and JWKS verification", async () => {
    const agent = request.agent(app);
    const pkce = makePkce();

    // 1. The client starts an authorization request.
    await startAuthorize(agent, pkce.challenge);

    // 2. The user signs in. The response is JSON; the frontend only ever
    //    calls location.assign on redirect_to.
    const csrf = await seedCsrf(agent);
    const login = await agent
      .post("/api/login")
      .set("x-csrf-token", csrf)
      .send({ email: USER.email, password: "correct horse battery" })
      .expect(200);

    expect(login.body).toHaveProperty("redirect_to");
    const redirectTo = login.body.redirect_to as string;

    // 3. Resuming the interaction yields the authorization code.
    const resume = await agent.get(new URL(redirectTo).pathname).expect(303);
    const callback = new URL(resume.headers["location"] as string);

    expect(`${callback.origin}${callback.pathname}`).toBe(APP_REDIRECT_URI);
    expect(callback.searchParams.get("state")).toBe("state-value");
    const code = callback.searchParams.get("code");
    expect(code).toBeTruthy();

    // 4. Exchange the code, proving possession of the PKCE verifier.
    const exchange = await agent
      .post("/token")
      .type("form")
      .send({
        grant_type: "authorization_code",
        code: code as string,
        redirect_uri: APP_REDIRECT_URI,
        client_id: "app",
        code_verifier: pkce.verifier,
      })
      .expect(200);

    tokens = exchange.body as TokenResponse;
    expect(tokens.token_type).toBe("Bearer");
    expect(tokens.refresh_token, "offline_access was requested").toBeTruthy();

    // An access token short enough that a stale membership claim cannot
    // outlive the window the README documents.
    expect(tokens.expires_in).toBeLessThanOrEqual(900);

    // 5. Verify against /jwks alone — no call back to this service.
    const jwksResponse = await agent.get("/jwks").expect(200);
    jwks = jwksResponse.body as { keys: unknown[] };
    expect(jwks.keys.length).toBeGreaterThan(0);

    const { payload, protectedHeader } = await jwtVerify(
      tokens.access_token,
      createLocalJWKSet(jwks as never),
      { issuer: "https://auth.tezzeract.com", audience: "app" },
    );

    expect(protectedHeader.alg).toBe("ES256");
    expect(payload.sub).toBe(USER.userId);
    expect(payload.aud).toBe("app");
  });

  it("publishes no private key material at /jwks", async () => {
    for (const key of jwks.keys as Record<string, unknown>[]) {
      // `d` is the private scalar for EC, and would make the token forgeable.
      expect(key).not.toHaveProperty("d");
      expect(key).toHaveProperty("kid");
    }
  });

  it("issues the claims other products are promised, validated by the contract", async () => {
    const { AccessTokenClaimsSchema } = await import("../src/contracts/claims.js");
    const parsed = AccessTokenClaimsSchema.safeParse(decodeJwt(tokens.access_token));

    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.email).toBe(USER.email);
    expect(parsed.data.name).toBe(USER.name);
    expect(parsed.data.standing).toBe("active");
    expect(parsed.data.memberships).toEqual([{ orgId: ORG_ID, role: "admin" }]);
  });

  it("does not let extra claims overwrite the registered ones", () => {
    const claims = decodeJwt(tokens.access_token);
    expect(claims.iss).toBe("https://auth.tezzeract.com");
    expect(claims.aud).toBe("app");
    expect(typeof claims.exp).toBe("number");
  });
});

describe("PKCE is mandatory", () => {
  it("refuses an authorization request with no code_challenge", async () => {
    const agent = request.agent(app);
    const response = await agent
      .get(
        `/authorize?${authorizeQuery("", { code_challenge: undefined, code_challenge_method: undefined })}`,
      )
      .expect(303);

    const location = new URL(response.headers["location"] as string);
    expect(location.searchParams.get("error")).toBe("invalid_request");
    expect(location.searchParams.get("error_description")).toMatch(/PKCE/i);
  });

  it("refuses the plain challenge method, leaving S256 as the only option", async () => {
    const agent = request.agent(app);
    const { verifier } = makePkce();
    const response = await agent
      .get(`/authorize?${authorizeQuery(verifier, { code_challenge_method: "plain" })}`)
      .expect(303);

    const location = new URL(response.headers["location"] as string);
    expect(location.searchParams.get("error")).toBe("invalid_request");
  });

  it("refuses a code exchange with the wrong verifier", async () => {
    const agent = request.agent(app);
    const pkce = makePkce();
    const other = makePkce();

    await startAuthorize(agent, pkce.challenge);
    const csrf = await seedCsrf(agent);
    const login = await agent
      .post("/api/login")
      .set("x-csrf-token", csrf)
      .send({ email: USER.email, password: "correct horse battery" })
      .expect(200);

    const resume = await agent.get(new URL(login.body.redirect_to as string).pathname).expect(303);
    const code = new URL(resume.headers["location"] as string).searchParams.get("code");

    const exchange = await agent
      .post("/token")
      .type("form")
      .send({
        grant_type: "authorization_code",
        code: code as string,
        redirect_uri: APP_REDIRECT_URI,
        client_id: "app",
        code_verifier: other.verifier,
      })
      .expect(400);

    expect(exchange.body.error).toBe("invalid_grant");
  });
});

describe("the redirect allowlist is exact", () => {
  const nearMisses = [
    "https://app.tezzeract.com/auth/callback/",
    "https://app.tezzeract.com/auth/callback?next=https://evil.example",
    "https://app.tezzeract.com.evil.example/auth/callback",
    "http://app.tezzeract.com/auth/callback",
    "https://talk.tezzeract.com/auth/callback",
    "http://localhost:5173/auth/callback",
  ];

  it.each(nearMisses)("refuses %s", async (redirectUri) => {
    const agent = request.agent(app);
    const { challenge } = makePkce();

    // A bad redirect_uri cannot be reported back to it, so the provider must
    // not redirect: it renders an error instead, which our config turns into
    // a hand-off to the /error screen.
    const response = await agent.get(
      `/authorize?${authorizeQuery(challenge, { redirect_uri: redirectUri })}`,
    );

    expect(response.status).toBe(303);
    const location = response.headers["location"] as string;
    expect(location, redirectUri).toMatch(/^\/error\?/);
    // Whatever happens, the browser is never sent to the unregistered URI.
    expect(location).not.toContain("evil.example");
    expect(location).not.toContain("localhost:5173");
  });

  it("accepts the exact registered URI", async () => {
    const agent = request.agent(app);
    const { challenge } = makePkce();
    const response = await agent.get(`/authorize?${authorizeQuery(challenge)}`).expect(303);
    expect(response.headers["location"]).toMatch(/^\/login\?/);
  });
});

describe("refresh token rotation and reuse detection", () => {
  async function signInAndGetTokens(): Promise<{ agent: Agent; tokens: TokenResponse }> {
    const agent = request.agent(app);
    const pkce = makePkce();

    await startAuthorize(agent, pkce.challenge);
    const csrf = await seedCsrf(agent);
    const login = await agent
      .post("/api/login")
      .set("x-csrf-token", csrf)
      .send({ email: USER.email, password: "correct horse battery" })
      .expect(200);

    const resume = await agent.get(new URL(login.body.redirect_to as string).pathname).expect(303);
    const code = new URL(resume.headers["location"] as string).searchParams.get("code");

    const exchange = await agent
      .post("/token")
      .type("form")
      .send({
        grant_type: "authorization_code",
        code: code as string,
        redirect_uri: APP_REDIRECT_URI,
        client_id: "app",
        code_verifier: pkce.verifier,
      })
      .expect(200);

    return { agent, tokens: exchange.body as TokenResponse };
  }

  const refresh = (agent: Agent, token: string) =>
    agent
      .post("/token")
      .type("form")
      .send({ grant_type: "refresh_token", refresh_token: token, client_id: "app" });

  it("returns a different refresh token on every exchange", async () => {
    const { agent, tokens } = await signInAndGetTokens();
    const first = tokens.refresh_token as string;

    const rotated = await refresh(agent, first).expect(200);
    const second = rotated.body.refresh_token as string;

    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    expect(rotated.body.access_token).toBeTruthy();
  });

  it("rejects a rotated token and revokes the whole grant", async () => {
    const { agent, tokens } = await signInAndGetTokens();
    const first = tokens.refresh_token as string;

    const rotated = await refresh(agent, first).expect(200);
    const second = rotated.body.refresh_token as string;

    // Replaying the consumed token is the signal that it leaked.
    const replay = await refresh(agent, first).expect(400);
    expect(replay.body.error).toBe("invalid_grant");

    // The grant is gone, so the token the legitimate client holds is dead
    // too. That is the intended outcome: the session must be re-established
    // rather than left usable alongside a stolen copy.
    const afterRevocation = await refresh(agent, second).expect(400);
    expect(afterRevocation.body.error).toBe("invalid_grant");
  });

  it("refuses an authorization code the second time it is presented", async () => {
    const agent = request.agent(app);
    const pkce = makePkce();

    await startAuthorize(agent, pkce.challenge);
    const csrf = await seedCsrf(agent);
    const login = await agent
      .post("/api/login")
      .set("x-csrf-token", csrf)
      .send({ email: USER.email, password: "correct horse battery" })
      .expect(200);

    const resume = await agent.get(new URL(login.body.redirect_to as string).pathname).expect(303);
    const code = new URL(resume.headers["location"] as string).searchParams.get("code") as string;

    const body = {
      grant_type: "authorization_code",
      code,
      redirect_uri: APP_REDIRECT_URI,
      client_id: "app",
      code_verifier: pkce.verifier,
    };

    await agent.post("/token").type("form").send(body).expect(200);
    const replay = await agent.post("/token").type("form").send(body).expect(400);
    expect(replay.body.error).toBe("invalid_grant");
  });
});

describe("flows that must not exist", () => {
  it("has no password grant", async () => {
    const response = await request(app)
      .post("/token")
      .type("form")
      .send({
        grant_type: "password",
        username: USER.email,
        password: "correct horse battery",
        client_id: "app",
      })
      .expect(400);

    expect(response.body.error).toBe("unsupported_grant_type");
  });

  it("has no implicit flow", async () => {
    const { challenge } = makePkce();
    const response = await request(app)
      .get(`/authorize?${authorizeQuery(challenge, { response_type: "token id_token" })}`)
      .expect(303);

    // An implicit-style request is answered in the fragment, which is where
    // the token would have been returned had the flow been enabled.
    const location = new URL(response.headers["location"] as string);
    const fragment = new URLSearchParams(location.hash.slice(1));
    expect(fragment.get("error")).toBe("unsupported_response_type");
    expect(fragment.get("access_token")).toBeNull();
    expect(fragment.get("id_token")).toBeNull();
  });

  it("exposes no introspection endpoint, so verification must use /jwks", async () => {
    const discovery = await request(app).get("/.well-known/openid-configuration").expect(200);
    expect(discovery.body).not.toHaveProperty("introspection_endpoint");
    // The host in a discovery URL comes from the request, which is correct
    // behind the real proxy and is 127.0.0.1 under supertest; the paths are
    // what this assertion is about.
    expect(new URL(discovery.body.jwks_uri as string).pathname).toBe("/jwks");
    expect(new URL(discovery.body.authorization_endpoint as string).pathname).toBe("/authorize");
    expect(new URL(discovery.body.userinfo_endpoint as string).pathname).toBe("/userinfo");
    expect(discovery.body.code_challenge_methods_supported).toEqual(["S256"]);
    expect(discovery.body.response_types_supported).toEqual(["code"]);
  });

  it("serves the provider's dev interaction screens nowhere", async () => {
    const response = await request(app).get("/interaction/whatever");
    expect(response.status).not.toBe(200);
  });
});

describe("security headers", () => {
  it("sends a strict CSP with no inline escape hatch", async () => {
    const response = await request(app).get("/api/client-config").expect(200);
    const csp = response.headers["content-security-policy"] as string;

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("marks every response noindex and uncacheable", async () => {
    const response = await request(app).get("/api/client-config").expect(200);
    expect(response.headers["x-robots-tag"]).toMatch(/noindex/);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });
});

describe("CSRF protection", () => {
  beforeEach(() => undefined);

  it("rejects a state-changing request with no token", async () => {
    const agent = request.agent(app);
    await seedCsrf(agent);

    const response = await agent
      .post("/api/login")
      .send({ email: USER.email, password: "correct horse battery" })
      .expect(403);

    expect(response.body.error.code).toBe("csrf_failed");
  });

  it("rejects a forged token", async () => {
    const agent = request.agent(app);
    await seedCsrf(agent);

    const response = await agent
      .post("/api/login")
      .set("x-csrf-token", "not-the-real-token")
      .send({ email: USER.email, password: "correct horse battery" })
      .expect(403);

    expect(response.body.error.code).toBe("csrf_failed");
  });

  it("guards every state-changing endpoint, not just login", async () => {
    const agent = request.agent(app);
    await seedCsrf(agent);

    for (const path of [
      "/api/signup",
      "/api/forgot-password",
      "/api/reset-password",
      "/api/mfa/verify",
      "/api/resend-verification",
      "/api/logout",
    ]) {
      const response = await agent.post(path).send({});
      expect(response.status, path).toBe(403);
    }
  });
});
