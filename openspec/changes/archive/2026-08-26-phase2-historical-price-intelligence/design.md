## Context

Phase 2A builds historical price intelligence on top of a working Phase 1 stack: NestJS modules in a modular monolith (`data-acquisition`, `core-domain`, `data-platform`, `application-api`, frontend), PostgreSQL with Drizzle ORM, Redis-backed BullMQ jobs, and a Next.js frontend. The landed-cost calculator, tax engines, and reliability framework are complete and tested. The time-series aggregation job is scheduled every 30 minutes but its worker is a stub.

Architecture rules that constrain this change: background jobs stay off the request path; every externally sourced fact carries a reliability status and timestamp; tax data is versioned and never overwritten; new UI behavior rolls out behind feature flags; ranking stays neutral; the disclaimer and explainability rules apply to every surfaced number.

## Goals / Non-Goals

**Goals:**
- Persist a time series per canonical product and per merchant offer covering foreign retail price, transport cost, applicable tax rate, and landed cost at each observation (T2.1).
- Serve charts from periodically materialized daily/weekly aggregates without recomputing history per request (T2.2).
- Make tax-driven price changes identifiable by joining the observation log against versioned tax-rule history (T2.3).
- Expose a historical data API endpoint for chart rendering (T2.4).
- Render historical price and landed-cost charts in the presentation layer (T2.5).

**Non-Goals:**
- Basket-level historical analysis (Phase 2B scope).
- External partner API access to historical data (Phase 2D scope, T2.14).
- Synthetic or imported backfill of history before rollout.
- Real-time (sub-hour) chart granularity.
- Alerts, notifications, or price-drop messaging (deferred with other notification features).

## Decisions

### Decision 1: Separate append-only observation table instead of extending retailOffers

**Choice**: New `price_observations` table; `retailOffers` stays as is.
**Alternatives considered**: Add transport/tax/landed columns to `retailOffers` (couples acquisition shape to analytics shape; transport and tax components are not properties of a scraped offer); derive history from `retailOffers` + `calculationRecords` on read (recomputes joins per request; calculation records are keyed by session, not by observation).
**Rationale**: The observation log is an analytical series with its own lifecycle. Keeping it separate lets the ingestion job append self-contained rows (price, transport, tax versions, landed cost, reliability snapshot) that the aggregator and attribution service consume without joins across session-scoped data.

### Decision 2: Observations recorded at price-ingestion time, quantity=1 baseline, reusing calculator engines

**Choice**: The price-ingestion background job appends one observation per changed offer, computing landed cost at quantity=1 through the same tax and transport engine code paths the calculator uses.
**Alternatives considered**: Record observations from user-facing calculations (couples history to traffic; gaps when nobody calculates; violates data-minimization by mixing session context into market data); compute landed cost lazily in the aggregation job from stored inputs (duplicates the calculation pipeline and risks divergence from calculator results).
**Rationale**: Guardrail requires this work off the request path, and the implementation plan requires optimizer/calculator consistency for the same inputs (the same principle applies here). Quantity=1 gives a stable per-unit series independent of basket composition.

### Decision 3: Single summaries table with a granularity column

**Choice**: One `price_history_summaries` table with `granularity` in ('daily', 'weekly') and a unique key on (granularity, period_start, product_id, merchant).
**Alternatives considered**: Two tables (duplicates schema and repository code); continuous aggregates via materialized views (Postgres materialized views need full refresh or triggers; incremental upsert from the worker is simpler and fits the existing job skeleton).
**Rationale**: The worker already runs every 30 minutes with a bucket payload. Incremental upsert keyed by the unique constraint makes reruns idempotent, and weekly rows can be derived from the same observation scan.

### Decision 4: Attribution as a pure function over consecutive observations plus tax-rule windows

**Choice**: `TaxChangeAttributionService` takes consecutive observations for a series plus the relevant `taxRules` effective windows and returns a classification: TAX_RULE_CHANGE (rule version boundary crossed, merchant price unchanged), MERCHANT_PRICE_CHANGE (retail price moved, rule versions unchanged), TRANSPORT_CHANGE (transport cost moved), or MIXED.
**Alternatives considered**: Store attribution on the observation row at write time (tax-rule boundaries can close retroactively when a new version is inserted with a past effectiveTo; computing at read time from immutable inputs stays correct); leave attribution to the frontend (spreads compliance-relevant logic into presentation).
**Rationale**: Rules are versioned and append-only but their windows are finalized only when a successor version lands, so attribution must remain derivable. A pure service keeps it testable and reusable by the API and charts. The guardrail that outputs must be observations with evidence (not bare legal conclusions) applies to the labels shown to users.

### Decision 5: Charts as hand-rolled SVG, no chart library

**Choice**: Pure SVG line-chart components with CSS styling.
**Alternatives considered**: Recharts or Chart.js (new runtime dependency, larger bundle, generic styling that fights the neutrality and controlled-vocabulary rules).
**Rationale**: The requirement is two line charts with markers and badges. Hand-rolled SVG avoids a dependency decision, keeps the bundle small, and gives exact control over neutral styling. No new dependency approval needed.

### Decision 6: API reads aggregates only, capped range

**Choice**: `GET /api/v1/products/:id/price-history` reads `price_history_summaries` only, caps the requested range at 365 days, defaults granularity to daily, and includes the earliest available observation date plus per-point reliability and attribution.
**Alternatives considered**: Fall back to raw observations for fine granularity (unbounded scan cost); uncapped ranges (abuse surface).
**Rationale**: Request-path cost stays bounded (indexed range read on aggregates). The rate limiter and range cap follow the existing public-endpoint pattern from the calculator API.

### Decision 7: Feature flag gates API and UI

**Choice**: `enable_historical_price_intelligence` in the existing `FeatureFlagService`/`LaunchGate` infrastructure; the controller checks it and the frontend hides charts when off.
**Alternatives considered**: Ship ungated (violates the flag rule for new user-facing data presentation and removes instant rollback).
**Rationale**: Project rule: new UI behavior and new data surfaces roll out behind flags. Default off until product review.

## Risks / Trade-offs

- **Observation volume growth**: hourly ingestion times merchants times products appends rows indefinitely. Mitigation: append-only inserts are cheap; covering indexes serve the aggregator; chart reads hit aggregates, not the log. A retention policy for raw observations can be added later without schema change.
- **No historical depth at launch**: series start at rollout. Mitigation: the API returns the earliest available date and the UI states "data available from" rather than implying a longer history.
- **Attribution ambiguity**: simultaneous merchant and tax changes classify as MIXED, which is less informative but honest. Mitigation: evidence fields (which input moved, which rule versions bound the step) ship with every attributed change.
- **Ingestion job latency increases**: each changed offer now runs a quantity=1 calculation. Mitigation: the recorder runs inside the existing worker with concurrency 1 and incremental processing; cost scales with changed offers, not with the full catalog.

## Open Questions

1. **Merchant filter scope**: should the compare-page chart show product-wide aggregates only, or per-merchant series selectors? Proposal default: API supports the merchant filter; the result view shows product-wide with per-merchant toggle.
2. **Weekly period anchor**: ISO week (Monday) or rolling 7-day from earliest observation? Proposal default: calendar-aligned ISO week, matching the daily bucket convention.
3. **Retention**: raw observations older than a threshold (for example 24 months) could be dropped once weekly aggregates exist. Decision deferred until volume data exists.
