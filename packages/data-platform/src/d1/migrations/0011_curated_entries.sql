-- Task 7.1 (change product-roadmap-phases-1-4): curated list entries
-- (design R10, spec: curated-lists).
--
-- curated_entries: one CURATED row per entry of an editorial list (the
-- first slug is "Alkon hylkäämät"). Columns are exactly the task/R10
-- set — the owning list slug (the 7.2 public lookup key), a target
-- that is EITHER a product_master reference OR an external reference,
-- the mandatory rationale, the evidence links (JSON), the review
-- metadata (reviewer), status — plus the created_at/updated_at stamps;
-- data minimization forbids optional fields "for later".
--
-- Evidence discipline (R10): rationale, evidence_links, and reviewer
-- are NOT NULL and non-empty (CHECKs) — an unevidenced entry is
-- unrepresentable at the schema level (the producer_links precedent).
-- evidence_links additionally carries a json_valid() CHECK: the column
-- is always parseable JSON; the STRUCTURE (a non-empty array of
-- {label, url} links) is validated by the repository on every write.
--
-- Target discipline: an entry points at exactly one thing —
-- (product_id IS NULL) <> (external_ref IS NULL) makes a
-- both-null entry (points at nothing) and a both-present entry
-- (ambiguous target) unrepresentable at rest. external_ref is
-- non-empty when present. The product FK needs no cascade — products
-- are never deleted (the priceAlerts / producer_links precedent).
--
-- Status lifecycle (binding spec difference from ferry_offers /
-- producer_links): rows start DRAFT (invisible to the public list)
-- and move to PUBLISHED by the audited console publish action, but
-- PUBLISHED is NOT terminal — the spec mandates that entries are
-- "created, updated, and unpublished through the audited operator
-- console" and that content changes require no deploys, so a
-- published entry is editable and can be unpublished (PUBLISHED →
-- DRAFT) via the console. Every mutation is audited at the console
-- layer, so the full editorial history stays in the audit trail.
CREATE TABLE `curated_entries` (
	`id` integer PRIMARY KEY NOT NULL,
	`list_slug` text(128) NOT NULL,
	`product_id` integer,
	`external_ref` text(512),
	`rationale` text NOT NULL,
	`evidence_links` text NOT NULL,
	`reviewer` text(128) NOT NULL,
	`status` text(16) DEFAULT 'DRAFT' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "curated_entries_status_check" CHECK("curated_entries"."status" IN ('DRAFT', 'PUBLISHED')),
	CONSTRAINT "curated_entries_list_slug_check" CHECK("curated_entries"."list_slug" <> ''),
	CONSTRAINT "curated_entries_rationale_check" CHECK("curated_entries"."rationale" <> ''),
	CONSTRAINT "curated_entries_evidence_links_check" CHECK("curated_entries"."evidence_links" <> '' AND json_valid("curated_entries"."evidence_links")),
	CONSTRAINT "curated_entries_reviewer_check" CHECK("curated_entries"."reviewer" <> ''),
	CONSTRAINT "curated_entries_target_check" CHECK(("curated_entries"."product_id" IS NULL) <> ("curated_entries"."external_ref" IS NULL)),
	CONSTRAINT "curated_entries_external_ref_check" CHECK("curated_entries"."external_ref" IS NULL OR "curated_entries"."external_ref" <> ''),
	FOREIGN KEY (`product_id`) REFERENCES `product_master`(`id`) ON UPDATE NO ACTION ON DELETE NO ACTION
);
--> statement-breakpoint
-- The (list_slug, status) composite serves the 7.2 public lookup
-- (published rows of one slug) and — through its leftmost prefix —
-- the console's per-slug management reads.
CREATE INDEX `curated_entries_list_slug_status_idx` ON `curated_entries` (`list_slug`, `status`);
