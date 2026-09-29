-- Task 1.1 (change expand-alerts-accuracy-breakdowns, design D1): the
-- alert kind set grows to PRICE | TAX_CHANGE | LANDED_COST | CATEGORY.
--
-- LANDED_COST watches the product-wide daily landed-cost close: a
-- product and a positive threshold, the same row shape as PRICE.
-- CATEGORY watches a whole canonical product category, so product_id
-- loses its NOT NULL (CATEGORY rows carry NULL) and a nullable
-- `category` column stores the watched value. Canonicality stays
-- app-layer by design (D1 mirrors the search route's 400-on-unknown
-- contract): the repository guard and the API route validate against
-- the shared PRODUCT_CATEGORIES constant — one definition, no schema
-- copy of the value set to drift.
--
-- SQLite cannot alter column constraints in place, so the table is
-- recreated (PRAGMA-guarded __new_ copy, DROP, RENAME) and its indexes
-- rebuilt — migration 0016's kind-column strategy. Existing rows carry
-- over untouched: every current row is a PRICE/TAX_CHANGE row with a
-- present product_id, valid under the new shape; `category` is new in
-- this migration, so the INSERT .. SELECT sources NULL for it (the
-- by-name copy would fail exactly like 0016's did).
--
-- The (account_id, product_id, kind) unique keeps guarding the
-- product-bearing kinds' per-product+kind duplicate check. CATEGORY
-- rows carry a NULL product_id, which SQLite unique indexes treat as
-- pairwise distinct — the category kind has no schema-level duplicate
-- guard.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_price_alerts` (
	`id` integer PRIMARY KEY NOT NULL,
	`account_id` integer NOT NULL,
	`product_id` integer,
	`kind` text(16) DEFAULT 'PRICE' NOT NULL,
	`category` text(32),
	`threshold_cents` integer,
	`status` text(16) DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `product_master`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "price_alerts_threshold_cents_check" CHECK("__new_price_alerts"."threshold_cents" IS NULL OR "__new_price_alerts"."threshold_cents" > 0),
	CONSTRAINT "price_alerts_status_check" CHECK("__new_price_alerts"."status" IN ('active', 'paused')),
	CONSTRAINT "price_alerts_kind_check" CHECK("__new_price_alerts"."kind" IN ('PRICE', 'TAX_CHANGE', 'LANDED_COST', 'CATEGORY'))
);
--> statement-breakpoint
INSERT INTO `__new_price_alerts`("id", "account_id", "product_id", "kind", "category", "threshold_cents", "status", "created_at", "updated_at") SELECT "id", "account_id", "product_id", "kind", NULL AS "category", "threshold_cents", "status", "created_at", "updated_at" FROM `price_alerts`;--> statement-breakpoint
DROP TABLE `price_alerts`;--> statement-breakpoint
ALTER TABLE `__new_price_alerts` RENAME TO `price_alerts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `price_alerts_status_idx` ON `price_alerts` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `price_alerts_account_id_product_id_kind_unique` ON `price_alerts` (`account_id`,`product_id`,`kind`);
