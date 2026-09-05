/**
 * Price-alert failure-gauge thresholds (task 10.2).
 *
 * The per-run failure count is already written to Analytics Engine as
 * `rajahinta_price_alerts_failed_total` by
 * {@link recordPriceAlertEvaluationCounters}; this module pairs that
 * gauge with the warning/critical thresholds the dashboard panels (see
 * METRICS.md) and any future cron alert checker evaluate against,
 * mirroring the freshness evaluators' structure
 * (`evaluateStalePriceShare`/`evaluateTransportAge` in
 * `src/cron/freshness-alert.ts`).
 *
 * Provenance honesty: unlike the freshness thresholds — ported verbatim
 * from the replaced `infra/k8s/base/prometheusrule.yaml` rules — no
 * Prometheus rule equivalent ever existed for price-alert failures, so
 * these constants are chosen defaults (no `replacedRule` naming) and
 * the thresholds are evaluated per run rather than over a `for` window:
 * the counter is a per-run count, so a healthy run immediately resolves
 * a prior run's breach.
 *
 * @module PriceAlertThresholds
 */

import { PRICE_ALERT_FAILED_COUNTER } from './metrics';

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/**
 * Failure-count thresholds per 30-min evaluation run (strict `>`
 * comparison, like the freshness evaluators):
 *
 * - `warning` fires when `failed > 0` — a single failed pipeline
 *   (email dispatch, intent write, unresolvable recipient) is already
 *   spec-visible failure ("Failure visibility") and must surface.
 * - `critical` fires when `failed > 9` (≥ 10 in one run) — a healthy
 *   run fails nothing and an isolated bad recipient fails once, so a
 *   double-digit failure count means systemic breakage (email Worker
 *   down, D1 unavailable), not a one-off.
 */
export const PRICE_ALERT_FAILED_THRESHOLDS = {
  warning: { threshold: 0 },
  critical: { threshold: 9 },
} as const;

/** Severity ladder shared with the freshness checker's shape. */
export type PriceAlertSeverity = 'warning' | 'critical';

/** One breached failure threshold, ready to render into a panel/alert. */
export interface PriceAlertFailureViolation {
  /**
   * Metric-contract invariant name — the AE gauge name itself, so the
   * violation greps straight back to the emitted data points.
   */
  readonly invariant: typeof PRICE_ALERT_FAILED_COUNTER;
  readonly severity: PriceAlertSeverity;
  /** Measured per-run failed count. */
  readonly measured: number;
  /** Human-readable measured value. */
  readonly measuredLabel: string;
  /** The breached threshold (numeric twin of the comparison RHS). */
  readonly threshold: number;
  /** Human-readable threshold. */
  readonly thresholdLabel: string;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate the per-run failed count against
 * {@link PRICE_ALERT_FAILED_THRESHOLDS} — strict `>` like the freshness
 * evaluators. A count breaching both levels reports the higher severity
 * (one violation per run).
 */
export function evaluatePriceAlertFailures(
  failed: number,
): PriceAlertFailureViolation | null {
  const { warning, critical } = PRICE_ALERT_FAILED_THRESHOLDS;
  if (failed > critical.threshold) {
    return {
      invariant: PRICE_ALERT_FAILED_COUNTER,
      severity: 'critical',
      measured: failed,
      measuredLabel: `${failed} failed pipelines this run`,
      threshold: critical.threshold,
      thresholdLabel: `> ${critical.threshold} failed pipelines per run`,
    };
  }
  if (failed > warning.threshold) {
    return {
      invariant: PRICE_ALERT_FAILED_COUNTER,
      severity: 'warning',
      measured: failed,
      measuredLabel: `${failed} failed pipelines this run`,
      threshold: warning.threshold,
      thresholdLabel: `> ${warning.threshold} failed pipelines per run`,
    };
  }
  return null;
}
