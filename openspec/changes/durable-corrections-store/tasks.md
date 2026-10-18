# durable-corrections-store — Tasks

> Ports the operator-console correction queue to a durable D1 store so list/open/resolve stop 503ing in staging and production. Schema and repository first; the console routes rewire once the repository exists; docs and verification last. No frontend work (the client already matches), no pg/Nest store (stub stays), no tax rate-review store (separate change).

## 1. Schema and repository

- [x] 1.1 D1 migration `0040_corrections.sql` (+ `corrections` table in `d1/schema.ts`): id INTEGER PK AUTOINCREMENT, target_type TEXT NOT NULL CHECK `('calculation','data_point')`, target_id INTEGER NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK `('open','resolved')`, resolution TEXT, created_at TEXT NOT NULL, resolved_at TEXT, index `corrections_queue_idx (status, created_at)`; columns mirror `CorrectionItem` exactly, no resolver column <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-platform/src/d1/schema.ts, packages/data-platform/src/d1/migrations/0040_corrections.sql] -->
- [x] 1.2 `D1CorrectionRepository` implementing the application-api `ICorrectionRepository` (create with repository-assigned id + ISO timestamps, findAll newest-first over open and resolved rows, resolve sets status/resolution/resolved_at and returns null on unknown id), pinned by tests: CRUD, resolve semantics, unknown-id null, idempotent re-resolve <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [packages/data-platform/src/repositories/d1/corrections.repository.ts, packages/data-platform/src/repositories/d1/__tests__/corrections.repository.test.ts] -->

## 2. Console routes

- [ ] 2.1 Rewire the three `/ops/console/corrections` handlers in `ops.routes.ts` to `D1CorrectionRepository` and delete `correctionsUnavailable()`: list serves `CorrectionListResponse` newest-first, open persists through the existing zod schema, resolve maps the optional `note` to the stored resolution and 404s unknown ids; open and resolve append `WorkerAuditService` events (operator, action, target, before/after), the list stays unaudited; update route tests to pin the success shapes the console renders, the audit rows, the 400/404 paths, and the removed 503 <!-- agent: platform-engineer.build, depends_on: [1.2], touches: [apps/api-worker/src/routes/ops.routes.ts, apps/api-worker/src/routes/__tests__/ops.routes.test.ts] -->

## 3. Documentation and verification

- [ ] 3.1 Docs: ARCHITECTURE.md operator-console description and TECHNICAL-ASSESSMENT.md open-debt note stop describing the correction-queue gap and record the remaining migrate-to-cloudflare 2.5 debts (tax rate-review store; public corrections endpoint on the worker) <!-- agent: platform-engineer.fast, depends_on: [2.1], touches: [ARCHITECTURE.md, docs/TECHNICAL-ASSESSMENT.md] -->
- [ ] 3.2 Full verification: typecheck, lint, unit suites (data-platform, api-worker, application-api, frontend), test:d1 — D1 suites are FTS5-blocked on the operator host, CI arbitrates — plus content lint; confirm staging applies migration 0040 in the deploy pipeline <!-- agent: platform-engineer.build, depends_on: [1.2, 2.1, 3.1], touches: [] -->
