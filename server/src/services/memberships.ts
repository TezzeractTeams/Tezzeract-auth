import { query } from "../db/pool.js";
import {
  MembershipRoleSchema,
  StandingSchema,
  type Membership,
  type Standing,
} from "../contracts/claims.js";
import { logger } from "../util/logger.js";

/**
 * Read-only access to organisation memberships and account standing.
 *
 * These values are read once, at token issue time, and embedded in the access
 * token. That is what lets other products verify a token from /jwks alone
 * without calling this service per request — and it is exactly why the claim
 * is a HINT: a membership revoked after issue stays visible for the remainder
 * of the token lifetime (at most 15 minutes). Consumers re-check against
 * their own OrgContext. See the README, "Memberships are a hint".
 *
 * This service never writes. Products own these rows.
 */

export interface MembershipSnapshot {
  memberships: Membership[];
  standing: Standing;
}

/**
 * Memberships for a user, ordered for a stable claim value so two tokens
 * issued back to back are byte-identical in this respect.
 */
export async function getMemberships(userId: string): Promise<Membership[]> {
  const rows = await query<{ org_id: string; role: string }>(
    `SELECT org_id, role
       FROM memberships
      WHERE user_id = $1
      ORDER BY org_id`,
    [userId],
  );

  const memberships: Membership[] = [];
  for (const row of rows) {
    const role = MembershipRoleSchema.safeParse(row.role);
    if (!role.success) {
      // A role this service does not understand must not silently become a
      // weaker or stronger one, so the row is dropped and flagged.
      logger.warn({ orgId: row.org_id }, "dropping membership with unrecognised role");
      continue;
    }
    memberships.push({ orgId: row.org_id, role: role.data });
  }
  return memberships;
}

/** Account standing. A user with no row is active. */
export async function getStanding(userId: string): Promise<Standing> {
  const rows = await query<{ standing: string }>(
    `SELECT standing FROM user_standing WHERE user_id = $1`,
    [userId],
  );
  const raw = rows[0]?.standing;
  if (raw === undefined) return "active";

  const parsed = StandingSchema.safeParse(raw);
  if (!parsed.success) {
    // Fail closed: an unreadable standing is treated as suspended rather than
    // defaulting to full access.
    logger.error("unrecognised account standing; treating as suspended");
    return "suspended";
  }
  return parsed.data;
}

export async function getSnapshot(userId: string): Promise<MembershipSnapshot> {
  const [memberships, standing] = await Promise.all([getMemberships(userId), getStanding(userId)]);
  return { memberships, standing };
}
