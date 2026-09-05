-- Task 2.1 (change product-roadmap-phases-1-4): price alerts + the
-- notification delivery intent log.
--
-- price_alerts: one alert per (account, product) — the UNIQUE constraint
-- makes the per-alert cooldown scope identical to design R2's
-- per-product-per-account cooldown, and its leading column serves
-- list-by-account. status is the active/paused evaluation toggle;
-- paused rows keep their configuration but are skipped by the cron.
-- account_id cascades on account deletion so the GDPR erasure path
-- cannot orphan alerts even if the repository layer is bypassed (the
-- same guarantee saved_scenarios carries).
--
-- alert_notifications: the intent log behind crash-safe delivery. A row
-- is written BEFORE dispatch (delivery_status 'pending') and the outcome
-- is marked AFTER (delivered | failed + marked_at) — a retried run skips
-- rows already marked delivered, so a crash mid-delivery never
-- double-sends. Attempt facts are immutable; the status transition is
-- the only update these rows receive. Deleting the alert cascades.
--
-- The (alert_id, delivery_status, created_at) index serves the cooldown
-- enforcement read: latest DELIVERED notification per alert, ordered by
-- created_at.
CREATE TABLE `price_alerts` (
	`id` integer PRIMARY KEY NOT NULL,
	`account_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`threshold_cents` integer NOT NULL,
	`status` text(16) DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "price_alerts_threshold_cents_check" CHECK("price_alerts"."threshold_cents" > 0),
	CONSTRAINT "price_alerts_status_check" CHECK("price_alerts"."status" IN ('active', 'paused')),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `product_master`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `price_alerts_account_id_product_id_unique` ON `price_alerts` (`account_id`,`product_id`);--> statement-breakpoint
CREATE INDEX `price_alerts_status_idx` ON `price_alerts` (`status`);--> statement-breakpoint
CREATE TABLE `alert_notifications` (
	`id` integer PRIMARY KEY NOT NULL,
	`alert_id` integer NOT NULL,
	`observed_price_cents` integer NOT NULL,
	`channel` text(16) NOT NULL,
	`delivery_status` text(16) DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`marked_at` text,
	CONSTRAINT "alert_notifications_channel_check" CHECK("alert_notifications"."channel" IN ('email')),
	CONSTRAINT "alert_notifications_delivery_status_check" CHECK("alert_notifications"."delivery_status" IN ('pending', 'delivered', 'failed')),
	FOREIGN KEY (`alert_id`) REFERENCES `price_alerts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `alert_notifications_alert_id_delivery_status_created_at_idx` ON `alert_notifications` (`alert_id`,`delivery_status`,`created_at`);
