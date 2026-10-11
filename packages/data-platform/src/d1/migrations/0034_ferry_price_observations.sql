-- Task 2.1 (change ferry-onboard-prices): the curated ferry onboard-shop
-- price observations behind the trip responses' display-only
-- "Laivaston havaitut hinnat" block (spec: trip-feasibility-calculator,
-- "Observed onboard prices block"; spec: data-acquisition, "Curated
-- ferry onboard price source").
--
-- ferry_price_observations: one row per (operator, route, label,
-- observed_at), transcribed from the operators' publicly browsable
-- onboard/pre-order shops into the in-repo curated dataset (the
-- Fransberg/Posti pattern) and upserted by the monthly
-- curated-rate-refresh cron. Columns are exactly the curated-source
-- contract — operator, route, display label, EUR minor-unit price,
-- observation date, per-row citation — plus the created_at stamp; data
-- minimization forbids optional fields "for later" (no EAN, no
-- product_master join, no merchant rows: a ferry shop cannot ship to
-- the door, so these rows never enter the landed-cost offer universe).
--
-- No status column, deliberately: "published rows only" refers to what
-- ingestion chose to store — the governance gate (an operator key per
-- ferry operator, fail-closed PENDING until granted) is the publication
-- mechanism, and the upsert stores only what the curated dataset
-- contains. Every row in the table is a display-ready curated fact, so
-- a lifecycle column would govern nothing.
--
-- Currency is the EUR literal, not a column: all three operators price
-- their FI-market shops in euro and the block reads no other currency,
-- so a single-currency table needs no dimension.
--
-- observed_at carries the curated revision's shared observation date
-- (one OBSERVED_AT per dataset — the Fransberg precedent), so a
-- re-observation on a later date lands a NEW row and prior months stay
-- as append-only history. UNIQUE (operator, route, label, observed_at)
-- is the idempotent upsert target: re-running the cron over an
-- unchanged dataset converges on the existing rows (same ids) instead
-- of duplicating history, and a price/citation correction of the same
-- observation overwrites in place.
--
-- Citation and observation date are NOT NULL and the text columns are
-- non-empty (CHECKs): an uncited or undated price is unrepresentable at
-- rest — the schema-level form of the spec's "ingestion refuses the
-- row". The operator/route/label CHECKs mirror ferry_offers (a blank is
-- a transcription bug, not an observation) and price_cents > 0 keeps
-- free/negative "prices" out for the same reason. Ordering for the trip
-- block is the unique key ascending — deterministic regardless of
-- insert order; the (operator, route, label) index serves it and the
-- route-filtered read.
CREATE TABLE `ferry_price_observations` (
	`id` integer PRIMARY KEY NOT NULL,
	`operator` text(128) NOT NULL,
	`route` text(128) NOT NULL,
	`label` text(512) NOT NULL,
	`price_cents` integer NOT NULL,
	`observed_at` text NOT NULL,
	`citation` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "ferry_price_observations_operator_check" CHECK("ferry_price_observations"."operator" <> ''),
	CONSTRAINT "ferry_price_observations_route_check" CHECK("ferry_price_observations"."route" <> ''),
	CONSTRAINT "ferry_price_observations_label_check" CHECK("ferry_price_observations"."label" <> ''),
	CONSTRAINT "ferry_price_observations_price_check" CHECK("ferry_price_observations"."price_cents" > 0),
	CONSTRAINT "ferry_price_observations_citation_check" CHECK("ferry_price_observations"."citation" <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ferry_price_observations_operator_route_label_observed_at_unique` ON `ferry_price_observations` (`operator`,`route`,`label`,`observed_at`);--> statement-breakpoint
CREATE INDEX `ferry_price_observations_operator_route_label_idx` ON `ferry_price_observations` (`operator`,`route`,`label`);
