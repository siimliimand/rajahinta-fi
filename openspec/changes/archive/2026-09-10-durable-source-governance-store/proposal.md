# Durable source-governance store

## Why

The operator console cannot grant any merchant. Governance mutations in the api-worker fail closed with 503 `StoreUnavailable` because the `source_governance` table was never ported to D1 (migrate-to-cloudflare 2.5 deferred it), the console list reports every merchant PENDING, and both ingestion compositions default to a process-local in-memory repository that is always empty in a deployed worker. The gate is GRANTED-only, so alks — the merchant this exists to price — can never be ingested on staging or production, and the alks-feed-and-import-vat change shipped with its staging smoke recorded as blocked on exactly this gap.

The port contract already exists (`ISourceGovernanceRepository` in core-domain, the Nest `OpsGovernanceService` semantics, the `WorkerAuditService` audit pattern); this change ports the store and wires the two consumers that must agree on it: the console and the ingestion gate.

## What Changes

### Durable store

- New `source_governance` table on both databases (pg migration 0020 + D1 migration 0021): merchant_id, acquisition_method, permission_status, source_url, status_reason, timestamps — mirroring `SourceGovernanceRecord`. Status transitions are forward-only (PENDING/EXPIRED → GRANTED → REVOKED); nothing auto-publishes and no seed grants permission (project rule: governance stays human).
- New `D1SourceGovernanceRepository` implementing `ISourceGovernanceRepository` beside the other D1 repositories. `checkPermission` aggregates across a merchant's sources with "no records = PENDING", never overstating.

### Consumers wired to the store

- The worker ingestion compositions (`composeIngestionPipeline`, `composeIngestionStageServices`) default their governance repository to the D1 store instead of in-memory; the gate stays GRANTED-only and fail-closed — an empty table behaves exactly like today.
- The operator console (`ops.routes.ts`) reads real aggregated status in its list, and its grant/revoke mutations persist through the repository and write a durable audit event carrying the operator identity. The 503 `StoreUnavailable` path is deleted. Grant semantics mirror the Nest `OpsGovernanceService`: PENDING/EXPIRED transitions to GRANTED, no records registers a new GRANTED source, already-granted is a no-op; revoke ends every source with a required reason.

### Documentation

- The ingestion runbook's staging-grant prerequisite ("503 is the fail-closed stop") and §2 steps become executable as written; ARCHITECTURE.md's console description stops describing the gap.

## Non-goals (this change)

- No pg-backed Nest repository: the Nest backend keeps its in-memory store (it serves no live staging traffic; the worker is the runtime that matters).
- No change to gate semantics, permission statuses, acquisition methods, or the hourly ingestion cadence.
- No alks grant performed by this change: granting is an operator action in staging after deploy, per the runbook.
