-- Task 2.1 (change alks-feed-and-import-vat): product weight in grams —
-- optional transport-estimation input; the volume-based estimate stays the
-- fallback. Nullable forward migration per the ingestion contract: feeds
-- that carry no weight leave it NULL. No backfill, no default — historical
-- rows and rate records are untouched.
ALTER TABLE `product_master` ADD COLUMN `weight_grams` INTEGER;
