/**
 * Price-alert failure-gauge threshold tests (task 10.2).
 *
 * - pins PRICE_ALERT_FAILED_THRESHOLDS (chosen defaults — no Prometheus
 *   rule precedent existed, unlike the ported freshness rules);
 * - strict-`>` semantics mirroring the freshness evaluators
 *   (evaluateStalePriceShare/evaluateTransportAge);
 * - the greppable-invariant contract: the violation names the same AE
 *   gauge the per-run data points are written under;
 * - the datapoint→threshold composition: a failed count recorded via
 *   recordPriceAlertEvaluationCounters is exactly the value the
 *   evaluator consumes.
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
} from '../metrics';
import type { Env } from '../../env';

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
  /** Minimal AE sink — same shape as the metrics.test.ts fake. */
  function fakeEnvWithFailedSink(): {
    env: Env;
    doubles: Array<number | undefined>;
  } {
    const doubles: Array<number | undefined> = [];
    const env = {
      METRICS: {
        writeDataPoint(point: { doubles?: number[] }): void {
          doubles.push(point.doubles?.[0]);
        },
      },
    } as unknown as Env;
    return { env, doubles };
  }

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
