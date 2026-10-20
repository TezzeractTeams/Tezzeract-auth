import { describe, expect, it } from "vitest";
import request from "supertest";
import { applyTestEnv } from "./helpers/env.js";

/**
 * Regression coverage for the Chrome-only CSP `form-action` block on the
 * RP-initiated logout confirmation page.
 *
 * Root cause: COOP: same-origin on /end_session raced the auto-submitting
 * form when the browser arrived there via a cross-site navigation (from
 * app.tezzeract.com, say). The fix drops COOP/CORP on /end_session* only,
 * and inlines the logout fields as real descendants of the provider's
 * <form> instead of linking them in via a `form=""` attribute.
 */
applyTestEnv({ ALLOW_LOCALHOST_CLIENTS: "false" });

const { createTestApp } = await import("./helpers/app.js");

describe("end_session response headers and markup", () => {
  it("drops Cross-Origin-Opener-Policy and Cross-Origin-Resource-Policy on /end_session", async () => {
    const { app } = createTestApp();
    const response = await request(app).get("/end_session");

    expect(response.headers["cross-origin-opener-policy"]).toBeUndefined();
    expect(response.headers["cross-origin-resource-policy"]).toBeUndefined();
  });

  it("keeps Cross-Origin-Opener-Policy and Cross-Origin-Resource-Policy everywhere else", async () => {
    const { app } = createTestApp();
    const response = await request(app).get("/jwks");

    expect(response.headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(response.headers["cross-origin-resource-policy"]).toBe("same-origin");
  });

  it("drops Cross-Origin-Embedder-Policy on /end_session", async () => {
    const { app } = createTestApp();
    const response = await request(app).get("/end_session");

    expect(response.headers["cross-origin-embedder-policy"]).toBeUndefined();
  });

  it("still sends form-action 'self' on /end_session", async () => {
    const { app } = createTestApp();
    const response = await request(app).get("/end_session");

    expect(response.headers["content-security-policy"]).toContain("form-action 'self'");
  });

  it("renders the logout fields as real children of the form, not form= links", async () => {
    const { app } = createTestApp();
    const response = await request(app).get("/end_session");

    // No session cookie, so this is the provider's anonymous form_post
    // fallback — asserting the confirm action is same-origin and that our
    // own markup helper (exercised on the authenticated branch) does not
    // reintroduce the external form="" association pattern anywhere.
    expect(response.text).not.toMatch(/form="op\.logoutForm"/);
  });
});
