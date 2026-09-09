-- Task 1.1 (change insight-surfaces, design D2/D4): the daily savings
-- snapshot table.
--
-- savings_snapshots: one materialized row per product per as-of day —
-- the day's best foreign offer, the Alko reference, the estimated landed
-- total, and the best-vs-reference gap. The daily insight job writes
-- idempotently keyed by unique(as_of, product_id): re-running a day
-- converges, last write wins (the price-history-summary bucket-key
-- pattern; both key columns are NOT NULL, so no NULLS NOT DISTINCT
-- compensation is needed). Every money amount is INTEGER euro cents and
-- the gap magnitude is INTEGER basis points (1/10 000) — floats never
-- touch money or percentages (design D4). tax_dataset_version is a
-- version_label reference, not an FK: versions are append-only rows
-- across the rule tables, not keyed lookups. alko_reference_cents and
-- alko_observed_at are null when no Alko reference was observed that day
-- — absence is representable, a sentinel zero is not.
CREATE TABLE `savings_snapshots` (
	`id` integer PRIMARY KEY NOT NULL,
	`as_of` text NOT NULL,
	`product_id` integer NOT NULL,
	`category` text(32) NOT NULL,
	`best_merchant` text(128) NOT NULL,
	`best_merchant_country` text(2) NOT NULL,
	`best_price_cents` integer NOT NULL,
	`best_observed_at` text NOT NULL,
	`alko_reference_cents` integer,
	`alko_observed_at` text,
	`landed_total_cents` integer NOT NULL,
	`landed_reliability` text(16) NOT NULL,
	`confidence` text(16) NOT NULL,
	`gap_cents` integer NOT NULL,
	`gap_basis_points` integer NOT NULL,
	`tax_dataset_version` text(64) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `product_master`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "savings_snapshots_as_of_product_id_unique" UNIQUE("as_of","product_id"),
	CONSTRAINT "savings_snapshots_landed_reliability_check" CHECK("savings_snapshots"."landed_reliability" IN ('VERIFIED', 'ESTIMATED', 'STALE', 'UNAVAILABLE')),
	CONSTRAINT "savings_snapshots_confidence_check" CHECK("savings_snapshots"."confidence" IN ('HIGH', 'MEDIUM', 'LOW'))
);
--> statement-breakpoint
CREATE INDEX `savings_snapshots_category_as_of_idx` ON `savings_snapshots` (`category`,`as_of`);
