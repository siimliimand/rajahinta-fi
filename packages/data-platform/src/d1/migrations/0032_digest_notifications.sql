-- Task 1.3 (change add-onboarding-preferences, design D4/D5): the
-- weekly preference digest's crash-safe delivery intent log.
--
-- digest_notifications: one row per (account, ISO week) — the UNIQUE
-- constraint is BOTH the idempotent-create guard and the crash
-- re-entry read (design D5: a re-run sweep hits the constraint /
-- delivered-lookup and suppresses the resend), and its leading
-- account_id column serves the per-account lookup. The pending row is
-- written BEFORE any send; only pending rows transition
-- (pending → delivered | failed) and marked_at is set exactly once, so
-- a crash mid-delivery can never double-send (the alert_notifications
-- intent-before-dispatch contract, 0004). Data minimization (design
-- D4/D5): the digest's facts are computed at send time from
-- materialized daily summaries and live in the email, never the intent
-- row — no observed-fact columns. account_id cascades on account
-- deletion so the GDPR erasure path cannot orphan a delivery intent
-- (the same guarantee account_favorites, account_preferences, and
-- price_alerts carry).
CREATE TABLE `digest_notifications` (
	`id` integer PRIMARY KEY NOT NULL,
	`account_id` integer NOT NULL,
	`digest_week` text NOT NULL,
	`channel` text(16) NOT NULL,
	`delivery_status` text(16) DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`marked_at` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `digest_notifications_channel_check` CHECK(`digest_notifications`.`channel` IN ('email')),
	CONSTRAINT `digest_notifications_delivery_status_check` CHECK(`digest_notifications`.`delivery_status` IN ('pending', 'delivered', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `digest_notifications_account_id_digest_week_unique` ON `digest_notifications` (`account_id`,`digest_week`);
