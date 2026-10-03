-- Task 3.2 (change first-impression-pass, design D8): the contact intake.
--
-- contact_messages: one row per accepted form submission behind
-- POST /api/v1/contact. Minimal personal data per spec contact-intake:
-- the message, the fixed topic enum, the OPTIONAL reply email, the UI
-- locale, the submission timestamp, and a salted HMAC-SHA-256 hex of the
-- source IP for abuse forensics — the raw address is never stored and no
-- column links a message to an account. Rows persist until the operator
-- reads them (documented wrangler SQL, newest-first via the created_at
-- index) or the daily retention sweep deletes them past 90 days —
-- nothing silently drops an unread message.
CREATE TABLE `contact_messages` (
	`id` integer PRIMARY KEY NOT NULL,
	`message` text(5000) NOT NULL,
	`topic` text(16) NOT NULL,
	`reply_email` text(320),
	`locale` text(2) NOT NULL,
	`ip_hash` text(64) NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "contact_messages_topic_check" CHECK("contact_messages"."topic" IN ('product_error', 'store_inquiry', 'other')),
	CONSTRAINT "contact_messages_locale_check" CHECK("contact_messages"."locale" IN ('fi', 'en')),
	CONSTRAINT "contact_messages_message_length_check" CHECK(length("contact_messages"."message") <= 5000),
	CONSTRAINT "contact_messages_ip_hash_check" CHECK(length("contact_messages"."ip_hash") = 64)
);
--> statement-breakpoint
CREATE INDEX `contact_messages_created_at_idx` ON `contact_messages` (`created_at`);
