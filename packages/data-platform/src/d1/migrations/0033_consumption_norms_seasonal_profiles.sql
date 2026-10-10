-- Change seasonal-occasion-templates (task 1.1): widen the
-- consumption_norms.event_profile CHECK with the four seasonal occasion
-- profiles (juhannus, vappu, rapujuhlat, talkoot) behind the new
-- seasonal-occasions-fi-2026.1 curated dataset. The three general
-- profiles keep their slots — the value set only grows.
--
-- SQLite cannot ALTER a CHECK constraint, so the table is rebuilt with
-- the documented procedure (https://sqlite.org/lang_altertable.html,
-- "Otherwise New Table"), the same shape migration 0002 emits for
-- SQLite CHECK changes: suspend FK enforcement, create the corrected
-- table, copy rows, drop the old table, rename, restore enforcement,
-- verify the reference graph. Every column, default, and sibling CHECK
-- is copied verbatim from migration 0006; no table references
-- consumption_norms and it references none, so the rebuild is
-- reference-safe. Ids, statuses, confirmation audit columns and
-- created_at are copied verbatim — published history must survive the
-- rebuild untouched (append-only dataset policy).
--
-- The UNIQUE (drink_type, event_profile, version_label) index and the
-- status index are dropped with the old table and recreated verbatim —
-- the unique index is the curated seed's idempotent upsert target.
--
-- The CHECKs below qualify the columns with the temporary table name
-- because SQLite resolves CHECK expressions at CREATE TABLE. The
-- closing ALTER TABLE RENAME rewrites each self-reference back to
-- "consumption_norms", so the stored constraints end up textually
-- identical to migration 0006's.
PRAGMA foreign_keys = off;--> statement-breakpoint
CREATE TABLE `consumption_norms_new` (
	`id` integer PRIMARY KEY NOT NULL,
	`version_label` text(64) NOT NULL,
	`drink_type` text(32) NOT NULL,
	`event_profile` text(32) NOT NULL,
	`norm_value_per_guest_per_hour` real NOT NULL,
	`source_citation` text NOT NULL,
	`status` text(32) DEFAULT 'PENDING_CONFIRMATION' NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`confirmed_by` text(128),
	`confirmed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "consumption_norms_status_check" CHECK("consumption_norms_new"."status" IN ('PENDING_CONFIRMATION', 'PUBLISHED')),
	CONSTRAINT "consumption_norms_drink_type_check" CHECK("consumption_norms_new"."drink_type" IN ('beer', 'wine_still', 'wine_sparkling', 'intermediate_products', 'other_fermented', 'spirits')),
	CONSTRAINT "consumption_norms_event_profile_check" CHECK("consumption_norms_new"."event_profile" IN ('casual_gathering', 'dinner_party', 'celebration', 'juhannus', 'vappu', 'rapujuhlat', 'talkoot')),
	CONSTRAINT "consumption_norms_norm_value_check" CHECK("consumption_norms_new"."norm_value_per_guest_per_hour" > 0),
	CONSTRAINT "consumption_norms_window_check" CHECK("consumption_norms_new"."effective_to" IS NULL OR "consumption_norms_new"."effective_to" > "consumption_norms_new"."effective_from")
);--> statement-breakpoint
INSERT INTO `consumption_norms_new` (`id`, `version_label`, `drink_type`, `event_profile`, `norm_value_per_guest_per_hour`, `source_citation`, `status`, `effective_from`, `effective_to`, `confirmed_by`, `confirmed_at`, `created_at`) SELECT `id`, `version_label`, `drink_type`, `event_profile`, `norm_value_per_guest_per_hour`, `source_citation`, `status`, `effective_from`, `effective_to`, `confirmed_by`, `confirmed_at`, `created_at` FROM `consumption_norms`;--> statement-breakpoint
DROP TABLE `consumption_norms`;--> statement-breakpoint
ALTER TABLE `consumption_norms_new` RENAME TO `consumption_norms`;--> statement-breakpoint
CREATE UNIQUE INDEX `consumption_norms_key_version_unique` ON `consumption_norms` (`drink_type`,`event_profile`,`version_label`);--> statement-breakpoint
CREATE INDEX `consumption_norms_status_idx` ON `consumption_norms` (`status`);--> statement-breakpoint
PRAGMA foreign_key_check;--> statement-breakpoint
PRAGMA foreign_keys = on;
