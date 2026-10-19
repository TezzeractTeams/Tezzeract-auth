import { Router, type Request } from "express";
import type Provider from "oidc-provider";
import { z } from "zod";
import { env } from "../../config/env.js";
import { credentials } from "../../services/credentials.js";
import {
  abandonInteraction,
  completeInteraction,
  currentInteraction,
  readPendingOAuth,
  storePendingMfa,
  storePendingOAuth,
} from "../../services/sessions.js";
import { asyncRoute } from "../errors.js";
import { ipKey, limit } from "../middleware/ratelimit.js";
import { logger } from "../../util/logger.js";
import { postLoginWelcome, setPostLoginRedirectCookie } from "../post-login-welcome.js";

/**
 * Supabase Google OAuth, mediated by this server so tokens never touch the
 * browser bundle. PKCE state lives in the OIDC interaction record.
 */

function loginPath(
  interaction: { uid: string; clientId: string | undefined },
  extra?: Record<string, string>,
): string {
  const params = new URLSearchParams({ interaction: interaction.uid });
  if (interaction.clientId) params.set("client_id", interaction.clientId);
  if (extra) {
    for (const [key, value] of Object.entries(extra)) params.set(key, value);
  }
  return `/login?${params.toString()}`;
}

function mfaPath(interaction: { uid: string; clientId: string | undefined }): string {
  const params = new URLSearchParams({ interaction: interaction.uid });
  if (interaction.clientId) params.set("client_id", interaction.clientId);
  return `/mfa?${params.toString()}`;
}

/**
 * Supabase must redirect back to the same browser origin that holds the OIDC
 * interaction cookie. In local dev the UI is often on :5180 (Vite) while
 * AUTH_ISSUER stays :3000 for the token `iss` claim — a fixed issuer callback
 * would drop the cookie and surface "sign-in session expired".
 */
function oauthCallbackUrl(req: Request): string {
  const issuer = env().AUTH_ISSUER;
  const host = req.get("host");
  if (!host) return `${issuer}/api/oauth/callback`;

  const forwarded = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto = forwarded ?? (req.secure ? "https" : "http");
  const requestOrigin = `${proto}://${host}`;

  if (requestOrigin === issuer) return `${issuer}/api/oauth/callback`;
  return `${requestOrigin}/api/oauth/callback`;
}

export function oauthRoutes(provider: Provider): Router {
  const router = Router();

  router.get(
    "/oauth/google",
    limit("login:ip", ipKey),
    asyncRoute(async (req, res) => {
      const interaction = await currentInteraction(provider, req, res);
      if (!interaction) {
        res.redirect(303, "/error?reason=no_interaction");
        return;
      }

      const begun = await credentials.beginOAuth({
        provider: "google",
        redirectTo: oauthCallbackUrl(req),
      });
      if (!begun.ok) {
        logger.warn("google oauth could not be started");
        res.redirect(303, loginPath(interaction, { oauth_error: "1" }));
        return;
      }

      await storePendingOAuth(provider, req, res, {
        provider: "google",
        codeVerifier: begun.codeVerifier,
        ...(begun.flowId ? { flowId: begun.flowId } : {}),
      });

      res.redirect(302, begun.authorizationUrl);
    }),
  );

  router.get(
    "/oauth/callback",
    asyncRoute(async (req, res) => {
      const interaction = await currentInteraction(provider, req, res);
      if (!interaction) {
        res.redirect(303, "/error?reason=no_interaction");
        return;
      }

      const pendingOAuth = await readPendingOAuth(provider, req, res);
      if (!pendingOAuth) {
        res.redirect(303, loginPath(interaction));
        return;
      }

      const parsed = z.object({ code: z.string().min(1) }).safeParse(req.query);
      if (!parsed.success) {
        res.redirect(303, loginPath(interaction));
        return;
      }

      const outcome = await credentials.completeOAuth({
        code: parsed.data.code,
        codeVerifier: pendingOAuth.codeVerifier,
        ...(pendingOAuth.flowId !== undefined ? { flowId: pendingOAuth.flowId } : {}),
      });

      if (outcome.kind === "rejected" || outcome.kind === "email_unverified") {
        res.redirect(303, loginPath(interaction));
        return;
      }

      if (outcome.kind === "mfa_required") {
        await storePendingMfa(provider, req, res, outcome.pending);
        res.redirect(303, mfaPath(interaction));
        return;
      }

      const redirectTo = await completeInteraction(provider, req, res, outcome.user.userId, {
        amr: ["oauth", "google"],
      });
      if (postLoginWelcome()) {
        setPostLoginRedirectCookie(res, redirectTo);
        await abandonInteraction(provider, req, res);
        res.redirect(303, "/welcome");
        return;
      }
      res.redirect(302, redirectTo);
    }),
  );

  return router;
}
