-- ===========================================================================
-- Savings-snapshot fixtures for the browser-E2E suite on the Workers stack
-- (homepage-live-gap-hero task 4.3).
--
-- Gives the homepage hero its POPULATED state: one materialized snapshot
-- day over the two journey products (TEST Beer 9001 / TEST Wine 9002,
-- seeded by seed-journeys.d1.sql — this file depends on those rows and is
-- applied right after it by boot-workers-stack.sh). Applied through the
-- same real D1 path (`wrangler d1 execute DB --local --file`) as every
-- other journey fixture — not a parallel seeding system.
--
-- Boot default is ON. E2E_SAVINGS_SNAPSHOT=0 skips this file so the
-- harness carries NO snapshot day and the homepage renders its pending
-- state (the snapshot-absent scenario its journey asserts).
--
-- Conventions (mirroring seed-journeys.d1.sql):
-- - explicit ids continuing the journey range (products 900x, transport
--   91xx, offers 92xx → snapshots 93xx);
-- - INSERT OR IGNORE — re-running the boot script never duplicates rows;
-- - as_of is the boot day (SQLite date('now'), UTC): the homepage's
--   3-day freshness cutoff (design D4) accepts it for the whole run,
--   and findLatestDay (MAX(as_of)) sees one shared day.
--
-- Figures are synthetic — the checks below bind SHAPE, not magnitude:
-- - gap_cents < 0 (landed total below the Alko reference): the top-N
--   route lists import-favourable rows only, a dearer row would be
--   excluded and the hero would render pending instead;
-- - alko_reference_cents NOT NULL: an eligibility defense excludes
--   null-reference rows;
-- - product_id resolves in product_master (the name-map defense);
-- - landed_reliability / confidence inside their CHECK value sets.
--
-- Order note for the journeys: sortSavingsRows orders by gap basis
-- points ascending (the most import-favourable first) — the wine
-- (−3161 bps) lists before the beer (−1972 bps), deterministically.
-- ===========================================================================

INSERT OR IGNORE INTO "savings_snapshots"
  ("id", "as_of", "product_id", "category", "best_merchant",
   "best_merchant_country", "best_price_cents", "best_observed_at",
   "alko_reference_cents", "alko_observed_at", "landed_total_cents",
   "landed_reliability", "confidence", "gap_cents", "gap_basis_points",
   "tax_dataset_version")
VALUES
  -- TEST Beer — €1.49 observed (test-merchant-de), €2.89 estimated landed
  -- total vs the €3.60 Alko reference → −€0.71 / −1972 bps.
  (9301, strftime('%Y-%m-%d', 'now'), 9001, 'beer', 'test-merchant-de',
   'DE', 149, '2026-01-01T00:00:00.000Z',
   360, '2026-01-01T00:00:00.000Z', 289,
   'VERIFIED', 'HIGH', -71, -1972,
   'e2e-journey-fixture'),
  -- TEST Wine — €5.99 observed (test-merchant-de), €6.49 estimated landed
  -- total vs the €9.49 Alko reference → −€3.00 / −3161 bps.
  (9302, strftime('%Y-%m-%d', 'now'), 9002, 'wine_still', 'test-merchant-de',
   'DE', 599, '2026-01-01T00:00:00.000Z',
   949, '2026-01-01T00:00:00.000Z', 649,
   'VERIFIED', 'HIGH', -300, -3161,
   'e2e-journey-fixture');
