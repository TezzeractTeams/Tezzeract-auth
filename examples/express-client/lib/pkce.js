const { randomBytes, createHash } = require("node:crypto");

function base64url(input) {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generateCodeVerifier() {
  return base64url(randomBytes(32));
}

// S256 — the only challenge method this provider accepts.
function codeChallengeFromVerifier(verifier) {
  return base64url(createHash("sha256").update(verifier).digest());
}

function generateState() {
  return base64url(randomBytes(16));
}

module.exports = { generateCodeVerifier, codeChallengeFromVerifier, generateState };
