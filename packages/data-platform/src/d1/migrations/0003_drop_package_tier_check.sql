-- Task 3.9 review finding (change migrate-to-cloudflare): drop the invented
-- transport_offers.package_tier CHECK.
--
-- Migration 0000 generated `transport_offers_package_tier_check` with the
-- value set ('parcel', 'box', 'pallet'), but unlike the other CHECK
-- constraints there is NO authoritative source for that set:
--
--   1. The pg canonical schema (packages/data-platform/src/schema.ts)
--      declares package_tier as a plain varchar(32) with no docblock
--      enumeration and no CHECK.
--   2. The core-domain treats it as a free string everywhere
--      (transport-estimation.service.ts / basket-shipping-calculator
--      match `o.packageTier === packageType` with `packageType: string`).
--   3. The value vocabulary in real data is the product container-type
--      vocabulary: the calculator matches transport offers to products by
--      `packageTier === product.containerType`, so rows carry values like
--      'can'/'bottle' — none of which the invented CHECK admits.
--
-- With the CHECK in place, every offer seeded from real pipelines is
-- rejected and calculations silently degrade to transport-0/UNAVAILABLE.
-- Per design D2, CHECK constraints are added only where the pg schema
-- enumerates values; it does not here, so the constraint is removed
-- outright rather than widened.
--
-- SQLite cannot ALTER a CHECK constraint, so the table is rebuilt with
-- the documented procedure (https://sqlite.org/lang_altertable.html),
-- the same shape as migration 0002. Nothing references transport_offers
-- and it has no FTS sync triggers, so the rebuild is a plain copy.
PRAGMA foreign_keys = off;--> statement-breakpoint
CREATE TABLE `transport_offers_new` (
	`id` integer PRIMARY KEY NOT NULL,
	`carrier` text(64) NOT NULL,
	`origin_country` text(4) NOT NULL,
	`destination_country` text(4) DEFAULT 'FI' NOT NULL,
	`weight_min_kg` real,
	`weight_max_kg` real,
	`package_tier` text(32) NOT NULL,
	`price_cents` integer NOT NULL,
	`currency` text(3) DEFAULT 'EUR' NOT NULL,
	`seller_involvement_indicator` integer DEFAULT false NOT NULL,
	`observed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`refreshed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`reliability_status` text(16) DEFAULT 'ESTIMATED' NOT NULL,
	CONSTRAINT "transport_offers_reliability_status_check" CHECK("transport_offers_new"."reliability_status" IN ('VERIFIED', 'ESTIMATED', 'STALE', 'UNAVAILABLE'))
);--> statement-breakpoint
INSERT INTO `transport_offers_new` (`id`, `carrier`, `origin_country`, `destination_country`, `weight_min_kg`, `weight_max_kg`, `package_tier`, `price_cents`, `currency`, `seller_involvement_indicator`, `observed_at`, `refreshed_at`, `reliability_status`) SELECT `id`, `carrier`, `origin_country`, `destination_country`, `weight_min_kg`, `weight_max_kg`, `package_tier`, `price_cents`, `currency`, `seller_involvement_indicator`, `observed_at`, `refreshed_at`, `reliability_status` FROM `transport_offers`;--> statement-breakpoint
DROP TABLE `transport_offers`;--> statement-breakpoint
ALTER TABLE `transport_offers_new` RENAME TO `transport_offers`;--> statement-breakpoint
PRAGMA foreign_key_check;--> statement-breakpoint
PRAGMA foreign_keys = on;
