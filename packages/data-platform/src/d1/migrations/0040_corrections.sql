-- Task 1.1 (change durable-corrections-store): the durable correction
-- queue behind ICorrectionRepository.
--
-- corrections: one row per flagged calculation or data point, mirroring
-- the CorrectionItem wire DTO
-- (packages/application-api/src/correction/correction.dto.ts)
-- one-to-one so the D1 repository is a dumb mapper, not a translator.
-- The queue was process-local in the Nest backend (migrate-to-cloudflare
-- 2.5 deferred this port); serving it from a Worker isolate would be
-- restart-volatile, so the routes fail closed today — this table is what
-- makes /ops/console/corrections operable in deployed environments.
--
-- target_type/target_id identify the flagged artifact ('calculation' or
-- 'data_point' — the open-route zod enum, restated as a CHECK so a
-- foreign value is unrepresentable at rest). status moves open →
-- resolved by an in-place UPDATE (status, resolution, resolved_at) —
-- the forward-only transition is enforced by the repository layer, not
-- by triggers, and the audit event carries the history.
--
-- There is no resolved_by column, on purpose: CorrectionItem carries no
-- resolver field and data minimization forbids columns "for later".
-- Operator attribution rides the durable audit trail — the
-- correction_opened / correction_resolved WorkerAuditService events
-- record the operator, the target, and the before/after values.
--
-- corrections_queue_idx serves the console's queue read with one
-- composite index: filter on the leading status column, order by
-- created_at newest first.
--
-- Additive migration: no existing table is touched; rollback is a
-- revert deploy (the table is inert to existing flows). Operator-created
-- runtime data only — never seeded (d1-seed verification counts stay
-- unaffected). No backfill: the queue is empty by construction (nothing
-- could persist before this table).
--
-- Numbering note: the change design expected 0039 to be free
-- (highest applied then 0038); 0039_calendar_event_candidates (change
-- calendar-event-automation) landed in between, so this is 0040.
CREATE TABLE `corrections` (
	`id` integer PRIMARY KEY NOT NULL,
	`target_type` text(16) NOT NULL,
	`target_id` integer NOT NULL,
	`reason` text NOT NULL,
	`status` text(16) DEFAULT 'open' NOT NULL,
	`resolution` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`resolved_at` text,
	CONSTRAINT `corrections_target_type_check` CHECK(`corrections`.`target_type` IN ('calculation', 'data_point')),
	CONSTRAINT `corrections_status_check` CHECK(`corrections`.`status` IN ('open', 'resolved'))
);
--> statement-breakpoint
CREATE INDEX `corrections_queue_idx` ON `corrections` (`status`,`created_at`);
