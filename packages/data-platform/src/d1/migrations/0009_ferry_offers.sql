-- Task 5.3 (change product-roadmap-phases-1-4): curated ferry operator
-- offers behind the trip feasibility calculator's neutral affiliate slot
-- (design R8, spec: trip-feasibility-calculator, "Neutral affiliate slot").
--
-- ferry_offers: one CURATED row per ferry operator link. Columns are
-- exactly the R8 set — operator, route label, url, status — plus the
-- created_at stamp; data minimization forbids optional fields "for
-- later" (no campaign fields, no ranking weight, no price data: an
-- affiliate row that could influence a calculation is unrepresentable
-- by construction, which is what makes the 5.5 byte-identical
-- compliance test structurally trivial).
--
-- Status lifecycle: rows start DRAFT (operator-console work in
-- progress, invisible to the public trip API) and move to PUBLISHED by
-- the audited console publish action; PUBLISHED is terminal for the
-- status (content comes down by deletion, which the audit trail
-- records). The CHECK makes any other state unrepresentable at rest.
--
-- Outbound discipline (R8): the stored url never leaves the operator
-- console. The public trip API returns redirector-ready references and
-- the outbound redirect controller serves the click (GET
-- /api/v1/outbound/ferry/:offerId) — the raw url exists only in this
-- table and the audited console responses.
--
-- Non-empty CHECKs mirror the group_order_sessions share-token check:
-- a blank operator, route label, or url is a curation bug, not an
-- offer. Ordering for the public block is (operator, route_label, id)
-- ascending — an index on (operator, route_label) serves it and keeps
-- the block deterministic regardless of insert order (affiliate data
-- must not influence anything, including its own ordering surprises).
CREATE TABLE `ferry_offers` (
	`id` integer PRIMARY KEY NOT NULL,
	`operator` text(128) NOT NULL,
	`route_label` text(128) NOT NULL,
	`url` text NOT NULL,
	`status` text(16) DEFAULT 'DRAFT' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "ferry_offers_status_check" CHECK("ferry_offers"."status" IN ('DRAFT', 'PUBLISHED')),
	CONSTRAINT "ferry_offers_operator_check" CHECK("ferry_offers"."operator" <> ''),
	CONSTRAINT "ferry_offers_route_label_check" CHECK("ferry_offers"."route_label" <> ''),
	CONSTRAINT "ferry_offers_url_check" CHECK("ferry_offers"."url" <> '')
);
--> statement-breakpoint
CREATE INDEX `ferry_offers_operator_route_label_idx` ON `ferry_offers` (`operator`,`route_label`);--> statement-breakpoint
CREATE INDEX `ferry_offers_status_idx` ON `ferry_offers` (`status`);
