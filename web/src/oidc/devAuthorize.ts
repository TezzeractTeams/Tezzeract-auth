/**
 * Start an OIDC authorization request from the login UI (development only).
 * Mirrors what a product app does before sending the user to /login.
 */

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

export async function startDevAuthorize(redirectUri: string): Promise<void> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64Url(new Uint8Array(digest));

  const params = new URLSearchParams({
    client_id: "app",
    response_type: "code",
    redirect_uri: redirectUri,
    scope: "openid email profile offline_access",
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  window.location.assign(`/authorize?${params.toString()}`);
}
