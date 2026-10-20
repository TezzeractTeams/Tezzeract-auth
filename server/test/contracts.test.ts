import { describe, expect, it } from "vitest";
import {
  AccessTokenClaimsSchema,
  ClientRecordSchema,
  HexColorSchema,
  LoginRequestSchema,
  MfaCodeSchema,
  SignupRequestSchema,
} from "../src/contracts/index.js";

describe("request contracts", () => {
  it("normalises email casing and whitespace so rate-limit keys agree", () => {
    const parsed = LoginRequestSchema.parse({
      email: "  Shanilka@Tezzeract.com ",
      password: "correct horse battery",
    });
    expect(parsed.email).toBe("shanilka@tezzeract.com");
  });

  it("rejects unknown fields rather than dropping them", () => {
    const result = LoginRequestSchema.safeParse({
      email: "a@b.com",
      password: "correct horse battery",
      role: "admin",
    });
    expect(result.success).toBe(false);
  });

  it("rejects passwords below the minimum length", () => {
    const result = SignupRequestSchema.safeParse({
      name: "Ada",
      email: "a@b.com",
      password: "short",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a pasted MFA code with whitespace", () => {
    expect(MfaCodeSchema.parse("123 456")).toBe("123456");
    expect(MfaCodeSchema.safeParse("12345").success).toBe(false);
    expect(MfaCodeSchema.safeParse("12345a").success).toBe(false);
  });
});

describe("client registry contract", () => {
  it("accepts a six-digit hex accent colour", () => {
    expect(HexColorSchema.parse("#009BE9")).toBe("#009BE9");
  });

  it("rejects an accent colour that could break out of the CSS declaration", () => {
    for (const value of ["red", "#fff", "#009BE9; } html {", "var(--x)"]) {
      expect(HexColorSchema.safeParse(value).success).toBe(false);
    }
  });

  it("rejects redirect URIs with a fragment or a relative form", () => {
    const base = {
      client_id: "app",
      name: "Tezzeract",
      logoUrl: "/logo.svg",
      accentColor: "#009BE9",
    };
    for (const uri of ["/callback", "https://a.example#frag", "javascript:alert(1)"]) {
      const result = ClientRecordSchema.safeParse({ ...base, redirect_uris: [uri] });
      expect(result.success, uri).toBe(false);
    }
    expect(
      ClientRecordSchema.safeParse({
        ...base,
        redirect_uris: ["https://app.tezzeract.com/auth/callback"],
        backchannel_logout_uri: "https://app.tezzeract.com/auth/backchannel-logout",
      }).success,
    ).toBe(true);
  });

  it("requires at least one redirect URI", () => {
    const result = ClientRecordSchema.safeParse({
      client_id: "app",
      name: "Tezzeract",
      logoUrl: "/logo.svg",
      accentColor: "#009BE9",
      redirect_uris: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("access token claims contract", () => {
  const claims = {
    iss: "https://auth.tezzeract.com",
    sub: "user_1",
    aud: "app",
    exp: 1_900_000_000,
    iat: 1_899_999_000,
    email: "a@b.com",
    name: "Ada",
    standing: "active",
    memberships: [{ orgId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301", role: "admin" }],
  };

  it("accepts the claim set this service promises", () => {
    expect(AccessTokenClaimsSchema.parse(claims).memberships).toHaveLength(1);
  });

  it("lets registered provider claims through so valid tokens are not rejected", () => {
    const result = AccessTokenClaimsSchema.safeParse({ ...claims, jti: "x", sid: "y" });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown membership role", () => {
    const result = AccessTokenClaimsSchema.safeParse({
      ...claims,
      memberships: [{ orgId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301", role: "superuser" }],
    });
    expect(result.success).toBe(false);
  });
});
