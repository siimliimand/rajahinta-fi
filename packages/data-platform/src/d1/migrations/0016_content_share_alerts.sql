-- Task 1.2 (change trust-and-reach-roadmap, design D3/D4/D5/D6): the
-- content, share, and alert-kind schema.
--
-- blog_posts: one row per (slug, locale). The draft hook at the manual
-- rate-confirmation point creates FI + EN DRAFT rows (fail-open);
-- only an operator action publishes — the public endpoints read
-- PUBLISHED rows only (the (locale, status) index). rate_dataset_version
-- is a version_label reference, not an FK: rate versions are append-only
-- rows across the rule tables, not keyed lookups.
--
-- newsletter_subscribers: double opt-in consent, independent of
-- accounts and of price-alert consent — no account FK exists. Rows
-- start PENDING; only the emailed token confirms (unconfirmed rows are
-- never mailed). Only the SHA-256 digest of the token is stored (the
-- email_tokens convention). Uniqueness is case-insensitive in SQL on
-- lower(email) (the accounts_email_lower_idx precedent); the repository
-- stores the address lowercase.
--
-- share_snapshots: frozen copies of a calculation result behind a
-- 22-character random public id (length pinned by CHECK — a generator
-- bug is unrepresentable at rest). The copy carries no account
-- identifiers, so there is no account FK and no retention exception;
-- the 12-month hygiene sweep (owned by the sharing module) filters by
-- created_at.
--
-- price_alerts: gains `kind` (DEFAULT 'PRICE', CHECK PRICE|TAX_CHANGE),
-- loses threshold_cents NOT NULL (TAX_CHANGE alerts carry no threshold —
-- the CHECK now demands only a positive value when present), and the
-- duplicate-guard unique moves from (account_id, product_id) to
-- (account_id, product_id, kind) — spec: duplicate check is per
-- product+kind, and TAX_CHANGE must not require a threshold. SQLite
-- cannot alter table constraints in place, so the generator recreates
-- the table (PRAGMA-guarded __new_ copy, DROP, RENAME) and rebuilds its
-- indexes; existing rows carry over and take kind = 'PRICE' from the
-- new column's default, preserving the pre-kind behavior exactly.
--
-- Repair vs raw generator output (drizzle-kit 0.30): the recreate's
-- INSERT .. SELECT copies every column BY NAME from the old table, which
-- fails with "no such column: kind" because the column is new in this
-- migration. The SELECT sources 'PRICE' literally instead — same
-- recreate strategy, appliable SQL, and existing rows still default to
-- PRICE (the column's NOT NULL DEFAULT would cover any NULL anyway).
CREATE TABLE `blog_posts` (
	`id` integer PRIMARY KEY NOT NULL,
	`slug` text(256) NOT NULL,
	`locale` text(16) NOT NULL,
	`title` text(512) NOT NULL,
	`body_markdown` text NOT NULL,
	`status` text(16) DEFAULT 'DRAFT' NOT NULL,
	`rate_dataset_version` text(64),
	`published_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "blog_posts_status_check" CHECK("blog_posts"."status" IN ('DRAFT', 'PUBLISHED')),
	CONSTRAINT "blog_posts_slug_check" CHECK("blog_posts"."slug" <> ''),
	CONSTRAINT "blog_posts_title_check" CHECK("blog_posts"."title" <> '')
);
--> statement-breakpoint
CREATE INDEX `blog_posts_locale_status_idx` ON `blog_posts` (`locale`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `blog_posts_slug_locale_unique` ON `blog_posts` (`slug`,`locale`);--> statement-breakpoint
CREATE TABLE `newsletter_subscribers` (
	`id` integer PRIMARY KEY NOT NULL,
	`email` text(320) NOT NULL,
	`status` text(16) DEFAULT 'PENDING' NOT NULL,
	`confirmation_token_hash` text(64) NOT NULL,
	`confirmed_at` text,
	`unsubscribed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "newsletter_subscribers_status_check" CHECK("newsletter_subscribers"."status" IN ('PENDING', 'ACTIVE', 'UNSUBSCRIBED')),
	CONSTRAINT "newsletter_subscribers_token_hash_check" CHECK("newsletter_subscribers"."confirmation_token_hash" <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `newsletter_subscribers_email_lower_idx` ON `newsletter_subscribers` (lower("email"));--> statement-breakpoint
CREATE INDEX `newsletter_subscribers_status_idx` ON `newsletter_subscribers` (`status`);--> statement-breakpoint
CREATE TABLE `share_snapshots` (
	`id` integer PRIMARY KEY NOT NULL,
	`public_id` text(22) NOT NULL,
	`frozen_result` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "share_snapshots_public_id_check" CHECK(length("share_snapshots"."public_id") = 22),
	CONSTRAINT "share_snapshots_frozen_result_check" CHECK("share_snapshots"."frozen_result" <> '' AND json_valid("share_snapshots"."frozen_result"))
);
--> statement-breakpoint
CREATE INDEX `share_snapshots_created_at_idx` ON `share_snapshots` (`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `share_snapshots_public_id_unique` ON `share_snapshots` (`public_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_price_alerts` (
	`id` integer PRIMARY KEY NOT NULL,
	`account_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`kind` text(16) DEFAULT 'PRICE' NOT NULL,
	`threshold_cents` integer,
	`status` text(16) DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `product_master`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "price_alerts_threshold_cents_check" CHECK("__new_price_alerts"."threshold_cents" IS NULL OR "__new_price_alerts"."threshold_cents" > 0),
	CONSTRAINT "price_alerts_status_check" CHECK("__new_price_alerts"."status" IN ('active', 'paused')),
	CONSTRAINT "price_alerts_kind_check" CHECK("__new_price_alerts"."kind" IN ('PRICE', 'TAX_CHANGE'))
);
--> statement-breakpoint
INSERT INTO `__new_price_alerts`("id", "account_id", "product_id", "kind", "threshold_cents", "status", "created_at", "updated_at") SELECT "id", "account_id", "product_id", 'PRICE' AS "kind", "threshold_cents", "status", "created_at", "updated_at" FROM `price_alerts`;--> statement-breakpoint
DROP TABLE `price_alerts`;--> statement-breakpoint
ALTER TABLE `__new_price_alerts` RENAME TO `price_alerts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `price_alerts_status_idx` ON `price_alerts` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `price_alerts_account_id_product_id_kind_unique` ON `price_alerts` (`account_id`,`product_id`,`kind`);
