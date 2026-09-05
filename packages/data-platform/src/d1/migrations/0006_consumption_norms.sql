-- Task 4.1 (change product-roadmap-phases-1-4): versioned consumption
-- norms behind the event calculator (design R5).
--
-- consumption_norms: one curated row per (drink_type, event_profile,
-- version_label) — a norms VERSION is the set of rows sharing a version
-- label, keyed by drink type × event profile, exactly like an FX dataset
-- is the set of fx_rates rows sharing a version_label. Rows are
-- append-only: a correction appends a new version and the historical
-- rows stay queryable; no code path updates norm values.
--
-- Every row carries a NOT NULL source citation (a norms row without a
-- citation is unrepresentable — spec: event-calculator, "Norms dataset
-- governance") and starts PENDING_CONFIRMATION; publication to the
-- terminal PUBLISHED state is the repository's explicit publish call,
-- the same manual dataset-confirmation lifecycle as fx_rate_datasets.
--
-- The effective window is HALF-OPEN on calendar dates:
-- effective_from <= event_date < effective_to (null effective_to =
-- open-ended/current). ISO 'YYYY-MM-DD' TEXT compares chronologically,
-- matching the date-column translation rule of this schema.
--
-- drink_type reuses the canonical tax-rule category keys so the event
-- calculator's per-type lines map onto the landed-cost/tax engines
-- without a translation layer. event_profile is the MVP simple mode's
-- closed set. UNIQUE (drink_type, event_profile, version_label) is the
-- seed's idempotent upsert target and the per-version identity.
CREATE TABLE `consumption_norms` (
	`id` integer PRIMARY KEY NOT NULL,
	`version_label` text(64) NOT NULL,
	`drink_type` text(32) NOT NULL,
	`event_profile` text(32) NOT NULL,
	`norm_value_per_guest_per_hour` real NOT NULL,
	`source_citation` text NOT NULL,
	`status` text(32) DEFAULT 'PENDING_CONFIRMATION' NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`confirmed_by` text(128),
	`confirmed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "consumption_norms_status_check" CHECK("consumption_norms"."status" IN ('PENDING_CONFIRMATION', 'PUBLISHED')),
	CONSTRAINT "consumption_norms_drink_type_check" CHECK("consumption_norms"."drink_type" IN ('beer', 'wine_still', 'wine_sparkling', 'intermediate_products', 'other_fermented', 'spirits')),
	CONSTRAINT "consumption_norms_event_profile_check" CHECK("consumption_norms"."event_profile" IN ('casual_gathering', 'dinner_party', 'celebration')),
	CONSTRAINT "consumption_norms_norm_value_check" CHECK("consumption_norms"."norm_value_per_guest_per_hour" > 0),
	CONSTRAINT "consumption_norms_window_check" CHECK("consumption_norms"."effective_to" IS NULL OR "consumption_norms"."effective_to" > "consumption_norms"."effective_from")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `consumption_norms_key_version_unique` ON `consumption_norms` (`drink_type`,`event_profile`,`version_label`);--> statement-breakpoint
CREATE INDEX `consumption_norms_status_idx` ON `consumption_norms` (`status`);
