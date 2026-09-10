# Design: durable source-governance store

## Context

Governance permission is the fail-closed gate in front of every feed fetch. Its only durable artifact today is the port: `ISourceGovernanceRepository` (create, updateStatus, revokeAllByMerchantId, findByMerchantId, findById, checkPermission, list) in core-domain, plus `SourceGovernanceService` over it. Both live implementations are in-memory (`InMemorySourceGovernanceRepository` in application-api, `NoRecordsGovernanceRepository` for no-record tests). The worker composes `SourceGovernanceService` over the in-memory default in `composeIngestionPipeline` and `composeIngestionStageServices`, the console list handler hardcodes `permissionStatus: 'PENDING', sourceCount: 0`, and `governanceUnavailable()` throws 503 on every mutation. Production behavior is therefore indistinguishable from "no merchant ever granted", by construction.

Facts the design rests on:

- The `WorkerAuditService` (D1 `audit_events`) is the established console audit path — blacklist publish/appeal flows already write operator identity, action, and before/after through it.
- The Nest `OpsGovernanceService` defines the grant/revoke semantics the console must reproduce: registry lookup 404, transitionable PENDING/EXPIRED record first, register-new-GRANTED when no records, no-op (`changed: false`) when already granted, revoke-all with required reason.
- D1 migrations walk by filename (`wrangler migrations` and the seed apply path); pg uses the drizzle journal (latest 0019, D1 latest 0020).
- The `d1-seed.test.ts` verification counts stay unaffected: governance rows are operator-created runtime data, never seeded.

## Decisions

### D1: one table, forward-only transitions

`source_governance` (D1 migration `0021_source_governance.sql`, pg drizzle `0020_source_governance`):

- `id` INTEGER PK AUTOINCREMENT (D1 repo convention), `merchant_id` TEXT NOT NULL (registry join key), `acquisition_method` TEXT NOT NULL with CHECK against the six `AcquisitionMethod` values, `permission_status` TEXT NOT NULL with CHECK against the four `PermissionStatus` values, `source_url` TEXT NOT NULL, `status_reason` TEXT (required materialized for REVOKED rows by the repository, optional otherwise), `created_at`/`updated_at` TEXT NOT NULL.
- Status changes UPDATE the row in place (the audit event carries the history); rows are never deleted. Registration is append-only — a merchant accrues sources, `checkPermission` aggregates.

### Repository: implement the port exactly

`D1SourceGovernanceRepository` implements `ISourceGovernanceRepository` with the same semantics as the in-memory reference: `checkPermission` returns the most favourable active status across sources (GRANTED beats PENDING beats REVOKED/EXPIRED) with `hasWarnings` when any non-granted source exists, and "no records" returns the undefined-status PENDING result — never overstated. Same file conventions as `D1MerchantRegistryRepository` (prepared statements over `env.DB`, contract mapping in one place).

### Wiring: both ingestion compositions and the console read D1

`composeIngestionPipeline` and `composeIngestionStageServices` construct `new D1SourceGovernanceRepository(env.DB)` as their default governance repository; the `governanceRepository` option override stays for tests. The empty-table behavior is byte-identical to today's fail-closed default, so flipping the default changes nothing until an operator grants.

`ops.routes.ts` replaces the hardcoded-PENDING list with registry-join plus `checkPermission` per merchant, and implements grant/revoke against the repository: grant validates the acquisition method against the same six-value list, requires an operator identity, transitions or registers as the Nest service does, and returns the same `OpsGovernanceMutationResponse` shape the console already renders. Both mutations append an `audit_events` row via `WorkerAuditService` (entityType `source_governance`, before/after statuses, operator, reason). `governanceUnavailable()` and its 503 are removed — after this change the console has no known-unservable mutation.

### Audit without dual writes

The repository does not write audit events; the route does. One writer per concern: the repo owns rows, the route owns the operator-decision audit trail. This matches the blacklist flows and keeps the repository reusable by future callers (e.g. a scheduled expiry job) without dragging operator identity into the data layer.

## Risks

- **Test defaults flip.** Workflow and queue tests that relied on the in-memory default now see a D1-backed gate; they must pass explicit in-memory overrides or a stub `env.DB`. The fail-closed assertions must keep passing with an empty real table — that equivalence is itself pinned by a test.
- **Console contract drift.** The console frontend renders `OpsGovernanceListResponse`/`OpsGovernanceMutationResponse` shapes; the route tests pin those shapes so the UI needs no change.
- **Staging migration timing.** The grant smoke can only run after deploy-staging applies migration 0021; the runbook callout is updated to sequence it.
