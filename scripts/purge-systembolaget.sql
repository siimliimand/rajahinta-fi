-- ===========================================================================
-- Merchant removal purge (task 2.2, change drop-sweden-eur-only-alko-benchmark)
--
-- Deletes every queryable row of the removed merchant: registry row,
-- governance audit records, retail offers, price-history summaries,
-- merchant-scoped terms/snapshots, and products that only that merchant
-- ever offered (with their FK-dependent rows).
--
-- Target: the D1/SQLite schema (packages/data-platform/src/d1/schema.ts).
-- Run BEFORE (re-)seeding an environment, in the deploy order
--   purge → migrate → seed (scripts/seed-d1.ts):
--
--   wrangler d1 execute DB --file scripts/purge-systembolaget.sql --local
--   wrangler d1 execute DB --file scripts/purge-systembolaget.sql --remote --env staging
--
-- Idempotent by construction: every statement is a DELETE whose predicate
-- is empty once the purge has run, so the second run removes nothing.
-- The R2 observation log is append-only and is NOT touched by design
-- (ARCHITECTURE.md §5 data immutability): no statement here reads or
-- writes it, and no observation partitions are deleted.
--
-- Post-condition (the spec's repeatable-safe scenario): zero rows
-- referencing the removed merchant in any D1 table:
--   SELECT (SELECT COUNT(*) FROM merchant_registry WHERE merchant_id = 'systembolaget')
--        + (SELECT COUNT(*) FROM retail_offers   WHERE merchant      = 'systembolaget')
--        + (SELECT COUNT(*) FROM price_history_summaries WHERE merchant = 'systembolaget')
--   -- → 0
--
-- Legacy pg note: the pg staging fixture never contained the removed
-- merchant, so pg environments need no purge; if one ever did, its
-- price_observations rows (a pg-only table) must also be deleted before
-- retail_offers.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. FK-dependent rows of the merchant-only products.
--
-- P = products whose ONLY retail offers are the removed merchant's
-- (products shared with other merchants are kept). Every table below
-- references product_master without ON DELETE cascade (the application
-- path never deletes products), so children go first, while the offers
-- still exist and make P computable. calculation_records and
-- price_history_summaries are not in the task's headline list but must
-- go for the same FK reason (and their summaries carry the merchant's
-- buckets directly).
-- ---------------------------------------------------------------------------

DELETE FROM alert_notifications
WHERE alert_id IN (SELECT id FROM price_alerts WHERE product_id IN (
  SELECT DISTINCT product_id FROM retail_offers
   WHERE merchant = 'systembolaget'
     AND product_id NOT IN (SELECT product_id FROM retail_offers WHERE merchant <> 'systembolaget')
));

DELETE FROM price_alerts
WHERE product_id IN (
  SELECT DISTINCT product_id FROM retail_offers
   WHERE merchant = 'systembolaget'
     AND product_id NOT IN (SELECT product_id FROM retail_offers WHERE merchant <> 'systembolaget')
);

DELETE FROM producer_links
WHERE alko_product_id IN (
  SELECT DISTINCT product_id FROM retail_offers
   WHERE merchant = 'systembolaget'
     AND product_id NOT IN (SELECT product_id FROM retail_offers WHERE merchant <> 'systembolaget')
) OR sibling_product_id IN (
  SELECT DISTINCT product_id FROM retail_offers
   WHERE merchant = 'systembolaget'
     AND product_id NOT IN (SELECT product_id FROM retail_offers WHERE merchant <> 'systembolaget')
);

DELETE FROM curated_entries
WHERE product_id IN (
  SELECT DISTINCT product_id FROM retail_offers
   WHERE merchant = 'systembolaget'
     AND product_id NOT IN (SELECT product_id FROM retail_offers WHERE merchant <> 'systembolaget')
);

DELETE FROM group_order_items
WHERE product_id IN (
  SELECT DISTINCT product_id FROM retail_offers
   WHERE merchant = 'systembolaget'
     AND product_id NOT IN (SELECT product_id FROM retail_offers WHERE merchant <> 'systembolaget')
);

DELETE FROM product_dimensions
WHERE product_id IN (
  SELECT DISTINCT product_id FROM retail_offers
   WHERE merchant = 'systembolaget'
     AND product_id NOT IN (SELECT product_id FROM retail_offers WHERE merchant <> 'systembolaget')
);

DELETE FROM calculation_records
WHERE product_master_id IN (
  SELECT DISTINCT product_id FROM retail_offers
   WHERE merchant = 'systembolaget'
     AND product_id NOT IN (SELECT product_id FROM retail_offers WHERE merchant <> 'systembolaget')
);

DELETE FROM price_history_summaries
WHERE merchant = 'systembolaget'
   OR product_id IN (
  SELECT DISTINCT product_id FROM retail_offers
   WHERE merchant = 'systembolaget'
     AND product_id NOT IN (SELECT product_id FROM retail_offers WHERE merchant <> 'systembolaget')
);

-- ---------------------------------------------------------------------------
-- 2. The merchant's retail offers.
-- ---------------------------------------------------------------------------

DELETE FROM retail_offers WHERE merchant = 'systembolaget';

-- ---------------------------------------------------------------------------
-- 3. Merchant-only products.
--
-- After step 2 the P-set itself is no longer expressible (its defining
-- offers are gone), so the sweep removes every product left with NO
-- offers and NO referencing row in any product_master child table.
-- Steps 1–2 cleared exactly P's references, so every P product matches.
-- The only additional rows this can remove are products with no offers
-- and no references anywhere — rows no query can ever reach — and those
-- carry no merchant identity (product_master has no merchant column).
-- ---------------------------------------------------------------------------

DELETE FROM product_master
WHERE NOT EXISTS (SELECT 1 FROM retail_offers           WHERE product_id       = product_master.id)
  AND NOT EXISTS (SELECT 1 FROM price_history_summaries WHERE product_id       = product_master.id)
  AND NOT EXISTS (SELECT 1 FROM calculation_records     WHERE product_master_id = product_master.id)
  AND NOT EXISTS (SELECT 1 FROM price_alerts            WHERE product_id       = product_master.id)
  AND NOT EXISTS (SELECT 1 FROM product_dimensions      WHERE product_id       = product_master.id)
  AND NOT EXISTS (SELECT 1 FROM group_order_items       WHERE product_id       = product_master.id)
  AND NOT EXISTS (SELECT 1 FROM producer_links          WHERE alko_product_id  = product_master.id
                                                     OR sibling_product_id = product_master.id)
  AND NOT EXISTS (SELECT 1 FROM curated_entries         WHERE product_id       = product_master.id);

-- ---------------------------------------------------------------------------
-- 4. Registry, merchant-scoped rows, and governance records.
--
-- Governance permission state lives only in governance audit records
-- (the source-governance store itself is an in-memory port — no
-- source_governance table exists), so its durable trace is the
-- audit_events rows below.
-- ---------------------------------------------------------------------------

DELETE FROM merchant_registry      WHERE merchant_id = 'systembolaget';
DELETE FROM merchant_terms         WHERE merchant_id = 'systembolaget';
DELETE FROM click_counter_snapshots WHERE merchant_id = 'systembolaget';
DELETE FROM audit_events           WHERE entity_type = 'source_governance' AND entity_id = 'systembolaget';
