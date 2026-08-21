-- =============================================================================
-- staging_reviews — staging infra table (no Drizzle ORM equivalent)
-- =============================================================================
-- This table tracks rule-change review sessions in the staging environment.
-- It has no Drizzle ORM equivalent because it is staging-infra only.
--
-- Created separately from the generated Drizzle migrations because:
--   ARCHITECTURE.md §15.1: schema.ts is the single source of truth.
--   staging_reviews is not in schema.ts — it exists only for staging tooling.
-- =============================================================================

CREATE TABLE IF NOT EXISTS staging_reviews (
    id                  SERIAL PRIMARY KEY,
    review_label        VARCHAR(128) NOT NULL,
    previous_version_id INTEGER,
    proposed_version_id INTEGER,
    reviewer            VARCHAR(256),
    status              VARCHAR(32) NOT NULL DEFAULT 'pending',
    summary             TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at         TIMESTAMPTZ
);

COMMENT ON TABLE staging_reviews IS 'Tracks rule-change review sessions in staging environment.';
COMMENT ON COLUMN staging_reviews.status IS 'pending | approved | rejected | changes_requested';

CREATE INDEX IF NOT EXISTS idx_staging_reviews_status ON staging_reviews (status);