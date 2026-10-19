import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { generateCodeVerifier, codeChallengeFromVerifier, generateState } from "@/lib/auth/pkce";

// Set these per product. client_id must match an entry in clients.seed.ts,
// and redirect_uri must match that entry's redirect_uris EXACTLY (no
// trailing-slash mismatch, no different scheme/host/path).
const AUTH_ISSUER = process.env.AUTH_ISSUER!; // e.g. https://auth.tezzeract.dev
const CLIENT_ID = process.env.AUTH_CLIENT_ID!; // "app" | "talk" | "contelli"
const REDIRECT_URI = process.env.AUTH_REDIRECT_URI!; // e.g. https://app.tezzeract.com/auth/callback

export async function GET(): Promise<Response> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = codeChallengeFromVerifier(codeVerifier);
  const state = generateState();

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    // offline_access + prompt=consent is required to get a refresh token —
    // the provider ignores offline_access otherwise.
    scope: "openid email profile offline_access",
    prompt: "consent",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  const res = NextResponse.redirect(`${AUTH_ISSUER}/authorize?${params.toString()}`);

  const cookieStore = await cookies();
  const cookieOpts = {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600, // the authorize round trip should take seconds, not minutes
  };
  cookieStore.set("pkce_verifier", codeVerifier, cookieOpts);
  cookieStore.set("oauth_state", state, cookieOpts);

  return res;
}
