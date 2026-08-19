-- =============================================================================
-- Staging seed data — realistic Finnish tax-rule and merchant data
-- =============================================================================
-- Intended for the staging environment's independent Postgres copy.
-- Idempotent via TRUNCATE + INSERT (run through setup.sh).
--
-- Contains:
--   1. Tax rules (normalized rows by type/category — alcohol, tobacco, container)
--   2. Transport-offer reference data for common import routes
--   3. Sample merchants (5 varied profiles)
--   4. Sample products per merchant with retail offers
--   5. Golden dataset — pre-calculated scenarios for CI regression tests
--
-- IMPORTANT: Seed rows are inserted in a fixed order so that auto-generated
-- SERIAL IDs are deterministic.  Any change to insert order or count will
-- shift FK references in the golden dataset.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. TAX RULES
-- =============================================================================
-- Finnish excise rates sourced from Vero Skatt (Tax Administration) publications.
-- Normalized per (tax_type × product_category × version_label).
-- Formula references map to math functions in the tax engine.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Version 2024-01 — rates effective 2024-01-01 (IDs 1—11)
-- ---------------------------------------------------------------------------

-- Note: product_category values use the canonical taxonomy keys from
-- packages/core-domain/src/tax/tax-categories.ts.  The normaliseCategory()
-- function maps legacy aliases to these keys at runtime.

