# Workers Analytics Engine metrics (task 6.1, design D8)

The prom-client exporter (`/metrics` on an internal port,
`packages/application-api/src/observability/metrics.service.ts`) is
replaced by a Workers Analytics Engine dataset written via
`writeDataPoint`. Emission lives in `src/observability/metrics.ts`; the
binding is `env.METRICS` (optional — no-op without it), one dataset per
environment (design D9):

| Environment | Dataset |
|---|---|
| (top-level / dev) | `rajahinta-api-metrics-dev` |
| staging | `rajahinta-api-metrics-staging` |
| production | `rajahinta-api-metrics-production` |

## Data point shapes

Two shapes share the dataset; the AE index (always `index1`) separates
request counters from gauge observations.

### Request counter — one per completed HTTP request

Emitted by the `requestMetrics` middleware (registered outermost, so the
final status after `onError`/error-boundary is counted).

| AE column | Content | Example |
|---|---|---|
| `index1` | Route pattern bucket (`c.req.routePath`), or `unmatched` when no route matched | `/api/v1/products/:id/price-history` |
| `blob1` | HTTP method | `GET` |
| `blob2` | Status class (`2xx`/`3xx`/`4xx`/`5xx`) | `4xx` |
| `blob3` | Exact status code | `404` |
| `double1` | Duration (ms) | `12.34` |

The route pattern is the same low-cardinality source the logging
middleware uses; unmatched requests never fall back to the raw path (the
AE index is a grouping dimension — raw 404 paths would explode
cardinality).

### Freshness gauge — one discrete write per observation

Emitted by the task-4.3 cron handlers via
`recordStalePriceShare` / `recordTransportAge`. Metric names preserve the
Prometheus contract (dashboards/alerts referenced them).

| AE column | Content | Example |
|---|---|---|
| `index1` | Gauge name | `rajahinta_transport_newest_offer_age_seconds` |
| `blob1` | Gauge name (self-describing) | same |
| `blob2` | Value as rendered (faithful text) | `7200`, `+Inf` |
| `blob3` | Labels as JSON | `{"carrier":"*"}` |
| `double1` | Numeric value (aggregatable) | `7200` |

Gauges and their producers:

- `rajahinta_data_quality_stale_price_share_ratio` — share of the
  aggregation scan's audited observation records with overall reliability
  `STALE` (written by the 30-minute aggregation cron; `0` when nothing
  audited — the Prometheus "renders 0" canary contract).
- `rajahinta_transport_newest_offer_age_seconds` — age of the newest
  active transport offer (written by the 6-hourly transport-rate refresh
  cron; no offers at all → `blob2 = "+Inf"`,
  `double1 = 9007199254740991` (`Number.MAX_SAFE_INTEGER`, the documented
  +Inf sentinel — AE doubles cannot carry Infinity, and the sentinel
  keeps `> threshold` / `max()` alert semantics firing)).
