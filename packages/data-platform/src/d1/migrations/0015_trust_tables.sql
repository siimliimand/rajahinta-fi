-- Task 1.1 (change trust-and-reach-roadmap, design D1/D2): the trust
-- tables — shop reports, blacklist entries, and user-reported
-- calculation outcomes.
--
-- shop_reports: one row per user report against a foreign merchant,
-- identified by domain + normalized name (no merchant_registry FK —
-- reported shops are not ingested). Evidence fields are NOT NULL; a
-- blank field is a validation bypass, unrepresentable at rest. The
-- moderation state machine (OPEN → LINKED | REJECTED) is driven by the
-- audited ops-console publish/reject actions, never automatically.
-- reporter_account_id cascades on account deletion (GDPR erasure, the
-- price_alerts guarantee) — the published entry is the durable public
-- record, not the reporter's evidence rows.
--
-- blacklist_entries: created only by the operator publish action once
-- the reports meet the published standard (3+ independent confirmed
-- non-delivery reports, or confirmed invalid business registration).
-- The standard set lives as constants in the core-domain blacklist
-- module, so standard_met stays unconstrained TEXT — the module owns
-- the value set. An appeal stamps the appeal fields and moves the entry
-- to REOPENED (hidden from public warnings immediately); every decision
-- is appended to the audit trail, not stored on the row. Entries are
-- governance records, never deleted — shop_reports.linked_entry_id
-- needs no cascade.
--
-- calculation_outcomes: user-reported actual totals, at most one per
-- (calculation record, account) — the UNIQUE index IS the duplicate
-- guard behind the API's 409. The row freezes an estimate-fields digest
-- plus both totals, so the "user-reported" accuracy statistic survives
-- the record's own retention: this table is deliberately NOT part of
-- the calculation-record retention sweep (its RETENTION_TABLES), whose
-- DELETEs would destroy exactly the data an outcome froze — it prunes
-- by its own 24-month cap instead (CALCULATION_OUTCOME_RETENTION_DAYS
-- in schema.ts; its own sweep is wired by a later task). For the same
-- reason calculation_record_id is NOT an FOREIGN KEY: records are
-- pruned at 180 days, outcomes at 24 months, and a cascade would
-- silently destroy outcomes while a restrictive FK would break the
-- record sweep.
CREATE TABLE `blacklist_entries` (
	`id` integer PRIMARY KEY NOT NULL,
	`merchant_domain` text(256) NOT NULL,
	`merchant_name_normalized` text(256) NOT NULL,
	`standard_met` text(64) NOT NULL,
	`published_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`published_by` text(128) NOT NULL,
	`status` text(16) DEFAULT 'PUBLISHED' NOT NULL,
	`appealed_at` text,
	`appeal_reason` text,
	CONSTRAINT "blacklist_entries_status_check" CHECK("blacklist_entries"."status" IN ('PUBLISHED', 'REOPENED', 'REJECTED')),
	CONSTRAINT "blacklist_entries_merchant_domain_check" CHECK("blacklist_entries"."merchant_domain" <> ''),
	CONSTRAINT "blacklist_entries_merchant_name_check" CHECK("blacklist_entries"."merchant_name_normalized" <> ''),
	CONSTRAINT "blacklist_entries_standard_met_check" CHECK("blacklist_entries"."standard_met" <> ''),
	CONSTRAINT "blacklist_entries_published_by_check" CHECK("blacklist_entries"."published_by" <> '')
);
--> statement-breakpoint
CREATE INDEX `blacklist_entries_merchant_domain_merchant_name_normalized_status_idx` ON `blacklist_entries` (`merchant_domain`,`merchant_name_normalized`,`status`);--> statement-breakpoint
CREATE TABLE `calculation_outcomes` (
	`id` integer PRIMARY KEY NOT NULL,
	`calculation_record_id` integer NOT NULL,
	`reporter_account_id` integer NOT NULL,
	`estimate_digest` text NOT NULL,
	`estimated_total_cents` integer NOT NULL,
	`reported_total_cents` integer NOT NULL,
	`reported_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`reporter_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "calculation_outcomes_estimated_total_check" CHECK("calculation_outcomes"."estimated_total_cents" > 0),
	CONSTRAINT "calculation_outcomes_reported_total_check" CHECK("calculation_outcomes"."reported_total_cents" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calculation_outcomes_calculation_record_id_reporter_account_id_unique` ON `calculation_outcomes` (`calculation_record_id`,`reporter_account_id`);--> statement-breakpoint
CREATE TABLE `shop_reports` (
	`id` integer PRIMARY KEY NOT NULL,
	`merchant_domain` text(256) NOT NULL,
	`merchant_name_normalized` text(256) NOT NULL,
	`order_reference` text(128) NOT NULL,
	`correspondence_summary` text NOT NULL,
	`reporter_account_id` integer NOT NULL,
	`status` text(16) DEFAULT 'OPEN' NOT NULL,
	`linked_entry_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`reporter_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`linked_entry_id`) REFERENCES `blacklist_entries`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "shop_reports_status_check" CHECK("shop_reports"."status" IN ('OPEN', 'LINKED', 'REJECTED')),
	CONSTRAINT "shop_reports_merchant_domain_check" CHECK("shop_reports"."merchant_domain" <> ''),
	CONSTRAINT "shop_reports_merchant_name_check" CHECK("shop_reports"."merchant_name_normalized" <> ''),
	CONSTRAINT "shop_reports_order_reference_check" CHECK("shop_reports"."order_reference" <> ''),
	CONSTRAINT "shop_reports_correspondence_check" CHECK("shop_reports"."correspondence_summary" <> '')
);
--> statement-breakpoint
CREATE INDEX `shop_reports_status_idx` ON `shop_reports` (`status`);--> statement-breakpoint
CREATE INDEX `shop_reports_merchant_domain_merchant_name_normalized_idx` ON `shop_reports` (`merchant_domain`,`merchant_name_normalized`);--> statement-breakpoint
CREATE INDEX `shop_reports_reporter_account_id_idx` ON `shop_reports` (`reporter_account_id`);
