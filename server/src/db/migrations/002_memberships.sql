-- Organisation memberships and account standing.
--
-- READ-ONLY from this service. Products own these rows; auth only reads them
-- at token issue time to populate the `memberships` and `standing` claims.
-- Those claims are a HINT with a lifetime of up to one access token (15 min);
-- consuming services re-check against their own OrgContext.
--
-- This file exists so the repo can stand up a local database and run its
-- tests. In a shared environment the owning service runs the real migration
-- and the auth service connects with a role that holds SELECT only.

CREATE TABLE IF NOT EXISTS memberships (
    user_id    TEXT        NOT NULL,
    org_id     UUID        NOT NULL,
    role       TEXT        NOT NULL
                   CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, org_id)
);

CREATE INDEX IF NOT EXISTS memberships_user_id_idx ON memberships (user_id);

-- Account standing gates product access without the token carrying a reason,
-- so billing or moderation detail never reaches a client. A user with no row
-- is treated as 'active'.
CREATE TABLE IF NOT EXISTS user_standing (
    user_id    TEXT        PRIMARY KEY,
    standing   TEXT        NOT NULL DEFAULT 'active'
                   CHECK (standing IN ('active', 'suspended', 'delinquent')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
