-- =============================================================================
-- Staging seed data — Finnish tax-rule and merchant data
-- =============================================================================
-- Tax rules are auto-generated from SEED_RULES (single source of truth).
-- Transport, product, and review data are test fixtures.
--
-- Do NOT edit tax rules by hand — regenerate via:
--   node scripts/export-seed-sql.mjs --out infra/staging-data/seed.sql
-- =============================================================================
BEGIN;

-- ============================================================================
-- Tax rules — auto-generated from SEED_RULES (single source of truth)
-- Generated: 2026-08-21T18:40:12.050Z
-- Do NOT edit by hand — run: node scripts/export-seed-sql.mjs
-- ============================================================================

INSERT INTO tax_rules (tax_type, product_category, rate, effective_from, effective_to, exemption_conditions, calculation_formula_reference, official_source, verification_date, version_label)
VALUES
    ('excise', 'beer', 0.00, '2024-01-01 00:00:00+00:00', '2024-12-31 00:00:00+00:00', '{"description":"Beer ≤ 0.5 %ABV — not subject to excise duty","appliesTo":{"maxAlcoholByVolume":0.5}}'::jsonb, 'PER_CENTILITRE_ETHANOL', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages (vero.fi)', '2024-03-01 00:00:00+00:00', 'v1.0-2024'),
    ('excise', 'beer', 28.35, '2024-01-01 00:00:00+00:00', '2024-12-31 00:00:00+00:00', '{"description":"Beer > 0.5 %ABV up to 3.5 %ABV — 28.35 snt/cl ethanol","appliesTo":{"minAlcoholByVolume":0.5,"maxAlcoholByVolume":3.5}}'::jsonb, 'PER_CENTILITRE_ETHANOL', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages (vero.fi)', '2024-03-01 00:00:00+00:00', 'v1.0-2024'),
    ('excise', 'beer', 36.20, '2024-01-01 00:00:00+00:00', '2024-12-31 00:00:00+00:00', '{"description":"Beer > 3.5 %ABV — 36.20 snt/cl ethanol","appliesTo":{"minAlcoholByVolume":3.5}}'::jsonb, 'PER_CENTILITRE_ETHANOL', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages (vero.fi)', '2024-03-01 00:00:00+00:00', 'v1.0-2024'),
    ('excise', 'wine_still', 0.00, '2024-01-01 00:00:00+00:00', '2024-12-31 00:00:00+00:00', '{"description":"Still wine ≤ 1.2 %ABV — exempt","appliesTo":{"maxAlcoholByVolume":1.2}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages (vero.fi)', '2024-03-01 00:00:00+00:00', 'v1.0-2024'),
    ('excise', 'wine_still', 0.36, '2024-01-01 00:00:00+00:00', '2024-12-31 00:00:00+00:00', '{"description":"Still wine > 1.2 – 2.8 %ABV — 0.36 €/l","appliesTo":{"minAlcoholByVolume":1.2,"maxAlcoholByVolume":2.8}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages (vero.fi)', '2024-03-01 00:00:00+00:00', 'v1.0-2024'),
    ('excise', 'wine_still', 1.98, '2024-01-01 00:00:00+00:00', '2024-12-31 00:00:00+00:00', '{"description":"Still wine > 2.8 – 5.5 %ABV — 1.98 €/l","appliesTo":{"minAlcoholByVolume":2.8,"maxAlcoholByVolume":5.5}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages (vero.fi)', '2024-03-01 00:00:00+00:00', 'v1.0-2024'),
    ('excise', 'wine_still', 3.08, '2024-01-01 00:00:00+00:00', '2024-12-31 00:00:00+00:00', '{"description":"Still wine > 5.5 – 8 %ABV — 3.08 €/l","appliesTo":{"minAlcoholByVolume":5.5,"maxAlcoholByVolume":8}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages (vero.fi)', '2024-03-01 00:00:00+00:00', 'v1.0-2024'),
    ('excise', 'wine_still', 4.56, '2024-01-01 00:00:00+00:00', '2024-12-31 00:00:00+00:00', '{"description":"Still wine > 8 – 15 %ABV — 4.56 €/l","appliesTo":{"minAlcoholByVolume":8,"maxAlcoholByVolume":15}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages (vero.fi)', '2024-03-01 00:00:00+00:00', 'v1.0-2024'),
    ('excise', 'wine_still', 4.56, '2024-01-01 00:00:00+00:00', '2024-12-31 00:00:00+00:00', '{"description":"Still wine > 15 – 18 %ABV — 4.56 €/l","appliesTo":{"minAlcoholByVolume":15,"maxAlcoholByVolume":18}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages (vero.fi)', '2024-03-01 00:00:00+00:00', 'v1.0-2024'),
    ('excise', 'wine_sparkling', 0.00, '2024-01-01 00:00:00+00:00', '2024-12-31 00:00:00+00:00', '{"description":"Sparkling wine ≤ 1.2 %ABV — exempt","appliesTo":{"maxAlcoholByVolume":1.2}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages (vero.fi)', '2024-03-01 00:00:00+00:00', 'v1.0-2024'),
    ('excise', 'wine_sparkling', 0.36, '2024-01-01 00:00:00+00:00', '2024-12-31 00:00:00+00:00', '{"description":"Sparkling wine > 1.2 – 2.8 %ABV — 0.36 €/l","appliesTo":{"minAlcoholByVolume":1.2,"maxAlcoholByVolume":2.8}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages (vero.fi)', '2024-03-01 00:00:00+00:00', 'v1.0-2024'),
    ('excise', 'wine_sparkling', 1.98, '2024-01-01 00:00:00+00:00', '2024-12-31 00:00:00+00:00', '{"description":"Sparkling wine > 2.8 – 5.5 %ABV — 1.98 €/l","appliesTo":{"minAlcoholByVolume":2.8,"maxAlcoholByVolume":5.5}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages (vero.fi)', '2024-03-01 00:00:00+00:00', 'v1.0-2024'),
    ('excise', 'wine_sparkling', 3.08, '2024-01-01 00:00:00+00:00', '2024-12-31 00:00:00+00:00', '{"description":"Sparkling wine > 5.5 – 8 %ABV — 3.08 €/l","appliesTo":{"minAlcoholByVolume":5.5,"maxAlcoholByVolume":8}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages (vero.fi)', '2024-03-01 00:00:00+00:00', 'v1.0-2024'),
    ('excise', 'wine_sparkling', 4.56, '2024-01-01 00:00:00+00:00', '2024-12-31 00:00:00+00:00', '{"description":"Sparkling wine > 8 – 15 %ABV — 4.56 €/l","appliesTo":{"minAlcoholByVolume":8,"maxAlcoholByVolume":15}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages (vero.fi)', '2024-03-01 00:00:00+00:00', 'v1.0-2024'),
    ('excise', 'wine_sparkling', 4.56, '2024-01-01 00:00:00+00:00', '2024-12-31 00:00:00+00:00', '{"description":"Sparkling wine > 15 – 18 %ABV — 4.56 €/l","appliesTo":{"minAlcoholByVolume":15,"maxAlcoholByVolume":18}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages (vero.fi)', '2024-03-01 00:00:00+00:00', 'v1.0-2024'),
    ('excise', 'intermediate_products', 5.68, '2024-01-01 00:00:00+00:00', '2024-12-31 00:00:00+00:00', '{"description":"Intermediate products > 1.2 – 15 %ABV — 5.68 €/l","appliesTo":{"minAlcoholByVolume":1.2,"maxAlcoholByVolume":15}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages (vero.fi)', '2024-03-01 00:00:00+00:00', 'v1.0-2024'),
    ('excise', 'intermediate_products', 8.63, '2024-01-01 00:00:00+00:00', '2024-12-31 00:00:00+00:00', '{"description":"Intermediate products > 15 – 22 %ABV — 8.63 €/l","appliesTo":{"minAlcoholByVolume":15,"maxAlcoholByVolume":22}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages (vero.fi)', '2024-03-01 00:00:00+00:00', 'v1.0-2024'),
    ('excise', 'spirits', 0.00, '2024-01-01 00:00:00+00:00', '2024-12-31 00:00:00+00:00', '{"description":"Spirits ≤ 1.2 %ABV — not subject to excise duty","appliesTo":{"maxAlcoholByVolume":1.2}}'::jsonb, 'PER_LITRE_OF_ALCOHOL', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages (vero.fi)', '2024-03-01 00:00:00+00:00', 'v1.0-2024'),
    ('excise', 'spirits', 30.90, '2024-01-01 00:00:00+00:00', '2024-12-31 00:00:00+00:00', '{"description":"Spirits > 1.2 %ABV up to 2.8 %ABV — 30.90 snt/cl ethanol (€30.90/l pure alcohol)","appliesTo":{"minAlcoholByVolume":1.2,"maxAlcoholByVolume":2.8}}'::jsonb, 'PER_LITRE_OF_ALCOHOL', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages (vero.fi)', '2024-03-01 00:00:00+00:00', 'v1.0-2024'),
    ('excise', 'spirits', 54.80, '2024-01-01 00:00:00+00:00', '2024-12-31 00:00:00+00:00', '{"description":"Spirits > 2.8 %ABV — 54.80 snt/cl ethanol (€54.80/l pure alcohol)","appliesTo":{"minAlcoholByVolume":2.8}}'::jsonb, 'PER_LITRE_OF_ALCOHOL', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages (vero.fi)', '2024-03-01 00:00:00+00:00', 'v1.0-2024'),
    ('excise', 'other_fermented', 0.00, '2024-01-01 00:00:00+00:00', '2024-12-31 00:00:00+00:00', '{"description":"Other fermented ≤ 1.2 %ABV — exempt","appliesTo":{"maxAlcoholByVolume":1.2}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages (vero.fi)', '2024-03-01 00:00:00+00:00', 'v1.0-2024'),
    ('excise', 'other_fermented', 0.36, '2024-01-01 00:00:00+00:00', '2024-12-31 00:00:00+00:00', '{"description":"Other fermented > 1.2 – 2.8 %ABV — 0.36 €/l","appliesTo":{"minAlcoholByVolume":1.2,"maxAlcoholByVolume":2.8}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages (vero.fi)', '2024-03-01 00:00:00+00:00', 'v1.0-2024'),
    ('excise', 'other_fermented', 1.98, '2024-01-01 00:00:00+00:00', '2024-12-31 00:00:00+00:00', '{"description":"Other fermented > 2.8 – 5.5 %ABV — 1.98 €/l","appliesTo":{"minAlcoholByVolume":2.8,"maxAlcoholByVolume":5.5}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages (vero.fi)', '2024-03-01 00:00:00+00:00', 'v1.0-2024'),
    ('excise', 'other_fermented', 3.08, '2024-01-01 00:00:00+00:00', '2024-12-31 00:00:00+00:00', '{"description":"Other fermented > 5.5 – 8 %ABV — 3.08 €/l","appliesTo":{"minAlcoholByVolume":5.5,"maxAlcoholByVolume":8}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages (vero.fi)', '2024-03-01 00:00:00+00:00', 'v1.0-2024'),
    ('excise', 'other_fermented', 4.56, '2024-01-01 00:00:00+00:00', '2024-12-31 00:00:00+00:00', '{"description":"Other fermented > 8 – 15 %ABV — 4.56 €/l","appliesTo":{"minAlcoholByVolume":8,"maxAlcoholByVolume":15}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages (vero.fi)', '2024-03-01 00:00:00+00:00', 'v1.0-2024'),
    ('excise', 'other_fermented', 4.56, '2024-01-01 00:00:00+00:00', '2024-12-31 00:00:00+00:00', '{"description":"Other fermented > 15 – 18 %ABV — 4.56 €/l","appliesTo":{"minAlcoholByVolume":15,"maxAlcoholByVolume":18}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages (vero.fi)', '2024-03-01 00:00:00+00:00', 'v1.0-2024'),
    ('container_duty', 'all_beverages', 0.51, '2024-01-01 00:00:00+00:00', '2024-12-31 00:00:00+00:00', NULL, 'FLAT_PER_LITRE', 'Finnish Tax Administration — Excise Duty on Beverage Containers, Rate 2024 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v1.0-2024'),
    ('excise', 'beer', 0.00, '2025-01-01 00:00:00+00:00', '2025-12-31 00:00:00+00:00', '{"description":"Beer ≤ 0.5 %ABV — not subject to excise duty","appliesTo":{"maxAlcoholByVolume":0.5}}'::jsonb, 'PER_CENTILITRE_ETHANOL', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2025 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v2.0-2025'),
    ('excise', 'beer', 28.35, '2025-01-01 00:00:00+00:00', '2025-12-31 00:00:00+00:00', '{"description":"Beer > 0.5 %ABV up to 3.5 %ABV — 28.35 snt/cl ethanol","appliesTo":{"minAlcoholByVolume":0.5,"maxAlcoholByVolume":3.5}}'::jsonb, 'PER_CENTILITRE_ETHANOL', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2025 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v2.0-2025'),
    ('excise', 'beer', 36.20, '2025-01-01 00:00:00+00:00', '2025-12-31 00:00:00+00:00', '{"description":"Beer > 3.5 %ABV — 36.20 snt/cl ethanol","appliesTo":{"minAlcoholByVolume":3.5}}'::jsonb, 'PER_CENTILITRE_ETHANOL', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2025 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v2.0-2025'),
    ('excise', 'wine_still', 0.00, '2025-01-01 00:00:00+00:00', '2025-12-31 00:00:00+00:00', '{"description":"Still wine ≤ 1.2 %ABV — exempt","appliesTo":{"maxAlcoholByVolume":1.2}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2025 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v2.0-2025'),
    ('excise', 'wine_still', 0.36, '2025-01-01 00:00:00+00:00', '2025-12-31 00:00:00+00:00', '{"description":"Still wine > 1.2 – 2.8 %ABV — 0.36 €/l","appliesTo":{"minAlcoholByVolume":1.2,"maxAlcoholByVolume":2.8}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2025 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v2.0-2025'),
    ('excise', 'wine_still', 1.98, '2025-01-01 00:00:00+00:00', '2025-12-31 00:00:00+00:00', '{"description":"Still wine > 2.8 – 5.5 %ABV — 1.98 €/l","appliesTo":{"minAlcoholByVolume":2.8,"maxAlcoholByVolume":5.5}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2025 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v2.0-2025'),
    ('excise', 'wine_still', 3.08, '2025-01-01 00:00:00+00:00', '2025-12-31 00:00:00+00:00', '{"description":"Still wine > 5.5 – 8 %ABV — 3.08 €/l","appliesTo":{"minAlcoholByVolume":5.5,"maxAlcoholByVolume":8}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2025 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v2.0-2025'),
    ('excise', 'wine_still', 4.56, '2025-01-01 00:00:00+00:00', '2025-12-31 00:00:00+00:00', '{"description":"Still wine > 8 – 15 %ABV — 4.56 €/l","appliesTo":{"minAlcoholByVolume":8,"maxAlcoholByVolume":15}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2025 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v2.0-2025'),
    ('excise', 'wine_still', 4.56, '2025-01-01 00:00:00+00:00', '2025-12-31 00:00:00+00:00', '{"description":"Still wine > 15 – 18 %ABV — 4.56 €/l","appliesTo":{"minAlcoholByVolume":15,"maxAlcoholByVolume":18}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2025 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v2.0-2025'),
    ('excise', 'wine_sparkling', 0.00, '2025-01-01 00:00:00+00:00', '2025-12-31 00:00:00+00:00', '{"description":"Sparkling wine ≤ 1.2 %ABV — exempt","appliesTo":{"maxAlcoholByVolume":1.2}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2025 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v2.0-2025'),
    ('excise', 'wine_sparkling', 0.36, '2025-01-01 00:00:00+00:00', '2025-12-31 00:00:00+00:00', '{"description":"Sparkling wine > 1.2 – 2.8 %ABV — 0.36 €/l","appliesTo":{"minAlcoholByVolume":1.2,"maxAlcoholByVolume":2.8}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2025 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v2.0-2025'),
    ('excise', 'wine_sparkling', 1.98, '2025-01-01 00:00:00+00:00', '2025-12-31 00:00:00+00:00', '{"description":"Sparkling wine > 2.8 – 5.5 %ABV — 1.98 €/l","appliesTo":{"minAlcoholByVolume":2.8,"maxAlcoholByVolume":5.5}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2025 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v2.0-2025'),
    ('excise', 'wine_sparkling', 3.08, '2025-01-01 00:00:00+00:00', '2025-12-31 00:00:00+00:00', '{"description":"Sparkling wine > 5.5 – 8 %ABV — 3.08 €/l","appliesTo":{"minAlcoholByVolume":5.5,"maxAlcoholByVolume":8}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2025 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v2.0-2025'),
    ('excise', 'wine_sparkling', 4.56, '2025-01-01 00:00:00+00:00', '2025-12-31 00:00:00+00:00', '{"description":"Sparkling wine > 8 – 15 %ABV — 4.56 €/l","appliesTo":{"minAlcoholByVolume":8,"maxAlcoholByVolume":15}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2025 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v2.0-2025'),
    ('excise', 'wine_sparkling', 4.56, '2025-01-01 00:00:00+00:00', '2025-12-31 00:00:00+00:00', '{"description":"Sparkling wine > 15 – 18 %ABV — 4.56 €/l","appliesTo":{"minAlcoholByVolume":15,"maxAlcoholByVolume":18}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2025 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v2.0-2025'),
    ('excise', 'intermediate_products', 5.68, '2025-01-01 00:00:00+00:00', '2025-12-31 00:00:00+00:00', '{"description":"Intermediate products > 1.2 – 15 %ABV — 5.68 €/l","appliesTo":{"minAlcoholByVolume":1.2,"maxAlcoholByVolume":15}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2025 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v2.0-2025'),
    ('excise', 'intermediate_products', 8.74, '2025-01-01 00:00:00+00:00', '2025-12-31 00:00:00+00:00', '{"description":"Intermediate products > 15 – 22 %ABV — 8.74 €/l","appliesTo":{"minAlcoholByVolume":15,"maxAlcoholByVolume":22}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2025 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v2.0-2025'),
    ('excise', 'spirits', 0.00, '2025-01-01 00:00:00+00:00', '2025-12-31 00:00:00+00:00', '{"description":"Spirits ≤ 1.2 %ABV — not subject to excise duty","appliesTo":{"maxAlcoholByVolume":1.2}}'::jsonb, 'PER_LITRE_OF_ALCOHOL', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2025 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v2.0-2025'),
    ('excise', 'spirits', 30.90, '2025-01-01 00:00:00+00:00', '2025-12-31 00:00:00+00:00', '{"description":"Spirits > 1.2 %ABV up to 2.8 %ABV — 30.90 snt/cl ethanol (€30.90/l pure alcohol)","appliesTo":{"minAlcoholByVolume":1.2,"maxAlcoholByVolume":2.8}}'::jsonb, 'PER_LITRE_OF_ALCOHOL', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2025 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v2.0-2025'),
    ('excise', 'spirits', 54.80, '2025-01-01 00:00:00+00:00', '2025-12-31 00:00:00+00:00', '{"description":"Spirits > 2.8 – 10 %ABV — 54.80 snt/cl ethanol (€54.80/l pure alcohol)","appliesTo":{"minAlcoholByVolume":2.8,"maxAlcoholByVolume":10}}'::jsonb, 'PER_LITRE_OF_ALCOHOL', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2025 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v2.0-2025'),
    ('excise', 'spirits', 55.50, '2025-01-01 00:00:00+00:00', '2025-12-31 00:00:00+00:00', '{"description":"Spirits > 10 %ABV — 55.50 snt/cl ethanol (€55.50/l pure alcohol)","appliesTo":{"minAlcoholByVolume":10}}'::jsonb, 'PER_LITRE_OF_ALCOHOL', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2025 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v2.0-2025'),
    ('excise', 'other_fermented', 0.00, '2025-01-01 00:00:00+00:00', '2025-12-31 00:00:00+00:00', '{"description":"Other fermented ≤ 1.2 %ABV — exempt","appliesTo":{"maxAlcoholByVolume":1.2}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2025 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v2.0-2025'),
    ('excise', 'other_fermented', 0.36, '2025-01-01 00:00:00+00:00', '2025-12-31 00:00:00+00:00', '{"description":"Other fermented > 1.2 – 2.8 %ABV — 0.36 €/l","appliesTo":{"minAlcoholByVolume":1.2,"maxAlcoholByVolume":2.8}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2025 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v2.0-2025'),
    ('excise', 'other_fermented', 1.98, '2025-01-01 00:00:00+00:00', '2025-12-31 00:00:00+00:00', '{"description":"Other fermented > 2.8 – 5.5 %ABV — 1.98 €/l","appliesTo":{"minAlcoholByVolume":2.8,"maxAlcoholByVolume":5.5}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2025 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v2.0-2025'),
    ('excise', 'other_fermented', 3.08, '2025-01-01 00:00:00+00:00', '2025-12-31 00:00:00+00:00', '{"description":"Other fermented > 5.5 – 8 %ABV — 3.08 €/l","appliesTo":{"minAlcoholByVolume":5.5,"maxAlcoholByVolume":8}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2025 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v2.0-2025'),
    ('excise', 'other_fermented', 4.56, '2025-01-01 00:00:00+00:00', '2025-12-31 00:00:00+00:00', '{"description":"Other fermented > 8 – 15 %ABV — 4.56 €/l","appliesTo":{"minAlcoholByVolume":8,"maxAlcoholByVolume":15}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2025 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v2.0-2025'),
    ('excise', 'other_fermented', 4.56, '2025-01-01 00:00:00+00:00', '2025-12-31 00:00:00+00:00', '{"description":"Other fermented > 15 – 18 %ABV — 4.56 €/l","appliesTo":{"minAlcoholByVolume":15,"maxAlcoholByVolume":18}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2025 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v2.0-2025'),
    ('container_duty', 'all_beverages', 0.51, '2025-01-01 00:00:00+00:00', '2025-12-31 00:00:00+00:00', NULL, 'FLAT_PER_LITRE', 'Finnish Tax Administration — Excise Duty on Beverage Containers, Rates 2025 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v2.0-2025'),
    ('excise', 'beer', 0.00, '2026-01-01 00:00:00+00:00', NULL, '{"description":"Beer ≤ 0.5 %ABV — not subject to excise duty","appliesTo":{"maxAlcoholByVolume":0.5}}'::jsonb, 'PER_CENTILITRE_ETHANOL', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2026 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v3.0-2026'),
    ('excise', 'beer', 28.75, '2026-01-01 00:00:00+00:00', NULL, '{"description":"Beer > 0.5 %ABV up to 3.5 %ABV — 28.75 snt/cl ethanol","appliesTo":{"minAlcoholByVolume":0.5,"maxAlcoholByVolume":3.5}}'::jsonb, 'PER_CENTILITRE_ETHANOL', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2026 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v3.0-2026'),
    ('excise', 'beer', 36.71, '2026-01-01 00:00:00+00:00', NULL, '{"description":"Beer > 3.5 %ABV — 36.71 snt/cl ethanol","appliesTo":{"minAlcoholByVolume":3.5}}'::jsonb, 'PER_CENTILITRE_ETHANOL', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2026 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v3.0-2026'),
    ('excise', 'wine_still', 0.00, '2026-01-01 00:00:00+00:00', NULL, '{"description":"Still wine ≤ 1.2 %ABV — exempt","appliesTo":{"maxAlcoholByVolume":1.2}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2026 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v3.0-2026'),
    ('excise', 'wine_still', 0.36, '2026-01-01 00:00:00+00:00', '2026-03-31 00:00:00+00:00', '{"description":"Still wine > 1.2 – 2.8 %ABV — 0.36 €/l (until 31.3.2026)","appliesTo":{"minAlcoholByVolume":1.2,"maxAlcoholByVolume":2.8}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2026 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v3.0-2026'),
    ('excise', 'wine_still', 0.50, '2026-04-01 00:00:00+00:00', NULL, '{"description":"Still wine > 1.2 – 2.8 %ABV — 0.50 €/l (from 1.4.2026)","appliesTo":{"minAlcoholByVolume":1.2,"maxAlcoholByVolume":2.8}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2026 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v3.0-2026'),
    ('excise', 'wine_still', 2.1902, '2026-01-01 00:00:00+00:00', NULL, '{"description":"Still wine > 2.8 – 5.5 %ABV — 2.1902 €/l","appliesTo":{"minAlcoholByVolume":2.8,"maxAlcoholByVolume":5.5}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2026 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v3.0-2026'),
    ('excise', 'wine_still', 3.4070, '2026-01-01 00:00:00+00:00', NULL, '{"description":"Still wine > 5.5 – 8 %ABV — 3.4070 €/l","appliesTo":{"minAlcoholByVolume":5.5,"maxAlcoholByVolume":8}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2026 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v3.0-2026'),
    ('excise', 'wine_still', 5.0497, '2026-01-01 00:00:00+00:00', NULL, '{"description":"Still wine > 8 – 15 %ABV — 5.0497 €/l","appliesTo":{"minAlcoholByVolume":8,"maxAlcoholByVolume":15}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2026 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v3.0-2026'),
    ('excise', 'wine_still', 5.0497, '2026-01-01 00:00:00+00:00', NULL, '{"description":"Still wine > 15 – 18 %ABV — 5.0497 €/l","appliesTo":{"minAlcoholByVolume":15,"maxAlcoholByVolume":18}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2026 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v3.0-2026'),
    ('excise', 'wine_sparkling', 0.00, '2026-01-01 00:00:00+00:00', NULL, '{"description":"Sparkling wine ≤ 1.2 %ABV — exempt","appliesTo":{"maxAlcoholByVolume":1.2}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2026 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v3.0-2026'),
    ('excise', 'wine_sparkling', 0.36, '2026-01-01 00:00:00+00:00', '2026-03-31 00:00:00+00:00', '{"description":"Sparkling wine > 1.2 – 2.8 %ABV — 0.36 €/l (until 31.3.2026)","appliesTo":{"minAlcoholByVolume":1.2,"maxAlcoholByVolume":2.8}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2026 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v3.0-2026'),
    ('excise', 'wine_sparkling', 0.50, '2026-04-01 00:00:00+00:00', NULL, '{"description":"Sparkling wine > 1.2 – 2.8 %ABV — 0.50 €/l (from 1.4.2026)","appliesTo":{"minAlcoholByVolume":1.2,"maxAlcoholByVolume":2.8}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2026 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v3.0-2026'),
    ('excise', 'wine_sparkling', 2.1902, '2026-01-01 00:00:00+00:00', NULL, '{"description":"Sparkling wine > 2.8 – 5.5 %ABV — 2.1902 €/l","appliesTo":{"minAlcoholByVolume":2.8,"maxAlcoholByVolume":5.5}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2026 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v3.0-2026'),
    ('excise', 'wine_sparkling', 3.4070, '2026-01-01 00:00:00+00:00', NULL, '{"description":"Sparkling wine > 5.5 – 8 %ABV — 3.4070 €/l","appliesTo":{"minAlcoholByVolume":5.5,"maxAlcoholByVolume":8}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2026 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v3.0-2026'),
    ('excise', 'wine_sparkling', 5.0497, '2026-01-01 00:00:00+00:00', NULL, '{"description":"Sparkling wine > 8 – 15 %ABV — 5.0497 €/l","appliesTo":{"minAlcoholByVolume":8,"maxAlcoholByVolume":15}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2026 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v3.0-2026'),
    ('excise', 'wine_sparkling', 5.0497, '2026-01-01 00:00:00+00:00', NULL, '{"description":"Sparkling wine > 15 – 18 %ABV — 5.0497 €/l","appliesTo":{"minAlcoholByVolume":15,"maxAlcoholByVolume":18}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2026 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v3.0-2026'),
    ('excise', 'intermediate_products', 5.7595, '2026-01-01 00:00:00+00:00', NULL, '{"description":"Intermediate products > 1.2 – 15 %ABV — 5.7595 €/l","appliesTo":{"minAlcoholByVolume":1.2,"maxAlcoholByVolume":15}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2026 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v3.0-2026'),
    ('excise', 'intermediate_products', 8.8624, '2026-01-01 00:00:00+00:00', NULL, '{"description":"Intermediate products > 15 – 22 %ABV — 8.8624 €/l","appliesTo":{"minAlcoholByVolume":15,"maxAlcoholByVolume":22}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2026 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v3.0-2026'),
    ('excise', 'spirits', 0.00, '2026-01-01 00:00:00+00:00', NULL, '{"description":"Spirits ≤ 1.2 %ABV — not subject to excise duty","appliesTo":{"maxAlcoholByVolume":1.2}}'::jsonb, 'PER_LITRE_OF_ALCOHOL', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2026 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v3.0-2026'),
    ('excise', 'spirits', 31.33, '2026-01-01 00:00:00+00:00', NULL, '{"description":"Spirits > 1.2 %ABV up to 2.8 %ABV — 31.33 snt/cl ethanol (€31.33/l pure alcohol)","appliesTo":{"minAlcoholByVolume":1.2,"maxAlcoholByVolume":2.8}}'::jsonb, 'PER_LITRE_OF_ALCOHOL', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2026 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v3.0-2026'),
    ('excise', 'spirits', 55.57, '2026-01-01 00:00:00+00:00', NULL, '{"description":"Spirits > 2.8 – 10 %ABV — 55.57 snt/cl ethanol (€55.57/l pure alcohol)","appliesTo":{"minAlcoholByVolume":2.8,"maxAlcoholByVolume":10}}'::jsonb, 'PER_LITRE_OF_ALCOHOL', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2026 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v3.0-2026'),
    ('excise', 'spirits', 56.28, '2026-01-01 00:00:00+00:00', NULL, '{"description":"Spirits > 10 %ABV — 56.28 snt/cl ethanol (€56.28/l pure alcohol)","appliesTo":{"minAlcoholByVolume":10}}'::jsonb, 'PER_LITRE_OF_ALCOHOL', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2026 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v3.0-2026'),
    ('excise', 'other_fermented', 0.00, '2026-01-01 00:00:00+00:00', NULL, '{"description":"Other fermented ≤ 1.2 %ABV — exempt","appliesTo":{"maxAlcoholByVolume":1.2}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2026 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v3.0-2026'),
    ('excise', 'other_fermented', 0.36, '2026-01-01 00:00:00+00:00', '2026-03-31 00:00:00+00:00', '{"description":"Other fermented > 1.2 – 2.8 %ABV — 0.36 €/l (until 31.3.2026)","appliesTo":{"minAlcoholByVolume":1.2,"maxAlcoholByVolume":2.8}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2026 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v3.0-2026'),
    ('excise', 'other_fermented', 0.50, '2026-04-01 00:00:00+00:00', NULL, '{"description":"Other fermented > 1.2 – 2.8 %ABV — 0.50 €/l (from 1.4.2026)","appliesTo":{"minAlcoholByVolume":1.2,"maxAlcoholByVolume":2.8}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2026 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v3.0-2026'),
    ('excise', 'other_fermented', 2.1902, '2026-01-01 00:00:00+00:00', NULL, '{"description":"Other fermented > 2.8 – 5.5 %ABV — 2.1902 €/l","appliesTo":{"minAlcoholByVolume":2.8,"maxAlcoholByVolume":5.5}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2026 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v3.0-2026'),
    ('excise', 'other_fermented', 3.4070, '2026-01-01 00:00:00+00:00', NULL, '{"description":"Other fermented > 5.5 – 8 %ABV — 3.4070 €/l","appliesTo":{"minAlcoholByVolume":5.5,"maxAlcoholByVolume":8}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2026 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v3.0-2026'),
    ('excise', 'other_fermented', 5.0497, '2026-01-01 00:00:00+00:00', NULL, '{"description":"Other fermented > 8 – 15 %ABV — 5.0497 €/l","appliesTo":{"minAlcoholByVolume":8,"maxAlcoholByVolume":15}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2026 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v3.0-2026'),
    ('excise', 'other_fermented', 5.0497, '2026-01-01 00:00:00+00:00', NULL, '{"description":"Other fermented > 15 – 18 %ABV — 5.0497 €/l","appliesTo":{"minAlcoholByVolume":15,"maxAlcoholByVolume":18}}'::jsonb, 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2026 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v3.0-2026'),
    ('container_duty', 'all_beverages', 0.51, '2026-01-01 00:00:00+00:00', NULL, NULL, 'FLAT_PER_LITRE', 'Finnish Tax Administration — Excise Duty on Beverage Containers, Rates 2026 (vero.fi)', '2026-08-21 00:00:00+00:00', 'v3.0-2026')
;

-- =============================================================================
-- 2. TRANSPORT OFFERS
-- =============================================================================
-- Carrier shipping-cost data for common import routes to Finland.

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
-- Product IDs are deterministic by insert order (1—45).
-- Retail offer IDs are deterministic by insert order (1—44).
-- =============================================================================

-- HelsinkiPremium Oy — Large alcohol importer (products 1—10)
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
    (1,  3290), (2,  2590), (3,  3490), (4,  4490), (5,  5990),
    (6,  7490), (7,  3990), (8,  3790), (9,  45000), (10, 8990)
) AS t(id, price);

-- SuomiLogistiikka — Medium general importer (products 11—20)
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
    (11, 3299), (12, 3099), (13, 2999), (14, 1899), (15, 3399),
    (16, 159), (17, 2899), (18, 99), (19, 129), (20, 89)
) AS t(id, price);

-- PohjolanTuonti — Small craft-beer specialist (products 21—28)
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
    (21, 599), (22, 499), (23, 649), (24, 549),
    (25, 799), (26, 699), (27, 589), (28, 699)
) AS t(id, price);

-- ArcticBev — Large beverage importer (products 29—36)
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
    (29, 68000), (30, 95000), (31, 12990), (32, 4590),
    (33, 38900), (34, 7990), (35, 5490), (36, 16990)
) AS t(id, price);

-- NordicTobacco — Specialized tobacco/nicotine importer (products 37—44)
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
    (37, 12990), (38, 12990), (39, 45000), (40, 19900),
    (41, 799), (42, 1299), (43, 699), (44, 699)
) AS t(id, price);

-- Standalone product (product_master_id = 45)
INSERT INTO product_master (name, manufacturer, brand, category, alcohol_by_volume, unit_volume, container_type, regulatory_classification, deposit_system_status, ean)
VALUES ('Sample Aperitif', 'Generic', 'Generic', 'intermediate_products', 18.000, 0.750, 'bottle', 'alcoholic_beverage', FALSE, NULL);

-- =============================================================================
-- 4. STAGING REVIEW RECORDS — track rule-change review sessions
-- =============================================================================

INSERT INTO staging_reviews (review_label, previous_version_id, proposed_version_id, reviewer, status, created_at)
VALUES
    ('2024→2025 index adjustment',  NULL, NULL, 'ops@rajahinta.fi',  'approved',     '2024-12-15T10:00:00+02:00'),
    ('2026 proposed rate change',   NULL, NULL, NULL,                'pending',      '2025-08-01T10:00:00+03:00');

COMMIT;

-- NOTE: Golden-dataset scenarios removed — FK references are invalid
-- after tax_rules expansion (old 45 rules → new 86 rules from SEED_RULES).
-- The golden-dataset CI job (task 6.1) generates its own fixtures.
