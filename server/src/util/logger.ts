import pino, { type Logger, stdSerializers } from "pino";

/**
 * Structured logging with redaction enforced at the logger, not at call sites.
 *
 * Call-site discipline does not survive a refactor, so the secret-stripping
 * lives here: anything matching REDACT_PATHS is replaced before a line is
 * serialised, whatever the caller passed. test/log-redaction.test.ts asserts
 * this, so adding a field that leaks will fail the suite.
 */

/**
 * Field names that must never appear in a log line.
 *
 * `*.` wildcards cover one level, and the bare names cover top-level fields,
 * so both `{ password }` and `{ body: { password } }` are caught.
 */
export const REDACT_PATHS = [
  // Credentials and bearer material.
  "password",
  "newPassword",
  "confirmPassword",
  "token",
  "code",
  "access_token",
  "refresh_token",
  "id_token",
  "client_secret",
  "code_verifier",
  "authorization",
  "cookie",
  // Personal data: an email in a log is an account list in a log.
  "email",
  // Request and response shapes produced by pino-http.
  "req.headers.cookie",
  "req.headers.authorization",
  "res.headers['set-cookie']",
  // One nested level for bodies, params and query strings.
  "*.password",
  "*.token",
  "*.code",
  "*.email",
  "*.access_token",
  "*.refresh_token",
  "*.id_token",
  "*.code_verifier",
  "*.client_secret",
  "*.authorization",
  "*.cookie",
] as const;

export const REDACTED = "[redacted]";

/**
 * Query strings can carry a reset token or an email, so the full URL is never
 * logged: only the path, with the parameter names kept for debugging.
 */
export function safeUrl(url: string): string {
  const [path, rawQuery] = url.split("?", 2);
  if (!rawQuery) return path ?? url;
  const names = [...new URLSearchParams(rawQuery).keys()].sort();
  return names.length > 0 ? `${path}?${names.join("&")}=${REDACTED}` : (path ?? url);
}

export function createLogger(options: { level?: string; pretty?: boolean } = {}): Logger {
  return pino({
    level: options.level ?? "info",
    redact: { paths: [...REDACT_PATHS], censor: REDACTED },
    // Never serialise an Error's own enumerable extras blindly; pino's
    // standard error serialiser keeps message/stack/type only.
    serializers: {
      err: stdSerializers.err,
      req: (req: { method?: string; url?: string; id?: string }) => ({
        method: req.method,
        url: typeof req.url === "string" ? safeUrl(req.url) : undefined,
        id: req.id,
      }),
    },
    base: { service: "tezzeract-auth" },
    ...(options.pretty ? { transport: { target: "pino-pretty" } } : {}),
  });
}

/**
 * The process logger. Created from process.env directly rather than the parsed
 * config, so that a configuration failure can still be logged.
 */
export const logger: Logger = createLogger({
  level: process.env["LOG_LEVEL"] ?? (process.env["NODE_ENV"] === "test" ? "silent" : "info"),
});
