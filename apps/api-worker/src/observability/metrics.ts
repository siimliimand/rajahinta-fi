/**
 * Analytics Engine metrics (task 6.1, design D8) — the Workers
 * replacement for the prom-client exporter in
 * packages/application-api/src/observability/metrics.service.ts:
 *
 * - request counters by route pattern + status class, emitted by the
 *   `requestMetrics` middleware (one `writeDataPoint` per completed
 *   request, final status read after the error boundary finalizes —
 *   pino 'finish' semantics, same placement as request-id.ts);
 * - freshness gauges (stale price share, transport newest-offer age),
 *   written as discrete data points by the task-4.3 cron handlers via
 *   `recordStalePriceShare` / `recordTransportAge`;
 * - price-alert evaluation job counters (evaluated / matched / notified
 *   / failed / cooldown-suppressed), one discrete point per counter per
 *   run, written by the task-2.2 cron handler via
 *   `recordPriceAlertEvaluationCounters` (dashboard wiring: task 10.2).
 *
 * Metric names are load-bearing: they match the Prometheus namesakes the
 * dashboards queried (infra/monitoring). The Grafana re-point queries —
 * old PromQL → Analytics Engine SQL — live in src/observability/METRICS.md.
 *
 * ## Data point shapes (Analytics Engine column mapping)
 *
 * Request counter (one per completed request):
 *   index1  = route pattern bucket (low cardinality; 'unmatched' when no
 *             route matched — never the raw path, the index is a grouping
 *             dimension and raw paths explode cardinality)
 *   blob1   = HTTP method
 *   blob2   = status class ("2xx" | "3xx" | "4xx" | "5xx"; the statusGroup
 *             shape InstrumentationService.recordApiCall used)
 *   blob3   = exact status code (string; bounded set, drill-down only)
 *   double1 = duration in milliseconds
 *
 * Discrete gauge write (one per gauge observation):
 *   index1  = gauge name (the grouping dimension)
 *   blob1   = gauge name (self-describing blobs per AE convention)
 *   blob2   = value as rendered ("0.25", "7200", "+Inf" — faithful text,
 *             including the +Inf case AE doubles cannot carry)
 *   blob3   = labels as JSON ("{}" when none)
 *   double1 = numeric value (aggregatable; +Inf encoded as
 *             {@link TRANSPORT_AGE_INFINITE})
 *
 * The METRICS binding is optional by design (per-env wrangler binding;
 * dev/local runs without it): with no binding every emitter is a no-op.
 * Emission is additionally best-effort — a writeDataPoint throw is
 * swallowed; metrics must never take a request or a cron tick down.
 *
 * @module AnalyticsEngineMetrics
 */

import type { Context } from 'hono';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv, Env } from '../env';

/** Stale-price-share gauge — Prometheus contract name preserved. */
export const STALE_PRICE_SHARE_GAUGE =
  'rajahinta_data_quality_stale_price_share_ratio';

/** Transport newest-offer age gauge — Prometheus contract name preserved. */
export const TRANSPORT_NEWEST_OFFER_AGE_GAUGE =
  'rajahinta_transport_newest_offer_age_seconds';

/**
 * +Inf encoding for gauge doubles. AE doubles are JSON numbers — Infinity
 * cannot be written. The sentinel is far above any real age (seconds) so
 * `max(double1)` and `> threshold` alert semantics keep firing, while
 * blob2 carries the faithful "+Inf" text for humans.
 */
export const TRANSPORT_AGE_INFINITE = Number.MAX_SAFE_INTEGER;

/** Status class of an HTTP status — InstrumentationService statusGroup parity. */
export function statusClassOf(status: number): string {
  return `${Math.floor(status / 100)}xx`;
}

/** One completed request's counter input. */
export interface RequestMetricInput {
  /** Route pattern bucket (low cardinality) — never the raw path. */
  readonly routePattern: string;
  readonly method: string;
  readonly status: number;
  readonly durationMs: number;
}

/** One gauge observation's input. */
export interface GaugeMetricInput {
  /** Gauge name (the Prometheus-contract name). */
  readonly name: string;
  /** Numeric value; use {@link TRANSPORT_AGE_INFINITE} for +Inf. */
  readonly value: number;
  /** Faithful value text; defaults to String(value). */
  readonly valueLabel?: string;
  /** Discrete labels; defaults to none. */
  readonly labels?: Record<string, string>;
}

