import { describe, expect, it } from "vitest";
import {
  PRESERVED_PARAMS,
  extractParams,
  toSearch,
  withParams,
  clientIdFrom,
} from "../oidc/params";
import { clientIdFromLogoutState } from "../oidc/signedOut";

/**
 * The OIDC parameters have to survive the walk from /login to /signup to
 * /forgot-password and back, and nothing else may ride along with them.
 */
describe("preserving OIDC parameters", () => {
  it("keeps the parameters a journey depends on", () => {
    const params = extractParams("?interaction=abc123&client_id=talk&login_hint=a@b.com");
    expect(params).toEqual({
      interaction: "abc123",
      client_id: "talk",
      login_hint: "a@b.com",
    });
  });

  it("reattaches them to an in-app path", () => {
    expect(withParams("/signup", "?interaction=abc123&client_id=talk")).toBe(
      "/signup?interaction=abc123&client_id=talk",
    );
  });

  it("survives a round trip through every screen", () => {
    const original = "?interaction=abc123&client_id=contelli";
    let search = original;
    for (const path of ["/signup", "/forgot-password", "/login", "/mfa"] as const) {
      search = new URL(withParams(path, search), "https://auth.tezzeract.com").search;
    }
    expect(extractParams(search)).toEqual({
      interaction: "abc123",
      client_id: "contelli",
    });
  });

  it("produces no query suffix when there is nothing to preserve", () => {
    expect(withParams("/login", "")).toBe("/login");
    expect(toSearch({})).toBe("");
  });

  it("never carries redirect_uri, which the frontend must not handle at all", () => {
    expect(PRESERVED_PARAMS).not.toContain("redirect_uri");
    const params = extractParams(
      "?interaction=abc&redirect_uri=https://evil.example&post_logout_redirect_uri=https://evil.example",
    );
    expect(params).toEqual({ interaction: "abc" });
  });

  it("drops anything not on the allowlist, so a crafted link cannot propagate", () => {
    const params = extractParams(
      "?interaction=abc&utm_source=x&next=https://evil.example&__proto__=y&token=secret",
    );
    expect(params).toEqual({ interaction: "abc" });
  });

  it("rejects values carrying control characters or newlines", () => {
    expect(extractParams("?client_id=app%0d%0aSet-Cookie:%20a=b")).toEqual({});
    expect(extractParams("?client_id=app\u0000")).toEqual({});
  });

  it("rejects an absurdly long value rather than growing every URL", () => {
    expect(extractParams(`?client_id=${"a".repeat(600)}`)).toEqual({});
  });

  it("treats an absent client_id as the default rather than an error", () => {
    expect(clientIdFrom("?interaction=abc")).toBeUndefined();
    expect(clientIdFrom("?client_id=talk")).toBe("talk");
  });

  it("escapes a value when serialising, so it cannot break out of the query", () => {
    expect(withParams("/login", "?client_id=a%26prompt%3Dnone")).toBe(
      "/login?client_id=a%26prompt%3Dnone",
    );
  });
});

describe("logout state as client_id", () => {
  it("accepts a registered client_id in state", () => {
    expect(clientIdFromLogoutState("?state=drive")).toBe("drive");
  });

  it("rejects values that are not a client_id", () => {
    expect(clientIdFromLogoutState("?state=https://evil.example")).toBeUndefined();
    expect(clientIdFromLogoutState("?state=")).toBeUndefined();
  });
});
