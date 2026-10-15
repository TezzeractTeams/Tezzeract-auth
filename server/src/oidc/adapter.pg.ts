import type { Adapter, AdapterPayload } from "oidc-provider";
import { query } from "../db/pool.js";
import { sha256Hex } from "../util/crypto.js";

/**
 * Postgres adapter for oidc-provider.
 *
 * oidc-provider's default adapter is in-memory, which would drop every
 * session, authorization code and refresh token on restart, so a real store is
 * required rather than optional.
 *
 * Ids and uids are hashed before they touch the database. oidc-provider uses
 * the opaque token value itself as the adapter key (see
 * lib/models/formats/opaque.js, `value: this.jti`), and an interaction uid
 * travels in a URL, so both are bearer credentials. Hashing them here means a
 * database dump, a log of a slow query or a replica leak yields nothing a
 * caller could present as a token. The provider is unaware: it passes a value
 * in and gets the same record back.
 *
 * grant_id and user_code are stored as-is. Neither is a bearer credential —
 * grant_id never leaves the server and exists so that revoking one grant on
 * refresh-token reuse drops every token sharing it.
 */

interface PayloadRow {
  payload: AdapterPayload;
  consumed_at: Date | null;
}

/** Keys are hashed; see the note above. */
const key = (value: string): string => sha256Hex(value);

export class PostgresAdapter implements Adapter {
  constructor(private readonly name: string) {}

  async upsert(id: string, payload: AdapterPayload, expiresIn: number): Promise<void> {
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;

    await query(
      `INSERT INTO oidc_payloads (type, id, payload, grant_id, user_code, uid, expires_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (type, id) DO UPDATE SET
            payload    = EXCLUDED.payload,
            grant_id   = EXCLUDED.grant_id,
            user_code  = EXCLUDED.user_code,
            uid        = EXCLUDED.uid,
            expires_at = EXCLUDED.expires_at`,
      [
        this.name,
        key(id),
        payload,
        payload.grantId ?? null,
        payload.userCode ?? null,
        payload.uid ? key(payload.uid) : null,
        expiresAt,
      ],
    );
  }

  async find(id: string): Promise<AdapterPayload | undefined> {
    return this.findOne(`id = $2`, key(id));
  }

  async findByUid(uid: string): Promise<AdapterPayload | undefined> {
    return this.findOne(`uid = $2`, key(uid));
  }

  async findByUserCode(userCode: string): Promise<AdapterPayload | undefined> {
    return this.findOne(`user_code = $2`, userCode);
  }

  /**
   * Mark a record consumed without deleting it.
   *
   * This is what makes authorization-code replay and refresh-token reuse
   * detectable: the provider finds the record, sees `consumed`, and revokes the
   * whole grant. Deleting instead would make a replay indistinguishable from
   * an expired token.
   */
  async consume(id: string): Promise<void> {
    await query(
      `UPDATE oidc_payloads
          SET consumed_at = now(),
              payload = jsonb_set(payload, '{consumed}', to_jsonb(extract(epoch from now())::int))
        WHERE type = $1 AND id = $2`,
      [this.name, key(id)],
    );
  }

  async destroy(id: string): Promise<void> {
    await query(`DELETE FROM oidc_payloads WHERE type = $1 AND id = $2`, [this.name, key(id)]);
  }

  /** Revoke every record sharing a grant. Called on refresh-token reuse. */
  async revokeByGrantId(grantId: string): Promise<void> {
    await query(`DELETE FROM oidc_payloads WHERE grant_id = $1`, [grantId]);
  }

  private async findOne(predicate: string, value: string): Promise<AdapterPayload | undefined> {
    const rows = await query<PayloadRow>(
      `SELECT payload, consumed_at
         FROM oidc_payloads
        WHERE type = $1 AND ${predicate}
          AND (expires_at IS NULL OR expires_at > now())`,
      [this.name, value],
    );
    return rows[0]?.payload;
  }
}

/** Factory in the shape oidc-provider's `adapter` option expects. */
export const postgresAdapter = (name: string): Adapter => new PostgresAdapter(name);

/** Remove expired records. Safe to run on a schedule. */
export async function sweepExpiredPayloads(): Promise<void> {
  await query(`DELETE FROM oidc_payloads WHERE expires_at IS NOT NULL AND expires_at < now()`);
}
