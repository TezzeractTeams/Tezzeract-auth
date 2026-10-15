import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CLIENT_ID,
  findClient,
  getClientConfig,
  isAllowedPostLogoutRedirectUri,
  isAllowedRedirectUri,
  listClients,
} from "../src/services/clients.js";
import { applyTestEnv } from "./helpers/env.js";

describe("client registry", () => {
  beforeEach(() => applyTestEnv());

  it("seeds app, talk and contelli", () => {
    expect(
      listClients()
        .map((c) => c.client_id)
        .sort(),
    ).toEqual(["app", "contelli", "talk"]);
  });

  it("defaults to the Tezzeract app when no client_id is given", () => {
    expect(findClient(undefined)?.client_id).toBe(DEFAULT_CLIENT_ID);
    expect(getClientConfig(undefined).name).toBe("Tezzeract");
  });

  it("falls back to Tezzeract branding for an unknown client_id", () => {
    expect(getClientConfig("not-a-real-client").name).toBe("Tezzeract");
  });

  it("exposes only branding fields to the browser", () => {
    expect(Object.keys(getClientConfig("talk")).sort()).toEqual(["accentColor", "logoUrl", "name"]);
  });
});

describe("redirect_uri matching", () => {
  beforeEach(() => applyTestEnv());

  it("accepts an exact registered URI", () => {
    expect(isAllowedRedirectUri("app", "https://app.tezzeract.com/auth/callback")).toBe(true);
  });

  it("rejects anything that is not an exact string match", () => {
    const nearMisses = [
      // trailing slash
      "https://app.tezzeract.com/auth/callback/",
      // prefix match
      "https://app.tezzeract.com/auth/callback/../evil",
      // open redirect via a path suffix
      "https://app.tezzeract.com/auth/callback?next=https://evil.example",
      // subdomain that merely starts with the registered host
      "https://app.tezzeract.com.evil.example/auth/callback",
      // scheme downgrade
      "http://app.tezzeract.com/auth/callback",
      // userinfo trick
      "https://app.tezzeract.com@evil.example/auth/callback",
      // case change in the path
      "https://app.tezzeract.com/auth/Callback",
      // another registered client's URI
      "https://talk.tezzeract.com/auth/callback",
      // bare origin
      "https://app.tezzeract.com",
    ];
    for (const uri of nearMisses) {
      expect(isAllowedRedirectUri("app", uri), uri).toBe(false);
    }
  });

  it("rejects every URI for an unregistered client", () => {
    expect(isAllowedRedirectUri("ghost", "https://app.tezzeract.com/auth/callback")).toBe(false);
  });

  it("keeps post-logout URIs on a separate allowlist", () => {
    expect(isAllowedPostLogoutRedirectUri("app", "https://app.tezzeract.com/")).toBe(true);
    // A valid login callback is not automatically a valid logout destination.
    expect(isAllowedPostLogoutRedirectUri("app", "https://app.tezzeract.com/auth/callback")).toBe(
      false,
    );
  });
});

describe("localhost callbacks", () => {
  it("are absent unless ALLOW_LOCALHOST_CLIENTS is set", () => {
    applyTestEnv();
    expect(isAllowedRedirectUri("app", "http://localhost:5173/auth/callback")).toBe(false);
  });

  it("are added in development when the flag is set", () => {
    applyTestEnv({ ALLOW_LOCALHOST_CLIENTS: "true" });
    expect(isAllowedRedirectUri("app", "http://localhost:5173/auth/callback")).toBe(true);
    // Still exact-match only.
    expect(isAllowedRedirectUri("app", "http://localhost:5173/auth/callback/")).toBe(false);
    expect(isAllowedRedirectUri("app", "http://localhost:3000/auth/callback")).toBe(false);
  });
});
