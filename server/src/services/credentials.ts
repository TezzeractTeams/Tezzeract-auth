import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";
import { logger } from "../util/logger.js";

/**
 * The credential store: passwords, MFA, email verification and recovery.
 *
 * Every Supabase call in this service lives behind the CredentialStore
 * interface below, so the backing identity provider can be replaced (WorkOS,
 * Ory, Clerk) by writing one new implementation and changing nothing else.
 * No other module imports @supabase/supabase-js, and the service-role key
 * never leaves this file.
 *
 * Error mapping is deliberately lossy. Supabase distinguishes "user not
 * found" from "invalid password" from "email not confirmed"; this service
 * collapses all of them into `rejected`, because the difference is exactly
 * what an account-enumeration attack is looking for.
 */

export interface CredentialUser {
  userId: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

/**
 * An authentication that passed the password check but still owes a second
 * factor. Held in server-side interaction storage, never sent to the browser.
 */
export interface PendingMfa {
  userId: string;
  factorId: string;
  challengeId: string;
  /** Supabase session needed to complete the challenge. Server-side only. */
  accessToken: string;
  refreshToken: string;
}

export type AuthOutcome =
  | { kind: "authenticated"; user: CredentialUser }
  | { kind: "mfa_required"; pending: PendingMfa }
  | { kind: "email_unverified"; email: string }
  | { kind: "rejected" };

export interface CredentialStore {
  authenticate(input: { email: string; password: string }): Promise<AuthOutcome>;
  verifyMfa(input: { pending: PendingMfa; code: string }): Promise<AuthOutcome>;
  register(input: { name: string; email: string; password: string }): Promise<void>;
  requestPasswordReset(input: { email: string; redirectTo: string }): Promise<void>;
  resetPassword(input: { token: string; password: string }): Promise<{ ok: boolean }>;
  resendVerification(input: { email: string; redirectTo: string }): Promise<void>;
  getUser(userId: string): Promise<CredentialUser | undefined>;
}

/* -------------------------------- Supabase -------------------------------- */

let admin: SupabaseClient | undefined;

/** Service-role client. Full access, so it is confined to this module. */
function adminClient(): SupabaseClient {
  admin ??= createClient(env().SUPABASE_URL, env().SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

/** A fresh anon-style client used for one operation, holding no session. */
function scopedClient(): SupabaseClient {
  return createClient(env().SUPABASE_URL, env().SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

interface SupabaseUserLike {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  user_metadata?: Record<string, unknown> | null;
  factors?: { id: string; status: string; factor_type?: string }[] | null;
}

function toCredentialUser(user: SupabaseUserLike): CredentialUser {
  const metadata = user.user_metadata ?? {};
  const rawName = metadata["name"] ?? metadata["full_name"];
  return {
    userId: user.id,
    email: user.email ?? "",
    name: typeof rawName === "string" && rawName.trim() !== "" ? rawName : (user.email ?? "user"),
    emailVerified: Boolean(user.email_confirmed_at),
  };
}

/**
 * Log a provider failure without the detail that would leak account state.
 *
 * The operation name and status code are useful operationally; the message is
 * not logged, because Supabase puts the email address and the reason
 * ("User already registered") into it.
 */
function logProviderFailure(operation: string, status?: number): void {
  logger.warn({ operation, status }, "credential provider rejected an operation");
}

export const supabaseCredentials: CredentialStore = {
  async authenticate({ email, password }) {
    const client = scopedClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });

    if (error || !data.user || !data.session) {
      logProviderFailure("signInWithPassword", error?.status);
      return { kind: "rejected" };
    }

    const user = toCredentialUser(data.user as SupabaseUserLike);

    if (!user.emailVerified) {
      // The caller turns this into the same generic response as a rejection;
      // it is distinguished here only so the verify-email screen can be shown
      // to someone who already proved they know the password.
      return { kind: "email_unverified", email: user.email };
    }

    const verifiedFactor = (data.user as SupabaseUserLike).factors?.find(
      (factor) => factor.status === "verified",
    );

    if (!verifiedFactor) {
      return { kind: "authenticated", user };
    }

    const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({
      factorId: verifiedFactor.id,
    });

    if (challengeError || !challenge) {
      logProviderFailure("mfa.challenge", challengeError?.status);
      return { kind: "rejected" };
    }

    return {
      kind: "mfa_required",
      pending: {
        userId: user.userId,
        factorId: verifiedFactor.id,
        challengeId: challenge.id,
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
      },
    };
  },

  async verifyMfa({ pending, code }) {
    const client = scopedClient();

    // The challenge is bound to the session created by the password step, so
    // that session has to be restored before the code can be verified.
    const { error: sessionError } = await client.auth.setSession({
      access_token: pending.accessToken,
      refresh_token: pending.refreshToken,
    });
    if (sessionError) {
      logProviderFailure("setSession", sessionError.status);
      return { kind: "rejected" };
    }

    const { data, error } = await client.auth.mfa.verify({
      factorId: pending.factorId,
      challengeId: pending.challengeId,
      code,
    });

    if (error || !data) {
      logProviderFailure("mfa.verify", error?.status);
      return { kind: "rejected" };
    }

    const user = await this.getUser(pending.userId);
    if (!user) return { kind: "rejected" };
    return { kind: "authenticated", user };
  },

  async register({ name, email, password }) {
    const { error } = await scopedClient().auth.signUp({
      email,
      password,
      options: { data: { name } },
    });

    // Swallowed on purpose. The route answers { verify_email: true } whether
    // or not the address was already registered, so the response cannot be
    // used to enumerate accounts. Supabase emails the existing account owner
    // rather than the person who submitted the form.
    if (error) logProviderFailure("signUp", error.status);
  },

  async requestPasswordReset({ email, redirectTo }) {
    const { error } = await scopedClient().auth.resetPasswordForEmail(email, { redirectTo });
    // Swallowed: /api/forgot-password returns 204 unconditionally.
    if (error) logProviderFailure("resetPasswordForEmail", error.status);
  },

  async resetPassword({ token, password }) {
    const client = scopedClient();

    // The recovery link carries a token_hash. Exchanging it yields a session
    // scoped to that user, which is the only authority for the password change.
    const { data, error } = await client.auth.verifyOtp({
      type: "recovery",
      token_hash: token,
    });

    if (error || !data.session) {
      logProviderFailure("verifyOtp(recovery)", error?.status);
      return { ok: false };
    }

    const { error: updateError } = await client.auth.updateUser({ password });
    if (updateError) {
      logProviderFailure("updateUser(password)", updateError.status);
      return { ok: false };
    }

    // Changing a password must not leave older sessions usable.
    await client.auth.signOut({ scope: "global" }).catch(() => undefined);
    return { ok: true };
  },

  async resendVerification({ email, redirectTo }) {
    const { error } = await scopedClient().auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: redirectTo },
    });
    // Swallowed: /api/resend-verification returns 204 unconditionally.
    if (error) logProviderFailure("resend", error.status);
  },

  async getUser(userId) {
    const { data, error } = await adminClient().auth.admin.getUserById(userId);
    if (error || !data.user) {
      logProviderFailure("admin.getUserById", error?.status);
      return undefined;
    }
    return toCredentialUser(data.user as SupabaseUserLike);
  },
};

/** The active credential store. Swap this one binding to change provider. */
export const credentials: CredentialStore = supabaseCredentials;
