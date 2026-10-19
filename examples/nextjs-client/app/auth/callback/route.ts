import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRemoteJWKSet, jwtVerify } from "jose";

const AUTH_ISSUER = process.env.AUTH_ISSUER!;
const CLIENT_ID = process.env.AUTH_CLIENT_ID!;
const REDIRECT_URI = process.env.AUTH_REDIRECT_URI!;

// Module-scope: createRemoteJWKSet caches the key set and refetches only on
// an unknown kid, which is what makes key rotation invisible here.
const JWKS = createRemoteJWKSet(new URL(`${AUTH_ISSUER}/jwks`));

export async function GET(req: NextRequest): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL("/login?error=auth_failed", req.url));
  }

  const cookieStore = await cookies();
  const expectedState = cookieStore.get("oauth_state")?.value;
  const codeVerifier = cookieStore.get("pkce_verifier")?.value;

  // State mismatch = CSRF on the OAuth flow itself. Missing verifier means
  // the cookie expired or this isn't a real callback.
  if (!code || !state || !expectedState || !codeVerifier || state !== expectedState) {
    return NextResponse.redirect(new URL("/login?error=invalid_state", req.url));
  }

  const tokenRes = await fetch(`${AUTH_ISSUER}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: codeVerifier,
    }),
  });

  if (!tokenRes.ok) {
    return NextResponse.redirect(new URL("/login?error=token_exchange_failed", req.url));
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    id_token: string;
    expires_in: number;
  };

  // Verify the access token against this service's published keys — no
  // network call back to auth.tezzeract.dev needed after this.
  const { payload: claims } = await jwtVerify(tokens.access_token, JWKS, {
    issuer: AUTH_ISSUER,
    audience: CLIENT_ID,
  });

  // `memberships`/`standing` on `claims` are a HINT, valid for the life of
  // this access token (<=15 min) — re-check before any consequential action.
  // See the auth repo README, "Memberships are a hint".

  const res = NextResponse.redirect(new URL("/", req.url));

  // Replace with your own session mechanism. Shown here as an example only:
  // storing the provider's tokens directly in HttpOnly cookies. A more
  // typical setup mints its own session id/JWT after reading `claims`.
  res.cookies.set("access_token", tokens.access_token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: tokens.expires_in,
  });
  if (tokens.refresh_token) {
    res.cookies.set("refresh_token", tokens.refresh_token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 14, // matches RefreshToken ttl server-side
    });
  }
  res.cookies.set("id_token", tokens.id_token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: tokens.expires_in,
  });

  res.cookies.delete("pkce_verifier");
  res.cookies.delete("oauth_state");

  return res;
}
