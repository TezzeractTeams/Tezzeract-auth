import { z } from "zod";

/**
 * Environment parsing. Fails fast and loudly at startup rather than letting a
 * missing secret surface as a confusing runtime error on the first login.
 *
 * Nothing in this module reads a default for a secret. A secret that is absent
 * is a crash, never a fallback.
 */

const BooleanFromEnv = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");

/** An absolute https origin with no path, used as the OIDC issuer. */
const IssuerSchema = z
  .string()
  .url()
  .superRefine((value, ctx) => {
    const url = new URL(value);
    if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "AUTH_ISSUER must be a bare origin, e.g. https://auth.tezzeract.com",
      });
    }
  })
  .transform((value) => new URL(value).origin);

/**
 * Signing keys, as a base64-encoded JSON array of private JWKs.
 *
 * The first key signs new tokens; any further keys are still published at
 * /jwks so tokens signed before a rotation keep verifying. Two entries is the
 * steady state during a rotation. See the README section "Rotating keys".
 */
const SigningKeysSchema = z
  .string()
  .min(1)
  .transform((value, ctx): unknown[] => {
    let decoded: string;
    try {
      decoded = Buffer.from(value, "base64").toString("utf8");
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must be base64" });
      return z.NEVER;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(decoded);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "must decode to a JSON array of JWKs",
      });
      return z.NEVER;
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "must be a non-empty JSON array of JWKs",
      });
      return z.NEVER;
    }
    if (parsed.length > 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "at most two keys may be active at once",
      });
      return z.NEVER;
    }
    return parsed as unknown[];
  })
  .pipe(
    z
      .array(
        z
          .object({
            kty: z.enum(["RSA", "EC"]),
            kid: z.string().min(1, "every signing key needs a kid so /jwks is addressable"),
            alg: z.enum(["RS256", "ES256"]).optional(),
          })
          .passthrough(),
      )
      .min(1)
      .max(2),
  );

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),

    /** Public origin of this service. Becomes the `iss` claim. */
    AUTH_ISSUER: IssuerSchema,

    /** Postgres: OIDC provider storage, sessions, rate limits, memberships. */
    DATABASE_URL: z.string().min(1).startsWith("postgres"),

    /** Supabase Auth, the credential store. Server-side only. */
    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

    /** Separate secrets so rotating one does not invalidate the other. */
    COOKIE_SECRET: z.string().min(32, "COOKIE_SECRET must be at least 32 characters"),
    CSRF_SECRET: z.string().min(32, "CSRF_SECRET must be at least 32 characters"),

    OIDC_SIGNING_KEYS: SigningKeysSchema,

    /** Access token lifetime, seconds. Kept short; memberships are a hint. */
    ACCESS_TOKEN_TTL: z.coerce.number().int().min(300).max(900).default(900),

    /**
     * Permits http://localhost redirect URIs in the client registry.
     * Refused outright when NODE_ENV is production, below.
     */
    ALLOW_LOCALHOST_CLIENTS: BooleanFromEnv.default("false"),

    /** Number of proxy hops to trust for req.ip. Wrong value breaks per-IP limits. */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && env.ALLOW_LOCALHOST_CLIENTS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ALLOW_LOCALHOST_CLIENTS"],
        message: "localhost redirect URIs cannot be enabled in production",
      });
    }
    if (env.NODE_ENV === "production" && !env.AUTH_ISSUER.startsWith("https://")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["AUTH_ISSUER"],
        message: "AUTH_ISSUER must be https in production",
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

/** Env var names that must never reach a log line or an error message. */
export const SECRET_ENV_KEYS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "COOKIE_SECRET",
  "CSRF_SECRET",
  "OIDC_SIGNING_KEYS",
  "DATABASE_URL",
] as const;

/**
 * Parse the environment, or throw with a report naming every problem at once.
 *
 * The report lists variable names and the reason only. It never echoes a
 * value, because a malformed secret is still a secret.
 */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (result.success) return result.data;

  const lines = result.error.issues.map((issue) => {
    const name = issue.path.join(".") || "(root)";
    return `  - ${name}: ${issue.message}`;
  });
  throw new Error(
    `Invalid environment configuration:\n${lines.join("\n")}\n\nSee .env.example for the full list.`,
  );
}

let cached: Env | undefined;

/** The parsed environment. Memoised so startup validation runs exactly once. */
export function env(): Env {
  cached ??= parseEnv();
  return cached;
}

/** Test seam: drop the memoised env so a test can re-parse a fresh one. */
export function resetEnvForTests(): void {
  cached = undefined;
}

export const isProduction = (): boolean => env().NODE_ENV === "production";
