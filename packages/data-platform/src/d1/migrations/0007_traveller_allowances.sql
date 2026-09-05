-- Task 5.1 (change product-roadmap-phases-1-4): versioned traveller
-- allowances behind the trip feasibility calculator (design R7).
--
-- traveller_allowance_datasets: one row per VERSION of the EU
-- personal-use indicative limits — the same dataset shape as
-- fx_rate_datasets (a version is one dataset row plus the child rows
-- referencing it). Rows are append-only: a correction appends a new
-- version and the historical rows stay queryable; no code path updates
-- a published version.
--
-- traveller_allowance_limits: one curated row per product category
-- inside a version, FK'd to its dataset, each carrying a NOT NULL
-- source citation (an allowance limit without a citation is
-- unrepresentable — spec: product-data-model, "Versioned traveller
-- allowance datasets"), a volume and/or quantity cap (the CHECK makes a
-- cap-less row unrepresentable), and its own effective window. category
-- reuses the canonical tax-rule category keys so the calculator's
-- per-category caps feed the landed-cost/tax engines without a
-- translation layer. UNIQUE (dataset_id, category) is the seed's
-- idempotent upsert target and the per-version identity.
--
-- Every table starts rows PENDING_CONFIRMATION; publication to the
-- terminal PUBLISHED state is the repository's explicit publish call,
-- the same manual dataset-confirmation lifecycle as fx_rate_datasets
-- and consumption_norms. Status lives on the DATASET — its limit rows
-- publish with it atomically.
--
-- The effective window is HALF-OPEN on calendar dates:
-- effective_from <= travel_date < effective_to (null effective_to =
-- open-ended/current). ISO 'YYYY-MM-DD' TEXT compares chronologically,
-- matching the date-column translation rule of this schema. The window
-- CHECKs make an inverted window unrepresentable at rest — the
-- repository enforces the same rule on the way in (defense in depth on
-- a high-liability dataset).
CREATE TABLE `traveller_allowance_datasets` (
	`id` integer PRIMARY KEY NOT NULL,
	`version_label` text(64) NOT NULL,
	`source_citation` text NOT NULL,
	`status` text(32) DEFAULT 'PENDING_CONFIRMATION' NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`confirmed_by` text(128),
	`confirmed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "traveller_allowance_datasets_status_check" CHECK("traveller_allowance_datasets"."status" IN ('PENDING_CONFIRMATION', 'PUBLISHED')),
	CONSTRAINT "traveller_allowance_datasets_window_check" CHECK("traveller_allowance_datasets"."effective_to" IS NULL OR "traveller_allowance_datasets"."effective_to" > "traveller_allowance_datasets"."effective_from")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `traveller_allowance_datasets_version_label_unique` ON `traveller_allowance_datasets` (`version_label`);--> statement-breakpoint
CREATE INDEX `traveller_allowance_datasets_status_effective_idx` ON `traveller_allowance_datasets` (`status`,`effective_from`);--> statement-breakpoint
CREATE TABLE `traveller_allowance_limits` (
	`id` integer PRIMARY KEY NOT NULL,
	`dataset_id` integer NOT NULL,
	`category` text(32) NOT NULL,
	`volume_cap_litres` real,
	`quantity_cap` integer,
	`source_citation` text NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	FOREIGN KEY (`dataset_id`) REFERENCES `traveller_allowance_datasets`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "traveller_allowance_limits_category_check" CHECK("traveller_allowance_limits"."category" IN ('beer', 'wine_still', 'wine_sparkling', 'intermediate_products', 'other_fermented', 'spirits')),
	CONSTRAINT "traveller_allowance_limits_cap_present_check" CHECK("traveller_allowance_limits"."volume_cap_litres" IS NOT NULL OR "traveller_allowance_limits"."quantity_cap" IS NOT NULL),
	CONSTRAINT "traveller_allowance_limits_volume_cap_check" CHECK("traveller_allowance_limits"."volume_cap_litres" IS NULL OR "traveller_allowance_limits"."volume_cap_litres" > 0),
	CONSTRAINT "traveller_allowance_limits_quantity_cap_check" CHECK("traveller_allowance_limits"."quantity_cap" IS NULL OR "traveller_allowance_limits"."quantity_cap" > 0),
	CONSTRAINT "traveller_allowance_limits_window_check" CHECK("traveller_allowance_limits"."effective_to" IS NULL OR "traveller_allowance_limits"."effective_to" > "traveller_allowance_limits"."effective_from")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `traveller_allowance_limits_dataset_category_unique` ON `traveller_allowance_limits` (`dataset_id`,`category`);