INSERT INTO tax_rules (tax_type, product_category, rate, effective_from, effective_to, exemption_conditions, calculation_formula_reference, official_source, verification_date, version_label)
VALUES
    -- Excise duty — alcohol
    -- Spirits: €29.50/litre of pure alcohol (stored in cents: 2950.00)
    ('excise_duty', 'spirits',              2950.000000, '2024-01-01T00:00:00+02:00', '2024-12-31T23:59:59+02:00', NULL, 'PER_LITRE_OF_ALCOHOL', 'https://www.vero.fi/valmisteverotus', '2023-12-15T10:00:00+02:00', '2024-01'),
    -- Beer: €33.00/hl/°Plato full rate (PER_DEGREE_PLATO — rate used with abv fraction)
    ('excise_duty', 'beer',                 3300.000000, '2024-01-01T00:00:00+02:00', '2024-12-31T23:59:59+02:00', '{"max_abv": 0.5, "description": "Beer ≤ 0.5 %ABV not subject to excise"}'::jsonb, 'PER_DEGREE_PLATO', 'https://www.vero.fi/valmisteverotus', '2023-12-15T10:00:00+02:00', '2024-01'),
    -- Still wine > 1.2 %ABV: €3.40/litre of product
    ('excise_duty', 'wine_still',           340.000000,  '2024-01-01T00:00:00+02:00', '2024-12-31T23:59:59+02:00', '{"min_abv": 1.2, "max_abv": 15, "description": "Still wine 1.2–15 %ABV"}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'https://www.vero.fi/valmisteverotus', '2023-12-15T10:00:00+02:00', '2024-01'),
    -- Still wine 15–18 %ABV: €4.55/litre of product
    ('excise_duty', 'wine_still',           455.000000,  '2024-01-01T00:00:00+02:00', '2024-12-31T23:59:59+02:00', '{"min_abv": 15, "max_abv": 18, "description": "Still wine 15–18 %ABV"}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'https://www.vero.fi/valmisteverotus', '2023-12-15T10:00:00+02:00', '2024-01'),
    -- Sparkling wine > 1.2 %ABV: €3.73/litre of product
    ('excise_duty', 'wine_sparkling',       373.000000,  '2024-01-01T00:00:00+02:00', '2024-12-31T23:59:59+02:00', '{"min_abv": 1.2, "description": "Sparkling wine > 1.2 %ABV"}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'https://www.vero.fi/valmisteverotus', '2023-12-15T10:00:00+02:00', '2024-01'),
    -- Intermediate products ≤ 15 %ABV: €3.40/litre of product
    ('excise_duty', 'intermediate_products', 340.000000, '2024-01-01T00:00:00+02:00', '2024-12-31T23:59:59+02:00', '{"max_abv": 15, "description": "Intermediate products ≤ 15 %ABV"}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'https://www.vero.fi/valmisteverotus', '2023-12-15T10:00:00+02:00', '2024-01'),
    -- Intermediate products > 15 %ABV: €4.55/litre of product
    ('excise_duty', 'intermediate_products', 455.000000, '2024-01-01T00:00:00+02:00', '2024-12-31T23:59:59+02:00', '{"min_abv": 15, "max_abv": 22, "description": "Intermediate products 15–22 %ABV"}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'https://www.vero.fi/valmisteverotus', '2023-12-15T10:00:00+02:00', '2024-01'),
    -- Other fermented > 2.8 %ABV: €3.40/litre of product
    ('excise_duty', 'other_fermented',      340.000000,  '2024-01-01T00:00:00+02:00', '2024-12-31T23:59:59+02:00', '{"min_abv": 2.8, "description": "Other fermented beverages > 2.8 %ABV"}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'https://www.vero.fi/valmisteverotus', '2023-12-15T10:00:00+02:00', '2024-01'),
    -- Excise duty — tobacco
    ('excise_duty', 'cigarettes',            64200.000000, '2024-01-01T00:00:00+02:00', '2024-12-31T23:59:59+02:00', NULL, 'per_1000_based', 'https://www.vero.fi/valmisteverotus', '2023-12-15T10:00:00+02:00', '2024-01'),
    ('excise_duty', 'cigars',                38500.000000, '2024-01-01T00:00:00+02:00', '2024-12-31T23:59:59+02:00', NULL, 'per_1000_based', 'https://www.vero.fi/valmisteverotus', '2023-12-15T10:00:00+02:00', '2024-01'),
    ('excise_duty', 'fine_cut_tobacco',       32500.000000, '2024-01-01T00:00:00+02:00', '2024-12-31T23:59:59+02:00', NULL, 'per_kg_based', 'https://www.vero.fi/valmisteverotus', '2023-12-15T10:00:00+02:00', '2024-01'),
    ('excise_duty', 'pipe_tobacco',           24500.000000, '2024-01-01T00:00:00+02:00', '2024-12-31T23:59:59+02:00', NULL, 'per_kg_based', 'https://www.vero.fi/valmisteverotus', '2023-12-15T10:00:00+02:00', '2024-01'),
    -- Container duty: €0.51/litre flat rate on all beverage containers
    ('container_duty', 'all_beverages',     51.000000,    '2024-01-01T00:00:00+02:00', '2024-12-31T23:59:59+02:00', NULL, 'FLAT_PER_LITRE', 'https://www.vero.fi/valmisteverotus', '2023-12-15T10:00:00+02:00', '2024-01');

-- ---------------------------------------------------------------------------
-- Version 2025-01 — rates effective 2025-01-01, index-adjusted (IDs 12—22)
-- ---------------------------------------------------------------------------

INSERT INTO tax_rules (tax_type, product_category, rate, effective_from, effective_to, exemption_conditions, calculation_formula_reference, official_source, verification_date, version_label)
VALUES
    -- Excise duty — alcohol
    ('excise_duty', 'spirits',              3044.000000, '2025-01-01T00:00:00+02:00', '2025-12-31T23:59:59+02:00', NULL, 'PER_LITRE_OF_ALCOHOL', 'https://www.vero.fi/valmisteverotus', '2024-12-10T14:30:00+02:00', '2025-01'),
    ('excise_duty', 'beer',                 3404.000000, '2025-01-01T00:00:00+02:00', '2025-12-31T23:59:59+02:00', '{"max_abv": 0.5, "description": "Beer ≤ 0.5 %ABV not subject to excise"}'::jsonb, 'PER_DEGREE_PLATO', 'https://www.vero.fi/valmisteverotus', '2024-12-10T14:30:00+02:00', '2025-01'),
    ('excise_duty', 'wine_still',           351.000000,  '2025-01-01T00:00:00+02:00', '2025-12-31T23:59:59+02:00', '{"min_abv": 1.2, "max_abv": 15, "description": "Still wine 1.2–15 %ABV"}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'https://www.vero.fi/valmisteverotus', '2024-12-10T14:30:00+02:00', '2025-01'),
    ('excise_duty', 'wine_still',           470.000000,  '2025-01-01T00:00:00+02:00', '2025-12-31T23:59:59+02:00', '{"min_abv": 15, "max_abv": 18, "description": "Still wine 15–18 %ABV"}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'https://www.vero.fi/valmisteverotus', '2024-12-10T14:30:00+02:00', '2025-01'),
    ('excise_duty', 'wine_sparkling',       385.000000,  '2025-01-01T00:00:00+02:00', '2025-12-31T23:59:59+02:00', '{"min_abv": 1.2, "description": "Sparkling wine > 1.2 %ABV"}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'https://www.vero.fi/valmisteverotus', '2024-12-10T14:30:00+02:00', '2025-01'),
    ('excise_duty', 'intermediate_products', 351.000000, '2025-01-01T00:00:00+02:00', '2025-12-31T23:59:59+02:00', '{"max_abv": 15, "description": "Intermediate products ≤ 15 %ABV"}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'https://www.vero.fi/valmisteverotus', '2024-12-10T14:30:00+02:00', '2025-01'),
    ('excise_duty', 'intermediate_products', 470.000000, '2025-01-01T00:00:00+02:00', '2025-12-31T23:59:59+02:00', '{"min_abv": 15, "max_abv": 22, "description": "Intermediate products 15–22 %ABV"}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'https://www.vero.fi/valmisteverotus', '2024-12-10T14:30:00+02:00', '2025-01'),
    ('excise_duty', 'other_fermented',      351.000000,  '2025-01-01T00:00:00+02:00', '2025-12-31T23:59:59+02:00', '{"min_abv": 2.8, "description": "Other fermented beverages > 2.8 %ABV"}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'https://www.vero.fi/valmisteverotus', '2024-12-10T14:30:00+02:00', '2025-01'),
    -- Excise duty — tobacco
    ('excise_duty', 'cigarettes',             66200.000000, '2025-01-01T00:00:00+02:00', '2025-12-31T23:59:59+02:00', NULL, 'per_1000_based', 'https://www.vero.fi/valmisteverotus', '2024-12-10T14:30:00+02:00', '2025-01'),
    ('excise_duty', 'cigars',                 39700.000000, '2025-01-01T00:00:00+02:00', '2025-12-31T23:59:59+02:00', NULL, 'per_1000_based', 'https://www.vero.fi/valmisteverotus', '2024-12-10T14:30:00+02:00', '2025-01'),
    ('excise_duty', 'fine_cut_tobacco',       33500.000000, '2025-01-01T00:00:00+02:00', '2025-12-31T23:59:59+02:00', NULL, 'per_kg_based', 'https://www.vero.fi/valmisteverotus', '2024-12-10T14:30:00+02:00', '2025-01'),
    ('excise_duty', 'pipe_tobacco',           25300.000000, '2025-01-01T00:00:00+02:00', '2025-12-31T23:59:59+02:00', NULL, 'per_kg_based', 'https://www.vero.fi/valmisteverotus', '2024-12-10T14:30:00+02:00', '2025-01'),
    -- Container duty (2025 rates): €0.51/litre flat rate on all beverage containers
    ('container_duty', 'all_beverages',     51.000000,    '2025-01-01T00:00:00+02:00', '2025-12-31T23:59:59+02:00', NULL, 'FLAT_PER_LITRE', 'https://www.vero.fi/valmisteverotus', '2024-12-10T14:30:00+02:00', '2025-01');

-- ---------------------------------------------------------------------------
-- Version 2026-PROPOSAL — proposed rates for review cycle (IDs 23—38)
-- Raises spirits duty +5% and adds nicotine product categories.
-- This version is NOT yet confirmed (verification_date = NULL).
-- Marked inactive by setting effective_to to a past date.
-- ---------------------------------------------------------------------------

INSERT INTO tax_rules (tax_type, product_category, rate, effective_from, effective_to, exemption_conditions, calculation_formula_reference, official_source, verification_date, version_label)
VALUES
    -- Excise duty — alcohol (2026 proposed)
    ('excise_duty', 'spirits',              3196.000000, '2026-01-01T00:00:00+02:00', '2025-01-01T00:00:00+02:00', NULL, 'PER_LITRE_OF_ALCOHOL', 'https://www.vero.fi/valmisteverotus', NULL, '2026-PROPOSAL'),
    ('excise_duty', 'beer',                 3506.000000, '2026-01-01T00:00:00+02:00', '2025-01-01T00:00:00+02:00', '{"max_abv": 0.5, "description": "Beer ≤ 0.5 %ABV not subject to excise"}'::jsonb, 'PER_DEGREE_PLATO', 'https://www.vero.fi/valmisteverotus', NULL, '2026-PROPOSAL'),
    ('excise_duty', 'wine_still',           362.000000,  '2026-01-01T00:00:00+02:00', '2025-01-01T00:00:00+02:00', '{"min_abv": 1.2, "max_abv": 15, "description": "Still wine 1.2–15 %ABV"}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'https://www.vero.fi/valmisteverotus', NULL, '2026-PROPOSAL'),
    ('excise_duty', 'wine_still',           484.000000,  '2026-01-01T00:00:00+02:00', '2025-01-01T00:00:00+02:00', '{"min_abv": 15, "max_abv": 18, "description": "Still wine 15–18 %ABV"}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'https://www.vero.fi/valmisteverotus', NULL, '2026-PROPOSAL'),
    ('excise_duty', 'wine_sparkling',       397.000000,  '2026-01-01T00:00:00+02:00', '2025-01-01T00:00:00+02:00', '{"min_abv": 1.2, "description": "Sparkling wine > 1.2 %ABV"}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'https://www.vero.fi/valmisteverotus', NULL, '2026-PROPOSAL'),
    ('excise_duty', 'intermediate_products', 362.000000, '2026-01-01T00:00:00+02:00', '2025-01-01T00:00:00+02:00', '{"max_abv": 15, "description": "Intermediate products ≤ 15 %ABV"}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'https://www.vero.fi/valmisteverotus', NULL, '2026-PROPOSAL'),
    ('excise_duty', 'intermediate_products', 484.000000, '2026-01-01T00:00:00+02:00', '2025-01-01T00:00:00+02:00', '{"min_abv": 15, "max_abv": 22, "description": "Intermediate products 15–22 %ABV"}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'https://www.vero.fi/valmisteverotus', NULL, '2026-PROPOSAL'),
    ('excise_duty', 'other_fermented',      362.000000,  '2026-01-01T00:00:00+02:00', '2025-01-01T00:00:00+02:00', '{"min_abv": 2.8, "description": "Other fermented beverages > 2.8 %ABV"}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'https://www.vero.fi/valmisteverotus', NULL, '2026-PROPOSAL'),
    -- Excise duty — tobacco (2026 proposed)
    ('excise_duty', 'cigarettes',             68200.000000, '2026-01-01T00:00:00+02:00', '2025-01-01T00:00:00+02:00', NULL, 'per_1000_based', 'https://www.vero.fi/valmisteverotus', NULL, '2026-PROPOSAL'),
    ('excise_duty', 'cigars',                 40900.000000, '2026-01-01T00:00:00+02:00', '2025-01-01T00:00:00+02:00', NULL, 'per_1000_based', 'https://www.vero.fi/valmisteverotus', NULL, '2026-PROPOSAL'),
    ('excise_duty', 'fine_cut_tobacco',       34500.000000, '2026-01-01T00:00:00+02:00', '2025-01-01T00:00:00+02:00', NULL, 'per_kg_based', 'https://www.vero.fi/valmisteverotus', NULL, '2026-PROPOSAL'),
    ('excise_duty', 'pipe_tobacco',           26000.000000, '2026-01-01T00:00:00+02:00', '2025-01-01T00:00:00+02:00', NULL, 'per_kg_based', 'https://www.vero.fi/valmisteverotus', NULL, '2026-PROPOSAL'),
    -- Container duty (2026 proposed rates — inactive)
    ('container_duty', 'all_beverages',     53.000000,    '2026-01-01T00:00:00+02:00', '2025-01-01T00:00:00+02:00', NULL, 'FLAT_PER_LITRE', 'https://www.vero.fi/valmisteverotus', NULL, '2026-PROPOSAL'),
    -- New nicotine categories (2026 proposed — inactive)
    ('excise_duty', 'nicotine_pouches',       25.000000,    '2026-01-01T00:00:00+02:00', '2025-01-01T00:00:00+02:00', NULL, 'per_gram_based', 'https://www.vero.fi/valmisteverotus', NULL, '2026-PROPOSAL'),
    ('excise_duty', 'e_liquid',               40.000000,    '2026-01-01T00:00:00+02:00', '2025-01-01T00:00:00+02:00', NULL, 'per_ml_based', 'https://www.vero.fi/valmisteverotus', NULL, '2026-PROPOSAL'),
    ('excise_duty', 'snus',                   28000.000000, '2026-01-01T00:00:00+02:00', '2025-01-01T00:00:00+02:00', NULL, 'per_kg_based', 'https://www.vero.fi/valmisteverotus', NULL, '2026-PROPOSAL');

-- =============================================================================
-- 2. TRANSPORT OFFERS
-- =============================================================================
-- Carrier shipping-cost data for common import routes to Finland.
-- Deterministic ID sequence: 1—12

INSERT INTO transport_offers (carrier, origin_country, destination_country, weight_min_kg, weight_max_kg, package_tier, price_cents, currency, seller_involvement_indicator, refreshed_at, reliability_status)
VALUES
    ('posti_freight',   'EE', 'FI',   0.0,    50.0,   'parcel', 2500,  'EUR', FALSE, '2024-01-01T00:00:00+02:00', 'EXACT'),
    ('posti_freight',   'EE', 'FI',   50.0,   500.0,  'pallet', 4500,  'EUR', FALSE, '2024-01-01T00:00:00+02:00', 'EXACT'),
    ('dhl_fi',          'DE', 'FI',   0.0,    30.0,   'parcel', 3500,  'EUR', FALSE, '2024-01-01T00:00:00+02:00', 'EXACT'),
    ('dhl_fi',          'DE', 'FI',   30.0,   300.0,  'box',    6500,  'EUR', FALSE, '2024-01-01T00:00:00+02:00', 'EXACT'),
    ('db_schenker',     'DE', 'FI',   100.0,  2000.0, 'pallet', 5500,  'EUR', FALSE, '2024-01-01T00:00:00+02:00', 'EXACT'),
    ('db_schenker',     'NL', 'FI',   100.0,  2000.0, 'pallet', 5800,  'EUR', FALSE, '2024-01-01T00:00:00+02:00', 'EXACT'),
    ('maersk_fi',       'CN', 'FI',   500.0,  25000.0,'pallet', 85000, 'EUR', FALSE, '2024-01-01T00:00:00+02:00', 'EXACT'),
    ('maersk_fi',       'US', 'FI',   500.0,  25000.0,'pallet', 72000, 'EUR', FALSE, '2024-01-01T00:00:00+02:00', 'EXACT'),
    ('vr_transport',    'SE', 'FI',   0.0,    1000.0, 'parcel', 3200,  'EUR', FALSE, '2024-01-01T00:00:00+02:00', 'EXACT'),
    ('vr_transport',    'SE', 'FI',   1000.0, 10000.0,'pallet', 5200,  'EUR', FALSE, '2024-01-01T00:00:00+02:00', 'EXACT'),
    ('dsv_fi',          'IT', 'FI',   0.0,    50.0,   'parcel', 4200,  'EUR', FALSE, '2024-01-01T00:00:00+02:00', 'EXACT'),
    ('kaukokiito',      'EE', 'FI',   0.0,    100.0,  'parcel', 1800,  'EUR', FALSE, '2024-01-01T00:00:00+02:00', 'ESTIMATED');

-- =============================================================================
-- 3. PRODUCT MASTER + RETAIL OFFERS
-- =============================================================================
-- Product IDs are determined by insert order (all products before any offers).
-- Deterministic product_master IDs: 1—44 (5 merchants), plus 45 (misc standalone).
-- Deterministic retail_offer IDs: 1—44 (one per product for first 44 products).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Merchant: HelsinkiPremium Oy — Large alcohol importer (products 1—10)
-- ---------------------------------------------------------------------------
INSERT INTO product_master (name, manufacturer, brand, category, alcohol_by_volume, unit_volume, container_type, regulatory_classification, deposit_system_status, ean)
VALUES
    ('Koskenkorva Viina',        'Koskenkorva',   'Koskenkorva',   'spirits', 38.000, 0.700, 'bottle', 'alcoholic_beverage', FALSE, '6410600010101'),
    ('Koskenkorva Salmiakki',    'Koskenkorva',   'Koskenkorva',   'spirits', 32.000, 0.500, 'bottle', 'alcoholic_beverage', FALSE, '6410600010118'),
    ('Absolut Vodka',            'Absolut',       'Absolut',       'spirits', 40.000, 0.700, 'bottle', 'alcoholic_beverage', FALSE, '7312040017306'),
    ('Absolut Original',        'Absolut',       'Absolut',       'spirits', 40.000, 1.000, 'bottle', 'alcoholic_beverage', FALSE, '7312040017313'),
    ('Jameson Irish Whiskey',    'Jameson',       'Jameson',       'spirits', 40.000, 0.700, 'bottle', 'alcoholic_beverage', FALSE, '5011007000218'),
    ('Johnnie Walker Black Label', 'Johnnie Walker', 'Johnnie Walker', 'spirits', 40.000, 0.700, 'bottle', 'alcoholic_beverage', FALSE, '5000267015777'),
    ('Beefeater London Dry Gin', 'Beefeater',     'Beefeater',     'spirits', 40.000, 0.700, 'bottle', 'alcoholic_beverage', FALSE, '5010327104830'),
    ('Bacardi Carta Blanca',     'Bacardi',       'Bacardi',       'spirits', 37.500, 0.700, 'bottle', 'alcoholic_beverage', FALSE, '5000219000172'),
    ('Château Margaux 2019',     'Château Margaux','Château Margaux','wine_still', 13.500, 0.750, 'bottle', 'alcoholic_beverage', FALSE, '3350930000197'),
    ('Moët & Chandon Brut',      'Moët & Chandon','Moët & Chandon','wine_sparkling', 12.000, 0.750, 'bottle', 'alcoholic_beverage', FALSE, '3057640032593');

INSERT INTO retail_offers (merchant, country, product_id, price_cents, currency, availability, source_url, reliability_status)
SELECT 'helsinki_premium', 'EE', id, price, 'EUR', 'in_stock', 'https://helsinkipremium.fi/tuote/' || id, 'EXACT'
FROM (VALUES
    (1,  3290),
    (2,  2590),
    (3,  3490),
    (4,  4490),
    (5,  5990),
    (6,  7490),
    (7,  3990),
    (8,  3790),
    (9,  45000),
    (10, 8990)
) AS t(id, price);

-- ---------------------------------------------------------------------------
-- Merchant: SuomiLogistiikka — Medium general importer (products 11—20)
-- ---------------------------------------------------------------------------
INSERT INTO product_master (name, manufacturer, brand, category, alcohol_by_volume, unit_volume, container_type, regulatory_classification, deposit_system_status, ean)
VALUES
    ('Sandels Lager 24pk',       'Sandels',       'Sandels',       'beer', 4.700,  0.330, 'can',    'alcoholic_beverage', TRUE,  '6411953111110'),
    ('Karjala 24pk',             'Karjala',       'Karjala',       'beer', 4.600, 0.330, 'can',    'alcoholic_beverage', TRUE,  '6411953222220'),
    ('Lapin Kulta 24pk',         'Lapin Kulta',   'Lapin Kulta',   'beer', 4.500, 0.330, 'can',    'alcoholic_beverage', TRUE,  '6411953333330'),
    ('Olvi 12pk',                'Olvi',          'Olvi',          'beer', 4.500, 0.330, 'can',    'alcoholic_beverage', TRUE,  '6411953444440'),
    ('Koff 24pk',                'Koff',          'Koff',          'beer', 4.700,  0.330, 'bottle', 'alcoholic_beverage', TRUE,  '6411953555550'),
    ('Fanta Orange',             'Fanta',         'Fanta',         'non_alcoholic', NULL,  1.500, 'bottle', 'non_alcoholic_beverage', TRUE, '5449000000996'),
    ('Coca-Cola 24pk',           'Coca-Cola',     'Coca-Cola',     'non_alcoholic', NULL,  0.330, 'can',    'non_alcoholic_beverage', TRUE, '5449000009999'),
    ('Bonduelle Herneet',        'Bonduelle',     'Bonduelle',     'non_alcoholic', NULL,  0.400, 'can',    'food_product', TRUE,    '6412400012340'),
    ('Kevytmaito',               'Valio',         'Valio',         'non_alcoholic', NULL,  1.000, 'carton', 'non_alcoholic_beverage', FALSE, '6410123456780'),
    ('Pirkka Pasta',             'Pirkka',        'Pirkka',        'non_alcoholic', NULL,  0.500, 'pouch',  'food_product', FALSE,   '6412400056789');

INSERT INTO retail_offers (merchant, country, product_id, price_cents, currency, availability, source_url, reliability_status)
SELECT 'suomi_logistiikka', 'FI', id, price, 'EUR', 'in_stock', 'https://suomilogistiikka.fi/product/' || id, 'EXACT'
FROM (VALUES
    (11, 3299),
    (12, 3099),
    (13, 2999),
    (14, 1899),
    (15, 3399),
    (16, 159),
    (17, 2899),
    (18, 99),
    (19, 129),
    (20, 89)
) AS t(id, price);

-- ---------------------------------------------------------------------------
-- Merchant: PohjolanTuonti — Small craft-beer specialist (products 21—28)
-- ---------------------------------------------------------------------------
INSERT INTO product_master (name, manufacturer, brand, category, alcohol_by_volume, unit_volume, container_type, regulatory_classification, deposit_system_status, ean)
VALUES
    ('Põhjala Must Kuld',       'Põhjala',        'Põhjala',        'beer', 10.500, 0.330, 'bottle', 'alcoholic_beverage', TRUE,  '4740079123451'),
    ('Põhjala Virmalised',      'Põhjala',        'Põhjala',        'beer', 8.000,  0.330, 'bottle', 'alcoholic_beverage', TRUE,  '4740079123468'),
    ('Sori Brewing Long Dreams','Sori Brewing',   'Sori Brewing',   'beer', 6.500,  0.440, 'can',    'alcoholic_beverage', TRUE,  '4740079222222'),
    ('Sori Brewing Citra IPA',  'Sori Brewing',   'Sori Brewing',   'beer', 5.500,  0.440, 'can',    'alcoholic_beverage', TRUE,  '4740079222239'),
    ('Mikkeller Green Gold',    'Mikkeller',      'Mikkeller',      'beer', 8.000,  0.330, 'can',    'alcoholic_beverage', TRUE,  '5711833001234'),
    ('To Øl Garden of Eden',    'To Øl',          'To Øl',          'beer', 6.800,  0.330, 'can',    'alcoholic_beverage', TRUE,  '5711833002239'),
    ('Fat Lizard Kama IPA',     'Fat Lizard',     'Fat Lizard',     'beer', 6.500,  0.440, 'can',    'alcoholic_beverage', TRUE,  '6438456000011'),
    ('Fat Lizard Saison',       'Fat Lizard',     'Fat Lizard',     'beer', 5.500,  0.750, 'bottle', 'alcoholic_beverage', TRUE,  '6438456000028');

INSERT INTO retail_offers (merchant, country, product_id, price_cents, currency, availability, source_url, reliability_status)
SELECT 'pohjolan_tuonti', 'EE', id, price, 'EUR', 'in_stock', 'https://pohjolantuonti.fi/tuote/' || id, 'EXACT'
FROM (VALUES
    (21, 599),
    (22, 499),
    (23, 649),
    (24, 549),
    (25, 799),
    (26, 699),
    (27, 589),
    (28, 699)
) AS t(id, price);

-- ---------------------------------------------------------------------------
-- Merchant: ArcticBev — Large beverage importer (products 29—36)
-- ---------------------------------------------------------------------------
INSERT INTO product_master (name, manufacturer, brand, category, alcohol_by_volume, unit_volume, container_type, regulatory_classification, deposit_system_status, ean)
VALUES
    ('Château Haut-Brion 2018', 'Château Haut-Brion','Château Haut-Brion','wine_still', 14.000, 0.750, 'bottle', 'alcoholic_beverage', FALSE, '3350930000198'),
    ('Penfolds Grange 2017',    'Penfolds',        'Penfolds',        'wine_still', 14.500, 0.750, 'bottle', 'alcoholic_beverage', FALSE, '9310297009197'),
    ('Veuve Clicquot Brut',     'Veuve Clicquot',  'Veuve Clicquot',  'wine_sparkling', 12.000, 0.750, 'bottle', 'alcoholic_beverage', FALSE, '3057640050634'),
    ('Grey Goose Vodka',        'Grey Goose',      'Grey Goose',      'spirits', 40.000, 0.700, 'bottle', 'alcoholic_beverage', FALSE, '3100000000190'),
    ('Hennessy XO',             'Hennessy',        'Hennessy',        'spirits', 40.000, 0.700, 'bottle', 'alcoholic_beverage', FALSE, '3100000000398'),
    ('Laphroaig 10 Year Old',   'Laphroaig',       'Laphroaig',       'spirits', 40.000, 0.700, 'bottle', 'alcoholic_beverage', FALSE, '5000213009105'),
    ('Chablis Premier Cru',     'Domaine Pattes Loup','Domaine Pattes Loup','wine_still', 12.500, 0.750, 'bottle', 'alcoholic_beverage', FALSE, '3760036481234'),
    ('Perrier-Jouët Belle Epoque','Perrier-Jouët', 'Perrier-Jouët',   'wine_sparkling', 12.500, 0.750, 'bottle', 'alcoholic_beverage', FALSE, '3057640070632');

INSERT INTO retail_offers (merchant, country, product_id, price_cents, currency, availability, source_url, reliability_status)
SELECT 'arctic_beverages', 'EE', id, price, 'EUR', 'in_stock', 'https://arcticbev.fi/tuote/' || id, 'EXACT'
FROM (VALUES
    (29, 68000),
    (30, 95000),
    (31, 12990),
    (32, 4590),
    (33, 38900),
    (34, 7990),
    (35, 5490),
    (36, 16990)
) AS t(id, price);

-- ---------------------------------------------------------------------------
-- Merchant: NordicTobacco — Specialized tobacco/nicotine importer (products 37—44)
-- ---------------------------------------------------------------------------
INSERT INTO product_master (name, manufacturer, brand, category, alcohol_by_volume, unit_volume, container_type, regulatory_classification, deposit_system_status, ean)
VALUES
    ('Marlboro Red 200pk',      'Marlboro',        'Marlboro',        'cigarettes', NULL, 0.100, 'carton', 'tobacco_product', FALSE, '6412400987654'),
    ('Marlboro Gold 200pk',     'Marlboro',        'Marlboro',        'cigarettes', NULL, 0.100, 'carton', 'tobacco_product', FALSE, '6412400987655'),
    ('Cohiba Behike 56',        'Cohiba',          'Cohiba',          'cigars',     NULL, 0.050, 'box',    'tobacco_product', FALSE, '8100045678901'),
    ('Macanudo Hampton Court',  'Macanudo',        'Macanudo',        'cigars',     NULL, 0.060, 'box',    'tobacco_product', FALSE, '8100045678902'),
    ('Pueblo Classic 30g',      'Pueblo',          'Pueblo',          'fine_cut_tobacco', NULL, 0.030, 'pouch',  'tobacco_product', FALSE, '4041099001234'),
    ('White Cappuccino 50g',    'White',           'White',           'fine_cut_tobacco', NULL, 0.050, 'pouch',  'tobacco_product', FALSE, '4041099002345'),
    ('LYFT Freeze Slim',        'LYFT',            'LYFT',            'nicotine_pouches', 0.000, 0.020, 'can',    'nicotine_product', FALSE, '7350056754321'),
    ('ZYN Nordic Citrus',       'ZYN',             'ZYN',             'nicotine_pouches', 0.000, 0.020, 'can',    'nicotine_product', FALSE, '7350056755678');

INSERT INTO retail_offers (merchant, country, product_id, price_cents, currency, availability, source_url, reliability_status)
SELECT 'nordic_tobacco', 'EE', id, price, 'EUR', 'in_stock', 'https://nordictobacco.fi/product/' || id, 'EXACT'
FROM (VALUES
    (37, 12990),
    (38, 12990),
    (39, 45000),
    (40, 19900),
    (41, 799),
    (42, 1299),
    (43, 699),
    (44, 699)
) AS t(id, price);

-- ---------------------------------------------------------------------------
-- Standalone product for golden dataset scenario 9 (product_master_id = 45)
-- ---------------------------------------------------------------------------
INSERT INTO product_master (name, manufacturer, brand, category, alcohol_by_volume, unit_volume, container_type, regulatory_classification, deposit_system_status, ean)
VALUES ('Sample Aperitif', 'Generic', 'Generic', 'intermediate_products', 18.000, 0.750, 'bottle', 'alcoholic_beverage', FALSE, NULL);

-- =============================================================================
-- 4. GOLDEN DATASET — pre-calculated scenarios for CI regression tests
-- =============================================================================
-- Each scenario exercises a specific calculation path.
-- FK references assume deterministic IDs from the seed order above:
--   tax_rules:    2024-01 (IDs 1—14), 2025-01 (IDs 15—28), 2026-PROPOSAL (IDs 29—45)
--   transport_offers: IDs 1—12 (same order as INSERT above)
--   product_master: IDs 1—44 (merchant products) + 45 (standalone)
--   retail_offers: IDs 1—44 (one per product for products 1—44)
-- =============================================================================

-- Tax rule reference IDs for 2025-01 (used in golden-001 through golden-010):
--   excise/spirits=14, excise/beer=15, excise/wine_still=16, excise/wine_still_high=17,
--   excise/wine_sparkling=18, excise/intermediate_low=19, excise/intermediate_high=20,
--   excise/other_fermented=21, excise/cigarettes=22, container/all_beverages=26
--
-- Tax rule reference IDs for 2026-PROPOSAL (used in golden-011, golden-012):
--   excise/spirits=27, excise/nicotine_pouches=41, container/all_beverages=39

INSERT INTO calculation_records (product_master_id, retail_offer_ids, transport_offer_id, excise_rule_version_id, container_duty_rule_version_id, total_cents, breakdown, confidence, quantity, destination, disclaimer, session_id, calculated_at)
VALUES

-- SCENARIO 1: Standard spirits bottle (0.7L, 40% ABV) — HelsinkiPremium → DHL from DE
(3, '[3]'::jsonb, 3, 14, 26, 83910, '{
    "excise": {"category": "spirits", "pure_alcohol_litres": 0.28, "rate_cents_per_litre": 3044, "amount_cents": 852},
    "container_duty": {"type": "glass_bottle", "rate_cents": 0.51, "quantity": 1, "amount_cents": 1},
    "transport": {"base_cents": 3500, "weight_charge_cents": 144, "total_transport_cents": 3644},
    "merchant_price_cents": 3490,
    "total_estimated_cents": 83910,
    "total_estimated_eur": 839.10,
    "disclaimer": "Estimated total cost in Finland, not final legal tax liability"
}'::jsonb, 'HIGH', 1, 'FI', 'Estimated total cost in Finland, not final legal tax liability', 'golden-001', '2025-06-15T10:00:00+03:00'),

-- SCENARIO 2: Strong beer case (24×0.33L, 4.7% ABV) — SuomiLogistiikka → Posti from EE
(11, '[11]'::jsonb, 1, 15, 26, 7907, '{
    "excise": {"category": "beer", "hectolitre_percent": 0.37224, "rate_cents_per_hlt_percent": 3404, "amount_cents": 1267},
    "container_duty": {"type": "aluminium_can", "rate_cents": 0.51, "quantity": 24, "amount_cents": 12, "deposit_system_exempt": false},
    "transport": {"base_cents": 2500, "weight_charge_cents": 723, "total_transport_cents": 3223},
    "merchant_price_cents": 3299,
    "total_estimated_cents": 7907,
    "total_estimated_eur": 79.07,
    "disclaimer": "Estimated total cost in Finland, not final legal tax liability"
}'::jsonb, 'HIGH', 1, 'FI', 'Estimated total cost in Finland, not final legal tax liability', 'golden-002', '2025-06-15T10:05:00+03:00'),

-- SCENARIO 3: Fine wine (0.75L, 13.5% ABV) — HelsinkiPremium → DB Schenker from DE
(9, '[9]'::jsonb, 5, 16, 26, 50895, '{
    "excise": {"category": "wine_still", "rate_cents_per_litre": 351, "volume_litres": 0.75, "amount_cents": 263},
    "container_duty": {"type": "glass_bottle", "rate_cents": 0.51, "quantity": 1, "amount_cents": 1},
    "transport": {"base_cents": 5500, "weight_charge_cents": 113, "total_transport_cents": 5613},
    "merchant_price_cents": 45000,
    "total_estimated_cents": 50895,
    "total_estimated_eur": 508.95,
    "disclaimer": "Estimated total cost in Finland, not final legal tax liability"
}'::jsonb, 'HIGH', 1, 'FI', 'Estimated total cost in Finland, not final legal tax liability', 'golden-003', '2025-06-15T10:10:00+03:00'),

-- SCENARIO 4: Cigarettes (200pk) — NordicTobacco → DHL from DE
(37, '[37]'::jsonb, 3, 22, NULL, 29766, '{
    "excise": {"category": "cigarettes", "quantity": 200, "rate_cents_per_1000": 66200, "amount_cents": 13240, "ad_valorem": false},
    "container_duty": {"type": "carton", "rate_cents": 0, "quantity": 1, "amount_cents": 0},
    "transport": {"base_cents": 3500, "weight_charge_cents": 36, "total_transport_cents": 3536},
    "merchant_price_cents": 12990,
    "total_estimated_cents": 29766,
    "total_estimated_eur": 297.66,
    "disclaimer": "Estimated total cost in Finland, not final legal tax liability"
}'::jsonb, 'HIGH', 1, 'FI', 'Estimated total cost in Finland, not final legal tax liability', 'golden-004', '2025-06-15T10:15:00+03:00'),

-- SCENARIO 5: Craft beer (single 0.44L, 6.5% ABV) — PohjolanTuonti → Kaukokiito from EE
(23, '[23]'::jsonb, 12, 15, 26, 2580, '{
    "excise": {"category": "beer", "hectolitre_percent": 0.0286, "rate_cents_per_hlt_percent": 3404, "amount_cents": 97},
    "container_duty": {"type": "aluminium_can", "rate_cents": 0.51, "quantity": 1, "amount_cents": 1},
    "transport": {"base_cents": 1800, "weight_charge_cents": 25, "total_transport_cents": 1825},
    "merchant_price_cents": 649,
    "total_estimated_cents": 2580,
    "total_estimated_eur": 25.80,
    "disclaimer": "Estimated total cost in Finland, not final legal tax liability"
}'::jsonb, 'HIGH', 1, 'FI', 'Estimated total cost in Finland, not final legal tax liability', 'golden-005', '2025-06-15T10:20:00+03:00'),

-- SCENARIO 6: Sparkling wine — ArcticBev → DHL from DE
(31, '[31]'::jsonb, 3, 18, 26, 17109, '{
    "excise": {"category": "wine_sparkling", "rate_cents_per_litre": 385, "volume_litres": 0.75, "amount_cents": 289},
    "container_duty": {"type": "glass_bottle", "rate_cents": 0.51, "quantity": 1, "amount_cents": 1},
    "transport": {"base_cents": 3500, "weight_charge_cents": 180, "total_transport_cents": 3680},
    "merchant_price_cents": 12990,
    "total_estimated_cents": 17109,
    "total_estimated_eur": 171.09,
    "disclaimer": "Estimated total cost in Finland, not final legal tax liability"
}'::jsonb, 'HIGH', 1, 'FI', 'Estimated total cost in Finland, not final legal tax liability', 'golden-006', '2025-06-15T10:25:00+03:00'),

-- SCENARIO 7: Non-alcoholic product (no excise) — SuomiLogistiikka → Posti from EE
(17, '[17]'::jsonb, 1, NULL, 26, 6083, '{
    "excise": {"category": "non_alcoholic", "amount_cents": 0, "note": "No excise on non-alcoholic products"},
    "container_duty": {"type": "aluminium_can", "rate_cents": 0.51, "quantity": 24, "amount_cents": 12, "deposit_system_exempt": false},
    "transport": {"base_cents": 2500, "weight_charge_cents": 680, "total_transport_cents": 3180},
    "merchant_price_cents": 2899,
    "total_estimated_cents": 6083,
    "total_estimated_eur": 60.83,
    "disclaimer": "Estimated total cost in Finland, not final legal tax liability"
}'::jsonb, 'HIGH', 1, 'FI', 'Estimated total cost in Finland, not final legal tax liability', 'golden-007', '2025-06-15T10:30:00+03:00'),

-- SCENARIO 8: Premium whisky via sea freight — HelsinkiPremium → Maersk from USA
(6, '[6]'::jsonb, 8, 14, 26, 156650, '{
    "excise": {"category": "spirits", "pure_alcohol_litres": 0.28, "rate_cents_per_litre": 3044, "amount_cents": 852},
    "container_duty": {"type": "glass_bottle", "rate_cents": 0.51, "quantity": 1, "amount_cents": 1},
    "transport": {"base_cents": 72000, "weight_charge_cents": 384, "total_transport_cents": 72384},
    "merchant_price_cents": 7490,
    "total_estimated_cents": 156650,
    "total_estimated_eur": 1566.50,
    "disclaimer": "Estimated total cost in Finland, not final legal tax liability"
}'::jsonb, 'HIGH', 1, 'FI', 'Estimated total cost in Finland, not final legal tax liability', 'golden-008', '2025-06-15T10:35:00+03:00'),

-- SCENARIO 9: Intermediate product (aperitif) — ArcticBev → DSV from IT
(45, NULL, 11, 19, 26, 6957, '{
    "excise": {"category": "intermediate_products", "hectolitres": 0.0075, "rate_cents_per_hectolitre": 351, "amount_cents": 3},
    "container_duty": {"type": "glass_bottle", "rate_cents": 0.51, "quantity": 1, "amount_cents": 1},
    "transport": {"base_cents": 4200, "weight_charge_cents": 110, "total_transport_cents": 4310},
    "merchant_price_cents": 2490,
    "total_estimated_cents": 6957,
    "total_estimated_eur": 69.57,
    "disclaimer": "Estimated total cost in Finland, not final legal tax liability"
}'::jsonb, 'HIGH', 1, 'FI', 'Estimated total cost in Finland, not final legal tax liability', 'golden-009', '2025-06-15T10:40:00+03:00'),

-- SCENARIO 10: Standard beer (4.5%) — SuomiLogistiikka → VR from SE
(13, '[13]'::jsonb, 9, 15, 26, 7819, '{
    "excise": {"category": "beer", "hectolitre_percent": 0.3564, "rate_cents_per_hlt_percent": 3404, "amount_cents": 1213},
    "container_duty": {"type": "glass_bottle", "rate_cents": 0.51, "quantity": 24, "amount_cents": 12, "deposit_system_exempt": false},
    "transport": {"base_cents": 3200, "weight_charge_cents": 495, "total_transport_cents": 3695},
    "merchant_price_cents": 2999,
    "total_estimated_cents": 7819,
    "total_estimated_eur": 78.19,
    "disclaimer": "Estimated total cost in Finland, not final legal tax liability"
}'::jsonb, 'HIGH', 1, 'FI', 'Estimated total cost in Finland, not final legal tax liability', 'golden-010', '2025-06-15T10:45:00+03:00'),

-- SCENARIO 11: Proposed 2026 rates — spirits increase impact (same as golden-001 but 2026 rates)
(3, '[3]'::jsonb, 3, 27, 39, 87774, '{
    "excise": {"category": "spirits", "pure_alcohol_litres": 0.28, "rate_cents_per_litre": 3196, "amount_cents": 895},
    "container_duty": {"type": "glass_bottle", "rate_cents": 0.53, "quantity": 1, "amount_cents": 1},
    "transport": {"base_cents": 3500, "weight_charge_cents": 144, "total_transport_cents": 3644},
    "merchant_price_cents": 3490,
    "total_estimated_cents": 87774,
    "total_estimated_eur": 877.74,
    "disclaimer": "Estimated total cost in Finland, not final legal tax liability"
}'::jsonb, 'HIGH', 1, 'FI', 'Estimated total cost in Finland, not final legal tax liability', 'golden-011', '2025-08-01T10:00:00+03:00'),

-- SCENARIO 12: Nicotine pouches (2026 proposed) — NordicTobacco → Posti from EE
(43, '[43]'::jsonb, 1, 41, 39, 3703, '{
    "excise": {"category": "nicotine_pouches", "weight_grams": 20, "rate_cents_per_gram": 25, "amount_cents": 500, "note": "New nicotine category proposed for 2026"},
    "container_duty": {"type": "aluminium_can", "rate_cents": 0.53, "quantity": 1, "amount_cents": 1},
    "transport": {"base_cents": 2500, "weight_charge_cents": 4, "total_transport_cents": 2504},
    "merchant_price_cents": 699,
    "total_estimated_cents": 3703,
    "total_estimated_eur": 37.03,
    "disclaimer": "Estimated total cost in Finland, not final legal tax liability"
}'::jsonb, 'HIGH', 1, 'FI', 'Estimated total cost in Finland, not final legal tax liability', 'golden-012', '2025-08-01T10:05:00+03:00');

-- =============================================================================
-- 5. STAGING REVIEW RECORDS — track rule-change review sessions
-- =============================================================================

INSERT INTO staging_reviews (review_label, previous_version_id, proposed_version_id, reviewer, status, created_at)
VALUES
    ('2024→2025 index adjustment',  NULL, NULL, 'ops@rajahinta.fi',  'approved',     '2024-12-15T10:00:00+02:00'),
    ('2026 proposed rate change',   NULL, NULL, NULL,                'pending',      '2025-08-01T10:00:00+03:00');

COMMIT;