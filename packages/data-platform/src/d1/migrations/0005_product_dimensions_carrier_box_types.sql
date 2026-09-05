-- Task 3.1 (change product-roadmap-phases-1-4): physical product
-- dimensions and the carrier box catalogue behind the packing optimizer.
--
-- product_dimensions: externally sourced packaging facts (design R3).
-- Every row carries source, reliability_status, and observed_at — a
-- dimension without provenance is unrepresentable. ONE row per product
-- (UNIQUE product_id): a new observation replaces the previous one via
-- the repository's upsert, and a MISSING row is the designed
-- "dimensions unknown" state — packing flags those products ESTIMATED
-- and omits them from breakage-risk reasoning. Nothing estimates or
-- defaults dimensions to fill gaps. product_id references product_master
-- without a cascade (products are never deleted, same as
-- price_alerts.product_id). material is its own closed value set
-- (GLASS/CAN/PLASTIC/OTHER) — it classifies the packed unit for the
-- glass+metal mixing warning, and deliberately not the product_master
-- container_type vocabulary. Positive-value CHECKs make an unmeasured
-- "zero dimension" row unrepresentable.
--
-- carrier_box_types: the packing module's ONLY source of box geometry
-- (spec: packing-optimization). Standard boxes per carrier with usable
-- internal dimensions and maximum weight, curated from the carriers'
-- published packaging pages — source and observed_at record where and
-- when each specification was taken from. UNIQUE (carrier, name) is the
-- curated seed's idempotent upsert target; a carrier-side spec change is
-- a seed-row edit, not a migration. carrier matches
-- transport_offers.carrier (same identifier domain).
CREATE TABLE `product_dimensions` (
	`id` integer PRIMARY KEY NOT NULL,
	`product_id` integer NOT NULL,
	`weight_g` integer NOT NULL,
	`height_mm` integer NOT NULL,
	`diameter_mm` integer NOT NULL,
	`material` text(16) NOT NULL,
	`source` text NOT NULL,
	`reliability_status` text(16) DEFAULT 'ESTIMATED' NOT NULL,
	`observed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "product_dimensions_material_check" CHECK("product_dimensions"."material" IN ('GLASS', 'CAN', 'PLASTIC', 'OTHER')),
	CONSTRAINT "product_dimensions_reliability_status_check" CHECK("product_dimensions"."reliability_status" IN ('VERIFIED', 'ESTIMATED', 'STALE', 'UNAVAILABLE')),
	CONSTRAINT "product_dimensions_weight_g_check" CHECK("product_dimensions"."weight_g" > 0),
	CONSTRAINT "product_dimensions_height_mm_check" CHECK("product_dimensions"."height_mm" > 0),
	CONSTRAINT "product_dimensions_diameter_mm_check" CHECK("product_dimensions"."diameter_mm" > 0),
	FOREIGN KEY (`product_id`) REFERENCES `product_master`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_dimensions_product_id_unique` ON `product_dimensions` (`product_id`);--> statement-breakpoint
CREATE TABLE `carrier_box_types` (
	`id` integer PRIMARY KEY NOT NULL,
	`carrier` text(64) NOT NULL,
	`name` text(128) NOT NULL,
	`internal_height_mm` integer NOT NULL,
	`internal_width_mm` integer NOT NULL,
	`internal_depth_mm` integer NOT NULL,
	`max_weight_g` integer NOT NULL,
	`source` text NOT NULL,
	`observed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "carrier_box_types_internal_height_mm_check" CHECK("carrier_box_types"."internal_height_mm" > 0),
	CONSTRAINT "carrier_box_types_internal_width_mm_check" CHECK("carrier_box_types"."internal_width_mm" > 0),
	CONSTRAINT "carrier_box_types_internal_depth_mm_check" CHECK("carrier_box_types"."internal_depth_mm" > 0),
	CONSTRAINT "carrier_box_types_max_weight_g_check" CHECK("carrier_box_types"."max_weight_g" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `carrier_box_types_carrier_name_unique` ON `carrier_box_types` (`carrier`,`name`);
