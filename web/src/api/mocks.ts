import type { AuthApi } from "./auth";
import { ApiError } from "./types";

/**
 * In-memory stand-in for the server, so the screens can be developed and
 * demonstrated without Postgres or Supabase running.
 *
 * Enabled only by VITE_USE_MOCKS=true, and reached only through the dynamic
 * import in resolveApi(), so this module is not part of a production bundle.
 * It is a UI fixture, not a second implementation of the rules: it exists to
 * exercise loading, error and success states.
 *
 * Accounts it knows about:
 *   ok@tezzeract.com       / correct horse battery  -> signs in
 *   mfa@tezzeract.com      / correct horse battery  -> asks for a code (123456)
 *   locked@tezzeract.com   / anything               -> rate limited
 *   anything else                                   -> incorrect credentials
 */

const PASSWORD = "correct horse battery";
const MFA_CODE = "123456";

/** Where a real server would send the browser after a successful sign-in. */
const SUCCESS_REDIRECT = "/mock/signed-in";

const latency = (ms = 600): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

let mfaPending = false;

export const mockApi: AuthApi = {
  async getClientConfig(clientId) {
    await latency(200);
    switch (clientId) {
      case "talk":
        return {
          name: "Tezzeract Talk",
          logoUrl: "/brand/talk.svg",
          accentColor: "#20C8F9",
          postLoginWelcome: false,
        };
      case "contelli":
        return {
          name: "Contelli",
          logoUrl: "/brand/contelli.svg",
          accentColor: "#00378A",
          postLoginWelcome: false,
        };
      case "boom":
        // Exercises the "fall back to Tezzeract defaults on failure" path.
        throw new ApiError("internal_error", "Mock failure", 500);
      default:
        return {
          name: "Tezzeract",
          logoUrl: "/brand/Tezzeract%20-%20Symbolic%20Logo%20%28Gradient%29.webp",
          wordmarkUrl: "/brand/Tezzeract%20-%20Text%20Logo%20%28Gradient%29.png",
          accentColor: "#009BE9",
          postLoginWelcome: false,
        };
    }
  },

  async login({ email, password }) {
    await latency();
    if (email === "locked@tezzeract.com") {
      throw new ApiError("rate_limited", "Too many attempts. Please wait a moment.", 429, 42);
    }
    if (password !== PASSWORD) {
      throw new ApiError("invalid_credentials", "Incorrect email or password.", 401);
    }
    if (email === "mfa@tezzeract.com") {
      mfaPending = true;
      return { mfa_required: true };
    }
    if (email !== "ok@tezzeract.com") {
      throw new ApiError("invalid_credentials", "Incorrect email or password.", 401);
    }
    return { redirect_to: SUCCESS_REDIRECT };
  },

  async signup() {
    await latency();
    // Always succeeds, exactly as the real endpoint does, so the mock cannot
    // teach the UI to expect an "email already taken" state that the server
    // will never send.
    return { verify_email: true };
  },

  async forgotPassword() {
    await latency();
  },

  async resetPassword({ token }) {
    await latency();
    if (token === "expired") {
      throw new ApiError("invalid_token", "This link is invalid or has expired.", 400);
    }
  },

  async verifyMfa({ code }) {
    await latency();
    if (!mfaPending) {
      throw new ApiError("no_interaction", "Your sign-in session has expired.", 400);
    }
    if (code !== MFA_CODE) {
      throw new ApiError("invalid_credentials", "That code is not correct.", 401);
    }
    mfaPending = false;
    return { redirect_to: SUCCESS_REDIRECT };
  },

  async resendVerification() {
    await latency();
  },

  async logout() {
    await latency(300);
    mfaPending = false;
  },

  async getInteractionStatus() {
    await latency(50);
    return { active: true };
  },

  async checkWelcomeAccess() {
    await latency(100);
  },

  async getPostLoginContinue() {
    await latency(100);
    return undefined;
  },
};