/** The metrics write surface — real (METRICS bound) or no-op. */
export interface MetricsEmitter {
  /** False when no METRICS binding is present (dev/local). */
  readonly enabled: boolean;
  recordRequest(input: RequestMetricInput): void;
  recordGauge(input: GaugeMetricInput): void;
}

/** Best-effort write — an AE failure must never propagate to the caller. */
function writePoint(
  dataset: AnalyticsEngineDataset,
  point: AnalyticsEngineDataPoint,
): void {
  try {
    dataset.writeDataPoint(point);
  } catch {
    // metrics are best-effort
  }
}

/** The shared no-op emitter (no METRICS binding). */
const NOOP_EMITTER: MetricsEmitter = {
  enabled: false,
  recordRequest: () => {},
  recordGauge: () => {},
};

/**
 * Emitter factory. Accepts a possibly-undefined env (tests issue
 * `app.request(path)` without one) and tolerates the binding's absence:
 * without METRICS everything is a safe no-op.
 */
export function metricsEmitter(
  env: Pick<Env, 'METRICS'> | undefined,
): MetricsEmitter {
  const dataset = env?.METRICS;
  if (!dataset) return NOOP_EMITTER;
  return {
    enabled: true,
    recordRequest(input: RequestMetricInput): void {
      writePoint(dataset, {
        indexes: [input.routePattern],
        blobs: [
          input.method,
          statusClassOf(input.status),
          String(input.status),
        ],
        doubles: [input.durationMs],
      });
    },
    recordGauge(input: GaugeMetricInput): void {
      writePoint(dataset, {
        indexes: [input.name],
        blobs: [
          input.name,
          input.valueLabel ?? String(input.value),
          JSON.stringify(input.labels ?? {}),
        ],
        doubles: [input.value],
      });
    },
  };
}

/**
 * Route pattern bucket for the AE index — SAME source as the logging
 * middleware (c.req.routePath, middleware/request-id.ts), with one
 * deliberate divergence: an unmatched request never reaches the index as
 * its raw path. Hono reports the wildcard pattern ('/*' — the middleware
 * registration itself) for unmatched requests; that wildcard, any '*' /
 * empty pattern, and thrown lookups all collapse to the constant
 * 'unmatched' bucket. Logs can afford per-path fidelity; the AE index is
 * a grouping dimension and raw 404 paths would explode cardinality.
 */
export function routeBucket(c: Context<AppEnv>): string {
  try {
    const pattern = c.req.routePath;
    if (pattern && pattern !== '/*' && pattern !== '*') return pattern;
  } catch {
    // no matched route — fall through to the constant bucket
  }
  return 'unmatched';
}

/**
 * Request-metrics middleware (design D8). Register FIRST (alongside the
 * logging middleware, outside the error boundary) so the final status is
 * read after onError/error-boundary finalize — error responses are
 * counted exactly like successful ones.
 */
export function requestMetrics(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const start = performance.now();
    try {
      await next();
    } finally {
      try {
        const durationMs =
          Math.round((performance.now() - start) * 100) / 100;
        metricsEmitter(c.env).recordRequest({
          routePattern: routeBucket(c),
          method: c.req.method,
          status: c.res.status,
          durationMs,
        });
      } catch {
        // metrics are best-effort — never destroy a produced response
      }
    }
  };
}

/**
 * Price-alert evaluation job counters (task 2.2, design R2) — written
 * once per run by the 30-min price-alert-evaluation cron handler, one
 * discrete point per counter. `double1` carries the per-run count, so
 * `sum(double1 * _sample_interval)` over a window is the running total
 * (the Prometheus `_total` namesake); the cooldown-suppressed counter
 * makes rate-limit suppression visible in the job's counters (spec:
 * notification rate limit). Task 10.2 completes the observability
 * picture around these points: the failure-gauge threshold pair lives
 * in `price-alert-thresholds.ts` and the dashboard panels (AE SQL) in
 * METRICS.md, "Price-alert job counters".
 */
export const PRICE_ALERT_EVALUATED_COUNTER =
  'rajahinta_price_alerts_evaluated_total';
export const PRICE_ALERT_MATCHED_COUNTER =
  'rajahinta_price_alerts_matched_total';
