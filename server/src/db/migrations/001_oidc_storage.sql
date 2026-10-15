-- OIDC provider storage: sessions, authorization codes, access and refresh
-- tokens, grants, interactions and replay-detection records.
--
-- The `id` column holds a SHA-256 hash, not the token value. oidc-provider
-- uses the opaque token value as its adapter key, so the pg adapter hashes it
-- on the way in and on lookup; a dump of this table yields no usable token.
-- Non-secret lookup keys (uid, grant_id, user_code) are stored as-is because
-- they are used for indexed reverse lookups and are not bearer credentials.

CREATE TABLE IF NOT EXISTS oidc_payloads (
    type        TEXT        NOT NULL,
    id          TEXT        NOT NULL,
    payload     JSONB       NOT NULL,
    grant_id    TEXT,
    user_code   TEXT,
    uid         TEXT,
    expires_at  TIMESTAMPTZ,
    consumed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (type, id)
);

-- Revoking a grant on refresh-token reuse must drop every token that shares it.
CREATE INDEX IF NOT EXISTS oidc_payloads_grant_id_idx
    ON oidc_payloads (grant_id) WHERE grant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS oidc_payloads_uid_idx
    ON oidc_payloads (uid) WHERE uid IS NOT NULL;

CREATE INDEX IF NOT EXISTS oidc_payloads_user_code_idx
    ON oidc_payloads (user_code) WHERE user_code IS NOT NULL;

-- Supports the expiry sweep.
CREATE INDEX IF NOT EXISTS oidc_payloads_expires_at_idx
    ON oidc_payloads (expires_at) WHERE expires_at IS NOT NULL;
