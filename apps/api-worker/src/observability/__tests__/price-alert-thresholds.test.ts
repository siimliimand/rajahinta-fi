/**
 * Price-alert failure-gauge threshold tests (task 10.2; per-kind sweep
 * coverage task 6.1).
 *
 * - pins PRICE_ALERT_FAILED_THRESHOLDS (chosen defaults — no Prometheus
 *   rule precedent existed, unlike the ported freshness rules);
 * - strict-`>` semantics mirroring the freshness evaluators
 *   (evaluateStalePriceShare/evaluateTransportAge);
 * - the greppable-invariant contract: the violation names the same AE
 *   gauge the per-run data points are written under;
 * - the datapoint→threshold composition: a failed count recorded via
 *   recordPriceAlertEvaluationCounters is exactly the value the
 *   evaluator consumes;
 * - kind-agnostic coverage (task 6.1, design D7): LANDED_COST and
 *   CATEGORY runs are judged by the same ladder at the same boundaries
 *   as the existing kinds, and a skip-only run trips nothing.
 *
 * @module PriceAlertThresholdsTest
 */

import { describe, expect, it } from 'vitest';
import {
  PRICE_ALERT_FAILED_THRESHOLDS,
  evaluatePriceAlertFailures,
} from '../price-alert-thresholds';
import {
  PRICE_ALERT_FAILED_COUNTER,
  recordPriceAlertEvaluationCounters,
  type PriceAlertEvaluationCounters,
} from '../metrics';
import type { Env } from '../../env';

/** Minimal AE sink — same shape as the metrics.test.ts fake. */
function fakeEnvWithFailedSink(): {
  env: Env;
  doubles: Array<number | undefined>;
  blobs: Array<Array<string | undefined> | undefined>;
} {
  const doubles: Array<number | undefined> = [];
  const blobs: Array<Array<string | undefined> | undefined> = [];
  const env = {
    METRICS: {
      writeDataPoint(point: { doubles?: number[]; blobs?: string[] }): void {
        doubles.push(point.doubles?.[0]);
        blobs.push(point.blobs);
      },
    },
  } as unknown as Env;
  return { env, doubles, blobs };
}

describe('PRICE_ALERT_FAILED_THRESHOLDS (task 10.2)', () => {
  it('pins the chosen constants (no Prometheus precedent — documented defaults)', () => {
    expect(PRICE_ALERT_FAILED_THRESHOLDS.warning.threshold).toBe(0);
    expect(PRICE_ALERT_FAILED_THRESHOLDS.critical.threshold).toBe(9);
  });

  it('names the emitted AE gauge as the invariant (greppable back to the data points)', () => {
    expect(evaluatePriceAlertFailures(1)?.invariant).toBe(
      PRICE_ALERT_FAILED_COUNTER,
    );
  });

  it('strict-> semantics: exactly AT a threshold does not fire that severity', () => {
    expect(evaluatePriceAlertFailures(0)).toBeNull();
    expect(evaluatePriceAlertFailures(1)?.severity).toBe('warning');
    expect(evaluatePriceAlertFailures(9)?.severity).toBe('warning');
    expect(evaluatePriceAlertFailures(10)?.severity).toBe('critical');
  });

  it('a count breaching both levels reports the higher severity', () => {
    const violation = evaluatePriceAlertFailures(25);
    expect(violation?.severity).toBe('critical');
    expect(violation?.threshold).toBe(
      PRICE_ALERT_FAILED_THRESHOLDS.critical.threshold,
    );
  });

  it('stays silent on a healthy run and carries renderable labels otherwise', () => {
    expect(evaluatePriceAlertFailures(0)).toBeNull();
    const warning = evaluatePriceAlertFailures(1);
    expect(warning?.measured).toBe(1);
    expect(warning?.measuredLabel).toContain('1');
    expect(warning?.thresholdLabel).toContain('> 0');
    const critical = evaluatePriceAlertFailures(10);
    expect(critical?.thresholdLabel).toContain('> 9');
  });
});

