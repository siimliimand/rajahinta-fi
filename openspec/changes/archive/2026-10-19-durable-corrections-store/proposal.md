# Durable corrections store

## Why

The operator console's correction queue cannot be operated in any deployed environment. All three `/ops/console/corrections` routes (list, open, resolve) throw 503 `StoreUnavailable` because the corrections store was never ported to D1 (migrate-to-cloudflare 2.5 deferred it); serving a process-local in-memory queue in a Worker would be restart-volatile, so the routes fail closed by design. Hit in production 2026-10-16 while operating the console. The same debt also blocks the tax rate-review approve/reject actions, but that store is a separate change.

The port contract already exists: the `ICorrectionRepository` port (`create` / `findAll` / `resolve`), the `CorrectionItem` wire DTO the console renders, and a console API client that already matches the route shapes — only the durable store and the route wiring are missing. The `durable-source-governance-store` change (2026-09-10) closed the identical gap for governance and is the structural precedent.

## What Changes

### Durable store

- New D1 migration `0040_corrections.sql` (+ `d1/schema.ts` table): `corrections` with id (INTEGER PK autoincrement), target_type (TEXT, CHECK `calculation | data_point`), target_id (INTEGER NOT NULL), reason (TEXT NOT NULL), status (TEXT, CHECK `open | resolved`, default `open`), resolution (TEXT NULL), created_at and resolved_at (ISO-8601 TEXT), plus a `(status, created_at)` index for the queue listing. Column set mirrors `CorrectionItem` exactly — no resolver column: operator attribution rides the durable audit trail (data minimization; the DTO carries no resolver field).
- New `D1CorrectionRepository` implementing `ICorrectionRepository` beside the other D1 repositories: `create` (repository-assigned id, ISO timestamps), `findAll` (newest first), `resolve` (sets status/resolution/resolved_at; returns null on unknown id). Pinned by tests: CRUD, resolve semantics, unknown-id null.

### Console wiring

- The three handlers in `ops.routes.ts` swap `correctionsUnavailable()` for the repository: list serves persisted rows newest-first in the `CorrectionListResponse` shape the console renders; open validates through the existing zod schema and persists; resolve maps the client's optional `note` to the stored `resolution` and 404s unknown ids. Open and resolve append `WorkerAuditService` events (operator identity, action, target, before/after) per the audited-console rule; the list stays unaudited (read-only, governance precedent). The 503 stub and its test pins are deleted; route tests pin the success shapes, the audit rows, the 400/404 paths, and the removed 503.

### Documentation

- ARCHITECTURE.md's operator-console description and TECHNICAL-ASSESSMENT.md's open-debt note stop describing the correction-queue gap, and record the two remaining 2.5 debts (tax rate-review store, public corrections endpoint on the worker).

## Non-goals (this change)

- No public `POST /api/v1/corrections` on the api-worker: the calculator's "Ilmoita virheessä" flag funnel still has no worker-side endpoint (separate gap with its own abuse-surface decisions — needs an owner call).
- No pg-backed Nest repository: `DrizzleCorrectionRepository` stays a stub (the Nest backend serves no live traffic; same non-goal as the governance port).
- No tax rate-review store: same 2.5 debt, separate change.
- No frontend changes: the console client already sends and renders exactly these shapes.
- No backfill: the queue is empty today by construction (nothing could persist).
