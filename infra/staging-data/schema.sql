-- =============================================================================
-- Staging schema — self-contained DDL for Rajahinta.fi staging PostgreSQL
-- =============================================================================
-- Mirrors the Drizzle ORM schemas defined in packages/data-platform/src/schema.ts
-- as the canonical single source of truth. Raw SQL for direct DB setup outside
-- the NestJS migration pipeline.
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
-- 1. product_master — canonical product records
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS product_master (
    id                          SERIAL PRIMARY KEY,
    name                        VARCHAR(512) NOT NULL,
    manufacturer                VARCHAR(256) NOT NULL,
    brand                       VARCHAR(256) NOT NULL,
    category                    VARCHAR(32) NOT NULL,
    alcohol_by_volume           NUMERIC(5, 3),
    unit_volume                 NUMERIC(10, 4) NOT NULL,
    container_type              VARCHAR(32) NOT NULL,
    regulatory_classification   VARCHAR(64) NOT NULL,
    deposit_system_status       BOOLEAN NOT NULL DEFAULT FALSE,
    ean                         VARCHAR(13),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE product_master IS 'Canonical product master — every product tracked once.';
COMMENT ON COLUMN product_master.manufacturer IS 'Manufacturer from feed adapter — used for product disambiguation.';
COMMENT ON COLUMN product_master.category IS 'Product category — maps to tax_rules.product_category for excise/duty rule lookup.';
COMMENT ON COLUMN product_master.alcohol_by_volume IS 'ABV (decimal, e.g. 0.047 for 4.7%) — required by excise engine. NULL for non-alcoholic products';
COMMENT ON COLUMN product_master.unit_volume IS 'Unit volume in litres — required for per-volume tax formulas (€/litre).';
COMMENT ON COLUMN product_master.container_type IS 'e.g. bottle, can, keg, carton, pouch — determines container duty rate.';
COMMENT ON COLUMN product_master.regulatory_classification IS 'Regulatory classification from feed — used for tax classification matching.';
COMMENT ON COLUMN product_master.deposit_system_status IS 'True if packaging participates in Finnish deposit-return system — checked by container-duty service for exemption.';
COMMENT ON COLUMN product_master.ean IS 'EAN-13 barcode (Finnish or global).';

CREATE INDEX IF NOT EXISTS idx_product_master_ean ON product_master (ean);
CREATE INDEX IF NOT EXISTS idx_product_master_name ON product_master (name);
CREATE INDEX IF NOT EXISTS idx_product_master_category ON product_master (category);

-- ---------------------------------------------------------------------------
-- 2. retail_offers — scraped price points from external retailers
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS retail_offers (
    id                  SERIAL PRIMARY KEY,
    merchant            VARCHAR(128) NOT NULL,
    country             VARCHAR(4) NOT NULL,
    product_id          INTEGER NOT NULL REFERENCES product_master(id) ON DELETE CASCADE,
    price_cents         INTEGER NOT NULL,
    currency            VARCHAR(3) NOT NULL DEFAULT 'EUR',
    availability        VARCHAR(16) NOT NULL DEFAULT 'unknown',
    source_url          VARCHAR(1024),
    observed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reliability_status  VARCHAR(16) NOT NULL DEFAULT 'ESTIMATED'
);

COMMENT ON TABLE retail_offers IS 'Price offers observed from external retailers.';
COMMENT ON COLUMN retail_offers.merchant IS 'Merchant identifier — distinguishes sources (e.g. "alko", "systembolaget").';
COMMENT ON COLUMN retail_offers.country IS 'Market/origin country (ISO 3166-1 alpha-2).';
COMMENT ON COLUMN retail_offers.availability IS 'Stock status — filters out-of-stock offers from price comparisons.';
COMMENT ON COLUMN retail_offers.reliability_status IS 'EXACT | ESTIMATED | STALE | UNAVAILABLE — surfaced to user per architecture rule.';

CREATE INDEX IF NOT EXISTS idx_retail_offers_product ON retail_offers (product_id);
CREATE INDEX IF NOT EXISTS idx_retail_offers_merchant ON retail_offers (merchant);
CREATE INDEX IF NOT EXISTS idx_retail_offers_observed ON retail_offers (observed_at DESC);

-- ---------------------------------------------------------------------------
-- 3. tax_rules — versioned tax rules, never overwritten, always appended
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tax_rules (
    id                              SERIAL PRIMARY KEY,
    tax_type                        VARCHAR(32) NOT NULL,
    product_category                VARCHAR(32) NOT NULL,
    rate                            NUMERIC(12, 6) NOT NULL,
    effective_from                  TIMESTAMPTZ NOT NULL,
    effective_to                    TIMESTAMPTZ,
    exemption_conditions            JSONB,
    calculation_formula_reference   VARCHAR(128) NOT NULL,
    official_source                 VARCHAR(512) NOT NULL,
    verification_date               TIMESTAMPTZ,
    version_label                   VARCHAR(64) NOT NULL,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE tax_rules IS 'Versioned tax rule datasets — never mutated in place.';
COMMENT ON COLUMN tax_rules.tax_type IS 'Tax type discriminator: "excise_duty" or "container_duty".';
COMMENT ON COLUMN tax_rules.product_category IS 'Matches product_master.category — selects applicable rule for a product.';
COMMENT ON COLUMN tax_rules.rate IS 'Rate value (meaning depends on taxType: €/hl/% for excise, € per unit for container).';
COMMENT ON COLUMN tax_rules.effective_to IS 'NULL means currently active';
COMMENT ON COLUMN tax_rules.exemption_conditions IS 'JSON exemption rules (e.g. {maxAlcoholByVolume: 0.5}) — evaluated by deposit-checker.';
COMMENT ON COLUMN tax_rules.calculation_formula_reference IS 'Math function key — selects the calculation formula in the tax engine.';
COMMENT ON COLUMN tax_rules.official_source IS 'Authoritative publication URL — auditability: "every number is explainable".';
COMMENT ON COLUMN tax_rules.verification_date IS 'When rate was verified against official source — NULL = unverified/ESTIMATED.';
COMMENT ON COLUMN tax_rules.version_label IS 'Human-readable version label (e.g. "v1.0-2024") — used for audit trail.';

CREATE INDEX IF NOT EXISTS idx_tax_rules_effective
    ON tax_rules (effective_from, effective_to);
CREATE INDEX IF NOT EXISTS idx_tax_rules_category
    ON tax_rules (product_category);
CREATE INDEX IF NOT EXISTS idx_tax_rules_version
    ON tax_rules (version_label);

-- ---------------------------------------------------------------------------
-- 4. transport_offers — carrier shipping cost data
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS transport_offers (
    id                              SERIAL PRIMARY KEY,
    carrier                         VARCHAR(64) NOT NULL,
    origin_country                  VARCHAR(4) NOT NULL,
    destination_country             VARCHAR(4) NOT NULL DEFAULT 'FI',
    weight_min_kg                   NUMERIC(10, 4),
    weight_max_kg                   NUMERIC(10, 4),
    package_tier                    VARCHAR(32) NOT NULL,
    price_cents                     INTEGER NOT NULL,
    currency                        VARCHAR(3) NOT NULL DEFAULT 'EUR',
    seller_involvement_indicator    BOOLEAN NOT NULL DEFAULT FALSE,
    observed_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    refreshed_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reliability_status              VARCHAR(16) NOT NULL DEFAULT 'ESTIMATED'
);

COMMENT ON TABLE transport_offers IS 'Carrier transport-rate offers for import routes.';
COMMENT ON COLUMN transport_offers.carrier IS 'Carrier identifier (e.g. matkahuolto, posti).';
COMMENT ON COLUMN transport_offers.weight_min_kg IS 'Weight bracket lower bound in kg — NULL = no lower limit.';
COMMENT ON COLUMN transport_offers.weight_max_kg IS 'Weight bracket upper bound in kg — NULL = no upper limit.';
COMMENT ON COLUMN transport_offers.package_tier IS 'Package tier (parcel/box/pallet) — matches basket dominant type.';
COMMENT ON COLUMN transport_offers.seller_involvement_indicator IS 'True if seller pays shipping (affects landed-cost attribution).';
COMMENT ON COLUMN transport_offers.reliability_status IS 'EXACT | ESTIMATED | STALE | UNAVAILABLE — surfaced to user per architecture rule.';

CREATE INDEX IF NOT EXISTS idx_transport_offers_origin
    ON transport_offers (origin_country, destination_country);
CREATE INDEX IF NOT EXISTS idx_transport_offers_carrier
    ON transport_offers (carrier);

-- ---------------------------------------------------------------------------
-- 5. calculation_records — every landed-cost result shown to a user
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS calculation_records (
    id                              SERIAL PRIMARY KEY,
    product_master_id               INTEGER NOT NULL REFERENCES product_master(id),
    retail_offer_ids                JSONB,
    transport_offer_id              INTEGER REFERENCES transport_offers(id),
    excise_rule_version_id          INTEGER REFERENCES tax_rules(id),
    container_duty_rule_version_id  INTEGER REFERENCES tax_rules(id),
    total_cents                     INTEGER NOT NULL,
    breakdown                       JSONB NOT NULL,
    confidence                      VARCHAR(6) NOT NULL,
    quantity                        INTEGER NOT NULL,
    destination                     VARCHAR(4) NOT NULL,
    disclaimer                      TEXT NOT NULL,
    session_id                      VARCHAR(64),
    calculated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE calculation_records IS 'Audit trail — every calculated figure traceable to inputs, rates, and timestamp.';
COMMENT ON COLUMN calculation_records.product_master_id IS 'FK to product_master — the product this calculation is for.';
COMMENT ON COLUMN calculation_records.retail_offer_ids IS 'JSON array of retail_offer_ids — basket may reference multiple offers.';
COMMENT ON COLUMN calculation_records.transport_offer_id IS 'FK to transport_offers — the shipping option used.';
COMMENT ON COLUMN calculation_records.excise_rule_version_id IS 'FK to tax_rules — excise rule version applied (traceability).';
COMMENT ON COLUMN calculation_records.container_duty_rule_version_id IS 'FK to tax_rules — container duty rule version applied (traceability).';
COMMENT ON COLUMN calculation_records.breakdown IS 'Structured cost breakdown (excise, duty, transport components) — "every number is explainable".';
COMMENT ON COLUMN calculation_records.confidence IS 'Confidence level (HIGH/MEDIUM/LOW) — used by ranking/sorting system.';
COMMENT ON COLUMN calculation_records.session_id IS 'Client session identifier for grouping related calculations.';

CREATE INDEX IF NOT EXISTS idx_calc_records_product ON calculation_records (product_master_id);
CREATE INDEX IF NOT EXISTS idx_calc_records_session ON calculation_records (session_id);
CREATE INDEX IF NOT EXISTS idx_calc_records_calculated_at ON calculation_records (calculated_at DESC);
CREATE INDEX IF NOT EXISTS idx_calc_records_confidence ON calculation_records (confidence);

-- ---------------------------------------------------------------------------
-- 6. staging_reviews — staging-specific: tracks rule-change review sessions
-- ---------------------------------------------------------------------------
-- NOTE: This table has no Drizzle ORM equivalent. It is staging infra only.

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

COMMIT;