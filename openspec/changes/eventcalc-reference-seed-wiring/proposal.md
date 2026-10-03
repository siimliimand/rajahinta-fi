# Proposal: eventcalc-reference-seed-wiring

## Why

The event calculator (`/event`, `POST /api/v1/event-calc`) is 100 % non-functional
in **every** environment. Every request answers `{"status":"NO_PUBLISHED_NORMS"}`:
the consumption norms the calculator resolves are not published for any
profile/date, so the feature's entire purpose — a drink estimate from guest
count — is impossible. The UI correctly shows a calm explanation instead of a
shopping list, and the V2 sourcing-plan toggle has nothing to act on.

Root cause (verified in production and staging during exploration):

- `consumption_norms` has **0 rows** in production AND staging. The route,
  repository, pure module, and UI are all correct — `NO_PUBLISHED_NORMS` is the
  spec-mandated answer to absent data.
- The seed that should populate them, `seedConsumptionNorms()`, is **orphaned**:
  exported from data-platform and unit-tested, but wired into nothing. It is
  absent from the D1 seed orchestrator (`generate.ts` emits only tax-rules and
  staging data; `staging.d1.sql` contains zero norms rows), absent from every
  script in `scripts/`, absent from every GitHub workflow, absent from every
  migration. No environment has ever run it.
- Even a seeded dataset would not compute: rows land `PENDING_CONFIRMATION` by
  design, and the spec requires explicit operator confirmation through the
  guarded ops console before publication. That console step has never been
  operated for norms. (Precedent exists: the sibling traveller-allowance
  dataset was seeded and owner-directed-published on 2026-10-02 — the playbook
  was simply never run for norms.)
- **Rider, same root family:** `carrier_box_types` also has **0 rows** in
  production. The event-calc route calls `listAll()` on it for the V2 sourcing
  plan's `suggestPacking` — with an empty table the packing suggestion is dead
  even after norms publish. Its seed constant (`CARRIER_BOX_TYPES_SEED`) is
  likewise absent from the orchestrator.

The `scripts/seed-runner.ts` (Postgres-era Kubernetes job, `DATABASE_URL`) is
legacy and unrelated to the D1 pipeline.

## What Changes

- Both orphaned reference-data seeds are wired into the D1 seed orchestrator
  as generated, byte-deterministic SQL files: `consumption-norms.d1.sql`
  (18 curated rows; reproduces the seed function's refresh-PENDING-only
  idempotency contract — published rows are never rewritten) and
  `carrier-box-types.d1.sql` (plain idempotent upsert, as its seed behaves
  today). The curated rows become exported pure constants consumed by BOTH the
  function seed and the SQL generator — one source of truth, pinned by a
  parity test.
- The orchestrator's fail-loudly verification (`buildVerifySql`) is extended:
  a staging deploy that fails to seed the new datasets fails the pipeline.
- A production handover runbook documents the deliberate, owner-gated manual
  act (per existing `seed-d1.ts` doctrine): emit/apply the SQL, review the
  18-row table (profile × drink type × l/guest/hour × citation), publish via
  the ops console API, and the post-publication live checks.
- Staging self-populates through the existing deploy pipeline once the files
  are registered — no workflow edits expected (`seed-d1.ts` iterates
  `SEED_SQL_FILES`).

No route, repository, pure-module, or frontend changes: the calm-explanation
and V2 toggle behavior is already correct and spec-compliant.

## Capabilities

### New Capabilities

(none — this completes the data pipeline of an existing capability)

### Modified Capabilities

(none — `event-calculator` already pins the resolution semantics, the
never-published-without-citation rule, and manual confirmation; this change
makes the referenced data actually flow. The regression guard is test-level:
generator parity, idempotency, byte-determinism, and verify assertions.)

## Impact

- **Code:** `packages/data-platform` (seed constants exposed, SQL generator,
  verify), `scripts/seed-d1.ts` only if verify wiring requires it.
- **Users:** the event calculator computes: guest count + duration + profile →
  per-drink-type litres with the norms version attached; the V2 sourcing plan
  packs into real carrier boxes.
- **Ops:** staging seeds itself on the next deploy; production seeding is one
  owner-gated `wrangler d1 execute --file` plus owner review and publication
  through the ops console API. No backfill of derived data, no secrets, no
  cron interaction.
- **Risk:** the only contract-sensitive surface is the norms SQL generator's
  idempotency (must never touch PUBLISHED rows) — pinned by tests; the verify
  assertions catch any silent seeding failure in staging.
