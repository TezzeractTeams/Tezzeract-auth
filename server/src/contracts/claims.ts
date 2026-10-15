import { z } from "zod";

/**
 * Access token claims issued by auth.tezzeract.com.
 *
 * Exported so that other Tezzeract services (Talk, App, Contelli) can import
 * this schema and validate a token they fetched the key for from /jwks,
 * without calling this service per request.
 *
 * IMPORTANT: `memberships` and `standing` are a HINT, captured at token issue
 * time. A token lives for up to 15 minutes, so a membership revoked a minute
 * after issue will still appear valid for the remainder of that window.
 * Consuming services MUST re-check authorization against their own OrgContext
 * before acting on it. See the README section "Memberships are a hint".
 */

/** Role within an organisation, as stored in the memberships table. */
export const MembershipRoleSchema = z.enum(["owner", "admin", "member", "viewer"]);
export type MembershipRole = z.infer<typeof MembershipRoleSchema>;

export const MembershipSchema = z
  .object({
    orgId: z.string().uuid(),
    role: MembershipRoleSchema,
  })
  .strict();
export type Membership = z.infer<typeof MembershipSchema>;

/**
 * Account standing. Gates product access without encoding a reason, so the
 * token never reveals billing or moderation detail to the client.
 */
export const StandingSchema = z.enum(["active", "suspended", "delinquent"]);
export type Standing = z.infer<typeof StandingSchema>;

export const AccessTokenClaimsSchema = z
  .object({
    /** Issuer: the auth origin, e.g. https://auth.tezzeract.com */
    iss: z.string().url(),
    /** Subject: the stable user id. */
    sub: z.string().min(1),
    /** Audience: the client_id the token was issued to. */
    aud: z.string().min(1),
    /** Expiry, seconds since epoch. */
    exp: z.number().int().positive(),
    /** Issued at, seconds since epoch. */
    iat: z.number().int().positive(),
    email: z.string().email(),
    name: z.string().min(1),
    standing: StandingSchema,
    memberships: z.array(MembershipSchema),
  })
  // Passthrough, not strict: the OIDC provider adds registered claims such as
  // jti, sid, scope and client_id. We assert on the claims we promise and let
  // the rest through rather than rejecting a structurally valid token.
  .passthrough();

export type AccessTokenClaims = z.infer<typeof AccessTokenClaimsSchema>;

/** The subset this service computes; the provider supplies iss/aud/exp/iat/sub. */
export const ProfileClaimsSchema = AccessTokenClaimsSchema.pick({
  email: true,
  name: true,
  standing: true,
  memberships: true,
});
export type ProfileClaims = z.infer<typeof ProfileClaimsSchema>;
