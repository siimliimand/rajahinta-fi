# Design: nightly sweep repair

## Context

The sweep is spec-honest but runtime-dead: every statement it needs is correct, and the crash happens in configuration resolution before any SQL runs. `handleRetentionSweep` builds `retentionDays` / `ageCapDays` from wrangler vars via `parseDays(env.CALCULATION_RECORD_*)`, and passes them into `runRetention` only when defined. `runRetention` then calls `configuredDays(envName, fallbackDays)` for anything absent — and `configuredDays` is the only place a Node global leaks into the Worker bundle: `const raw = process.env[envName]`.

## Decisions

### D1: remove the process.env path, keep three-layer resolution

New resolution order, implemented in `runRetention`:

1. Explicit call parameter (the handler's wrangler-var path, unchanged).
2. Code fallback: anonymous window 30 days, age cap 180 days — the constants the module docblock and the gate review already contract.

`configuredDays` and its `envName` plumbing are deleted. The pg-era service keeps its own env parsing — it runs on Node where `process` exists; the D1 service diverges deliberately and the divergence is commented at the removal site (WHY: Workers runtime, 2026-10/11 nightly-failure incident).

Rejected alternative: `typeof process !== 'undefined'` guard around the env lookup. It preserves a second configuration path that can never fire in any supported runtime and hides the Node-ism instead of removing it; the tests would keep exercising a dead branch.

### D2: tests

- `calculation-record-retention.test.ts` currently deletes/sets `process.env.CALCULATION_RECORD_*` — rewritten to pass explicit `{ retentionDays, ageCapDays }` per case; the "invalid value falls back" cases become "absent param falls back" cases (same fallback constants asserted).
- New regression test in the api-worker cron suite: `handleRetentionSweep(env, log)` where `env` carries neither var — the exact production shape — completes, returns pruned counts, and never throws `process is not defined`. This is the pin that would have caught the incident; the old suite never executed the env-fallback branch against a Workers-like environment.

### D3: first drain envelope

The batch loop (`DELETE … rowid IN (SELECT … LIMIT ?)`, repeated until a short batch) is bounded per statement and unbounded per run. First successful production pass drains ~64,659 rows to exhaustion in one invocation; idempotent by cutoff, so any interruption is continued by the next night. No cap is added: the sweep already had this contract and has simply never been exercised.

## Spec

`background-jobs` gains one ADDED requirement (Workers-safe configuration resolution) so the rule survives as a durable scenario set rather than a comment. No existing requirement changes — the sweep's windows, cadence, and bounded-batch behavior are already spec'd; this change makes the runtime honor them.
