# Expand alerts and accuracy breakdowns — Design

## Context

The alert pipeline (`apps/api-worker/src/cron/price-alert-evaluation.ts`) sweeps every 30 minutes: kind-guarded rows, `observed <= threshold` semantics, 24-hour cooldown from the latest DELIVERED notification row, 7-day summary-freshness lookback, per-alert failure isolation, intent-log delivery through the email Worker. The kind set (`PRICE | TAX_CHANGE`, migration 0016) was already extended once; the kind-guard ownership rule (each evaluator skips foreign kinds before any read or counter) is the established pattern.

Price observations are self-contained: `price-observation-recorder.service.ts` composes the landed cost as `offer.priceCents × 1 + excise × 1 + containerDuty × 1 + transport.costCents` (quantity=1 baseline, transport once per shipment), selecting the current transport offer for the baseline route (carrier = merchant, origin = offer country, destination = FI), and embedding excise/container-duty rule-version snapshots, per-input reliability, and confidence. The time-series aggregation folds these into `landedCost*` buckets per product+merchant, with product-wide rows at `merchant IS NULL`.

The accuracy statistic is computed read-time from stored outcomes (`aggregateOutcomeAccuracy`), rendered by `AccuracyStat` on the home trust-row and ranking section. The type contract pins honesty: `withinMarginShare` null exactly when count is 0, count always displayed, wording from the module labels.

## Goals / Non-Goals

**Goals:**

- Alert on the number the site actually promises: landed cost to Finland, per product.
- Alert on a canonical category with a deterministic, curation-free definition.
- Split the accuracy statistic by objective dimensions (category, carrier) without weakening its honesty rules.

**Non-Goals:**

- New delivery channels; per-merchant alert metrics; category alerts on landed cost; savings narratives; corridor splits; anonymous reporting; feature flags.

## Decisions

### D1 — Extend the closed kind set, not new tables

`LANDED_COST` and `CATEGORY` join `PRICE | TAX_CHANGE` in the same `price_alerts` table; `product_id` becomes nullable and a nullable category column is added (app-layer validation against `PRODUCT_CATEGORIES`, mirroring the search route's 400-on-unknown contract). Kind-aware creation guards, extending the existing asymmetry:

| kind | productId | category | threshold |
|---|---|---|---|
| PRICE | required | forbidden | required > 0 |
| TAX_CHANGE | required | forbidden | forbidden |
| LANDED_COST | required | forbidden | required > 0 |
| CATEGORY | forbidden | required | required > 0 |

Alternative — a separate category-alerts table — rejected: doubles the notification/cooldown/intent-log plumbing for no modeling gain.

### D2 — LANDED_COST watches the product-wide daily close

The reader mirrors `latestMaterializedPriceCents` but reads `landedCostCloseCents` from the newest daily bucket with `merchant IS NULL`, same 7-day freshness lookback. Close (not Min) matches the PRICE reader's semantics: the latest materialized state, not the day's best. Same threshold semantics (`observed <= threshold`), cooldown, and failure isolation.

### D3 — Landed-cost emails disclose the composition

The email states: product, observed landed cost, threshold, and the composition facts that make the number explainable — retail offer price, transport offer and route (carrier, origin → FI), excise and container-duty dataset versions, confidence, observed-at timestamp — plus "quantity=1 baseline from the materialized summary, not a live quote". Every fact comes from the observation/summary record; nothing is recomputed at send time. Plain factual wording; the content lint's advice ban applies (no "good time to buy").

### D4 — CATEGORY = minimum shelf price, deterministic tie-break

The sweep computes `MIN(priceCloseCents)` over the category's products having a daily product-wide summary within the freshness window; the email names the lowest-`productId` product among tied minima. Shelf price (not landed cost) for the category kind: it reuses the exact metric, column, and freshness semantics of the PRICE reader, and avoids per-product tax-composition disclosure inside a category-level email. The query is bounded: it runs only for active CATEGORY rows and joins on the summary table's existing (granularity, period, product) key plus the product category index.

### D5 — Accuracy breakdowns: read-time filters, floor at 10

`findAccuracyStatistic` gains split filters (category; carrier via calculation record → transport offer). Aggregation stays read-time — no new materialization. A cell with `n < 10` renders the count only (a distinct "count-only" state, not the empty state); `n = 0` renders the honest empty state; `n >= 10` renders share + count. The global statistic is unchanged. Carrier is the transport dimension rather than "method": it is what records actually carry (`transport_offer_id`).

### D6 — Display-only, pinned by compliance test

Breakdowns are a read-path addition; nothing feeds the calculator, ranking, or basket inputs. A compliance test in `tests/compliance/` pins calculator and ranking responses byte-identical with the breakdown code active (precedent: `accuracy-unitprice-input-isolation.test.ts`).

### D7 — Ships enabled, observability per kind

No feature flags. Evaluation counters gain per-kind points; `PRICE_ALERT_FAILED_THRESHOLDS` semantics extend to the two new sweeps (same warning/critical ladder). Rollback is `wrangler rollback`.

## Risks / Trade-offs

- **Category sweep cost** → bounded by active-CATEGORY-row count; indexed join; per-alert isolation means a slow category read never aborts the batch.
- **Category email storms on a feed swing** → the 24-hour delivered-row cooldown applies per alert, unchanged; a single ingest glitch triggers at most one email per alert per day.
- **Small-N cells mislead** → the floor renders counts only below 10; the type contract's null-share honesty is preserved verbatim.
- **Kind-guard complexity grows** → the ownership guard table gets exhaustive unit + D1 integration tests (PRICE/TAX_CHANGE behavior pinned unchanged).
