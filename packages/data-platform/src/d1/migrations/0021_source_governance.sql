-- Task 1.1 (change durable-source-governance-store): the durable source
-- governance table behind ISourceGovernanceRepository.
--
-- source_governance: one row per registered merchant data source,
-- mirroring the core-domain SourceGovernanceRecord
-- (packages/core-domain/src/governance/source-governance.types.ts).
-- Permission state is the fail-closed gate in front of every feed fetch:
-- a merchant with no row (or no GRANTED row) is not ingested.
-- Registration is append-only (a merchant accrues sources;
-- checkPermission aggregates); status changes UPDATE the row in place —
-- forward-only transitions (PENDING/EXPIRED → GRANTED → REVOKED) are
-- enforced by the repository layer, not by triggers, and the audit event
-- carries the history. Rows are never deleted. status_reason is nullable
-- at the schema level: the repository materializes it as required for
-- REVOKED rows, optional otherwise. Operator-created runtime data only —
-- never seeded (d1-seed verification counts stay unaffected).
CREATE TABLE `source_governance` (
	`id` integer PRIMARY KEY NOT NULL,
	`merchant_id` text(128) NOT NULL,
	`acquisition_method` text(32) NOT NULL,
	`permission_status` text(16) NOT NULL,
	`source_url` text NOT NULL,
	`status_reason` text,
	`last_verified_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "source_governance_acquisition_method_check" CHECK("source_governance"."acquisition_method" IN ('PERMITTED_FEED', 'RETAILER_API', 'STRUCTURED_MERCHANT_FEED', 'LICENSED_PROVIDER', 'COMPLIANT_CRAWLING', 'MANUAL_VERIFICATION')),
	CONSTRAINT "source_governance_permission_status_check" CHECK("source_governance"."permission_status" IN ('GRANTED', 'PENDING', 'EXPIRED', 'REVOKED'))
);
