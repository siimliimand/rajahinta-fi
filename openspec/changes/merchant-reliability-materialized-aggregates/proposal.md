# Merchant reliability materialized aggregates

## Why

The 2026-10 D1 billing incident fix (PR #129) bounded the product-page reliability embed to the page's merchants — but production measurement (2026-10-14, `wrangler d1 execute --remote --json`, product 2651's realistic 6-merchant set) shows the bounded read still costs **534,215 rows per request** vs the old 818,425: only a 35% cut, not a fix. A typical page's merchants (alks, kippis, licorea, longero, viinarannasta, drinkonline) hold most of the ~214k-row `retail_offers` catalog, and the append-only history grows the cost forever. Minute-granularity analytics post-deploy still show the embed class as the dominant account read (~43M rows/hour — within reach of the `RajahintaD1RowsReadDailyBudget` 1B/24h guardrail).

The figures are per-merchant whole-catalog aggregates that change at most once per 30-min aggregation tick. A figure with that cadence must not be recomputed per request: the existing `*/30` tick (which already materializes `price_history_summaries`, savings snapshots, and outcome margins) should materialize them, and the embed should read the materialized rows.

## What Changes

- **New table `merchant_reliability_aggregates`** (migration 0035): one row per merchant — offer count, per-status counts (VERIFIED/ESTIMATED/STALE/UNAVAILABLE), freshest observed_at, computed_at. Seeded at migration time with the current live aggregates (one-off ~818k-row read at deploy, then maintained by the tick).
- **New 30-min cron handler** `handleMerchantReliabilityAggregates`, registered on the existing `AGGREGATION_CRON` AFTER `freshness-alert` so the tick's VERIFIED→STALE ageing write-back is reflected in the same pass. Full refresh per tick (delete + insert of the same aggregate query the repositories run today — ~818k rows/tick ≈ 39M rows/day ≈ $0.04/day, ~0.16% of the included allowance).
- **`D1MerchantReliabilityRepository.findCurrentOfferAggregates` switches to reading the materialized table** (optional merchant filter via `IN`, ≤ a few dozen rows total): per-request cost drops from 534k rows to ~table size (~6–40 rows). The ranked-CTE SQL machinery and `D1_BOUND_PARAMETER_CAP` from PR #129 are removed — the materialized read serves both the bounded and whole-catalog paths.
- **Figures stay byte-identical**: the materialized rows ARE the same aggregates the live query yields, recomputed by the same deterministic-latest rule every tick — locked by a parity test.
- **Honest staleness contract**: aggregates are at most one tick old (~30 min), matching every other materialized surface (`price_history_summaries`, savings snapshots). Cold start (table empty, before the first tick) returns an empty map — the embed already fails open (badge omitted), never a live whole-catalog scan.

## Non-goals

- **Freshness-sweep index** (`retail_offers(reliability_status, observed_at)` for the aged-VERIFIED UPDATE full scan) — separate change, becomes migration **0036** (0035 is this table).
- **pg/Drizzle materialization** — production is D1-only; `DrizzleMerchantReliabilityRepository` keeps its live DISTINCT ON query (tests/legacy harness).
- **Incremental aggregate maintenance** — full recompute per tick is simpler and ~$0.04/day.
- **Response-layer caching** — unnecessary once the read is a primary-key lookup away.
- **The mystery `__unknown__` Worker script** — separate ops investigation.

## Incident linkage

2026-10 D1 billing incident: one informational embed read the whole catalog per product-detail request (~818k rows measured, ~99% of account-wide D1 reads, overage ~$14). Layer 1 fix: PR #129 (bounded read — shipped, insufficient at 534k). Layer 2 fix (this change): materialized aggregates — ends the per-request cost class. Guardrail: `RajahintaD1RowsReadDailyBudget` (PR #130) — will fire on the residual until this change deploys; that is the guardrail telling the truth.
