CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` text(128) NOT NULL,
	`email` text(320) NOT NULL,
	`tier` text(16) DEFAULT 'FREE' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`last_active_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "accounts_tier_check" CHECK("accounts"."tier" IN ('FREE', 'PREMIUM'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_user_id_unique` ON `accounts` (`user_id`);--> statement-breakpoint
CREATE TABLE `aggregation_watermarks` (
	`id` integer PRIMARY KEY NOT NULL,
	`job_name` text(128) NOT NULL,
	`watermark` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `aggregation_watermarks_job_name_unique` ON `aggregation_watermarks` (`job_name`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text(64) PRIMARY KEY NOT NULL,
	`entity_type` text(64) NOT NULL,
	`entity_id` text(128) NOT NULL,
	`action` text(16) NOT NULL,
	`author` text(128) NOT NULL,
	`reason` text NOT NULL,
	`occurred_at` text NOT NULL,
	`previous_value` text,
	`new_value` text,
	CONSTRAINT "audit_events_action_check" CHECK("audit_events"."action" IN ('created', 'updated', 'deleted', 'confirmed'))
);
--> statement-breakpoint
CREATE INDEX `audit_events_entity_type_entity_id_occurred_at_idx` ON `audit_events` (`entity_type`,`entity_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_events_occurred_at_idx` ON `audit_events` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `basket_calculation_records` (
	`id` integer NOT NULL,
	`session_id` text(64),
	`destination` text NOT NULL,
	`transport_arrangement` text NOT NULL,
	`input_basket` text NOT NULL,
	`shipment_breakdown` text NOT NULL,
	`total_cents` integer NOT NULL,
	`confidence` text(6) NOT NULL,
	`disclaimer` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`id`, `created_at`),
	CONSTRAINT "basket_calculation_records_confidence_check" CHECK("basket_calculation_records"."confidence" IN ('HIGH', 'MEDIUM', 'LOW'))
);
--> statement-breakpoint
CREATE TABLE `calculation_records` (
	`id` integer NOT NULL,
	`product_master_id` integer NOT NULL,
	`retail_offer_ids` text,
	`transport_offer_id` integer,
	`excise_rule_version_id` integer,
	`container_duty_rule_version_id` integer,
	`total_cents` integer NOT NULL,
	`breakdown` text NOT NULL,
	`confidence` text(6) NOT NULL,
	`quantity` integer NOT NULL,
	`destination` text(4) NOT NULL,
	`disclaimer` text NOT NULL,
	`session_id` text(64),
	`calculated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`id`, `calculated_at`),
	FOREIGN KEY (`product_master_id`) REFERENCES `product_master`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transport_offer_id`) REFERENCES `transport_offers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`excise_rule_version_id`) REFERENCES `tax_rules`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`container_duty_rule_version_id`) REFERENCES `tax_rules`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "calculation_records_confidence_check" CHECK("calculation_records"."confidence" IN ('HIGH', 'MEDIUM', 'LOW'))
);
--> statement-breakpoint
CREATE INDEX `calculation_records_session_id_calculated_at_idx` ON `calculation_records` (`session_id`,`calculated_at`);--> statement-breakpoint
CREATE TABLE `click_counter_snapshots` (
	`id` integer PRIMARY KEY NOT NULL,
	`merchant_id` text(128) NOT NULL,
	`url` text(1024) NOT NULL,
	`click_count` integer NOT NULL,
	`captured_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `click_counter_snapshots_merchant_url_captured_at_unique` ON `click_counter_snapshots` (`merchant_id`,`url`,`captured_at`);--> statement-breakpoint
CREATE TABLE `fx_rate_datasets` (
	`id` integer PRIMARY KEY NOT NULL,
	`version_label` text(64) NOT NULL,
	`source_name` text(128) NOT NULL,
	`source_url` text(512),
	`reference_date` text NOT NULL,
	`status` text(32) DEFAULT 'PENDING_CONFIRMATION' NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`confirmed_by` text(128),
	`confirmed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "fx_rate_datasets_status_check" CHECK("fx_rate_datasets"."status" IN ('PENDING_CONFIRMATION', 'PUBLISHED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fx_rate_datasets_version_label_unique` ON `fx_rate_datasets` (`version_label`);--> statement-breakpoint
CREATE TABLE `fx_rates` (
	`id` integer PRIMARY KEY NOT NULL,
	`dataset_id` integer NOT NULL,
	`base_currency` text(3) NOT NULL,
	`quote_currency` text(3) NOT NULL,
	`rate` real NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`dataset_id`) REFERENCES `fx_rate_datasets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fx_rates_dataset_pair_unique` ON `fx_rates` (`dataset_id`,`base_currency`,`quote_currency`);--> statement-breakpoint
CREATE TABLE `merchant_registry` (
	`id` integer PRIMARY KEY NOT NULL,
	`merchant_id` text(128) NOT NULL,
	`name` text(256) NOT NULL,
	`country` text(4) NOT NULL,
	`feed_url` text NOT NULL,
	`feed_format` text(8) NOT NULL,
	`polling_interval_ms` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merchant_registry_merchant_id_unique` ON `merchant_registry` (`merchant_id`);--> statement-breakpoint
CREATE TABLE `merchant_terms` (
	`id` integer PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`minimum_order_value_cents` integer,
	`currency` text NOT NULL,
	`source_url` text,
	`reliability_status` text(16) DEFAULT 'ESTIMATED' NOT NULL,
	`observed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "merchant_terms_reliability_status_check" CHECK("merchant_terms"."reliability_status" IN ('VERIFIED', 'ESTIMATED', 'STALE', 'UNAVAILABLE'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merchant_terms_merchant_id_unique` ON `merchant_terms` (`merchant_id`);--> statement-breakpoint
CREATE TABLE `price_history_summaries` (
	`id` integer PRIMARY KEY NOT NULL,
	`granularity` text(16) NOT NULL,
	`period_start` text NOT NULL,
	`product_id` integer NOT NULL,
	`merchant` text(128),
	`price_open_cents` integer NOT NULL,
	`price_close_cents` integer NOT NULL,
	`price_min_cents` integer NOT NULL,
	`price_max_cents` integer NOT NULL,
	`price_avg_cents` integer NOT NULL,
	`landed_cost_open_cents` integer NOT NULL,
	`landed_cost_close_cents` integer NOT NULL,
	`landed_cost_min_cents` integer NOT NULL,
	`landed_cost_max_cents` integer NOT NULL,
	`landed_cost_avg_cents` integer NOT NULL,
	`observation_count` integer NOT NULL,
	`strictest_reliability` text(16) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `product_master`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "price_history_summaries_granularity_check" CHECK("price_history_summaries"."granularity" IN ('daily', 'weekly')),
	CONSTRAINT "price_history_summaries_strictest_reliability_check" CHECK("price_history_summaries"."strictest_reliability" IN ('VERIFIED', 'ESTIMATED', 'STALE', 'UNAVAILABLE'))
);
--> statement-breakpoint
CREATE INDEX `price_history_summaries_granularity_product_id_period_start_idx` ON `price_history_summaries` (`granularity`,`product_id`,`period_start`);--> statement-breakpoint
CREATE UNIQUE INDEX `price_history_summaries_bucket_key` ON `price_history_summaries` (`granularity`,`period_start`,`product_id`,`merchant`);--> statement-breakpoint
CREATE TABLE `product_master` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text(512) NOT NULL,
	`manufacturer` text(256) NOT NULL,
	`brand` text(256) NOT NULL,
	`category` text(32) NOT NULL,
	`alcohol_by_volume` real,
	`unit_volume` real NOT NULL,
	`container_type` text(32) NOT NULL,
	`regulatory_classification` text(64) NOT NULL,
	`deposit_system_status` integer,
	`ean` text(13),
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "product_master_container_type_check" CHECK("product_master"."container_type" IN ('glass', 'plastic', 'metal', 'carton'))
);
--> statement-breakpoint
CREATE TABLE `retail_offers` (
	`id` integer PRIMARY KEY NOT NULL,
	`merchant` text(128) NOT NULL,
	`country` text(4) NOT NULL,
	`product_id` integer NOT NULL,
	`price_cents` integer NOT NULL,
	`currency` text(3) DEFAULT 'EUR' NOT NULL,
	`original_price_cents` integer,
	`original_currency` text(3),
	`fx_dataset_version` text(64),
	`availability` text(16) DEFAULT 'unknown' NOT NULL,
	`source_url` text(1024),
	`observed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`reliability_status` text(16) DEFAULT 'ESTIMATED' NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `product_master`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "retail_offers_reliability_status_check" CHECK("retail_offers"."reliability_status" IN ('VERIFIED', 'ESTIMATED', 'STALE', 'UNAVAILABLE'))
);
--> statement-breakpoint
CREATE INDEX `retail_offers_merchant_product_id_observed_at_idx` ON `retail_offers` (`merchant`,`product_id`,`observed_at`);--> statement-breakpoint
CREATE TABLE `saved_baskets` (
	`id` integer PRIMARY KEY NOT NULL,
	`account_id` integer NOT NULL,
	`name` text(256) NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`items` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `saved_scenarios` (
	`id` integer PRIMARY KEY NOT NULL,
	`account_id` integer NOT NULL,
	`name` text(256) NOT NULL,
	`inputs` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `saved_scenarios_account_id_name_unique` ON `saved_scenarios` (`account_id`,`name`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY NOT NULL,
	`token_hash` text(64) NOT NULL,
	`account_id` integer NOT NULL,
	`rotated_from_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`rotated_from_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_account_id_idx` ON `sessions` (`account_id`);--> statement-breakpoint
CREATE TABLE `tax_rules` (
	`id` integer PRIMARY KEY NOT NULL,
	`tax_type` text(32) NOT NULL,
	`product_category` text(32) NOT NULL,
	`rate` real NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`exemption_conditions` text,
	`calculation_formula_reference` text(128) NOT NULL,
	`official_source` text(512) NOT NULL,
	`verification_date` text,
	`version_label` text(64) NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "tax_rules_tax_type_check" CHECK("tax_rules"."tax_type" IN ('excise', 'container_duty'))
);
--> statement-breakpoint
CREATE TABLE `transport_offers` (
	`id` integer PRIMARY KEY NOT NULL,
	`carrier` text(64) NOT NULL,
	`origin_country` text(4) NOT NULL,
	`destination_country` text(4) DEFAULT 'FI' NOT NULL,
	`weight_min_kg` real,
	`weight_max_kg` real,
	`package_tier` text(32) NOT NULL,
	`price_cents` integer NOT NULL,
	`currency` text(3) DEFAULT 'EUR' NOT NULL,
	`seller_involvement_indicator` integer DEFAULT false NOT NULL,
	`observed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`refreshed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`reliability_status` text(16) DEFAULT 'ESTIMATED' NOT NULL,
	CONSTRAINT "transport_offers_package_tier_check" CHECK("transport_offers"."package_tier" IN ('parcel', 'box', 'pallet')),
	CONSTRAINT "transport_offers_reliability_status_check" CHECK("transport_offers"."reliability_status" IN ('VERIFIED', 'ESTIMATED', 'STALE', 'UNAVAILABLE'))
);
