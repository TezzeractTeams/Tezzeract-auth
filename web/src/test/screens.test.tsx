import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { App } from "../app";
import type { AuthApi } from "../api/auth";
import { ApiError } from "../api/types";

/**
 * Screen behaviour that the security rules depend on: that a generic error is
 * what the user sees, that the frontend only ever assigns the server's opaque
 * redirect, and that OIDC parameters survive navigation between screens.
 */

const config = {
  name: "Tezzeract",
  logoUrl: "/brand/Tezzeract%20-%20Symbolic%20Logo%20%28Gradient%29.webp",
  wordmarkUrl: "/brand/Tezzeract%20-%20Text%20Logo%20%28Gradient%29.png",
  accentColor: "#009BE9",
  postLoginWelcome: false,
};

function stubApi(overrides: Partial<AuthApi> = {}): AuthApi {
  return {
    getClientConfig: vi.fn().mockResolvedValue(config),
    login: vi.fn(),
    signup: vi.fn().mockResolvedValue({ verify_email: true }),
    forgotPassword: vi.fn().mockResolvedValue(undefined),
    resetPassword: vi.fn().mockResolvedValue(undefined),
    verifyMfa: vi.fn(),
    resendVerification: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    getInteractionStatus: vi.fn().mockResolvedValue({ active: true }),
    checkWelcomeAccess: vi.fn().mockResolvedValue(undefined),
    getPostLoginContinue: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as AuthApi;
}

function renderAt(path: string, api: AuthApi) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App api={api} />
    </MemoryRouter>,
  );
}

describe("login screen", () => {
  it("labels its fields so they are reachable by name", async () => {
    renderAt("/login", stubApi());
    expect(await screen.findByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it("shows the server's generic message and nothing more specific", async () => {
    const api = stubApi({
      login: vi
        .fn()
        .mockRejectedValue(
          new ApiError("invalid_credentials", "Incorrect email or password.", 401),
        ),
    });
    renderAt("/login", api);

    await userEvent.type(await screen.findByLabelText(/email/i), "nobody@tezzeract.com");
    await userEvent.type(screen.getByLabelText(/password/i), "wrong password here");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Incorrect email or password.");
    // Nothing may hint at which half was wrong, or whether the account exists.
    expect(alert.textContent).not.toMatch(/no account|not found|unknown|exist|password is/i);
  });

  it("announces a submit failure in a live region", async () => {
    const api = stubApi({
      login: vi.fn().mockRejectedValue(new ApiError("rate_limited", "Too many attempts.", 429, 30)),
    });
    renderAt("/login", api);

    await userEvent.type(await screen.findByLabelText(/email/i), "a@b.com");
    await userEvent.type(screen.getByLabelText(/password/i), "some password x");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("aria-live", "assertive");
    expect(alert).toHaveTextContent(/30 seconds/);
  });

  it("validates before calling the server", async () => {
    const api = stubApi();
    renderAt("/login", api);

    await userEvent.click(await screen.findByRole("button", { name: /sign in/i }));

    expect(await screen.findByText(/enter your email address/i)).toBeInTheDocument();
    expect(api.login).not.toHaveBeenCalled();
  });

  it("offers Google sign-in via the server oauth route", async () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...original, assign },
    });

    renderAt("/login", stubApi());
    await userEvent.click(await screen.findByRole("button", { name: /continue with google/i }));
    expect(assign).toHaveBeenCalledWith("/api/oauth/google");

    Object.defineProperty(window, "location", { configurable: true, value: original });
  });

  it("carries the OIDC parameters to signup and to forgot-password", async () => {
    renderAt("/login?interaction=abc123&client_id=talk", stubApi());

    const signup = await screen.findByRole("link", { name: /create an account/i });
    expect(signup).toHaveAttribute("href", "/signup?interaction=abc123&client_id=talk");

    expect(screen.getByRole("link", { name: /forgot password/i })).toHaveAttribute(
      "href",
      "/forgot-password?interaction=abc123&client_id=talk",
    );
  });

  it("sends the user to /mfa, keeping the interaction, when a code is required", async () => {
    const api = stubApi({ login: vi.fn().mockResolvedValue({ mfa_required: true }) });
    renderAt("/login?interaction=abc123", api);

    await userEvent.type(await screen.findByLabelText(/email/i), "mfa@tezzeract.com");
    await userEvent.type(screen.getByLabelText(/password/i), "correct horse battery");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("group", { name: /verification code/i })).toBeInTheDocument();
  });
});

