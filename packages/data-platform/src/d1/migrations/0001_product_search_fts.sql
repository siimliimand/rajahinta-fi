-- Task 2.2 (change migrate-to-cloudflare): FTS5 product search index.
--
-- External-content FTS5 virtual table over `product_master` (name, brand,
-- manufacturer) plus the AFTER INSERT / DELETE / UPDATE sync triggers —
-- the exact DDL validated by the G2 search-parity spike
-- (scripts/spikes/cloudflare/search-parity, 13/13 golden queries within
-- top-5; design D3, gate G2 GO).
--
-- Hand-written custom migration: drizzle-kit (0.30) cannot express FTS5
-- virtual tables in sqliteTable definitions, so this table deliberately
-- has NO drizzle schema declaration — raw SQL in the migration is the
-- source of truth for it (raw-SQL-in-migration preferred per task 2.2;
-- src/d1/schema.ts stays untouched). The meta/_journal.json entry keeps
-- the drizzle-kit journal consistent; no snapshot exists for this file,
-- which is the documented mechanism for custom migrations.
--
-- remove_diacritics 0 keeps ö/ä/å as-is so 'öl' does not acquire the
-- extra recall of 'ol*' — parity with the pg ILIKE contract, which folds
-- case but never strips diacritics.
CREATE VIRTUAL TABLE `product_master_fts` USING fts5(
  `name`,
  `brand`,
  `manufacturer`,
  content=`product_master`,
  content_rowid=`id`,
  tokenize='unicode61 remove_diacritics 0'
);
--> statement-breakpoint
-- External-content tables must be kept in sync by triggers.
CREATE TRIGGER `product_master_fts_ai` AFTER INSERT ON `product_master` BEGIN
  INSERT INTO `product_master_fts` (rowid, `name`, `brand`, `manufacturer`)
  VALUES (new.`id`, new.`name`, new.`brand`, new.`manufacturer`);
END;
--> statement-breakpoint
CREATE TRIGGER `product_master_fts_ad` AFTER DELETE ON `product_master` BEGIN
  INSERT INTO `product_master_fts` (`product_master_fts`, rowid, `name`, `brand`, `manufacturer`)
  VALUES ('delete', old.`id`, old.`name`, old.`brand`, old.`manufacturer`);
END;
--> statement-breakpoint
CREATE TRIGGER `product_master_fts_au` AFTER UPDATE ON `product_master` BEGIN
  INSERT INTO `product_master_fts` (`product_master_fts`, rowid, `name`, `brand`, `manufacturer`)
  VALUES ('delete', old.`id`, old.`name`, old.`brand`, old.`manufacturer`);
  INSERT INTO `product_master_fts` (rowid, `name`, `brand`, `manufacturer`)
  VALUES (new.`id`, new.`name`, new.`brand`, new.`manufacturer`);
END;
