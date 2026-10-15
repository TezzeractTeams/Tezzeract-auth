import {
  ApiError,
  type ApiErrorBody,
  type ClientConfig,
  type EmailOnlyRequest,
  type LoginRequest,
  type LoginResponse,
  type MfaVerifyRequest,
  type MfaVerifyResponse,
  type ResetPasswordRequest,
  type SignupRequest,
  type SignupResponse,
} from "./types";

/**
 * Every network call this app makes.
 *
 * Same-origin by design: the server serves this bundle and the API from one
 * origin, so requests are relative and the session cookie is first-party.
 * There is no base URL to configure and no CORS to negotiate.
 *
 * Nothing here persists anything. No token, password or profile is written to
 * localStorage or sessionStorage; the session lives only in an HttpOnly
 * cookie the browser will not let script read.
 */

/** Set by the server's CSRF cookie, which is readable by design. */
const CSRF_COOKIE = "tz_csrf";
const CSRF_HEADER = "x-csrf-token";

function readCsrfToken(): string | undefined {
  // document.cookie is the only readable source; the cookie carries no
  // authority alone, which is what makes double-submit safe.
  for (const part of document.cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === CSRF_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

async function toApiError(response: Response): Promise<ApiError> {
  const retryAfter = Number(response.headers.get("Retry-After") ?? "");
  let body: ApiErrorBody | undefined;
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    // A non-JSON error body (a proxy error page, say) must still surface as a
    // typed failure rather than a parse exception.
    body = undefined;
  }

  const code = body?.error?.code ?? "internal_error";
  const message = body?.error?.message ?? "Something went wrong. Please try again.";
  return new ApiError(
    code,
    message,
    response.status,
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
  );
}

interface RequestOptions {
  method: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
}

async function request(path: string, options: RequestOptions): Promise<Response> {
  const csrf = readCsrfToken();

  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  // GET changes nothing, so it is exempt server-side too.
  if (options.method !== "GET" && csrf) headers[CSRF_HEADER] = csrf;

  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method,
      headers,
      // First-party session cookie; the server is the same origin.
      credentials: "include",
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    // A dropped connection is reported as a generic failure, with the same
    // copy as a server-side fault, so the UI has one error path.
    throw new ApiError("internal_error", "Something went wrong. Please try again.", 0);
  }

  if (!response.ok) throw await toApiError(response);
  return response;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await request(path, { method: "POST", body });
  return (await response.json()) as T;
}

async function postNoContent(path: string, body: unknown): Promise<void> {
  await request(path, { method: "POST", body });
}

/* ------------------------------- the surface ------------------------------ */

export const realApi = {
  /**
   * Seeds the CSRF cookie as a side effect, so this is called on mount by
   * every screen before any form can be submitted.
   */
  async getClientConfig(clientId: string | undefined, signal?: AbortSignal): Promise<ClientConfig> {
    const query = clientId ? `?client_id=${encodeURIComponent(clientId)}` : "";
    const response = await request(`/api/client-config${query}`, {
      method: "GET",
      ...(signal ? { signal } : {}),
    });
    return (await response.json()) as ClientConfig;
  },

  login(body: LoginRequest): Promise<LoginResponse> {
    return postJson<LoginResponse>("/api/login", body);
  },

  signup(body: SignupRequest): Promise<SignupResponse> {
    return postJson<SignupResponse>("/api/signup", body);
  },

  /** Resolves on success whether or not the address exists. */
  forgotPassword(body: EmailOnlyRequest): Promise<void> {
    return postNoContent("/api/forgot-password", body);
  },

  resetPassword(body: ResetPasswordRequest): Promise<void> {
    return postNoContent("/api/reset-password", body);
  },

  verifyMfa(body: MfaVerifyRequest): Promise<MfaVerifyResponse> {
    return postJson<MfaVerifyResponse>("/api/mfa/verify", body);
  },

  resendVerification(body: EmailOnlyRequest): Promise<void> {
    return postNoContent("/api/resend-verification", body);
  },

  logout(): Promise<void> {
    return postNoContent("/api/logout", {});
  },
};

export type AuthApi = typeof realApi;

/**
 * Resolve the implementation the app will use.
 *
 * `import.meta.env.VITE_USE_MOCKS` is statically replaced at build time, so a
 * production build evaluates this to a constant false, drops the branch, and
 * never emits the dynamic import — the mock module is absent from the bundle
 * rather than present but unreachable.
 */
export async function resolveApi(): Promise<AuthApi> {
  if (import.meta.env.VITE_USE_MOCKS === "true") {
    const { mockApi } = await import("./mocks");
    return mockApi;
  }
  return realApi;
}

export { ApiError } from "./types";
