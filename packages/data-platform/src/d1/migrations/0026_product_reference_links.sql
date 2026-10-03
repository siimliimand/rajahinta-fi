-- Task 1.1 (change alko-reference-matching-pipeline, design D1/D2): the
-- persistence the matcher never had — the product-identity EDGE between the
-- two disjoint product universes (4,257 Alko-referenced / 4,442 foreign,
-- zero overlap, zero Alko-side EANs).
--
-- product_reference_links: one row per foreign→Alko reference decision
-- (design D1 — a link, never a merge: offers, price history, alerts, and
-- calculation records stay on their existing product ids). Rows are
-- TERMINAL DECISIONS ONLY — the matching pass never writes here (D2); an
-- operator confirm through the guarded console creates CONFIRMED, a reject
-- records REJECTED, and a replaced link becomes SUPERSEDED. Invariants
-- (spec product-normalization / savings-discovery): only CONFIRMED links
-- are read by any consumer (the savings cron); decisions are immutable once
-- made — nothing updates a decided row, replacement supersedes the old row
-- and coexists with it as history.
--
-- Live-link uniqueness is a PARTIAL unique index per side, WHERE
-- status = 'CONFIRMED': at most one live link per foreign product AND per
-- Alko product at any time (design D1 "unique per side"), while
-- SUPERSEDED/REJECTED history coexists under the same keys. A plain UNIQUE
-- would make replacement history unrepresentable; no constraint would leave
-- two live links per side representable — an ambiguous reference resolution
-- in the cron and a double-rendered savings pair. The one-to-one live
-- pairing also surfaces duplicate foreign listings at confirm time: the
-- second confirm fails until the operator explicitly supersedes.
--
-- CONFIRMED-without-attribution is unrepresentable (conditional CHECK, the
-- consumption-norms trust pattern): a confirmed link names the operator and
-- the decision time. created_at/updated_at carry the schema-wide strftime
-- default; repositories stamp updated_at explicitly on supersedence (no
-- ON UPDATE trigger exists anywhere in this schema).
--
-- match_review: the review queue the matching pass writes (D2/D5) — every
-- scored candidate, PENDING only; the pass NEVER decides. UNIQUE
-- (foreign_product_id, alko_product_id) is the per-pair identity behind the
-- pass's idempotent upsert (re-runs refresh PENDING rows in place, never
-- duplicate). Both sides' name/brand/ABV/volume are frozen at enqueue time
-- so the reviewer sees what the scorer saw even if product_master moves
-- afterward. status leaving PENDING requires decided_by/decided_at
-- attribution (conditional CHECK), and decided rows are immutable — a
-- decided candidate can never re-enter the queue (the pair-unique index
-- forces the refresh path onto PENDING rows only). score is CHECKed to the
-- scorer's pinned 0–100 contract (product-matcher.types).
--
-- savings_snapshots.reference_link_id: nullable provenance — when a
-- CONFIRMED link produced the pair, the snapshot row names it (design D4,
-- the explainability invariant). ALTER ADD COLUMN nullable per the
-- product weight_grams precedent (0020): the 0018 table exists in
-- production, and NULL stays meaningful — a pair produced from a direct
-- Alko reference offer, which remains representable.
CREATE TABLE `product_reference_links` (
	`id` integer PRIMARY KEY NOT NULL,
	`foreign_product_id` integer NOT NULL,
	`alko_product_id` integer NOT NULL,
	`status` text(16) NOT NULL,
	`confirmed_by` text(128),
	`confirmed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "product_reference_links_status_check" CHECK("product_reference_links"."status" IN ('CONFIRMED', 'REJECTED', 'SUPERSEDED')),
	CONSTRAINT "product_reference_links_confirmed_attribution_check" CHECK("product_reference_links"."status" <> 'CONFIRMED' OR ("product_reference_links"."confirmed_by" IS NOT NULL AND length("product_reference_links"."confirmed_by") > 0 AND "product_reference_links"."confirmed_at" IS NOT NULL)),
	CONSTRAINT "product_reference_links_self_link_check" CHECK("product_reference_links"."foreign_product_id" <> "product_reference_links"."alko_product_id"),
	FOREIGN KEY (`foreign_product_id`) REFERENCES `product_master`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`alko_product_id`) REFERENCES `product_master`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `match_review` (
	`id` integer PRIMARY KEY NOT NULL,
	`foreign_product_id` integer NOT NULL,
	`alko_product_id` integer NOT NULL,
	`confidence` text(16) NOT NULL,
	`match_method` text(16) NOT NULL,
	`score` integer NOT NULL,
	`foreign_name` text(512) NOT NULL,
	`foreign_brand` text(256),
	`foreign_abv` real,
	`foreign_volume` real,
	`alko_name` text(512) NOT NULL,
	`alko_brand` text(256),
	`alko_abv` real,
	`alko_volume` real,
	`status` text(16) DEFAULT 'PENDING' NOT NULL,
	`decided_by` text(128),
	`decided_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "match_review_confidence_check" CHECK("match_review"."confidence" IN ('EXACT', 'HIGH', 'MEDIUM', 'LOW', 'NONE')),
	CONSTRAINT "match_review_match_method_check" CHECK("match_review"."match_method" IN ('ean', 'fuzzy')),
	CONSTRAINT "match_review_score_check" CHECK("match_review"."score" BETWEEN 0 AND 100),
	CONSTRAINT "match_review_status_check" CHECK("match_review"."status" IN ('PENDING', 'CONFIRMED', 'REJECTED')),
	CONSTRAINT "match_review_decided_attribution_check" CHECK("match_review"."status" = 'PENDING' OR ("match_review"."decided_by" IS NOT NULL AND length("match_review"."decided_by") > 0 AND "match_review"."decided_at" IS NOT NULL)),
	CONSTRAINT "match_review_self_pair_check" CHECK("match_review"."foreign_product_id" <> "match_review"."alko_product_id"),
	FOREIGN KEY (`foreign_product_id`) REFERENCES `product_master`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`alko_product_id`) REFERENCES `product_master`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
-- IF NOT EXISTS despite the runner applying each file exactly once
-- (wrangler d1 migrations filename-order semantics): a stray re-apply of
-- the statement stays a no-op instead of an abort (0023/0025 discipline).
-- The live-side uniques double as the consumers' read paths: the cron's
-- CONFIRMED sweep scans either index, and per-product lookups carry the
-- status = 'CONFIRMED' predicate the partial index requires.
CREATE UNIQUE INDEX IF NOT EXISTS `product_reference_links_foreign_product_id_confirmed_unique` ON `product_reference_links` (`foreign_product_id`) WHERE `status` = 'CONFIRMED';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `product_reference_links_alko_product_id_confirmed_unique` ON `product_reference_links` (`alko_product_id`) WHERE `status` = 'CONFIRMED';--> statement-breakpoint
-- The pair identity: idempotent-upsert target of the matching pass and the
-- guard that keeps decided candidates from ever re-entering the queue.
CREATE UNIQUE INDEX IF NOT EXISTS `match_review_foreign_product_id_alko_product_id_unique` ON `match_review` (`foreign_product_id`,`alko_product_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `match_review_status_idx` ON `match_review` (`status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `match_review_foreign_product_id_idx` ON `match_review` (`foreign_product_id`);--> statement-breakpoint
ALTER TABLE `savings_snapshots` ADD COLUMN `reference_link_id` INTEGER REFERENCES `product_reference_links`(`id`) ON UPDATE no action ON DELETE no action;
