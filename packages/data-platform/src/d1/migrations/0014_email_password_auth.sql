-- Task 1.1 (change email-password-auth, design D7): real accounts replace
-- the anonymous placeholder identity. One migration, four steps:
--
-- 1. Purge the anonymous rows. `@placeholder.local` addresses are the
--    documented disposable minted client-side pre-launch (design:
--    non-goal "migrating anonymous rows into user accounts"); sessions
--    and the other account-scoped child rows cascade or are purged by
--    FK. Purging BEFORE the columns/index below keeps the unique index
--    build uncontended and the backfill a no-op.
-- 2. Identity columns: `password_hash` stores only the PBKDF2 envelope
--    (design D1) — nullable column, the login path rejects a null/empty
--    hash fail-safe (401), so a credential-less row can never
--    authenticate; the backfill pins that state for any surviving row.
--    `email_verified_at` is null = unverified, set only by the emailed
--    single-use token flow.
-- 3. Username === email uniqueness moves into SQL: a UNIQUE index on
--    `lower(email)` so case variants cannot mint duplicate identities —
--    the same expression the repositories' login lookup uses.
-- 4. `email_tokens` per design D3: hashed single-use tokens for email
--    verification and password reset; only the SHA-256 hex digest is
--    stored, `purpose` is a closed CHECK set, and consumption stamps
--    `used_at` in the same statement that checks `used_at IS NULL AND
--    expires_at > now` (replay loses). 24 h verification / 1 h reset
--    horizons are caller policy — the table stores and compares
--    instants, it does not own them.
DELETE FROM `accounts` WHERE `email` LIKE '%@placeholder.local';
--> statement-breakpoint
ALTER TABLE `accounts` ADD `password_hash` text;
--> statement-breakpoint
UPDATE `accounts` SET `password_hash` = '' WHERE `password_hash` IS NULL;
--> statement-breakpoint
ALTER TABLE `accounts` ADD `email_verified_at` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_email_lower_idx` ON `accounts` (lower("email"));
--> statement-breakpoint
CREATE TABLE `email_tokens` (
	`id` integer PRIMARY KEY NOT NULL,
	`account_id` integer NOT NULL,
	`token_hash` text(64) NOT NULL,
	`purpose` text(16) NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "email_tokens_purpose_check" CHECK("email_tokens"."purpose" IN ('verify_email', 'password_reset'))
);
--> statement-breakpoint
CREATE INDEX `email_tokens_token_hash_purpose_idx` ON `email_tokens` (`token_hash`,`purpose`);--> statement-breakpoint
CREATE INDEX `email_tokens_account_id_idx` ON `email_tokens` (`account_id`);
