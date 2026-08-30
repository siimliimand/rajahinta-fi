-- G3 vertical slice spike — D1 seed (local).
--
-- Golden dataset v2.1 from tests/golden/ (products 1/2/3/4/13, offers
-- 100-103/112-114), the v1.0-2024 tax rule seed from
-- tests/golden/helpers/in-memory-tax-rule.repository.ts (25 rules,
-- vero.fi rates), and the golden transport offers (carrierA/carrierB/
-- carrierSE). Product rows are product_master-shaped; the weight the
-- calculator uses is estimated from unit_volume by the adapter
-- (litres x 1.0) exactly like the production ProductDataAdapter.

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  manufacturer TEXT NOT NULL,
  brand TEXT NOT NULL,
  category TEXT NOT NULL,
  alcohol_by_volume TEXT,
  unit_volume TEXT NOT NULL,
  container_type TEXT NOT NULL,
  regulatory_classification TEXT NOT NULL,
  deposit_system_status INTEGER,
  ean TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS retail_offers (
  id INTEGER PRIMARY KEY,
  merchant TEXT NOT NULL,
  country TEXT NOT NULL,
  product_id INTEGER NOT NULL REFERENCES products(id),
  price_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  original_price_cents INTEGER,
  original_currency TEXT,
  fx_dataset_version TEXT,
  availability TEXT NOT NULL DEFAULT 'unknown',
  source_url TEXT,
  observed_at TEXT NOT NULL,
  reliability_status TEXT NOT NULL DEFAULT 'ESTIMATED'
);

CREATE TABLE IF NOT EXISTS tax_rules (
  id INTEGER PRIMARY KEY,
  tax_type TEXT NOT NULL,
  product_category TEXT NOT NULL,
  rate TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  exemption_conditions TEXT,
  calculation_formula_reference TEXT NOT NULL,
  official_source TEXT NOT NULL,
  verification_date TEXT,
  version_label TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transport_offers (
  id INTEGER PRIMARY KEY,
  carrier TEXT NOT NULL,
  origin_country TEXT NOT NULL,
  destination_country TEXT NOT NULL DEFAULT 'FI',
  weight_min_kg REAL,
  weight_max_kg REAL,
  package_tier TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  seller_involvement_indicator INTEGER NOT NULL DEFAULT 0,
  observed_at TEXT NOT NULL,
  refreshed_at TEXT NOT NULL,
  reliability_status TEXT NOT NULL DEFAULT 'ESTIMATED'
);

CREATE TABLE IF NOT EXISTS calculation_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_master_id INTEGER NOT NULL REFERENCES products(id),
  retail_offer_ids TEXT,
  transport_offer_id INTEGER,
  excise_rule_version_id INTEGER,
  container_duty_rule_version_id INTEGER,
  total_cents INTEGER NOT NULL,
  breakdown TEXT NOT NULL,
  confidence TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  destination TEXT NOT NULL,
  disclaimer TEXT NOT NULL,
  session_id TEXT,
  calculated_at TEXT NOT NULL
);

DELETE FROM calculation_records;
DELETE FROM transport_offers;
DELETE FROM tax_rules;
DELETE FROM retail_offers;
DELETE FROM products;

-- ---------------------------------------------------------------------------
-- Golden products (tests/golden/data/products.ts)
-- ---------------------------------------------------------------------------

