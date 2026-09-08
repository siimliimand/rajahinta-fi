-- Task 5.3 (change trust-and-reach-roadmap, design D4): the newsletter
-- delivery intent log.
--
-- newsletter_notifications: one row per intended newsletter recipient per
-- send. The ops notify-subscribers action writes a PENDING intent row
-- BEFORE dispatching through the email worker and marks the outcome
-- AFTER, so a retried action skips subscribers already marked delivered
-- — a crash mid-batch can never double-send (spec content-publication:
-- crash-safe send). Rows are append-only delivery-attempt records: the
-- outcome transition (pending → delivered | failed) plus marked_at is
-- the only update a row ever receives (the alert_notifications
-- precedent, applied to the newsletter audience). Deleting the
-- subscriber cascades here — the intent log has no meaning without its
-- recipient.
CREATE TABLE `newsletter_notifications` (
	`id` integer PRIMARY KEY NOT NULL,
	`subscriber_id` integer NOT NULL,
	`channel` text(16) NOT NULL,
	`delivery_status` text(16) DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`marked_at` text,
	FOREIGN KEY (`subscriber_id`) REFERENCES `newsletter_subscribers`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "newsletter_notifications_channel_check" CHECK("newsletter_notifications"."channel" IN ('email')),
	CONSTRAINT "newsletter_notifications_delivery_status_check" CHECK("newsletter_notifications"."delivery_status" IN ('pending', 'delivered', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `newsletter_notifications_subscriber_id_delivery_status_created_at_idx` ON `newsletter_notifications` (`subscriber_id`,`delivery_status`,`created_at`);
