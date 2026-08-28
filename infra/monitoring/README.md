# Monitoring — freshness alerting

Alerting rules for the freshness invariants the data-quality service
already computes, so degradation pages an operator instead of being
discovered by users (technical-assessment remediation, task 6.4;
`deployment-observability` spec: *Freshness alerting*).

## What is alerted

| Invariant | Domain staleness threshold (code) | Source of truth |
|---|---|---|
| Stale price share | price: **24 h** | `DEFAULT_STALENESS_THRESHOLDS.price` in `packages/core-domain/src/reliability/reliability.types.ts`; computed by `DataQualityService.runQualityCheck` (`staleCount / totalOffers`) after each ingestion pipeline run |
| Transport offer age | transport: **7 days** | `DEFAULT_STALENESS_THRESHOLDS.transport` (same file); age of the newest transport offer (`now - max(observedAt)` over active offers), fed by the transport-rate-refresh path |

The transport threshold is the 7-day threshold referenced in the
technical assessment: when the **newest** offer exceeds it, *every*
offer is stale and transport costs on all calculations degrade to
ESTIMATED/UNAVAILABLE.

## Alert rules and thresholds

Rules live in `infra/k8s/base/prometheusrule.yaml` (PrometheusRule CRD,
`monitoring.coreos.com/v1`), deployed into the `rajahinta` namespace by
both Kustomize overlays. Deploying requires the Prometheus Operator and
a Prometheus instance whose `ruleSelector` matches the
`release: prometheus` label on the rule object.

| Alert | Severity | Expression | `for` | Rationale |
|---|---|---|---|---|
| `RajahintaStalePriceShareWarning` | warning | `rajahinta_data_quality_stale_price_share_ratio > 0.10` | 15 m | Some staleness between hourly ingestion runs is normal; a sustained share above 10 % means ingestion is falling behind across merchants. |
| `RajahintaStalePriceShareCritical` | critical | `rajahinta_data_quality_stale_price_share_ratio > 0.25` | 15 m | A sustained share above 25 % means a broad merchant/feed outage — the reference dataset can no longer be presented as current. |
| `RajahintaTransportOfferAgeWarning` | warning | `rajahinta_transport_newest_offer_age_seconds > 432000` (5 days) | 30 m | Early warning two days before the invariant breaks, while VERIFIED offers still exist. |
| `RajahintaTransportOfferAgeCritical` | critical | `rajahinta_transport_newest_offer_age_seconds > 604800` (7 days) | 15 m | The assessment's threshold: newest offer older than 7 days ⇒ no fresh transport offers at all. |
| `RajahintaFreshnessMetricsAbsent` | warning | `absent(...)` of either gauge | 30 m | A dead or missing metric export path must page rather than silently show nothing. |

Changing a threshold is a deliberate act: update the table above and the
rule expressions in the same commit.

## Metric contract

The rules consume two gauges the backend must export on its Prometheus
`/metrics` endpoint:

```
# Share of audited retail offers whose actual recency status is STALE,
# measured against the 24 h price-domain staleness threshold.
# Updated after each ingestion pipeline quality check
# (DataQualityService.runQualityCheck → staleCount / totalOffers).
# 0 when no offers have been audited yet (gauge registered at 0).
rajahinta_data_quality_stale_price_share_ratio   # gauge, 0..1, no labels

# Age in seconds of the newest active transport offer
# (now - max(observedAt)). Updated by the transport refresh path /
# scheduler after each refresh cycle.
rajahinta_transport_newest_offer_age_seconds     # gauge, seconds, no labels
```

Optional (recommended for debugging, not required by the rules):
`rajahinta_data_quality_offers_total{status="verified|stale|estimated|unavailable"}`
counters from the same quality report, letting the share be derived
independently in PromQL.

## Metric exposure gap (application-side, outstanding)

Today these invariants are **computed but not exported**:

- `DataQualityService.runQualityCheck` returns counts that are only
  written to the NestJS logger — nothing feeds `KpiService`/
  `InstrumentationService`, and there is no Prometheus `/metrics`
  endpoint anywhere in the repo (`prom-client` is not a dependency).
- `InstrumentationService` already has suitable semantic hooks
  (`recordStaleness(source, lagMs)`, `recordFreshnessCheck`) but they
  write to the in-memory `KpiService` buffer flushed as `[KPI]` log
  lines — not scrapeable.

**Required application-side work (owned by the lead / platform
engineer, out of infra scope):**

1. Add `prom-client` and expose `/metrics` on the backend (internal port
   or the ops-auth path per the authenticated-ops-dashboard work).
2. After each `runQualityCheck`, set
   `rajahinta_data_quality_stale_price_share_ratio` from the report
   (`staleCount / totalOffers`, 0 when `totalOffers === 0`).
3. After each transport-rate refresh (and/or on a schedule), set
   `rajahinta_transport_newest_offer_age_seconds` from
   `now - max(observedAt)` over active transport offers.
4. Wire a ServiceMonitor (or static scrape job) for the endpoint.

Until (1)–(3) land, `RajahintaFreshnessMetricsAbsent` will fire by
design — it is the canary for exactly this gap. Deploy the rules
together with the export work, or expect that one warning alert.

## Neutrality

Nothing in this alerting path influences ranking, merchant scoring, or
sort order. The metrics are operational freshness signals only, per the
project's neutrality constraint.
