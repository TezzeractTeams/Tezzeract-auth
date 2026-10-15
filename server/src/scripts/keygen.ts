import { generateSigningKey } from "../oidc/keys.js";

/**
 * Generate a signing key for OIDC_SIGNING_KEYS.
 *
 * Run with: pnpm --filter @tezzeract/auth-server keygen [ES256|RS256]
 *
 * Deliberately a script rather than a runtime capability, so a deployed
 * process has no code path that can mint itself a new signing key. The
 * rotation procedure is in the README under "Rotating keys".
 */
async function main(): Promise<void> {
  const algArg = process.argv[2] ?? "ES256";
  if (algArg !== "ES256" && algArg !== "RS256") {
    process.stderr.write(`Unsupported algorithm "${algArg}". Use ES256 or RS256.\n`);
    process.exit(1);
  }

  const key = await generateSigningKey(algArg);

  // The key goes to stdout so it can be piped; the guidance goes to stderr so
  // it does not contaminate a redirect into a file.
  process.stderr.write(
    [
      `Generated a new ${algArg} signing key (kid: ${key.kid}).`,
      "",
      "This is PRIVATE key material. Put it in your secret store, not in git.",
      "",
      "To rotate, prepend it to the existing array so the new key signs while",
      "the previous one keeps verifying tokens already issued. For a first",
      "key, use the single-element array below.",
      "",
      "OIDC_SIGNING_KEYS=",
    ].join("\n") + "\n",
  );

  process.stdout.write(`${Buffer.from(JSON.stringify([key])).toString("base64")}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
