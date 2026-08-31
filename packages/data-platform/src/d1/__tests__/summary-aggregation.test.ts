/**
 * Summary materialization — pure aggregation over R2-sourced observation
 * batches (task 2.3). Expectations ported from the pg worker's suite
 * (packages/application-api/src/jobs/__tests__/time-series-aggregation.worker.test.ts)
 * so the D1 port cannot drift from the proven bucketing semantics.
 *
 * @module D1SummaryAggregationTest
 */
import { describe, it, expect } from 'vitest';
import {
  BUCKET_WINDOW_MS,
  averageCentsHalfUp,
  bucketAnchor,
  buildBucketSummaries,
  observationReliability,
  startOfIsoWeek,
  startOfUtcDay,
  strictestReliability,
} from '../summary-aggregation';
import type { ObservationLogRecord } from '../observation-log';

const T = {
  mon: '2026-08-24', // Monday
  tue: '2026-08-25',
  sun: '2026-08-30',
};

/** Build an R2-sourced observation row with overridable fields. */
function observation(overrides: Partial<ObservationLogRecord>): ObservationLogRecord {
  return {
    id: 1,
    product_id: 7,
    merchant: 'alko',
    retail_offer_id: 101,
    observed_at: '2026-08-24T10:00:00.000Z',
    foreign_retail_price_cents: 1000,
    transport_cost_cents: 500,
    transport_offer_id: 8,
    excise_rule_version_id: 3,
    container_duty_rule_version_id: null,
    landed_cost_cents: 1500,
    input_reliability: {
      retailPrice: 'VERIFIED',
      transport: 'ESTIMATED',
      exciseRule: 'VERIFIED',
      containerDutyRule: 'ESTIMATED',
    },
    confidence: 'HIGH',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Bucket anchors — the strftime bucketing semantics
// ---------------------------------------------------------------------------

describe('bucket anchors — strftime bucketing equivalents', () => {
  it('daily anchor is the UTC calendar day — strftime(\'%Y-%m-%d\')', () => {
    expect(startOfUtcDay(new Date('2026-08-26T23:59:59Z')).toISOString()).toBe(
      '2026-08-26T00:00:00.000Z',
    );
    expect(startOfUtcDay(new Date('2026-08-26T00:00:00Z')).toISOString()).toBe(
      '2026-08-26T00:00:00.000Z',
    );
  });

  it('daily anchor matches the D1 strftime expression over the same instant', () => {
    // The equivalence pin: the D1-side expression
    //   strftime('%Y-%m-%d', '2026-08-26T15:30:00.000Z') = '2026-08-26'
    // equals the app-side anchor's ISO day.
    expect(startOfUtcDay(new Date('2026-08-26T15:30:00.000Z')).toISOString().slice(0, 10)).toBe(
      '2026-08-26',
    );
  });

  it('weekly anchor is Monday 00:00 UTC of the ISO 8601 week', () => {
    // Sunday belongs to the previous ISO week.
    expect(startOfIsoWeek(new Date('2026-08-23T15:00:00Z')).toISOString()).toBe(
      '2026-08-17T00:00:00.000Z',
    );
    expect(startOfIsoWeek(new Date('2026-08-24T01:00:00Z')).toISOString()).toBe(
      '2026-08-24T00:00:00.000Z',
    );
    expect(startOfIsoWeek(new Date('2026-08-29T12:00:00Z')).toISOString()).toBe(
      '2026-08-24T00:00:00.000Z',
    );
  });

  it('exposes the bucket widths the scan loop steps by', () => {
    expect(BUCKET_WINDOW_MS.daily).toBe(86_400_000);
    expect(BUCKET_WINDOW_MS.weekly).toBe(7 * 86_400_000);
    expect(bucketAnchor('daily', new Date('2026-08-26T10:00:00Z'))).toEqual(
      startOfUtcDay(new Date('2026-08-26T10:00:00Z')),
    );
    expect(bucketAnchor('weekly', new Date('2026-08-26T10:00:00Z'))).toEqual(
      startOfIsoWeek(new Date('2026-08-26T10:00:00Z')),
    );
  });
});

// ---------------------------------------------------------------------------
// Rounding and severity — the pins that must not drift from pg
// ---------------------------------------------------------------------------

describe('averageCentsHalfUp — exact half-up integer arithmetic', () => {
  it('matches the pg worker pins', () => {
    expect(averageCentsHalfUp(5, 2)).toBe(3); // 2.5 → 3
    expect(averageCentsHalfUp(7, 2)).toBe(4); // 3.5 → 4
    expect(averageCentsHalfUp(7, 3)).toBe(2); // 2.33 → 2
    expect(averageCentsHalfUp(3001, 3)).toBe(1000); // 1000.33 → 1000
    expect(averageCentsHalfUp(0, 1)).toBe(0);
    expect(averageCentsHalfUp(1000 + 1001, 2)).toBe(1001); // 1000.5 → 1001
  });
});

describe('strictestReliability / observationReliability', () => {
  it('orders by canonical severity VERIFIED < ESTIMATED < STALE < UNAVAILABLE', () => {
    expect(strictestReliability(['VERIFIED', 'ESTIMATED'])).toBe('ESTIMATED');
    expect(strictestReliability(['VERIFIED', 'STALE', 'ESTIMATED'])).toBe('STALE');
    expect(strictestReliability(['STALE', 'UNAVAILABLE'])).toBe('UNAVAILABLE');
    expect(strictestReliability(['VERIFIED'])).toBe('VERIFIED');
  });

  it('derives overall reliability from the input snapshot, degrading unknown shapes', () => {
    expect(observationReliability(observation({}))).toBe('ESTIMATED'); // strictest of snapshot
    expect(
      observationReliability(
        observation({
          input_reliability: {
            retailPrice: 'VERIFIED',
            transport: 'VERIFIED',
            exciseRule: 'STALE',
            containerDutyRule: 'VERIFIED',
          },
        }),
      ),
    ).toBe('STALE');
    expect(
      observationReliability(
        observation({
          input_reliability: {
            retailPrice: 'WEIRD',
            transport: 'ALSO WEIRD',
            exciseRule: 'X',
            containerDutyRule: 'Y',
          } as unknown as ObservationLogRecord['input_reliability'],
        }),
      ),
    ).toBe('UNAVAILABLE'); // never silently upgrade
  });
});

// ---------------------------------------------------------------------------
// buildBucketSummaries — the materialized row shapes
// ---------------------------------------------------------------------------

describe('buildBucketSummaries', () => {
  it('returns one row per merchant plus the product-wide row', () => {
    const rows = [
      observation({ id: 1, merchant: 'a', foreign_retail_price_cents: 100, landed_cost_cents: 200, observed_at: `${T.mon}T10:00:00.000Z` }),
      observation({ id: 2, merchant: 'b', foreign_retail_price_cents: 300, landed_cost_cents: 400, observed_at: `${T.mon}T11:00:00.000Z` }),
    ];
    const summaries = buildBucketSummaries('daily', startOfUtcDay(new Date(rows[0].observed_at)), rows);
    expect(summaries.map((s) => s.merchant).sort()).toEqual(['a', 'b', null]);

    const productWide = summaries.find((s) => s.merchant === null);
    expect(productWide?.observationCount).toBe(2);
    expect(productWide?.priceOpenCents).toBe(100);
    expect(productWide?.priceCloseCents).toBe(300);
    expect(productWide?.priceMinCents).toBe(100);
    expect(productWide?.priceMaxCents).toBe(300);
  });

  it('opens/closes by series order and rounds averages half-up', () => {
    const rows = [
      observation({ id: 1, foreign_retail_price_cents: 1001, landed_cost_cents: 1501, observed_at: `${T.mon}T10:00:00.000Z` }),
      observation({ id: 2, foreign_retail_price_cents: 1000, landed_cost_cents: 1500, observed_at: `${T.mon}T11:00:00.000Z` }),
    ];
    const [row] = buildBucketSummaries('daily', startOfUtcDay(new Date(rows[0].observed_at)), rows);
    expect(row.priceAvgCents).toBe(1001); // 1000.5 rounds up
    expect(row.landedCostAvgCents).toBe(1501);
    expect(row.priceOpenCents).toBe(1001);
    expect(row.priceCloseCents).toBe(1000);
    expect(row.observationCount).toBe(2);
  });

  it('sorts an unsorted batch into (observed_at, id) series order first', () => {
    const rows = [
      observation({ id: 2, foreign_retail_price_cents: 2000, observed_at: `${T.mon}T12:00:00.000Z` }),
      observation({ id: 1, foreign_retail_price_cents: 1000, observed_at: `${T.mon}T10:00:00.000Z` }),
    ];
    const [row] = buildBucketSummaries('daily', startOfUtcDay(new Date(rows[0].observed_at)), rows);
    expect(row.priceOpenCents).toBe(1000);
    expect(row.priceCloseCents).toBe(2000);
  });

  it('breaks observed_at ties by id', () => {
    const rows = [
      observation({ id: 2, foreign_retail_price_cents: 2222, observed_at: `${T.mon}T10:00:00.000Z` }),
      observation({ id: 1, foreign_retail_price_cents: 1111, observed_at: `${T.mon}T10:00:00.000Z` }),
    ];
    const [row] = buildBucketSummaries('daily', startOfUtcDay(new Date(rows[0].observed_at)), rows);
    expect(row.priceOpenCents).toBe(1111);
    expect(row.priceCloseCents).toBe(2222);
  });

  it('aggregates strictest reliability across the bucket and never upgrades unknown shapes', () => {
    const staleRow = observation({
      id: 2,
      observed_at: `${T.mon}T11:00:00.000Z`,
      input_reliability: {
        retailPrice: 'VERIFIED',
        transport: 'VERIFIED',
        exciseRule: 'STALE',
        containerDutyRule: 'VERIFIED',
      },
    });
    const [row] = buildBucketSummaries('daily', startOfUtcDay(new Date(staleRow.observed_at)), [
      observation({ id: 1, observed_at: `${T.mon}T10:00:00.000Z` }),
      staleRow,
    ]);
    expect(row.strictestReliability).toBe('STALE');

    const unknown = observation({
      id: 3,
      observed_at: `${T.mon}T12:00:00.000Z`,
      input_reliability: {
        retailPrice: '??',
        transport: '??',
        exciseRule: '??',
        containerDutyRule: '??',
      } as unknown as ObservationLogRecord['input_reliability'],
    });
    const [unknownRow] = buildBucketSummaries('daily', startOfUtcDay(new Date(unknown.observed_at)), [unknown]);
    expect(unknownRow.strictestReliability).toBe('UNAVAILABLE');
  });

  it('stamps the granularity and periodStart anchor day into every row', () => {
    const rows = [observation({ observed_at: `${T.tue}T08:00:00.000Z` })];
    for (const granularity of ['daily', 'weekly'] as const) {
      const [row] = buildBucketSummaries(granularity, bucketAnchor(granularity, new Date(rows[0].observed_at)), rows);
      expect(row.granularity).toBe(granularity);
      expect(row.periodStart).toBe(granularity === 'daily' ? T.tue : T.mon);
      expect(row.productId).toBe(7);
    }
  });

  it('carries the per-merchant rows with their own aggregates', () => {
    const rows = [
      observation({ id: 1, merchant: 'alko', foreign_retail_price_cents: 100, landed_cost_cents: 300, observed_at: `${T.mon}T10:00:00.000Z` }),
      observation({ id: 2, merchant: 'alko', foreign_retail_price_cents: 300, landed_cost_cents: 500, observed_at: `${T.mon}T11:00:00.000Z` }),
    ];
    const summaries = buildBucketSummaries('daily', startOfUtcDay(new Date(rows[0].observed_at)), rows);
    const alko = summaries.find((s) => s.merchant === 'alko');
    expect(alko?.priceMinCents).toBe(100);
    expect(alko?.priceMaxCents).toBe(300);
    expect(alko?.priceAvgCents).toBe(200);
    expect(alko?.landedCostAvgCents).toBe(400);
    expect(alko?.observationCount).toBe(2);
  });

  it('returns no rows for an empty batch', () => {
    expect(buildBucketSummaries('daily', new Date('2026-08-24T00:00:00Z'), [])).toEqual([]);
  });

  it('covers a full ISO week across multiple days when bucketed weekly', () => {
    const rows = [
      observation({ id: 1, foreign_retail_price_cents: 1000, landed_cost_cents: 1500, observed_at: `${T.mon}T10:00:00.000Z` }),
      observation({ id: 2, foreign_retail_price_cents: 1010, landed_cost_cents: 1510, observed_at: `${T.tue}T10:00:00.000Z` }),
      observation({ id: 3, foreign_retail_price_cents: 2000, landed_cost_cents: 2500, observed_at: `${T.sun}T10:00:00.000Z` }),
    ];
    const [week] = buildBucketSummaries('weekly', startOfIsoWeek(new Date(rows[0].observed_at)), rows);
    expect(week.observationCount).toBe(3);
    expect(week.priceOpenCents).toBe(1000);
    expect(week.priceCloseCents).toBe(2000);
    expect(week.priceMinCents).toBe(1000);
    expect(week.priceMaxCents).toBe(2000);
    expect(week.priceAvgCents).toBe(1337); // 4010/3 = 1336.67 → 1337
    expect(week.landedCostAvgCents).toBe(1837);
  });
});
