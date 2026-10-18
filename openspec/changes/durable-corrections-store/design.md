# Durable corrections store — Design

## Context

The correction queue predates the Worker port: the Nest backend carried it in `packages/application-api/src/correction/` (port + in-memory adapter), migrate-to-cloudflare 2.5 deferred its D1 counterpart, and the worker routes shipped fail-closed (`correctionsUnavailable()` in `apps/api-worker/src/routes/ops.routes.ts`). The console client (`apps/frontend/src/app/[locale]/ops/api.ts`) already speaks the final contract, so this change is backend-only.

## Goals

- Queue rows survive isolate restarts and are operable in staging and production.
- Every queue mutation stays audited in the durable `audit_events` trail.
- Zero frontend or consumer-contract changes.

## Decisions

### D1-only schema (no pg migration)

The Nest backend keeps its stub/in-memory store (same decision as `durable-source-governance-store`); the Worker is the runtime that matters. The D1 table mirrors `CorrectionItem` one-to-one so the repository is a dumb mapper, not a translator:

| column | type | notes |
|---|---|---|
| id | INTEGER PRIMARY KEY AUTOINCREMENT | repository-assigned |
| target_type | TEXT NOT NULL | CHECK in `('calculation','data_point')` — the route zod enum |
| target_id | INTEGER NOT NULL | |
| reason | TEXT NOT NULL | |
| status | TEXT NOT NULL DEFAULT 'open' | CHECK in `('open','resolved')` |
| resolution | TEXT | NULL while open |
| created_at | TEXT NOT NULL | ISO-8601 |
| resolved_at | TEXT | NULL while open |

Index `corrections_queue_idx` on `(status, created_at)` — the console lists the open queue first, newest first.

No `resolved_by` column: `CorrectionItem` has no resolver field and data minimization forbids columns "for later". The resolving operator is recorded in the audit event.

### Repository beside the D1 family

`D1CorrectionRepository` in `packages/data-platform/src/repositories/d1/corrections.repository.ts` implements the application-api `ICorrectionRepository` (`create`, `findAll`, `resolve`). `findAll` returns everything (open and resolved — the console renders both states, `CorrectionListResponse.total` counts all rows). `resolve` on an unknown id returns null; the route turns that into 404. Resolve on an already-resolved row is a no-op rewrite of the same values (idempotent), matching the port's loose contract; the audit row still records the action.

### Route wiring keeps today's validation

The zod schemas stay byte-identical (`targetType`/`targetId`/`reason`/`operator` on open; `operator` on resolve, optional `note` accepted as today). The `note` becomes the stored `resolution` (null when absent). Audit actions: `correction_opened` / `correction_resolved` with operator, target id, and before/after values.

## Risks

- The D1 test suites are FTS5-blocked on the operator host; repository tests must pass in CI (established arbitration, 2026-10-15 note).
- Migration numbering: 0039 is free (highest applied is 0038; the 0029 duplication is historical and deliberately untouched).