export const PRICE_ALERT_NOTIFIED_COUNTER =
  'rajahinta_price_alerts_notified_total';
export const PRICE_ALERT_FAILED_COUNTER =
  'rajahinta_price_alerts_failed_total';
export const PRICE_ALERT_SUPPRESSED_COUNTER =
  'rajahinta_price_alerts_cooldown_suppressed_total';

/** One evaluation run's counters, in export order. */
export interface PriceAlertEvaluationCounters {
  /** Alerts compared against a materialized price. */
  readonly evaluated: number;
  /** Alerts whose observed price met the threshold (`<=`). */
  readonly matched: number;
  /** Emails dispatched successfully. */
  readonly notified: number;
  /** Failed pipelines (dispatch, intent write, unresolvable recipient). */
  readonly failed: number;
  /** Matched but withheld by the 24-hour delivered-row cooldown. */
  readonly suppressed: number;
}

/** Per-run counter order — stable for dashboard queries. */
const PRICE_ALERT_COUNTER_POINTS: readonly (keyof PriceAlertEvaluationCounters)[] = [
  'evaluated',
  'matched',
  'notified',
  'failed',
  'suppressed',
];

const PRICE_ALERT_COUNTER_NAMES: Record<
  keyof PriceAlertEvaluationCounters,
  string
> = {
  evaluated: PRICE_ALERT_EVALUATED_COUNTER,
  matched: PRICE_ALERT_MATCHED_COUNTER,
  notified: PRICE_ALERT_NOTIFIED_COUNTER,
  failed: PRICE_ALERT_FAILED_COUNTER,
  suppressed: PRICE_ALERT_SUPPRESSED_COUNTER,
};

/**
 * Export one run's price-alert counters — one discrete data point per
 * counter, same gauge write path as the freshness metrics (no-op
 * without METRICS, best-effort emission).
 */
export function recordPriceAlertEvaluationCounters(
  env: Env,
  counters: PriceAlertEvaluationCounters,
): void {
  const emitter = metricsEmitter(env);
  for (const key of PRICE_ALERT_COUNTER_POINTS) {
    emitter.recordGauge({
      name: PRICE_ALERT_COUNTER_NAMES[key],
      value: counters[key],
    });
  }
}

/**
 * Stale-price-share gauge — the cron-callable freshness write. The
 * Prometheus hook (DataQualityService.runQualityReport → gauge) had the
 * "renders 0 when nothing audited" contract, kept here: 0 offers → 0, so
 * an absent() canary never fires merely because a cycle found nothing.
 */
export function recordStalePriceShare(
  env: Env,
  staleCount: number,
  totalOffers: number,
): void {
  metricsEmitter(env).recordGauge({
    name: STALE_PRICE_SHARE_GAUGE,
    value: totalOffers > 0 ? staleCount / totalOffers : 0,
  });
}

/**
 * Transport newest-offer age in seconds — the single age computation the
 * gauge write and the task-6.3 freshness-alert evaluator share, so the
 * dashboard value and the alert can never diverge. `null` (no offers at
 * all) keeps the Prometheus contract: the degenerate case of every offer
 * being stale — the +Inf sentinel stands in for Infinity (an AE double
 * cannot carry it) and both alert thresholds still fire.
 */
export function transportAgeSeconds(newestOfferObservedAt: Date | null): number {
  return newestOfferObservedAt === null
    ? TRANSPORT_AGE_INFINITE
    : Math.max(
        0,
        Math.floor((Date.now() - newestOfferObservedAt.getTime()) / 1000),
      );
}

/**
 * Transport newest-offer-age gauge — the cron-callable freshness write.
 * Age comes from {@link transportAgeSeconds}; blob2 keeps the faithful
 * "+Inf" text for humans when no offers exist.
 */
export function recordTransportAge(
  env: Env,
  newestOfferObservedAt: Date | null,
): void {
  const ageSeconds =
    newestOfferObservedAt === null
      ? null
      : transportAgeSeconds(newestOfferObservedAt);
  metricsEmitter(env).recordGauge({
    name: TRANSPORT_NEWEST_OFFER_AGE_GAUGE,
    value: ageSeconds ?? TRANSPORT_AGE_INFINITE,
    valueLabel: ageSeconds === null ? '+Inf' : String(ageSeconds),
  });
}
