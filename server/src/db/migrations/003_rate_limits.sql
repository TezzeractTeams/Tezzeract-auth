-- Rate limiting and lockout counters, shared across server instances.
--
-- One row per (bucket, key, window). `key` is a SHA-256 hash of the subject
-- being limited, so an email address or IP never lands in this table in the
-- clear: the counters are useful for throttling but not as a user list.

CREATE TABLE IF NOT EXISTS auth_rate_limits (
    bucket       TEXT        NOT NULL,
    key          TEXT        NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    hits         INTEGER     NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket, key, window_start)
);

CREATE INDEX IF NOT EXISTS auth_rate_limits_window_idx
    ON auth_rate_limits (window_start);

-- Consecutive-failure tracking, which outlives the sliding rate-limit window
-- so that slow, patient password guessing still trips a lockout.
CREATE TABLE IF NOT EXISTS auth_lockouts (
    bucket        TEXT        NOT NULL,
    key           TEXT        NOT NULL,
    failures      INTEGER     NOT NULL DEFAULT 0,
    locked_until  TIMESTAMPTZ,
    last_failure  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (bucket, key)
);

CREATE INDEX IF NOT EXISTS auth_lockouts_last_failure_idx
    ON auth_lockouts (last_failure);
