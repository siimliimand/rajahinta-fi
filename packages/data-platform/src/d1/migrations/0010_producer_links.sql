-- Task 6.1 (change product-roadmap-phases-1-4): curated sibling-product
-- links for the producer dupe finder (design R9, spec:
-- producer-matching).
--
-- producer_links: one CURATED row per (Alko product, sibling product)
-- pair. Columns are exactly the R9 set — the two product references,
-- the evidence fields (producer key, manufacturer, source URL), the
-- review metadata (reviewer, reviewed_at), status — plus the created_at
-- stamp; data minimization forbids optional fields "for later" (no
-- ranking weight, no taste/flavor fields, no confidence score: a
-- similarity-adjacent column is unrepresentable by construction, which
-- is what makes the 6.5 source-level compliance assertion structurally
-- trivial).
--
-- Evidence discipline (R9): producer_key, manufacturer, source_url,
-- reviewer, and reviewed_at are NOT NULL and non-empty (CHECKs) — an
-- unevidenced row is unrepresentable at the schema level. Every
-- presented link carries its evidence; reviewer/reviewed_at record the
-- human review the row exists because of.
--
-- Matching path (binding, spec "No similarity scoring"): an EXACT
-- lookup on normalized producer keys — equality on the stored key, no
-- scoring, no similarity, no fuzzy path exists in the module. The
-- repository normalizes keys on write AND lookup (trim + lowercase +
-- whitespace-run collapse — the exported normalizeProducerKey rule,
-- pinned by tests and reused by the 6.2 seed importer), so the lookup
-- is a plain indexed equality and near-miss keys cannot match.
--
-- Status lifecycle: rows start DRAFT (operator-console work in
-- progress, invisible to the public dupes API) and move to PUBLISHED
-- by the audited console publish action (ferry_offers precedent);
-- PUBLISHED is terminal for the status (content comes down by
-- deletion, which the audit trail records). The CHECK makes any other
-- state unrepresentable at rest.
--
-- Product references: FKs to product_master with no action on delete —
-- products are never deleted (the priceAlerts / group_order_items
-- precedent), so no cascade exists. A row whose two references name
-- the SAME product is a curation bug, not a link (self-link CHECK) —
-- a product is its own trivial sibling and must never be returned.
--
-- Indexes: producer_key serves the exact lookup (the only matching
-- path); alko_product_id serves the product-scoped reads (console
-- listing, the 6.3 dupes endpoint's per-product query).
CREATE TABLE `producer_links` (
	`id` integer PRIMARY KEY NOT NULL,
	`alko_product_id` integer NOT NULL,
	`sibling_product_id` integer NOT NULL,
	`producer_key` text(256) NOT NULL,
	`manufacturer` text(256) NOT NULL,
	`source_url` text NOT NULL,
	`reviewer` text(128) NOT NULL,
	`reviewed_at` text NOT NULL,
	`status` text(16) DEFAULT 'DRAFT' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "producer_links_status_check" CHECK("producer_links"."status" IN ('DRAFT', 'PUBLISHED')),
	CONSTRAINT "producer_links_producer_key_check" CHECK("producer_links"."producer_key" <> ''),
	CONSTRAINT "producer_links_manufacturer_check" CHECK("producer_links"."manufacturer" <> ''),
	CONSTRAINT "producer_links_source_url_check" CHECK("producer_links"."source_url" <> ''),
	CONSTRAINT "producer_links_reviewer_check" CHECK("producer_links"."reviewer" <> ''),
	CONSTRAINT "producer_links_reviewed_at_check" CHECK("producer_links"."reviewed_at" <> ''),
	CONSTRAINT "producer_links_self_link_check" CHECK("producer_links"."alko_product_id" <> "producer_links"."sibling_product_id"),
	FOREIGN KEY (`alko_product_id`) REFERENCES `product_master`(`id`) ON UPDATE NO ACTION ON DELETE NO ACTION,
	FOREIGN KEY (`sibling_product_id`) REFERENCES `product_master`(`id`) ON UPDATE NO ACTION ON DELETE NO ACTION
);
--> statement-breakpoint
CREATE INDEX `producer_links_producer_key_idx` ON `producer_links` (`producer_key`);--> statement-breakpoint
CREATE INDEX `producer_links_alko_product_id_idx` ON `producer_links` (`alko_product_id`);
