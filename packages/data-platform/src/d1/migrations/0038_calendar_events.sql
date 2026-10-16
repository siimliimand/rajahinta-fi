-- Task 1.2 (change tax-change-calendar): the tax-change calendar's
-- rhythm-fact storage.
--
-- calendar_events: one row per price-change rhythm event (FI/EE excise
-- steps, Alko's twice-yearly price lists, Verohallinto's next-year table
-- publication, the government rate-decision window). Rhythm facts are
-- NOT tax rates and stay out of tax_rules so the excise engine's
-- gap/overlap-validated rate timeline is never polluted with undated
-- windows (design decision: new table instead of extending taxRules).
--
-- The status/precision split is the honest-framing contract in data: a
-- CONFIRMED row carries its exact occurrence_date (ISO YYYY-MM-DD), an
-- EXPECTED row carries only expected_window at month-or-quarter
-- precision ('YYYY-MM' / 'YYYY-Qn'). status_period_check makes any row
-- claiming both — or neither — unrepresentable at rest, so rendering
-- cannot invent precision the row does not carry. The repository-layer
-- validator (repositories/calendar-event-validator.ts) restates the
-- same contract with errors naming the valid values; the CHECK is the
-- last-line guarantee for raw SQL paths.
--
-- source_url is NOT NULL — no unsourced event can exist (the
-- tax_rules.official_source discipline). FI/EN title and summary are
-- NOT NULL in both languages: the surface is Finnish-default with an
-- English locale, and a missing-locale row would render a hole
-- mid-timeline.
--
-- calendar_events_year_period_idx serves both query paths with one
-- composite index: the year-range read filters on the leading year
-- column, the next-event lookup scans the period columns in order
-- (occurrence_date for CONFIRMED rows, expected_window for EXPECTED
-- rows) — the homepage widget's per-request read stays a single
-- indexed query.
--
-- Additive migration: no existing table is touched; rollback is a
-- revert deploy (the table is inert to existing flows).
CREATE TABLE `calendar_events` (
	`id` integer PRIMARY KEY NOT NULL,
	`year` integer NOT NULL,
	`event_type` text(32) NOT NULL,
	`status` text(16) NOT NULL,
	`occurrence_date` text,
	`expected_window` text(8),
	`title_fi` text(256) NOT NULL,
	`title_en` text(256) NOT NULL,
	`summary_fi` text NOT NULL,
	`summary_en` text NOT NULL,
	`source_url` text(512) NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT `calendar_events_event_type_check` CHECK(`calendar_events`.`event_type` IN ('FI_EXCISE_CHANGE', 'EE_EXCISE_CHANGE', 'ALKO_PRICE_LIST', 'TAX_TABLE_PUBLICATION', 'RATE_DECISION')),
	CONSTRAINT `calendar_events_status_check` CHECK(`calendar_events`.`status` IN ('CONFIRMED', 'EXPECTED')),
	CONSTRAINT `calendar_events_status_period_check` CHECK((`calendar_events`.`status` = 'CONFIRMED' AND `calendar_events`.`occurrence_date` IS NOT NULL AND `calendar_events`.`expected_window` IS NULL) OR (`calendar_events`.`status` = 'EXPECTED' AND `calendar_events`.`occurrence_date` IS NULL AND `calendar_events`.`expected_window` IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `calendar_events_year_period_idx` ON `calendar_events` (`year`,`occurrence_date`,`expected_window`);
