-- Task 1.1 (change add-onboarding-preferences, design D2/D3): the
-- account-preferences row behind the /onboarding quiz and the weekly
-- digest consent.
--
-- account_preferences: one row per account — the UNIQUE constraint is
-- the idempotent-create guard (design D2: a fixed, small field set;
-- partial updates are column-scoped). Data minimization: coarse fields
-- only — channel is a stored answer, null = unanswered (design D8);
-- category_tags is a JSON array of canonical PRODUCT_CATEGORIES keys
-- validated at the repository/route layer against the shared constant,
-- deliberately without a per-element CHECK so the category vocabulary
-- keeps exactly one definition (design D7); no brands, no price
-- ceilings, no free-text fields. digest_enabled is consent: default
-- false, opt-in (design D3). onboarded_at stays null until quiz
-- completion or explicit skip (design D6). account_id cascades on
-- account deletion so the GDPR erasure path cannot orphan a preference
-- profile even if the repository layer is bypassed (the same guarantee
-- account_favorites, price_alerts, and saved_scenarios carry).
CREATE TABLE `account_preferences` (
	`id` integer PRIMARY KEY NOT NULL,
	`account_id` integer NOT NULL,
	`channel` text,
	`category_tags` text DEFAULT '[]' NOT NULL,
	`digest_enabled` integer DEFAULT false NOT NULL,
	`onboarded_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `account_preferences_channel_check` CHECK(`account_preferences`.`channel` IS NULL OR `account_preferences`.`channel` IN ('TRAVEL', 'DELIVERY', 'BOTH')),
	CONSTRAINT `account_preferences_digest_enabled_check` CHECK(`account_preferences`.`digest_enabled` IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_preferences_account_id_unique` ON `account_preferences` (`account_id`);