- `rajahinta_history_summary_coverage_ratio` — share of the aggregation
  window's products with observations that have `daily` summary buckets
  (written by the 30-minute aggregation cron AFTER its writes; design D4
  of watermark-isolation-history-backfill — "coverage measured where the
  gap is produced"). Measured over the same D1 pair the backfill script's
  coverage query uses: `retail_offers` rows as the observations,
  `price_history_summaries` daily buckets at/after the window's floor
  day (the pass's ISO-week Monday). A window with no products-with-
  observations has no defined ratio: the point is still written, encoded
  with the +Inf sentinel (`blob2 = "+Inf"`, `double1 = 9007199254740991`)
  — an empty window is vacuously complete, never a gap, so a
  below-threshold coverage alert must not fire on it (see "Querying").
  Chunked convergence (aggregation-cursor-chunking): during the INITIAL
  backfill the pass has no watermark yet, so both counts run unbounded —
  the ratio is the global share of ALL products with observations that
  have buckets — and it climbs tick over tick as cursor chunks land (the
  pass emits after each tick's chunk writes; a quiet tick still emits).
  `RajahintaHistorySummaryCoverageBelowInvariant` therefore fires BY
  DESIGN for the whole convergence window — the invariant IS unmet;
  silence it for the window per the runbook (§7) and expect it to clear
  when the coverage check answers zero. A ratio that stops climbing
  tick over tick after the chunked deploy is the regression signal the
  alert exists for.

### Price-alert job counters — one discrete write per counter per kind per run

Emitted once per alert kind by the 30-min price-alert-evaluation cron
handler (task 2.2, design R2; per-kind attribution task 6.1, design D7)
via `recordPriceAlertEvaluationCounters`, using the same data point
shape as the freshness gauges. The handler sweeps ALL active alerts in
one run, but its counters are kept per kind: the run writes one
five-point set per alert kind present in the sweep (a kind whose rows
entered the sweep), and `blob3` carries that kind as the AE label
(`{"kind":"PRICE"}`, `{"kind":"LANDED_COST"}`, `{"kind":"CATEGORY"}`),
so summing `double1 * _sample_interval` over a window — per kind or
across kinds — gives the running totals (Prometheus `_total`
namesakes):

| `index1` / `blob1` | Meaning |
|---|---|
| `rajahinta_price_alerts_evaluated_total` | Alerts compared against a materialized price |
| `rajahinta_price_alerts_matched_total` | Alerts whose observed price met the threshold (`<=`) |
| `rajahinta_price_alerts_notified_total` | Emails dispatched successfully |
| `rajahinta_price_alerts_failed_total` | Failed pipelines (dispatch, intent write, unresolvable recipient) |
| `rajahinta_price_alerts_cooldown_suppressed_total` | Matched but withheld by the 24-hour delivered-row cooldown (the spec requires suppression be visible in the job's counters) |

Attribution posture (task 6.1, design D7):

- A kind present in the sweep is never omitted: a kind whose alerts all
  skipped (stale summaries, unretrievable composition) still writes its
  five points with the honest zeros it recorded — under its kind label.
- A kind absent from the sweep (no active rows of that kind) gets no
  fabricated point-set.
- TAX_CHANGE rows are never counted here — they skip to the
  tax-change-alert-evaluation handler, whose own runs own that kind's
  counters.
- A sweep with no threshold-kind row at all (empty active set, or
  TAX_CHANGE-only) writes one label-less (`blob3 = "{}"`) zero-valued
  set: the run's heartbeat, so `evaluated = 0` across a window keeps
  meaning "the cron stopped producing points" rather than "no rows
  happened to exist".

Notified tracks matched minus suppressed and failed within each kind
(the per-alert pipeline increments exactly one kind's counters); cross-
kind divergence is the first forensics question. The dashboard panels
for these counters are under "Querying" below (task 10.2); the
failure-count warning/critical thresholds live in
`src/observability/price-alert-thresholds.ts`
(`PRICE_ALERT_FAILED_THRESHOLDS`) — the ladder itself stays run-wide
(the violated count is the per-run aggregate), while attribution of a
breach lives on the failed point's kind label.

### Data-quality gauges — one per run / per carrier / per feed (task 4.1)

Emitted via `src/observability/data-quality.ts` (task 4.1, change
data-quality-and-publication-trust) using the same data point shape as
the freshness gauges. The five names are the dashboard panels'
contract — imported into Grafana Cloud from `infra/grafana/`
(data-quality-dashboard.json + data-quality-alerts.yaml; import steps
in infra/README.md, "Data-quality panel"). Stable write order: coverage,
transport rows (carriers ascending), feed ages (merchants ascending).

| `index1` / `blob1` | Shape | Labels (`blob3`) | Producer |
|---|---|---|---|
| `rajahinta_data_quality_zero_price_rejections_total` | Per-run count — sum `double1 * _sample_interval` over a window for the running total (price-alert-counter semantics) | `{"merchant":"<id>"}` when the run's merchant is stamped | The ingestion run seam (`recordZeroPriceRejections`), counting the mapper price-floor gate's "price drift" rejections in the run report's error channel (`zeroPriceRejectionsOf`) |
| `rajahinta_data_quality_implausible_volume_share_ratio` | Latest-observation ratio 0..1, "renders 0 when nothing audited" | — | The quality-report hook contract: `dataQualityReportGaugeHook(env)` registered via `DataQualityService.setQualityReportHook`, or `recordImplausibleVolumeShare` at the run seam. Byte-parity with the wave-1 `IMPLAUSIBLE_VOLUME_SHARE_METRIC` in packages/data-acquisition (parity pinned by test) |
| `rajahinta_data_quality_alko_reference_coverage_ratio` | Latest-observation ratio 0..1 — products with a usable Alko reference (offer row + observation instant, the savings-snapshot qualification predicate) over all `product_master` rows | — | `measureAndRecordDataQualityGauges` on the 30-min tick (`measureAlkoReferenceCoverage`) |
| `rajahinta_transport_offer_rows` | Latest-observation count per carrier — rows in the append-only `transport_offers` table | `{"carrier":"<id>"}` | `measureAndRecordDataQualityGauges`; expected curated carriers (fransberg, posti) are written as honest 0s when their table carries no rows — the panel shows zero, never absence |
| `rajahinta_feed_last_success_age_seconds` | Latest-observation age in seconds per registry feed — newest `retail_offers.observed_at` per merchant with a non-empty `feed_url` (every successful ingestion stamps fresh observedAt instants) | `{"merchant":"<id>"}` | `measureAndRecordDataQualityGauges`; a feed that has never published an offer writes the `+Inf` sentinel (`double1 = 9007199254740991`, `blob2 = "+Inf"` — the transport-age contract), so `> threshold` alert semantics fire unchanged |

Threshold alerts over these names are Grafana-managed rules
(`infra/grafana/data-quality-alerts.yaml`, routing via infra/README.md).
They are the data-quality paging layer; the freshness invariants stay
with the in-Worker task-6.3 checker (see "Alerting note" below).

## Querying — the Grafana re-point (task 6.5)

AE SQL API (used by the Grafana Cloudflare/JSON data source or plain
`curl`):

```bash
curl -X POST \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/analytics_engine/sql?dataset=rajahinta-api-metrics-production" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: text/plain" \
  --data "SELECT ..." # the queries below
```

AE samples writes: weight every count by `_sample_interval`. Percentiles
use `quantileExactWeighted(q)(double1, _sample_interval)`.

### Old: request rate by route (PromQL `sum by (path) (rate(api_request_count_total[5m]))`)

```sql
SELECT index1 AS route,
       blob2 AS status_class,
       sum(_sample_interval) AS requests,
       count() AS sampled_rows
FROM rajahinta-api-metrics-production
WHERE timestamp > NOW() - INTERVAL '1' HOUR
GROUP BY route, status_class
ORDER BY requests DESC
```

Time series (Grafana panel): the SQL API returns `timestamp` per row —
query a bounded window (`WHERE timestamp > … AND timestamp < …`) and let
Grafana bucket the rows into steps; there is no server-side interval
bucketing statement in AE SQL.

### Old: request duration p95 (PromQL `histogram_quantile(0.95, …)`)

```sql
SELECT index1 AS route,
       quantileExactWeighted(0.95)(double1, _sample_interval) AS p95_ms,
       avg(double1) AS avg_ms
FROM rajahinta-api-metrics-production
WHERE timestamp > NOW() - INTERVAL '1' HOUR
GROUP BY route
ORDER BY p95_ms DESC
```

### Old: stale-price-share (`rajahinta_data_quality_stale_price_share_ratio`)

Gauges are discrete points — take the latest observation in the window:

```sql
SELECT timestamp,
       blob2 AS rendered_value,
       double1 AS stale_price_share
FROM rajahinta-api-metrics-production
WHERE index1 = 'rajahinta_data_quality_stale_price_share_ratio'
  AND timestamp > NOW() - INTERVAL '1' DAY
ORDER BY timestamp DESC
LIMIT 1
```

### Old: transport newest-offer age (`rajahinta_transport_newest_offer_age_seconds`)

Latest observation; the +Inf sentinel (`double1 = 9007199254740991`,
`blob2 = '+Inf'`) means "no transport offers exist" — alert semantics
(`> 7d`) fire on it unchanged:

```sql
SELECT timestamp,
       blob2 AS rendered_value,
       double1 AS age_seconds
FROM rajahinta-api-metrics-production
WHERE index1 = 'rajahinta_transport_newest_offer_age_seconds'
  AND timestamp > NOW() - INTERVAL '1' DAY
ORDER BY timestamp DESC
LIMIT 1
```

### Summary-coverage ratio (`rajahinta_history_summary_coverage_ratio`)

One point per aggregation pass (design D4,
watermark-isolation-history-backfill), written after the pass's writes —
a 30-minute window holds exactly one, so "latest in window" is a
bounded-window read like the freshness gauges:

```sql
SELECT timestamp,
       blob2 AS rendered_value,
       double1 AS summary_coverage
FROM rajahinta-api-metrics-production
WHERE index1 = 'rajahinta_history_summary_coverage_ratio'
  AND timestamp > NOW() - INTERVAL '30' MINUTE
ORDER BY timestamp DESC
LIMIT 1
```

Zero-denominator encoding (documented decision): a window with zero
products-with-observations writes the +Inf sentinel
(`double1 = 9007199254740991`, `blob2 = '+Inf'`). It means "0/0 —
nothing to summarize", NOT "0% covered": the coverage alert (task 1.6)
fires on `double1 < threshold`, so the sentinel keeps a quiet window
silent, while a real drift (a ratio strictly below 1 measured over a
window WITH observations) persists tick over tick and trips it. A ratio
above 1 is written unclamped — summarized products without matching
observations is a drift signal in the other direction, rendered as-is.

### Data-quality gauges (task 4.1) — latest per label

The cadence gauges (coverage, transport rows, feed ages) are
latest-observation points like the freshness gauges, written once per
label per 30-min tick — so a one-tick window holds exactly one point
per label, and "latest per label" is a bounded-window read. Per-carrier
row counts (the Grafana panel):

```sql
SELECT JSONExtractString(blob3, 'carrier') AS carrier,
       double1 AS row_count
FROM rajahinta-api-metrics-production
WHERE index1 = 'rajahinta_transport_offer_rows'
  AND timestamp > NOW() - INTERVAL '30' MINUTE
ORDER BY carrier
```

Per-feed last-success age, latest per merchant (the `+Inf` sentinel
`9007199254740991` breaches every age threshold unchanged):

```sql
SELECT JSONExtractString(blob3, 'merchant') AS merchant,
       double1 AS age_seconds
FROM rajahinta-api-metrics-production
WHERE index1 = 'rajahinta_feed_last_success_age_seconds'
  AND timestamp > NOW() - INTERVAL '30' MINUTE
ORDER BY merchant
```

Zero-price rejections are per-run counts — sum over the window
(`_sample_interval`-weighted, price-alert counter semantics), per
merchant when the run stamped its label:

```sql
SELECT JSONExtractString(blob3, 'merchant') AS merchant,
       sum(double1 * _sample_interval) AS rejections
FROM rajahinta-api-metrics-production
WHERE index1 = 'rajahinta_data_quality_zero_price_rejections_total'
  AND timestamp > NOW() - INTERVAL '1' DAY
GROUP BY merchant
ORDER BY merchant
```

The ratio gauges (implausible-volume share, Alko reference coverage)
read like the stale-price-share query above with their own `index1`.
The Grafana panels + threshold alerts over all five names are committed
under `infra/grafana/` (import steps in infra/README.md).

### Price-alert job counters (task 10.2 panel)

Unlike the freshness gauges these are per-run counts, not latest-value
observations — sum them over the window (weighted by `_sample_interval`)
for the running totals. Per-kind points (task 6.1, design D7) share the
counter names, so the aggregate query is unchanged; the kindless
heartbeat rows of an empty sweep extract no kind:

```sql
SELECT index1 AS counter,
       sum(double1 * _sample_interval) AS total
FROM rajahinta-api-metrics-production
WHERE index1 LIKE 'rajahinta_price_alerts_%'
  AND timestamp > NOW() - INTERVAL '1' DAY
GROUP BY counter
ORDER BY counter
```

Per-kind breakdown — attribute the totals to the sweep kinds:

```sql
SELECT index1 AS counter,
       JSONExtractString(blob3, 'kind') AS kind,
       sum(double1 * _sample_interval) AS total
FROM rajahinta-api-metrics-production
WHERE index1 LIKE 'rajahinta_price_alerts_%'
  AND timestamp > NOW() - INTERVAL '1' DAY
GROUP BY counter, kind
ORDER BY counter, kind
```

Per-run time series (Grafana buckets the rows, same as above) — panel
for the failure gauge, attributed per kind:

```sql
SELECT timestamp,
       JSONExtractString(blob3, 'kind') AS kind,
       double1 * _sample_interval AS failed
FROM rajahinta-api-metrics-production
WHERE index1 = 'rajahinta_price_alerts_failed_total'
  AND timestamp > NOW() - INTERVAL '1' DAY
ORDER BY timestamp
```

Panel threshold steps mirror the in-code pair exactly
(`PRICE_ALERT_FAILED_THRESHOLDS` in
`src/observability/price-alert-thresholds.ts`, strict `>`):
`warning` above 0 failed pipelines in a run, `critical` above 9
(≥ 10 — systemic email-Worker/D1 breakage rather than a one-off bad
recipient). The ladder is run-wide; the failed point's `kind` label is
what attributes a breach to its sweep kind. `evaluated = 0` across a
whole window is itself a canary: the 30-min cron stopped producing
points (an empty sweep still writes its label-less zero-valued
heartbeat, so absent points — not zero-valued ones — mean a stopped
cron).

### Error rate by status class

```sql
SELECT blob2 AS status_class,
       sum(_sample_interval) AS requests
FROM rajahinta-api-metrics-production
WHERE timestamp > NOW() - INTERVAL '1' HOUR
GROUP BY status_class
```

## Client funnel events — Grafana Faro RUM (task 1.5)

The frontend emits four funnel events through the Grafana Faro Web SDK
(`pushEvent`). They are client-side RUM signals: not part of the AE
dataset above and never queryable from it. Emission lives in
`apps/frontend/src/lib/telemetry/` (`funnel-events.ts`,
`time-to-result.ts`, `faro-init.ts`); the emit points are the calculator
view, the basket view, and the alerts page.

Initialization is gated on build-time `NEXT_PUBLIC_FARO_URL` — unset,
the emitters are complete no-ops, the client twin of the optional
`METRICS` binding above. An init failure degrades the same way
(telemetry never takes a page down).

The events are identity-free and session-scoped (the funnel-evidence
proposal's D1/D2 data-posture decisions): the collector sees Faro's
anonymous session id only, and the output is observability, never a
calculation or ranking input. Emitters skip Faro's dedupe deliberately —
attribute-free repeats (a second calculation, a second alert) are
distinct completions, not duplicates. The server-side outbound-click
counter remains the authoritative action-completion signal; the funnel
events answer the visitor-side journey the worker cannot see.

### Event dictionary

| Event | Trigger point | Attributes | What it answers |
|---|---|---|---|
| `calc_started` | Calculator submit (`calculator-view.tsx`; the direct path and the scenario-load re-submit both emit) | none | how many calculations begin |
| `calc_result_seen` | Calculation result rendered — post-commit effect, so the event marks a result the visitor can actually see | `durationMs` — client time-to-result from submit, present only when a prior submit started the clock; a result without one emits bare rather than fabricating a duration | how long visitors wait to see the result |
| `basket_optimized` | Optimization result rendered (`basket-view.tsx`; failed optimizations never reach the effect) | none | how many basket optimizations complete |
| `alert_set` | Alerts POST success response (`account/alerts/page.tsx`) — the 409/404/error paths never count | deliberately none — form contents excluded | how many alert subscriptions complete |

### Querying — Faro logs in Grafana (task 1.5)

Faro events surface in Grafana as Faro logs (Loki data source): one JSON
log line per event with `kind="events"`, the event name in
`event_name`, its attributes flattened under `event_attributes_*`, and
Faro's anonymous `session_id` alongside (schema per the Grafana Cloud
Faro logs pipeline). Stream labels match the SDK init
(`app_name="rajahinta-frontend"`; `environment` is `production` for
production builds, `development` otherwise).

Funnel conversion across the four events — per-event counts; the ratio
of consecutive steps is the cohort-level conversion (the events carry no
identity, so there is no per-user funnel by design):

```logql
sum by (event_name) (
  count_over_time({app_name="rajahinta-frontend", environment="production"}
    | json
    | kind="events"
    | event_name=~"calc_started|calc_result_seen|basket_optimized|alert_set"
    [24h])
)
```

Client time-to-result distribution — p50 and p95 of `durationMs`; the
`!= ""` filter drops the bare events emitted without a clock. Durations
are whole milliseconds from `performance.now()` (monotonic, comparable
across devices); they include network and render wait, so they are not
comparable to the AE request-duration p95 above — server-side latency
stays in AE.

```logql
quantile_over_time(0.50,
  {app_name="rajahinta-frontend", environment="production"}
    | json
    | kind="events"
    | event_name="calc_result_seen"
    | event_attributes_durationMs != ""
    | unwrap event_attributes_durationMs
  [24h])
```

```logql
quantile_over_time(0.95,
  {app_name="rajahinta-frontend", environment="production"}
    | json
    | kind="events"
    | event_name="calc_result_seen"
    | event_attributes_durationMs != ""
    | unwrap event_attributes_durationMs
  [24h])
```

Repeat-usage cohort — sessions that emitted at least one funnel event in
the window, counted from the anonymous session id. Run it over a
multi-day range at 1-day steps: each point is the sessions active that
day, and a session series spanning more than one day bucket is a
returning session. LogQL has no distinct-days-per-session function, so
the day-bucketed panel is the signal (cohort-level by design — there is
no identity to join on):

```logql
count(
  sum by (session_id) (
    count_over_time({app_name="rajahinta-frontend", environment="production"}
      | json
      | kind="events"
      | event_name=~"calc_started|calc_result_seen|basket_optimized|alert_set"
      [24h])
  )
)
```

## Alerting note (design D8)

PrometheusRule paging does not carry over: freshness invariants are
checked by the Cron alert checker → email Worker (task 6.3). The AE
gauges above are the dashboard/forensics view; the cron checker computes
from D1 directly and must not scrape AE.
