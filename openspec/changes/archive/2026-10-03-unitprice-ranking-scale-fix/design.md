# Design: unitprice-ranking-scale-fix

## Context

The ranking endpoint's documented fetch-then-shape design
("Phase 1 adds no new SQL surface") reused the search listing and swept
offers per product. That scoping decision assumed the sweep was bounded;
bounded is not fast: the sweep is O(products-in-category) sequential D1
round-trips over an offers table that grows every day. This change
deliberately revisits that decision — the exploration measured the
candidate JOIN at 3,517 rows for the largest category, small enough for
one query.

## Decisions

### D1 — Acquisition collapses to one repository call; the pure pipeline is untouched

`eurPerGram`, `rankUnitPrices`, the reliability gating
(`toReliabilityStatus`), and pack-from-name parsing (`parsePackUnits`)
stay byte-identical. The route maps the candidate rows into
`UnitPriceRankingEntry`s exactly as before — only where the rows come
from changes. Rationale: `unit-price-metrics` pins the metric as a
read-time pure derivation using the same parser as the search embeds;
pushing the metric into SQL would duplicate the parser or force
persistence (both spec violations) for no need.

### D2 — Latest-per-(product, merchant) dedup mirrors findOffers exactly

`findOffers` documents the recency rule: `retail_offers` is
append-per-scrape, so the latest observation per (product, merchant) is
`MAX(id)` per group. The new method uses the identical rule as a SQL
subquery (`GROUP BY product_id, merchant` over category-scoped product
ids, joined back on `id`). Same semantics, one query. Products without
offers simply have no candidate rows — the same omission the per-product
sweep produced, and `rankUnitPrices` drops them identically.

### D3 — Defensive row cap replaces RANKING_MAX_PRODUCTS

The handler-side `RANKING_MAX_PRODUCTS = 10_000` becomes a SQL `LIMIT`
on candidate rows (20_000 — candidates are latest-per-merchant offers,
~1.04 per product today, so the largest category yields ~3.5k). The cap
is defensive only; if it ever binds, ranking completeness (which products
appear) degrades, never correctness (the pure policy still orders
whatever it receives). Documented in the repository method.

### D4 — Index (product_id, merchant, id) on retail_offers

Migration 0025 (`CREATE INDEX IF NOT EXISTS`, 0023 file format). The
tail `id` column lets SQLite resolve `MAX(id)` per
`(product_id, merchant)` group from the index alone. Without the index
the dedup aggregate scans 96k+ rows (growing daily); with it, a seek per
category query. Applies through the standard gated deploy job — no
backfill, online D1 index creation.

### D5 — Regression pin at test level, not spec level

The spec has no latency clause, and none is added: behavior is
unchanged. The pin that would have caught this defect is structural: a
route test asserting the handler makes a **bounded number of repository
calls (≤ 2)** for a multi-product category fixture. If anyone reintroduces
a per-product sweep, the pin fails.

### D6 — No response caching

The route keeps its per-request contract (parity with products/detail;
the shared-cache pattern stays on ISR pages only). With D1+D4 the live
computation answers in a few hundred milliseconds; caching would add an
age-gate interplay question for no measured need.

### D7 — Client fetch timeout routes into the existing error state

`ValueRanking` already has loading, error-with-retry, and empty states;
the defect was only that a dead backend left the fetch pending ~100 s.
A 10 s `AbortSignal.timeout` on the ranking fetch makes failure visible
in seconds. The timeout rides the existing fetch init (extend the shared
`request()` helper with an init passthrough only if it lacks one);
component test asserts the error state surfaces on a timed-out fetch.

## Non-goals

- No cron-materialized ranking table (revisit only if the live JOIN
  ever becomes slow — it is ~100× away from that).
- No orphan-offer auto-cleanup (owner-gated artifact only, task 3.2).
- No response-shape or ordering changes of any kind.
