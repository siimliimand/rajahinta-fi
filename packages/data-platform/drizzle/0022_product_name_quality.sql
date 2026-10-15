-- Change product-name-quality-gate: merchant-feed garbage names
-- ('' , '40 %', 'ÀN 2022', annotated names) reach every listing.
-- product_master gains the name-quality columns the D1 side got in
-- migration 0037: name_quality quarantines rows out of the shared
-- PRODUCT_LISTING_UNIVERSE_SQL predicate, name_annotation preserves the
-- stripped merchant commentary for the ops enrichment queue. Legacy pg
-- stack parity (schema.ts carries both columns since 2.3; the E2E boot's
-- seed writes them).
--> statement-breakpoint
ALTER TABLE "product_master" ADD COLUMN "name_quality" varchar(32) NOT NULL DEFAULT 'ok';--> statement-breakpoint
ALTER TABLE "product_master" ADD COLUMN "name_annotation" text;
