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

### Error rate by status class

```sql
SELECT blob2 AS status_class,
       sum(_sample_interval) AS requests
FROM rajahinta-api-metrics-production
WHERE timestamp > NOW() - INTERVAL '1' HOUR
GROUP BY status_class
```

## Alerting note (design D8)

PrometheusRule paging does not carry over: freshness invariants are
checked by the Cron alert checker → email Worker (task 6.3). The AE
gauges above are the dashboard/forensics view; the cron checker computes
from D1 directly and must not scrape AE.
