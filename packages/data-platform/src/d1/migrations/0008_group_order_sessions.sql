-- Task 9.1 (change product-roadmap-phases-1-4): group order sessions
-- and items behind the accounting-only ledger (design R12).
--
-- group_order_sessions: one row per collaborative order. share_token is
-- the join credential — UNIQUE so it identifies exactly one session,
-- CHECKed non-empty (a blank token is a credential-generation bug, not
-- a session) — and expires_at is the exclusive edge past which the
-- share link stops being usable (the rejection is the API layer's job,
-- task 9.3; the table carries the edge honestly). owner_account_id is
-- the only account reference: the session stores no personal data
-- beyond participant nicknames and no account data for non-owning
-- participants (R12); deleting the account cascades (GDPR erasure, the
-- saved_scenarios guarantee).
--
-- group_order_items: one participant's line. participant_nickname is
-- free text bounded at 64 chars and deliberately NOT a user reference —
-- participants join by share link without an account, so the nickname
-- is the only participant identity a row carries (anonymity by
-- design). session_id cascades so a deleted session cannot orphan item
-- rows; product_id needs no cascade (products are never deleted, the
-- price_alerts precedent). The (session_id, added_at) index serves the
-- ledger's deterministic item ordering.
--
-- ACCOUNTING-ONLY BOUNDARY (spec: group-order-ledger, design R12):
-- neither table carries payment-adjacent columns — no amounts, no
-- currencies, no settlement state. Item VALUE for the proportional
-- allocation is derived at compute time from product/offer data
-- (tasks 9.2/9.3), never stored on these rows, so a payment instrument
-- or an amount is unrepresentable in a group order at the schema level.
CREATE TABLE `group_order_sessions` (
	`id` integer PRIMARY KEY NOT NULL,
	`owner_account_id` integer NOT NULL,
	`share_token` text(64) NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "group_order_sessions_share_token_check" CHECK("group_order_sessions"."share_token" <> ''),
	FOREIGN KEY (`owner_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_order_sessions_share_token_unique` ON `group_order_sessions` (`share_token`);--> statement-breakpoint
CREATE INDEX `group_order_sessions_expires_at_idx` ON `group_order_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `group_order_items` (
	`id` integer PRIMARY KEY NOT NULL,
	`session_id` integer NOT NULL,
	`participant_nickname` text(64) NOT NULL,
	`product_id` integer NOT NULL,
	`quantity` integer NOT NULL,
	`added_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "group_order_items_quantity_check" CHECK("group_order_items"."quantity" > 0),
	FOREIGN KEY (`session_id`) REFERENCES `group_order_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `product_master`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `group_order_items_session_id_added_at_idx` ON `group_order_items` (`session_id`,`added_at`);