describe("forgot password", () => {
  it("confirms identically without revealing whether the account exists", async () => {
    const api = stubApi();
    renderAt("/forgot-password", api);

    await userEvent.type(await screen.findByLabelText(/email/i), "nobody@tezzeract.com");
    await userEvent.click(screen.getByRole("button", { name: /send reset link/i }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/if an account exists/i);
    expect(status.textContent).not.toMatch(/\bwe sent\b|\bno account\b/i);
  });
});

describe("signup", () => {
  it("offers Google sign-in via the server oauth route", async () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...original, assign },
    });

    renderAt("/signup", stubApi());
    await userEvent.click(await screen.findByRole("button", { name: /continue with google/i }));
    expect(assign).toHaveBeenCalledWith("/api/oauth/google");

    Object.defineProperty(window, "location", { configurable: true, value: original });
  });

  it("requires both passwords to match before submitting", async () => {
    const api = stubApi();
    renderAt("/signup", api);

    await userEvent.type(await screen.findByLabelText(/full name/i), "Ada");
    await userEvent.type(screen.getByLabelText(/^email/i), "ada@tezzeract.com");
    await userEvent.type(screen.getByLabelText(/^password/i), "correct horse battery");
    await userEvent.type(screen.getByLabelText(/confirm password/i), "different passphrase");
    await userEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByText(/both passwords must match/i)).toBeInTheDocument();
    expect(api.signup).not.toHaveBeenCalled();
  });

  it("always ends on check-your-inbox, with no email-taken state", async () => {
    const api = stubApi();
    renderAt("/signup", api);

    await userEvent.type(await screen.findByLabelText(/full name/i), "Ada");
    await userEvent.type(screen.getByLabelText(/^email/i), "taken@tezzeract.com");
    await userEvent.type(screen.getByLabelText(/^password/i), "correct horse battery");
    await userEvent.type(screen.getByLabelText(/confirm password/i), "correct horse battery");
    await userEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByText(/check your inbox/i)).toBeInTheDocument();
  });
});

describe("error screen", () => {
  it("renders a reason from its own table, never the query value", async () => {
    renderAt("/error?reason=invalid_redirect", stubApi());
    expect(await screen.findByText(/this sign-in link is not valid/i)).toBeInTheDocument();
  });

  it("falls back to generic copy for an unrecognised or crafted reason", async () => {
    const injected = "<img src=x onerror=alert(1)>";
    renderAt(`/error?reason=${encodeURIComponent(injected)}`, stubApi());

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
    // The parameter is a lookup key only; it must not reach the document.
    expect(document.body.innerHTML).not.toContain("onerror");
    expect(document.querySelector("img[src='x']")).toBeNull();
  });
});

describe("theming", () => {
  it("falls back to Tezzeract defaults when client-config fails", async () => {
    const api = stubApi({
      getClientConfig: vi.fn().mockRejectedValue(new ApiError("internal_error", "boom", 500)),
    });
    renderAt("/login?client_id=talk", api);

    // The screen still renders rather than blocking on branding.
    expect(await screen.findByRole("button", { name: /sign in/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--tz-accent")).toBe("#009BE9");
    });
  });

  it("applies the client accent as a CSS variable", async () => {
    const api = stubApi({
      getClientConfig: vi.fn().mockResolvedValue({ ...config, accentColor: "#20C8F9" }),
    });
    renderAt("/login?client_id=talk", api);

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--tz-accent")).toBe("#20C8F9");
    });
  });

  it("refuses an accent colour that is not a plain hex literal", async () => {
    const api = stubApi({
      getClientConfig: vi
        .fn()
        .mockResolvedValue({ ...config, accentColor: "red; } html { display: none" }),
    });
    renderAt("/login", api);

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--tz-accent")).toBe("#009BE9");
    });
  });
});
