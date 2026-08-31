-- ===========================================================================
-- Journey fixtures for the browser-E2E suite on the Workers stack (task 5.4,
-- change migrate-to-cloudflare).
--
-- The journeys (age gate, calculator, compare sorting, account export)
-- assert on the two obviously-fake staging products from the legacy
-- browser-E2E stack (packages/data-platform/src/seed/staging-seed.ts):
--
--   TEST Beer — Lorem Ipsum Dolor  beer        4.7 % vol  0.500 l  offers from €1.49
--   TEST Wine — Lorem Ipsum        wine_still  12 % vol   0.750 l  offers from €5.99
--
-- with DE/SE parcel transport to FI carried by the offers' own merchants.
-- The task-2.6 D1 seed (db:seed:d1:local) deliberately ships the
-- infra/staging-data fixture set (real product names) and not these rows,
-- so this file adds exactly the journey-visible state through the same
-- real D1 path (`wrangler d1 execute DB --local --file`, applied by
-- boot-workers-stack.sh after the 2.6 seed). It is NOT a parallel seeding
-- system: same mechanism, same conventions as the 2.6 generator.
--
-- Conventions (mirroring packages/data-platform/src/seed/d1/generate.ts):
-- - explicit primary-key ids in a high range that cannot collide with the
--   2.6 fixture ids (products 1–19, offers/transport 1–N);
-- - INSERT OR IGNORE everywhere — re-running the boot script never
--   duplicates rows;
-- - FK-safe order: products → transport → retail offers.
--
-- FTS5 sync: product_master carries AFTER INSERT triggers
-- (migration 0001/0002) that index new rows into product_master_fts, so
-- plain inserts are searchable — no manual FTS maintenance.
--
-- Deliberately NOT seeded here:
-- - sessions/accounts — minted by the API at runtime via the journeys'
--   401 → issue-session → replay path (the behavior under test);
-- - feature flags — resolved from wrangler vars (FF_*, apps/api-worker
--   src/middleware/feature-flags.ts); the journeys run with flags OFF,
--   the same state a clean runner gets when no FF_* var is set
--   (boot-stack.sh parity).
--
-- Determinism note for the compare-sorting journey: the beer is cheaper
-- (€1.49 < €5.99) and weaker (4.7 % < 12 %) than the wine, while
-- "TEST Beer…" sorts before "TEST Wine…" alphabetically — the three sort
-- orders stay distinguishable, exactly like the legacy stack's seed.
-- ===========================================================================

-- 1. Products — canonical, gate-known regulatory classifications
--    ('beer' / 'wine_still') so the classification gate passes them into
--    the calculator (same self-heal target values as the pg staging seed).
INSERT OR IGNORE INTO "product_master"
  ("id", "name", "manufacturer", "brand", "category", "alcohol_by_volume",
   "unit_volume", "container_type", "regulatory_classification",
   "deposit_system_status", "ean")
VALUES
  (9001, 'TEST Beer — Lorem Ipsum Dolor', 'Test Brauerei GmbH', 'Test Brand',
   'beer', 0.047, 0.5, 'glass', 'beer', 1, '000000000001'),
  (9002, 'TEST Wine — Lorem Ipsum', 'Test Vignoble SAS', 'Test Brand',
   'wine_still', 0.12, 0.75, 'glass', 'wine_still', 0, '000000000002');

-- 2. Transport offers — DE/SE parcel routes to FI (0–30 kg) plus the
--    heavy DE pallet bracket, carriers named after the retail merchants
--    (the calculator resolves the carrier from the selected offer).
INSERT OR IGNORE INTO "transport_offers"
  ("id", "carrier", "origin_country", "destination_country", "weight_min_kg",
   "weight_max_kg", "package_tier", "price_cents", "currency",
   "seller_involvement_indicator", "reliability_status")
VALUES
  (9101, 'test-merchant-de', 'DE', 'FI', 0, 30, 'parcel', 999, 'EUR', 0, 'VERIFIED'),
  (9102, 'test-merchant-se', 'SE', 'FI', 0, 30, 'parcel', 499, 'EUR', 0, 'VERIFIED'),
  (9103, 'test-merchant-de', 'DE', 'FI', 30, NULL, 'pallet', 4999, 'EUR', 0, 'VERIFIED');

-- 3. Retail offers — EUR price points from both merchant markets.
INSERT OR IGNORE INTO "retail_offers"
  ("id", "merchant", "country", "product_id", "price_cents", "currency",
   "availability", "source_url", "reliability_status")
VALUES
  (9201, 'test-merchant-de', 'DE', 9001, 149, 'EUR', 'in_stock',
   'https://staging.invalid/test-beer-de', 'VERIFIED'),
  (9202, 'test-merchant-se', 'SE', 9001, 189, 'EUR', 'in_stock',
   'https://staging.invalid/test-beer-se', 'VERIFIED'),
  (9203, 'test-merchant-de', 'DE', 9002, 599, 'EUR', 'in_stock',
   'https://staging.invalid/test-wine-de', 'VERIFIED'),
  (9204, 'test-merchant-se', 'SE', 9002, 749, 'EUR', 'in_stock',
   'https://staging.invalid/test-wine-se', 'VERIFIED');
