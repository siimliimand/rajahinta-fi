# Nightly sweep repair

## Why

The nightly calculation-record retention sweep (`30 3 * * *`, `retention-sweep` handler) has failed on every production run since go-live. Workers Logs from the 2026-10-26 and 2026-11-03 03:30 UTC ticks both carry:

```
Cron handler "retention-sweep" failed
error = process is not defined
```

Root cause: `D1CalculationRecordRetentionService.configuredDays()` (`packages/data-platform/src/repositories/d1/calculation-record-retention.ts:153`) reads `process.env[envName]` directly. The Workers runtime has no `process` global. The cron handler (`apps/api-worker/src/cron/retention-sweep.ts`) injects explicit window overrides only when the wrangler vars `CALCULATION_RECORD_RETENTION_DAYS` / `CALCULATION_RECORD_AGE_CAP_DAYS` are set — production sets neither, so the env fallback executes and throws before any deletion.

Consequence (production `calculation_records`, measured 2026-11-03): **497,074 rows total, 64,659 already past the 30-day anonymous window, zero ever pruned**. The anonymous-record prune is a privacy requirement; the table grows with every calculator use (~7k rows/day net).

Correction to the 2026-11-03 session report: `contact-retention` was suspected of carrying the same D1 bound-variable cap bug fixed for `retail-offers-retention`. Verified NOT affected — `DELETE_BATCH_SQL` (`contact-message.repository.ts:73`) deletes via `rowid IN (SELECT … LIMIT ?)` with only two bound variables. No change there; this change covers the sweep defect only.

## What Changes

- **Service repair**: remove the `process.env` resolution (`configuredDays`) from `D1CalculationRecordRetentionService` entirely. Window resolution becomes explicit parameter ?? code fallback (anonymous 30-day window, 180-day gate-review age cap — the existing module contract). Wrangler vars keep working: the handler already passes them as explicit overrides when set, and that path is unchanged. The Node-side `process.env` parsing was BullMQ-era carryover; the pg-era service keeps its own env parsing (it runs on Node) — the D1 service diverges deliberately.
- **Tests**: rewrite `calculation-record-retention.test.ts` to inject explicit windows instead of mutating `process.env`; add an api-worker cron regression test pinning the exact production shape — `handleRetentionSweep` with an `Env` carrying no retention vars completes successfully and returns pruned counts.
- **Spec delta**: `background-jobs` ADDED requirement — retention sweeps resolve configuration from deployment config or code defaults, never the Node process environment.
- **Verification**: gated production deploy, then confirm the next 03:30 UTC tick logs `Retention sweep finished: pruned anonymous …` without error and the past-window row count drops from 64,659 toward 0.

## Non-goals

- No retention window changes (30 days / 180 days stay as contracted).
- No `contact-retention` or `retail-offers-retention` changes (healthy / fixed and live).
- No new cron patterns, no `process`-shim (`nodejs_compat` stays off for this path).
- No pg-side service changes.

## Dependencies

- Production rollout is gated as usual (workflow_dispatch + `confirm_deploy=yes`); the first verified green tick is the close-out evidence.
- The first live drain of ~64,659 rows runs the service's batch loop to exhaustion in one pass — bounded per statement (`LIMIT` batch), unbounded in loop length. Idempotent by cutoff: a slow or interrupted pass is simply continued by the next night.
