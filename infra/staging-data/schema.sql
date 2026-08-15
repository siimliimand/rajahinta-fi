-- =============================================================================
-- Staging schema — self-contained DDL for Rajahinta.fi staging PostgreSQL
-- =============================================================================
-- Mirrors the Drizzle ORM schemas defined in packages/data-platform/src/index.ts
-- but as raw SQL for direct DB setup outside the NestJS migration pipeline.
--
-- PostgreSQL 16 + TimescaleDB 2.16 compatible.
--
-- Apply: psql -f schema.sql
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. Products — canonical product records
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS products (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(512) NOT NULL,
    brand           VARCHAR(256),
    container_type  VARCHAR(32) NOT NULL,
    volume_litres   NUMERIC(10, 4) NOT NULL,
    alcohol_by_volume NUMERIC(5, 3),
    ean             VARCHAR(13),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE products IS 'Canonical product master — every product tracked once.';
COMMENT ON COLUMN products.container_type IS 'e.g. bottle, can, keg, carton, pouch';
COMMENT ON COLUMN products.alcohol_by_volume IS 'ABV — NULL for non-alcoholic products';
COMMENT ON COLUMN products.ean IS 'EAN-13 barcode (Finnish or global)';

CREATE INDEX IF NOT EXISTS idx_products_ean ON products (ean);
CREATE INDEX IF NOT EXISTS idx_products_name ON products (name);

-- ---------------------------------------------------------------------------
-- 2. Merchant offers — scraped price points
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS merchant_offers (
    id              SERIAL PRIMARY KEY,
    product_id      INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    merchant_id     VARCHAR(128) NOT NULL,
    price_cents     INTEGER NOT NULL,
    currency        VARCHAR(3) NOT NULL DEFAULT 'EUR',
    source_url      VARCHAR(1024),
    reliability     VARCHAR(16) NOT NULL DEFAULT 'EXACT',
    observed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE merchant_offers IS 'Price offers observed from external merchants.';
COMMENT ON COLUMN merchant_offers.reliability IS 'EXACT | ESTIMATED | STALE';
COMMENT ON COLUMN merchant_offers.observed_at IS 'When this price was collected';

CREATE INDEX IF NOT EXISTS idx_merchant_offers_product ON merchant_offers (product_id);
CREATE INDEX IF NOT EXISTS idx_merchant_offers_merchant ON merchant_offers (merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_offers_observed ON merchant_offers (observed_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Tax rate versions — never overwritten, always appended
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tax_rate_versions (
    id              SERIAL PRIMARY KEY,
    version_label   VARCHAR(64) NOT NULL,
    effective_from  TIMESTAMPTZ NOT NULL,
    effective_to    TIMESTAMPTZ,
    confirmed_at    TIMESTAMPTZ,
    rates           JSONB NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE tax_rate_versions IS 'Versioned tax rate datasets — never mutated in place.';
COMMENT ON COLUMN tax_rate_versions.effective_to IS 'NULL means currently active';
COMMENT ON COLUMN tax_rate_versions.confirmed_at IS 'When manually/legally confirmed — NULL if pending';
COMMENT ON COLUMN tax_rate_versions.rates IS 'Full rate tree as JSONB (alcohol, tobacco, fuel, etc.)';

CREATE INDEX IF NOT EXISTS idx_tax_rate_versions_effective
    ON tax_rate_versions (effective_from, effective_to);

-- ---------------------------------------------------------------------------
-- 4. Transport rates — carrier shipping cost data
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS transport_rates (
    id                  SERIAL PRIMARY KEY,
    carrier_id          VARCHAR(128) NOT NULL,
    origin_country      VARCHAR(4) NOT NULL,
    destination_country VARCHAR(4) NOT NULL DEFAULT 'FI',
    base_price_cents    INTEGER NOT NULL,
    price_per_kg_cents  NUMERIC(10, 4),
    min_weight_kg       NUMERIC(8, 2),
    max_weight_kg       NUMERIC(8, 2),
    effective_from      TIMESTAMPTZ NOT NULL,
    effective_to        TIMESTAMPTZ,
    reliability         VARCHAR(16) NOT NULL DEFAULT 'EXACT',
    refreshed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE transport_rates IS 'Carrier transport-rate offers for import routes.';
COMMENT ON COLUMN transport_rates.carrier_id IS 'Carrier identifier (e.g. posti, dhl_fi, db_schenker)';
COMMENT ON COLUMN transport_rates.reliability IS 'EXACT | ESTIMATED | STALE';

CREATE INDEX IF NOT EXISTS idx_transport_rates_origin
    ON transport_rates (origin_country, destination_country);
CREATE INDEX IF NOT EXISTS idx_transport_rates_carrier
    ON transport_rates (carrier_id);

-- ---------------------------------------------------------------------------
-- 5. Calculation audit trail — every figure is traceable
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS calculation_audit (
    id                  SERIAL PRIMARY KEY,
    session_id          VARCHAR(64) NOT NULL,
    input_snapshot      JSONB NOT NULL,
    result_snapshot     JSONB NOT NULL,
    rate_version_id     INTEGER REFERENCES tax_rate_versions(id),
    disclaimer_language VARCHAR(2) NOT NULL,
    calculated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE calculation_audit IS 'Audit trail — every calculated figure traceable to inputs, rates, and timestamp.';
COMMENT ON COLUMN calculation_audit.session_id IS 'Client session identifier for grouping related calculations';
COMMENT ON COLUMN calculation_audit.input_snapshot IS 'Product data, merchant offer, transport rate, ABV, volume used';
COMMENT ON COLUMN calculation_audit.result_snapshot IS 'All calculated figures: excise, container duty, transport, total';
COMMENT ON COLUMN calculation_audit.disclaimer_language IS 'Language code (fi, sv, en) — disclaimer baked into result';

CREATE INDEX IF NOT EXISTS idx_calc_audit_session ON calculation_audit (session_id);
CREATE INDEX IF NOT EXISTS idx_calc_audit_rate_version ON calculation_audit (rate_version_id);
CREATE INDEX IF NOT EXISTS idx_calc_audit_calculated_at ON calculation_audit (calculated_at DESC);

-- ---------------------------------------------------------------------------
-- 6. Staging review table — tracks rule-change review sessions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS staging_reviews (
    id                  SERIAL PRIMARY KEY,
    review_label        VARCHAR(128) NOT NULL,
    previous_version_id INTEGER REFERENCES tax_rate_versions(id),
    proposed_version_id INTEGER REFERENCES tax_rate_versions(id),
    reviewer            VARCHAR(256),
    status              VARCHAR(32) NOT NULL DEFAULT 'pending',
    summary             TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at         TIMESTAMPTZ
);

COMMENT ON TABLE staging_reviews IS 'Tracks rule-change review sessions in staging environment.';
COMMENT ON COLUMN staging_reviews.status IS 'pending | approved | rejected | changes_requested';

CREATE INDEX IF NOT EXISTS idx_staging_reviews_status ON staging_reviews (status);

COMMIT;