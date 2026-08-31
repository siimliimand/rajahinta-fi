-- Task 2.5 (change migrate-to-cloudflare), gate-review addition (a):
-- widen the product_master.container_type CHECK.
--
-- Migration 0000 generated the CHECK from the pg schema docblock
-- ("glass/plastic/metal/carton"), but that is NOT the full authoritative
-- value set:
--
--   1. The core-domain container-type union
--      (packages/core-domain/src/index.ts) is
--      'glass' | 'plastic' | 'metal' | 'carton' | 'other' — 'other' was
--      missing from the D1 CHECK.
--   2. Real feed data and the committed fixtures store the
--      container-duty engine's standard packaging spellings too:
--      golden products (tests/golden/data/products.ts) and the
--      data-acquisition fixtures use 'can' (and consumer tests 'bottle')
--      — both members of the container-duty engine's STANDARD_CONTAINERS
--      set (core-domain/src/tax/services/container-duty.math.ts).
--
-- Authoritative value set = core-domain ContainerType union ∪ fixture
-- values: glass, plastic, metal, carton, other, can, bottle.
--
-- SQLite cannot ALTER a CHECK constraint, so the table is rebuilt with
-- the documented procedure (https://sqlite.org/lang_altertable.html,
-- "Otherwise New Table"), the same shape drizzle-kit emits for SQLite
-- CHECK changes: suspend FK enforcement, create the corrected table,
-- copy rows, drop the old table, rename, restore enforcement, verify
-- the reference graph. Ids are copied verbatim so the FTS5
-- external-content index of migration 0001 stays consistent (it reads
-- content by rowid = id). The sync triggers are dropped first so the
-- copy does not double-write the FTS index, then recreated verbatim
-- from 0001.
--
-- The CHECK below qualifies the column with the TEMPORARY table name
-- because SQLite resolves CHECK expressions at CREATE TABLE. The closing
-- ALTER TABLE RENAME rewrites the self-reference back to
-- "product_master", so the stored constraint ends up textually
-- identical to migration 0000's (asserted in the D1 harness tests).
PRAGMA foreign_keys = off;--> statement-breakpoint
DROP TRIGGER `product_master_fts_ai`;--> statement-breakpoint
DROP TRIGGER `product_master_fts_ad`;--> statement-breakpoint
DROP TRIGGER `product_master_fts_au`;--> statement-breakpoint
CREATE TABLE `product_master_new` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text(512) NOT NULL,
	`manufacturer` text(256) NOT NULL,
	`brand` text(256) NOT NULL,
	`category` text(32) NOT NULL,
	`alcohol_by_volume` real,
	`unit_volume` real NOT NULL,
	`container_type` text(32) NOT NULL,
	`regulatory_classification` text(64) NOT NULL,
	`deposit_system_status` integer,
	`ean` text(13),
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "product_master_container_type_check" CHECK("product_master_new"."container_type" IN ('glass', 'plastic', 'metal', 'carton', 'other', 'can', 'bottle'))
);--> statement-breakpoint
INSERT INTO `product_master_new` (`id`, `name`, `manufacturer`, `brand`, `category`, `alcohol_by_volume`, `unit_volume`, `container_type`, `regulatory_classification`, `deposit_system_status`, `ean`, `created_at`, `updated_at`) SELECT `id`, `name`, `manufacturer`, `brand`, `category`, `alcohol_by_volume`, `unit_volume`, `container_type`, `regulatory_classification`, `deposit_system_status`, `ean`, `created_at`, `updated_at` FROM `product_master`;--> statement-breakpoint
DROP TABLE `product_master`;--> statement-breakpoint
ALTER TABLE `product_master_new` RENAME TO `product_master`;--> statement-breakpoint
CREATE TRIGGER `product_master_fts_ai` AFTER INSERT ON `product_master` BEGIN
  INSERT INTO `product_master_fts` (rowid, `name`, `brand`, `manufacturer`)
  VALUES (new.`id`, new.`name`, new.`brand`, new.`manufacturer`);
END;--> statement-breakpoint
CREATE TRIGGER `product_master_fts_ad` AFTER DELETE ON `product_master` BEGIN
  INSERT INTO `product_master_fts` (`product_master_fts`, rowid, `name`, `brand`, `manufacturer`)
  VALUES ('delete', old.`id`, old.`name`, old.`brand`, old.`manufacturer`);
END;--> statement-breakpoint
CREATE TRIGGER `product_master_fts_au` AFTER UPDATE ON `product_master` BEGIN
  INSERT INTO `product_master_fts` (`product_master_fts`, rowid, `name`, `brand`, `manufacturer`)
  VALUES ('delete', old.`id`, old.`name`, old.`brand`, old.`manufacturer`);
  INSERT INTO `product_master_fts` (rowid, `name`, `brand`, `manufacturer`)
  VALUES (new.`id`, new.`name`, new.`brand`, new.`manufacturer`);
END;--> statement-breakpoint
PRAGMA foreign_key_check;--> statement-breakpoint
PRAGMA foreign_keys = on;
