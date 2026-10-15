import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { applyTestEnv } from "./helpers/env.js";

/**
 * One origin has to serve three things: the OIDC endpoints, the /api surface
 * and the built frontend. The provider is a Koa callback that answers 404 for
 * anything it does not route, so mounting it carelessly makes every SPA route
 * disappear. These tests pin that the three coexist.
 */

applyTestEnv();

vi.mock("../src/services/ratelimit.js", () => ({
  consume: vi.fn(async () => ({ allowed: true, remaining: 9, retryAfterSeconds: 0 })),
  lockoutRemaining: vi.fn(async () => 0),
  recordFailure: vi.fn(async () => 0),
  recordSuccess: vi.fn(async () => undefined),
  sweepExpired: vi.fn(async () => undefined),
}));
vi.mock("../src/services/credentials.js", () => ({
  credentials: { authenticate: vi.fn(), getUser: vi.fn() },
}));
vi.mock("../src/db/pool.js", () => ({
  query: vi.fn(async () => []),
  getPool: vi.fn(),
  transaction: vi.fn(),
  closePool: vi.fn(async () => undefined),
}));

const { createTestApp } = await import("./helpers/app.js");
const { createApp } = await import("../src/http/app.js");

const WEB_DIST = resolve(import.meta.dirname, "../../web/dist");
const hasBuild = existsSync(resolve(WEB_DIST, "index.html"));

describe("serving the frontend alongside the OIDC endpoints", () => {
  const itWithBuild = hasBuild ? it : it.skip;

  function appWithWeb() {
    const { provider } = createTestApp();
    return createApp({ provider, webDistPath: WEB_DIST, version: "test" });
  }

  itWithBuild("serves the SPA for every screen route", async () => {
    const app = appWithWeb();

    for (const path of [
      "/login",
      "/signup",
      "/forgot-password",
      "/reset-password",
      "/verify-email",
      "/mfa",
      "/logout",
      "/error",
    ]) {
      const response = await request(app).get(path);
      expect(response.status, path).toBe(200);
      expect(response.headers["content-type"], path).toMatch(/text\/html/);
      expect(response.text, path).toContain('<div id="root">');
    }
  });

  itWithBuild("keeps the OIDC endpoints working with the frontend mounted", async () => {
    const app = appWithWeb();

    const discovery = await request(app).get("/.well-known/openid-configuration").expect(200);
    expect(discovery.body.issuer).toBe("https://auth.tezzeract.com");

    await request(app).get("/jwks").expect(200);
  });

  itWithBuild("keeps /api returning JSON, not the SPA shell", async () => {
    const app = appWithWeb();
    const response = await request(app).get("/api/client-config").expect(200);
    expect(response.headers["content-type"]).toMatch(/application\/json/);
    expect(response.body.name).toBe("Tezzeract");
  });

  itWithBuild("serves index.html uncached so a deploy takes effect at once", async () => {
    const response = await request(appWithWeb()).get("/login").expect(200);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  itWithBuild("marks the index noindex in both the header and the markup", async () => {
    const response = await request(appWithWeb()).get("/login").expect(200);
    expect(response.headers["x-robots-tag"]).toMatch(/noindex/);
    expect(response.text).toMatch(/<meta name="robots" content="noindex/);
  });

  it("reports healthy when the database answers", async () => {
    const { provider } = createTestApp();
    const app = createApp({ provider, serveWeb: false, version: "test" });

    const response = await request(app).get("/healthz").expect(200);
    expect(response.body).toEqual({ status: "ok", version: "test", checks: { database: "ok" } });
  });
});
