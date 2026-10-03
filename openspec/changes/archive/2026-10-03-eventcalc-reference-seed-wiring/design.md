# Design: eventcalc-reference-seed-wiring

## Context

The event calculator's data pipeline was specified end-to-end (seed → operator
review → publication → resolution) but only the consuming half was ever wired:
the route, repository, pure module, UI, and the guarded ops confirm endpoint
all exist and work. The producing half — the seed and the act of publication —
never executed in any environment. This change wires the producing half using
the orchestrator patterns the repo already trusts, and documents the
owner-gated production act that the seed-d1 doctrine explicitly reserves for
humans ("production seeding is a deliberate, manual act").

## Decisions

### D1 — Generated SQL files, one source of truth

The orchestrator (`packages/data-platform/src/seed/d1/generate.ts`) emits
byte-deterministic SQL from seed constants — that is its existing, verified
pattern (`SEED_RULES`, `MERCHANT_REGISTRY_SEED`, staging data). Both new
datasets follow it: the curated rows become exported pure constants
(`CONSUMPTION_NORMS_SEED_ROWS` derived by the seed's own pure row-builder over
`CURATED_NORMS`; `CARRIER_BOX_TYPES_SEED` already exists), and new generator
functions emit INSERTs from those constants. The function seeds
(`seedConsumptionNorms`, `seedCarrierBoxTypes`) are refactored to consume the
same constants — no duplicated row data anywhere. A parity test applies both
paths to a node:sqlite migrated database and pins row-for-row equivalence.

Alternative rejected: a standalone `scripts/*.mts` calling the seed functions
against remote D1 — it would fix production only, leave staging empty, keep
the orchestrator blind, and add a second invocation path to maintain.

### D2 — Idempotency contracts preserved exactly

The norms seed documents a deliberate contract: the upsert refreshes
PENDING_CONFIRMATION rows only; PUBLISHED rows are immutable (append-only
dataset — a correction is a new version). The generated SQL must reproduce
this (`ON CONFLICT ... DO UPDATE ... WHERE` the existing row is pending), and
the idempotency test re-applies the file over a seeded-then-published
database to prove PUBLISHED rows come out untouched. Carrier boxes have no
publication workflow; their plain upsert contract carries over as-is.

### D3 — Fail-loudly verification

`buildVerifySql()` gains assertions for both datasets (norms ≥ 18 rows in
{PENDING_CONFIRMATION, PUBLISHED}; boxes ≥ its curated count). The orchestrator
already fails the run on any verification mismatch (`assertVerificationRow`),
so a staging deploy whose seeding silently no-ops now fails the pipeline —
the same fix-plus-guard standard the category incident set.

### D4 — Production stays a deliberate, owner-gated manual act

`seed-d1.ts` documents that the pipeline seeds staging only; production
seeding is manual. That doctrine is correct for reference data an operator
must review — the runbook keeps it: emit the SQL files, owner reviews the
18-row table (each row carries its verifiable standard-drink derivation
citation), apply with `wrangler d1 execute DB --remote --env production
--file`, then publish through the ops console API
(`POST /ops/console/confirmations/consumption-norms/:id/confirm`, `operator`
+ `note`; blank citation → 409; PUBLISHED is terminal). The runbook documents
the real authentication path for that API — the task verifies how the
2026-10-02 allowances session operated it and records the same procedure.

### D5 — Publication is append-only; rollback semantics stated

Corrections append a new version with a fresh window; they never edit
history (spec + repository contract). The runbook's rollback section states
this honestly: a wrongly published row is corrected by appending a superseding
version (the half-open effective-window resolution makes the newest
effectiveFrom per drink type win); mass deletion is an owner-gated direct-D1
act outside routine operations, never assumed by tooling.

### D6 — No consuming-surface changes

The route, repository, pure module, and UI already implement the spec,
including the calm `NO_PUBLISHED_NORMS` state and the V2 toggle. Touching them
would be scope creep; the live checks in the runbook prove them against real
data instead.

## Non-goals

- No ops-console web UI (the API path suffices for a single-operator product).
- No changes to the event calculator's arithmetic, resolution semantics, or
  response contract.
- No retrier/cron for publication — the human confirm step is the trust
  design, not an obstacle.
- No legacy cleanup of `scripts/seed-runner.ts` (pg-era; harmless, out of
  scope).