describe('datapoint → threshold composition (task 10.2 wiring)', () => {
  it('the recorded failed counter is the value the evaluator judges', () => {
    const { env, doubles } = fakeEnvWithFailedSink();
    recordPriceAlertEvaluationCounters(env, {
      evaluated: 12,
      matched: 3,
      notified: 2,
      failed: 10,
      suppressed: 1,
    });

    // The failed point is the fourth discrete write (export order).
    expect(doubles).toHaveLength(5);
    const failedCount = doubles[3] as number;
    expect(failedCount).toBe(10);

    const violation = evaluatePriceAlertFailures(failedCount);
    expect(violation?.severity).toBe('critical');
    expect(violation?.invariant).toBe(PRICE_ALERT_FAILED_COUNTER);
  });

  it('a healthy run records 0 and the evaluator stays silent', () => {
    const { env, doubles } = fakeEnvWithFailedSink();
    recordPriceAlertEvaluationCounters(env, {
      evaluated: 4,
      matched: 0,
      notified: 0,
      failed: 0,
      suppressed: 0,
    });
    expect(evaluatePriceAlertFailures(doubles[3] as number)).toBeNull();
  });
});

describe('per-kind sweep coverage (task 6.1, design D7)', () => {
  /** A recorded run's failed count and its failed point's kind label. */
  function recordedRun(counters: PriceAlertEvaluationCounters): {
    failedCount: number;
    failedKindLabel: string | undefined;
  } {
    const { env, doubles, blobs } = fakeEnvWithFailedSink();
    recordPriceAlertEvaluationCounters(env, counters);
    return {
      failedCount: doubles[3] as number,
      // blob3 is the labels channel; parse out the kind the point carries.
      failedKindLabel: (JSON.parse(
        blobs[3]?.[2] ?? '{}',
      ) as Record<string, string>).kind,
    };
  }

  it('a LANDED_COST failure run is judged by the same ladder at the same boundaries', () => {
    // warning: failed > 0 — identical to the existing kinds' boundary.
    const warning = evaluatePriceAlertFailures(
      recordedRun({
        evaluated: 2,
        matched: 1,
        notified: 0,
        failed: 1,
        suppressed: 0,
        kind: 'LANDED_COST',
      }).failedCount,
    );
    expect(warning?.severity).toBe('warning');
    expect(warning?.threshold).toBe(
      PRICE_ALERT_FAILED_THRESHOLDS.warning.threshold,
    );
    // critical: failed > 9 — same critical boundary, no per-kind pair.
    const critical = evaluatePriceAlertFailures(
      recordedRun({
        evaluated: 12,
        matched: 3,
        notified: 2,
        failed: 10,
        suppressed: 1,
        kind: 'LANDED_COST',
      }).failedCount,
    );
    expect(critical?.severity).toBe('critical');
    expect(critical?.threshold).toBe(
      PRICE_ALERT_FAILED_THRESHOLDS.critical.threshold,
    );
    expect(critical?.invariant).toBe(PRICE_ALERT_FAILED_COUNTER);
  });

  it('a CATEGORY failure run is judged by the same ladder, and the breach is attributable to the sweep', () => {
    const run = recordedRun({
      evaluated: 3,
      matched: 3,
      notified: 0,
      failed: 3,
      suppressed: 0,
      kind: 'CATEGORY',
    });
    const violation = evaluatePriceAlertFailures(run.failedCount);
    expect(violation?.severity).toBe('warning');
    expect(violation?.threshold).toBe(
      PRICE_ALERT_FAILED_THRESHOLDS.warning.threshold,
    );
    // The emitted failed point carries the sweep kind, so a panel can
    // attribute the breach to the CATEGORY sweep (the violation's
    // measured count is run-wide — attribution lives on the point).
    expect(run.failedKindLabel).toBe('CATEGORY');
  });

  it('a skip-only run trips nothing — skips are neither evaluations nor failures', () => {
    for (const kind of ['LANDED_COST', 'CATEGORY'] as const) {
      const run = recordedRun({
        evaluated: 0,
        matched: 0,
        notified: 0,
        failed: 0,
        suppressed: 0,
        kind,
      });
      expect(run.failedCount).toBe(0);
      // warning fires at failed > 0 — a stale-summary/unretrievable-
      // composition sweep that skipped every alert stays silent.
      expect(evaluatePriceAlertFailures(run.failedCount)).toBeNull();
      expect(run.failedKindLabel).toBe(kind);
    }
  });
});