INSERT INTO products (id, name, manufacturer, brand, category, alcohol_by_volume, unit_volume, container_type, regulatory_classification, deposit_system_status, ean, created_at, updated_at) VALUES
  (1, 'Premium Lager 5%', 'Beverage DE GmbH', 'Premium Lager', 'beer', '0.05', '0.5', 'can', 'beer', 1, null, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  (2, 'Rioja Reserva', 'Vinos ES SA', 'Rioja', 'wine', '0.12', '0.75', 'glass', 'wine', 1, null, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  (3, 'Premium Vodka', 'Spirits EU Sp. z o.o.', 'Premium Vodka', 'spirits', '0.4', '0.7', 'glass', 'spirits', 1, null, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  (4, 'Unknown Beverage', 'Unknown Merchant Oy', 'Unknown', 'unknown', '0', '0.5', 'plastic', '', null, null, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  (13, 'Svensk Exportöl 5%', 'Systembolaget AB', 'Svensk Exportöl', 'beer', '0.05', '0.5', 'can', 'beer', 1, null, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

-- ---------------------------------------------------------------------------
-- Golden retail offers
-- ---------------------------------------------------------------------------

INSERT INTO retail_offers (id, merchant, country, product_id, price_cents, currency, original_price_cents, original_currency, fx_dataset_version, availability, source_url, observed_at, reliability_status) VALUES
  (100, 'beverage-de', 'DE', 1, 200, 'EUR', null, null, null, 'in_stock', null, '2026-08-20T10:00:00.000Z', 'EXACT'),
  (101, 'vinos-es', 'ES', 2, 300, 'EUR', null, null, null, 'in_stock', null, '2026-08-20T10:00:00.000Z', 'EXACT'),
  (102, 'spirits-eu', 'PL', 3, 500, 'EUR', null, null, null, 'in_stock', null, '2026-08-20T10:00:00.000Z', 'EXACT'),
  (103, 'unknown-merchant', 'DE', 4, 100, 'EUR', null, null, null, 'in_stock', null, '2026-08-20T10:00:00.000Z', 'ESTIMATED'),
  -- Case 5: converted SEK offer (22.64 SEK @ ECB 11.32 -> 200 EUR cents)
  (112, 'systembolaget', 'SE', 13, 200, 'EUR', 2264, 'SEK', 'ecb-2026-08-27.1', 'in_stock', null, '2026-08-27T10:00:00.000Z', 'VERIFIED'),
  (113, 'beverage-de', 'DE', 13, 260, 'EUR', null, null, null, 'in_stock', null, '2026-08-27T10:00:00.000Z', 'VERIFIED'),
  -- The trap: raw SEK leaked as cents, cheapest, must be EXCLUDED
  (114, 'shop-se-rogue', 'SE', 13, 90, 'SEK', 900, 'SEK', null, 'in_stock', null, '2026-08-27T10:00:00.000Z', 'ESTIMATED');

-- ---------------------------------------------------------------------------
-- Tax rules — v1.0-2024 official seed (same 25 rows as the golden helper)
-- ---------------------------------------------------------------------------

INSERT INTO tax_rules (id, tax_type, product_category, rate, effective_from, effective_to, exemption_conditions, calculation_formula_reference, official_source, verification_date, version_label, created_at) VALUES
  (1, 'excise', 'beer', '0.00', '2024-01-01T00:00:00.000Z', null, '{"maxAlcoholByVolume":0.5}', 'PER_DEGREE_PLATO', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2024 (vero.fi)', '2024-03-01T00:00:00.000Z', 'v1.0-2024', '2026-01-01T00:00:00.000Z'),
  (101, 'excise', 'beer', '28.35', '2024-01-01T00:00:00.000Z', null, '{"minAlcoholByVolume":0.5,"maxAlcoholByVolume":3.5}', 'PER_DEGREE_PLATO', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2024 (vero.fi)', '2024-03-01T00:00:00.000Z', 'v1.0-2024', '2026-01-01T00:00:00.000Z'),
  (102, 'excise', 'beer', '36.20', '2024-01-01T00:00:00.000Z', null, '{"minAlcoholByVolume":3.5}', 'PER_DEGREE_PLATO', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2024 (vero.fi)', '2024-03-01T00:00:00.000Z', 'v1.0-2024', '2026-01-01T00:00:00.000Z'),
  (2, 'excise', 'wine_still', '0.00', '2024-01-01T00:00:00.000Z', null, '{"maxAlcoholByVolume":1.2}', 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2024 (vero.fi)', '2024-03-01T00:00:00.000Z', 'v1.0-2024', '2026-01-01T00:00:00.000Z'),
  (3, 'excise', 'wine_still', '0.36', '2024-01-01T00:00:00.000Z', null, '{"minAlcoholByVolume":1.2,"maxAlcoholByVolume":2.8}', 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2024 (vero.fi)', '2024-03-01T00:00:00.000Z', 'v1.0-2024', '2026-01-01T00:00:00.000Z'),
  (4, 'excise', 'wine_still', '1.98', '2024-01-01T00:00:00.000Z', null, '{"minAlcoholByVolume":2.8,"maxAlcoholByVolume":5.5}', 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2024 (vero.fi)', '2024-03-01T00:00:00.000Z', 'v1.0-2024', '2026-01-01T00:00:00.000Z'),
  (5, 'excise', 'wine_still', '3.08', '2024-01-01T00:00:00.000Z', null, '{"minAlcoholByVolume":5.5,"maxAlcoholByVolume":8}', 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2024 (vero.fi)', '2024-03-01T00:00:00.000Z', 'v1.0-2024', '2026-01-01T00:00:00.000Z'),
  (6, 'excise', 'wine_still', '4.56', '2024-01-01T00:00:00.000Z', null, '{"minAlcoholByVolume":8,"maxAlcoholByVolume":15}', 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2024 (vero.fi)', '2024-03-01T00:00:00.000Z', 'v1.0-2024', '2026-01-01T00:00:00.000Z'),
  (7, 'excise', 'wine_still', '4.56', '2024-01-01T00:00:00.000Z', null, '{"minAlcoholByVolume":15,"maxAlcoholByVolume":18}', 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2024 (vero.fi)', '2024-03-01T00:00:00.000Z', 'v1.0-2024', '2026-01-01T00:00:00.000Z'),
  (8, 'excise', 'wine_sparkling', '0.00', '2024-01-01T00:00:00.000Z', null, '{"maxAlcoholByVolume":1.2}', 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2024 (vero.fi)', '2024-03-01T00:00:00.000Z', 'v1.0-2024', '2026-01-01T00:00:00.000Z'),
  (9, 'excise', 'wine_sparkling', '0.36', '2024-01-01T00:00:00.000Z', null, '{"minAlcoholByVolume":1.2,"maxAlcoholByVolume":2.8}', 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2024 (vero.fi)', '2024-03-01T00:00:00.000Z', 'v1.0-2024', '2026-01-01T00:00:00.000Z'),
  (10, 'excise', 'wine_sparkling', '1.98', '2024-01-01T00:00:00.000Z', null, '{"minAlcoholByVolume":2.8,"maxAlcoholByVolume":5.5}', 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2024 (vero.fi)', '2024-03-01T00:00:00.000Z', 'v1.0-2024', '2026-01-01T00:00:00.000Z'),
  (11, 'excise', 'wine_sparkling', '3.08', '2024-01-01T00:00:00.000Z', null, '{"minAlcoholByVolume":5.5,"maxAlcoholByVolume":8}', 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2024 (vero.fi)', '2024-03-01T00:00:00.000Z', 'v1.0-2024', '2026-01-01T00:00:00.000Z'),
  (12, 'excise', 'wine_sparkling', '4.56', '2024-01-01T00:00:00.000Z', null, '{"minAlcoholByVolume":8,"maxAlcoholByVolume":15}', 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2024 (vero.fi)', '2024-03-01T00:00:00.000Z', 'v1.0-2024', '2026-01-01T00:00:00.000Z'),
  (13, 'excise', 'wine_sparkling', '4.56', '2024-01-01T00:00:00.000Z', null, '{"minAlcoholByVolume":15,"maxAlcoholByVolume":18}', 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2024 (vero.fi)', '2024-03-01T00:00:00.000Z', 'v1.0-2024', '2026-01-01T00:00:00.000Z'),
  (14, 'excise', 'spirits', '0.00', '2024-01-01T00:00:00.000Z', null, '{"maxAlcoholByVolume":1.2}', 'PER_LITRE_OF_ALCOHOL', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2024 (vero.fi)', '2024-03-01T00:00:00.000Z', 'v1.0-2024', '2026-01-01T00:00:00.000Z'),
  (15, 'excise', 'spirits', '30.90', '2024-01-01T00:00:00.000Z', null, '{"minAlcoholByVolume":1.2,"maxAlcoholByVolume":2.8}', 'PER_LITRE_OF_ALCOHOL', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2024 (vero.fi)', '2024-03-01T00:00:00.000Z', 'v1.0-2024', '2026-01-01T00:00:00.000Z'),
  (16, 'excise', 'spirits', '54.80', '2024-01-01T00:00:00.000Z', null, '{"minAlcoholByVolume":2.8}', 'PER_LITRE_OF_ALCOHOL', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2024 (vero.fi)', '2024-03-01T00:00:00.000Z', 'v1.0-2024', '2026-01-01T00:00:00.000Z'),
  (17, 'excise', 'intermediate_products', '5.68', '2024-01-01T00:00:00.000Z', null, '{"minAlcoholByVolume":1.2,"maxAlcoholByVolume":15}', 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2024 (vero.fi)', '2024-03-01T00:00:00.000Z', 'v1.0-2024', '2026-01-01T00:00:00.000Z'),
  (18, 'excise', 'intermediate_products', '8.63', '2024-01-01T00:00:00.000Z', null, '{"minAlcoholByVolume":15,"maxAlcoholByVolume":22}', 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2024 (vero.fi)', '2024-03-01T00:00:00.000Z', 'v1.0-2024', '2026-01-01T00:00:00.000Z'),
  (19, 'excise', 'other_fermented', '0.00', '2024-01-01T00:00:00.000Z', null, '{"maxAlcoholByVolume":1.2}', 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2024 (vero.fi)', '2024-03-01T00:00:00.000Z', 'v1.0-2024', '2026-01-01T00:00:00.000Z'),
  (20, 'excise', 'other_fermented', '0.36', '2024-01-01T00:00:00.000Z', null, '{"minAlcoholByVolume":1.2,"maxAlcoholByVolume":2.8}', 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2024 (vero.fi)', '2024-03-01T00:00:00.000Z', 'v1.0-2024', '2026-01-01T00:00:00.000Z'),
  (21, 'excise', 'other_fermented', '1.98', '2024-01-01T00:00:00.000Z', null, '{"minAlcoholByVolume":2.8,"maxAlcoholByVolume":5.5}', 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2024 (vero.fi)', '2024-03-01T00:00:00.000Z', 'v1.0-2024', '2026-01-01T00:00:00.000Z'),
  (22, 'excise', 'other_fermented', '3.08', '2024-01-01T00:00:00.000Z', null, '{"minAlcoholByVolume":5.5,"maxAlcoholByVolume":8}', 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2024 (vero.fi)', '2024-03-01T00:00:00.000Z', 'v1.0-2024', '2026-01-01T00:00:00.000Z'),
  (23, 'excise', 'other_fermented', '4.56', '2024-01-01T00:00:00.000Z', null, '{"minAlcoholByVolume":8,"maxAlcoholByVolume":15}', 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2024 (vero.fi)', '2024-03-01T00:00:00.000Z', 'v1.0-2024', '2026-01-01T00:00:00.000Z'),
  (24, 'excise', 'other_fermented', '4.56', '2024-01-01T00:00:00.000Z', null, '{"minAlcoholByVolume":15,"maxAlcoholByVolume":18}', 'PER_LITRE_OF_PRODUCT', 'Finnish Tax Administration — Excise Duty on Alcohol and Alcoholic Beverages, Rates 2024 (vero.fi)', '2024-03-01T00:00:00.000Z', 'v1.0-2024', '2026-01-01T00:00:00.000Z'),
  (25, 'container_duty', 'all_beverages', '0.51', '2024-01-01T00:00:00.000Z', null, null, 'FLAT_PER_LITRE', 'Finnish Tax Administration — Beverage Container Duty Rate 2024 (vero.fi)', '2024-03-01T00:00:00.000Z', 'v1.0-2024', '2026-01-01T00:00:00.000Z');

-- ---------------------------------------------------------------------------
-- Golden transport offers
-- ---------------------------------------------------------------------------

INSERT INTO transport_offers (id, carrier, origin_country, destination_country, weight_min_kg, weight_max_kg, package_tier, price_cents, currency, seller_involvement_indicator, observed_at, refreshed_at, reliability_status) VALUES
  (900, 'carrierA', 'DE', 'FI', 0, 1, 'can', 150, 'EUR', 1, '2026-08-28T00:00:00.000Z', '2026-08-28T00:00:00.000Z', 'EXACT'),
  (901, 'carrierB', 'ES', 'FI', 0, 2, 'glass', 200, 'EUR', 0, '2026-08-28T00:00:00.000Z', '2026-08-28T00:00:00.000Z', 'EXACT'),
  (902, 'carrierSE', 'SE', 'FI', 0, 1, 'can', 150, 'EUR', 1, '2026-08-28T00:00:00.000Z', '2026-08-28T00:00:00.000Z', 'EXACT');
