import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { pino } from "pino";
import { REDACT_PATHS, REDACTED, safeUrl } from "../src/util/logger.js";

/**
 * Redaction is enforced at the logger, so this suite drives the real logger
 * configuration and inspects the bytes it emits. A field added to a log call
 * that leaks a secret fails here.
 */

function capture() {
  const written: string[] = [];
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      written.push(String(chunk));
      callback();
    },
  });
  const logger = pino(
    { level: "trace", redact: { paths: [...REDACT_PATHS], censor: REDACTED } },
    sink,
  );
  return { logger, lines: () => written };
}

const SECRETS = {
  password: "correct horse battery staple",
  token: "eyJhbGciOiJFUzI1NiJ9.tokenbody.signature",
  code: "123456",
  access_token: "at_secret_value",
  refresh_token: "rt_secret_value",
  id_token: "it_secret_value",
  code_verifier: "cv_secret_value",
  client_secret: "cs_secret_value",
  cookie: "_session=abcdef; tz_csrf=ghijkl",
  authorization: "Bearer at_secret_value",
  email: "shanilka@tezzeract.com",
};

describe("log redaction", () => {
  it("strips every sensitive field at the top level", () => {
    const { logger, lines } = capture();
    logger.info(SECRETS, "login attempt");

    const output = lines().join("");
    for (const [field, value] of Object.entries(SECRETS)) {
      expect(output, `${field} leaked`).not.toContain(value);
    }
    expect(output).toContain(REDACTED);
  });

  it("strips the same fields one level down, as request bodies arrive", () => {
    const { logger, lines } = capture();
    logger.info({ body: SECRETS, query: SECRETS, params: SECRETS }, "request");

    const output = lines().join("");
    for (const [field, value] of Object.entries(SECRETS)) {
      expect(output, `${field} leaked from a nested object`).not.toContain(value);
    }
  });

  it("strips cookie and authorization headers from a request log", () => {
    const { logger, lines } = capture();
    logger.info(
      {
        req: {
          method: "POST",
          headers: {
            cookie: "_session=abcdef",
            authorization: "Bearer at_secret_value",
            "user-agent": "vitest",
          },
        },
      },
      "request",
    );

    const output = lines().join("");
    expect(output).not.toContain("_session=abcdef");
    expect(output).not.toContain("at_secret_value");
    // Non-sensitive headers still make it through, or the log is useless.
    expect(output).toContain("vitest");
  });

  it("strips Set-Cookie from a response log", () => {
    const { logger, lines } = capture();
    logger.info({ res: { headers: { "set-cookie": "_session=abcdef; HttpOnly" } } }, "response");
    expect(lines().join("")).not.toContain("_session=abcdef");
  });

  it("never logs a query string value, only the parameter names", () => {
    // A reset link is the whole credential, and it arrives as a query string.
    expect(safeUrl("/reset-password?token=secret-reset-token")).toBe(
      `/reset-password?token=${REDACTED}`,
    );
    expect(safeUrl("/login?interaction=abc123&client_id=app")).toBe(
      `/login?client_id&interaction=${REDACTED}`,
    );
    expect(safeUrl("/api/login")).toBe("/api/login");
  });

  it("keeps an error's message and stack but not an attached secret", () => {
    const { logger, lines } = capture();
    const error = Object.assign(new Error("provider rejected"), {
      password: SECRETS.password,
    });
    logger.error({ err: error }, "failure");

    const output = lines().join("");
    expect(output).toContain("provider rejected");
    expect(output).not.toContain(SECRETS.password);
  });
});
