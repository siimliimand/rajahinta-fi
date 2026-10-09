-- Task 1.1 (change add-product-favorites, design D2): the favorites
-- table behind the product-page heart and the /account/favorites list.
--
-- account_favorites: one row per (account, product) — the UNIQUE
-- constraint is the duplicate guard (route layer: 409), exactly like
-- the alerts triple, and its leading account_id column serves
-- list-by-account. saved_price_cents captures the product's
-- materialized daily close at save time and is nullable as real state,
-- not "optional for later": the product may have no daily summary
-- within the 7-day freshness window at save time. The list's Δ column
-- renders only when a read-time current price exists too; deltas are
-- computed, never stored (design D4). account_id cascades on account
-- deletion so the GDPR erasure path cannot orphan favorites even if
-- the repository layer is bypassed (the same guarantee price_alerts
-- and saved_scenarios carry); products are never deleted, so
-- product_id carries no cascade.
CREATE TABLE `account_favorites` (
	`id` integer PRIMARY KEY NOT NULL,
	`account_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`saved_price_cents` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `product_master`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_favorites_account_id_product_id_unique` ON `account_favorites` (`account_id`,`product_id`);
