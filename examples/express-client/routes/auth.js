// Mount with: app.use("/auth", require("./routes/auth"));
// Requires: cookie-parser (app.use(cookieParser())), node >=18 (global fetch), jose.
const express = require("express");
const { createRemoteJWKSet, jwtVerify } = require("jose");
const { generateCodeVerifier, codeChallengeFromVerifier, generateState } = require("../lib/pkce");

const router = express.Router();

const AUTH_ISSUER = process.env.AUTH_ISSUER; // https://auth.tezzeract.dev
const CLIENT_ID = process.env.AUTH_CLIENT_ID; // "app"
const REDIRECT_URI = process.env.AUTH_REDIRECT_URI; // https://app.tezzeract.com/auth/callback
const POST_LOGOUT_LANDING_URI =
  process.env.AUTH_POST_LOGOUT_LANDING_URI ??
  process.env.AUTH_POST_LOGOUT_REDIRECT_URI ??
  `${AUTH_ISSUER.replace(/\/$/, "")}/signed-out`;

// Module-scope: caches the key set, refetches only on an unknown kid, so
// key rotation on the auth server needs no change here.
const JWKS = createRemoteJWKSet(new URL(`${AUTH_ISSUER}/jwks`));

const PKCE_COOKIE_OPTS = { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600_000 };
const SESSION_COOKIE_OPTS = { httpOnly: true, secure: true, sameSite: "lax", path: "/" };

/** GET /auth/login — the React app sends the user here (not an XHR, a full navigation). */
router.get("/login", (req, res) => {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = codeChallengeFromVerifier(codeVerifier);
  const state = generateState();

  res.cookie("pkce_verifier", codeVerifier, PKCE_COOKIE_OPTS);
  res.cookie("oauth_state", state, PKCE_COOKIE_OPTS);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    // offline_access is ignored by the provider unless prompt=consent is set.
    scope: "openid email profile offline_access",
    prompt: "consent",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  res.redirect(`${AUTH_ISSUER}/authorize?${params.toString()}`);
});

/** GET /auth/callback — registered as the exact redirect_uri for this client_id. */
router.get("/callback", async (req, res) => {
  const { code, state, error } = req.query;

  if (error) return res.redirect("/login?error=auth_failed");

  const expectedState = req.cookies.oauth_state;
  const codeVerifier = req.cookies.pkce_verifier;

  if (!code || !state || !expectedState || !codeVerifier || state !== expectedState) {
    return res.redirect("/login?error=invalid_state");
  }

  res.clearCookie("pkce_verifier", { path: "/" });
  res.clearCookie("oauth_state", { path: "/" });

  let tokens;
  try {
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
    if (!tokenRes.ok) throw new Error(`token endpoint ${tokenRes.status}`);
    tokens = await tokenRes.json();
  } catch {
    return res.redirect("/login?error=token_exchange_failed");
  }

  // Verify against this service's own published keys — no further network
  // call to auth.tezzeract.dev needed per request after this.
  let claims;
  try {
    const result = await jwtVerify(tokens.access_token, JWKS, {
      issuer: AUTH_ISSUER,
      audience: CLIENT_ID,
    });
    claims = result.payload;
  } catch {
    return res.redirect("/login?error=invalid_token");
  }

  // `claims.memberships` / `claims.standing` are a HINT, valid only for this
  // token's lifetime (<=15 min). Re-check before any consequential action —
  // see the auth repo README, "Memberships are a hint". Mint your own
  // session however TezzeractltV2 already does it; shown here as the
  // simplest possible example.
  res.cookie("access_token", tokens.access_token, { ...SESSION_COOKIE_OPTS, maxAge: tokens.expires_in * 1000 });
  if (tokens.refresh_token) {
    res.cookie("refresh_token", tokens.refresh_token, { ...SESSION_COOKIE_OPTS, maxAge: 14 * 24 * 60 * 60 * 1000 });
  }
  res.cookie("id_token", tokens.id_token, { ...SESSION_COOKIE_OPTS, maxAge: tokens.expires_in * 1000 });

  res.redirect("/");
});

/** GET /auth/logout — ends the provider's session and revokes refresh tokens from it. */
router.get("/logout", (req, res) => {
  const idToken = req.cookies.id_token;

  res.clearCookie("access_token", { path: "/" });
  res.clearCookie("refresh_token", { path: "/" });
  res.clearCookie("id_token", { path: "/" });

  if (!idToken) return res.redirect("/login");

  const params = new URLSearchParams({
    id_token_hint: idToken,
    post_logout_redirect_uri: POST_LOGOUT_LANDING_URI,
    state: CLIENT_ID,
  });
  res.redirect(`${AUTH_ISSUER}/end_session?${params.toString()}`);
});

module.exports = router;
