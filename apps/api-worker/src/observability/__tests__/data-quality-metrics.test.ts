/**
 * Data-quality metrics tests (task 4.1, change
 * data-quality-and-publication-trust).
 *
 * - the metric-name contracts (byte-parity with the wave-1
 *   data-acquisition constant);
 * - the pure computations (implausible-volume share, Alko reference
 *   coverage, zero-price rejections from the run error channel);
 * - every writer's AE point shape against a fake AE binding (index /
 *   blob / double layout, labels, the +Inf sentinel) and the no-op
 *   fallback without the METRICS binding;
 * - the quality-report hook receiver (the task-1.2 export made real);
 * - the D1 measurements against the committed migrations (fake-D1
 *   harness — the savings-snapshot qualification data, the curated
 *   carriers seeded at 0, the per-feed last-success read);
 * - the one-tick writer's per-gauge error isolation.
 *
 * @module DataQualityMetricsTest
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { IMPLAUSIBLE_VOLUME_SHARE_METRIC } from '../../../../../packages/data-acquisition/src/services/data-quality.service';
import type { DataQualityReport } from '../../../../../packages/data-acquisition/src/services/data-quality.service';
import type { D1DatabaseLike } from '../../../../../packages/data-platform/src/d1/executor';
import {
  ALKO_REFERENCE_COVERAGE_GAUGE,
  FEED_LAST_SUCCESS_AGE_GAUGE,
  IMPLAUSIBLE_VOLUME_SHARE_GAUGE,
  PRICE_DRIFT_ERROR_MARKER,
  TRANSPORT_OFFER_ROWS_GAUGE,
  ZERO_PRICE_REJECTIONS_COUNTER,
  alkoReferenceCoverageOf,
  dataQualityReportGaugeHook,
  implausibleVolumeShareOf,
  measureAlkoReferenceCoverage,
  measureAndRecordDataQualityGauges,
  measureFeedLastSuccesses,
  measureTransportRowsPerCarrier,
  recordAlkoReferenceCoverage,
  recordFeedLastSuccessAge,
  recordImplausibleVolumeShare,
  recordTransportRowsPerCarrier,
  recordZeroPriceRejections,
  zeroPriceRejectionsOf,
} from '../data-quality';
import { TRANSPORT_AGE_INFINITE } from '../metrics';
import { createD1Shim } from '../../analytics/__tests__/fake-d1';
import type { Env } from '../../env';

// ---------------------------------------------------------------------------
// Local migrated-D1 harness — the shared openMigratedD1 helper applied
// statement-wise with an FTS5 feature-detect: some Node builds ship
// node:sqlite without the fts5 module (which the shared helper requires
// unconditionally through migration 0001). The data-quality reads below
// touch none of the FTS objects, so when the module is missing its
// statements (the virtual table + its triggers, also rebuilt by 0002)
// are skipped and the measured tables apply in full.
// ---------------------------------------------------------------------------

function fts5Available(db: DatabaseSync): boolean {
  try {
    db.exec('CREATE VIRTUAL TABLE __fts5_probe USING fts5(x)');
    db.exec('DROP TABLE __fts5_probe');
    return true;
  } catch {
    return false;
  }
}

function openMigratedD1(): { d1: D1DatabaseLike } {
  const db = new DatabaseSync(':memory:');
  const hasFts = fts5Available(db);
  const migrationsDir = new URL(
    '../../../../../packages/data-platform/src/d1/migrations',
    import.meta.url,
  ).pathname;
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const content = readFileSync(`${migrationsDir}/${file}`, 'utf8');
    for (const statement of content.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed.length === 0) continue;
      if (!hasFts && trimmed.includes('product_master_fts')) continue;
      db.exec(trimmed);
    }
  }
  return { d1: createD1Shim(db) };
}

// ---------------------------------------------------------------------------
// Fake AE binding — index/blob/double sink recording every call
// ---------------------------------------------------------------------------

type RecordedPoint = AnalyticsEngineDataPoint;

function fakeAnalyticsEngine(): { points: RecordedPoint[]; binding: AnalyticsEngineDataset } {
  const points: RecordedPoint[] = [];
  return {
    points,
    binding: {
      writeDataPoint(event?: RecordedPoint): void {
        points.push(event ?? {});
      },
    },
  };
}

function envWith(ae: { binding: AnalyticsEngineDataset } | null): Env {
  return (ae === null ? {} : { METRICS: ae.binding }) as unknown as Env;
}

// ---------------------------------------------------------------------------
// Metric-name contracts
// ---------------------------------------------------------------------------

describe('metric-name contracts', () => {
  it('implausible-volume gauge is byte-parity with the wave-1 data-acquisition constant', () => {
    expect(IMPLAUSIBLE_VOLUME_SHARE_GAUGE).toBe(IMPLAUSIBLE_VOLUME_SHARE_METRIC);
    expect(IMPLAUSIBLE_VOLUME_SHARE_GAUGE).toBe(
      'rajahinta_data_quality_implausible_volume_share_ratio',
    );
  });

  it('the price-drift marker is the mapper rejection message fragment', () => {
    // data-mapping.service.ts design D1 message — the marker must stay a
    // substring of it or the error-channel count reads zero forever.
    const mapperMessage =
      'Failed to map offer for product "X" (merchant "alks"): price drift — ' +
      'minor-unit price "0" is not a positive cent amount; offer rejected, ' +
      'the product stays offer-less (design D1)';
    expect(mapperMessage.includes(PRICE_DRIFT_ERROR_MARKER)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pure computations
// ---------------------------------------------------------------------------

describe('implausibleVolumeShareOf', () => {
  it('renders the withheld/audited ratio', () => {
    expect(implausibleVolumeShareOf(1, 4)).toBeCloseTo(0.25);
    expect(implausibleVolumeShareOf(3, 3)).toBe(1);
  });

  it('renders 0 when nothing was audited (canary contract)', () => {
    expect(implausibleVolumeShareOf(0, 0)).toBe(0);
  });
});

describe('alkoReferenceCoverageOf', () => {
  it('renders covered/catalog ratio', () => {
    expect(alkoReferenceCoverageOf({ coveredProducts: 3, totalProducts: 4 })).toBeCloseTo(0.75);
  });

  it('renders 0 for an empty catalog (a dead savings surface alerts)', () => {
    expect(alkoReferenceCoverageOf({ coveredProducts: 0, totalProducts: 0 })).toBe(0);
  });
});

describe('zeroPriceRejectionsOf', () => {
  it('counts only the price-floor gate rejections in the run error channel', () => {
    const errors = [
      'Failed to map offer for product "Karhu" (merchant "alks"): price drift — minor-unit price "0" is not a positive cent amount; offer rejected, the product stays offer-less (design D1)',
      'Data error: unit_volume 0 (product 12, merchant "alks") is outside the canonical litre window (0, 100)',
      'Feed fetch failed: HTTP 503',
      'Another price drift — minor-unit price "-5" is not a positive cent amount; offer rejected, the product stays offer-less (design D1)',
      'Failed to upsert product "X": UNIQUE constraint failed',
    ];
    expect(zeroPriceRejectionsOf(errors)).toBe(2);
  });

  it('returns 0 for a clean run', () => {
    expect(zeroPriceRejectionsOf([])).toBe(0);
    expect(zeroPriceRejectionsOf(['Feed fetch failed: HTTP 503'])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Writers — AE point shapes
// ---------------------------------------------------------------------------

describe('data-quality gauge writers (fake AE binding)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('recordZeroPriceRejections writes one per-run point with the merchant label', () => {
    const ae = fakeAnalyticsEngine();
    recordZeroPriceRejections(envWith(ae), 3, 'alks');
    expect(ae.points).toHaveLength(1);
    expect(ae.points[0].indexes).toEqual([ZERO_PRICE_REJECTIONS_COUNTER]);
    expect(ae.points[0].blobs?.[0]).toBe(ZERO_PRICE_REJECTIONS_COUNTER);
    expect(ae.points[0].blobs?.[1]).toBe('3');
    expect(ae.points[0].blobs?.[2]).toBe('{"merchant":"alks"}');
    expect(ae.points[0].doubles?.[0]).toBe(3);
  });

  it('recordZeroPriceRejections without a merchant emits the label-less point', () => {
    const ae = fakeAnalyticsEngine();
    recordZeroPriceRejections(envWith(ae), 0);
    expect(ae.points[0].blobs?.[2]).toBe('{}');
    expect(ae.points[0].doubles?.[0]).toBe(0);
  });

  it('recordImplausibleVolumeShare writes the ratio point', () => {
    const ae = fakeAnalyticsEngine();
    recordImplausibleVolumeShare(envWith(ae), 2, 8);
    expect(ae.points[0].indexes).toEqual([IMPLAUSIBLE_VOLUME_SHARE_GAUGE]);
    expect(ae.points[0].doubles?.[0]).toBeCloseTo(0.25);
  });

  it('recordImplausibleVolumeShare renders 0 when nothing was audited', () => {
    const ae = fakeAnalyticsEngine();
    recordImplausibleVolumeShare(envWith(ae), 0, 0);
    expect(ae.points[0].doubles?.[0]).toBe(0);
  });

  it('recordAlkoReferenceCoverage writes the ratio point', () => {
    const ae = fakeAnalyticsEngine();
    recordAlkoReferenceCoverage(envWith(ae), 300, 400);
    expect(ae.points[0].indexes).toEqual([ALKO_REFERENCE_COVERAGE_GAUGE]);
    expect(ae.points[0].blobs?.[1]).toBe(String(300 / 400));
    expect(ae.points[0].doubles?.[0]).toBeCloseTo(0.75);
  });

  it('recordTransportRowsPerCarrier writes one labeled point per carrier, sorted', () => {
    const ae = fakeAnalyticsEngine();
    recordTransportRowsPerCarrier(envWith(ae), { posti: 12, fransberg: 0 });
    expect(ae.points.map((p) => p.indexes?.[0])).toEqual([
      TRANSPORT_OFFER_ROWS_GAUGE,
      TRANSPORT_OFFER_ROWS_GAUGE,
    ]);
    expect(ae.points.map((p) => p.blobs?.[2])).toEqual([
      '{"carrier":"fransberg"}',
      '{"carrier":"posti"}',
    ]);
    expect(ae.points.map((p) => p.doubles?.[0])).toEqual([0, 12]);
  });

  it('recordFeedLastSuccessAge writes whole seconds under the merchant label', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-30T12:00:00Z'));
    const ae = fakeAnalyticsEngine();
    recordFeedLastSuccessAge(envWith(ae), 'alko', new Date('2026-08-30T10:00:00Z'));
    expect(ae.points[0].indexes).toEqual([FEED_LAST_SUCCESS_AGE_GAUGE]);
    expect(ae.points[0].blobs?.[1]).toBe('7200');
    expect(ae.points[0].blobs?.[2]).toBe('{"merchant":"alko"}');
    expect(ae.points[0].doubles?.[0]).toBe(7200);
  });

  it('recordFeedLastSuccessAge encodes a never-successful feed as +Inf', () => {
    const ae = fakeAnalyticsEngine();
    recordFeedLastSuccessAge(envWith(ae), 'eu-import', null);
    expect(ae.points[0].doubles?.[0]).toBe(TRANSPORT_AGE_INFINITE);
    expect(Number.isFinite(ae.points[0].doubles?.[0])).toBe(true); // AE-safe
    expect(ae.points[0].blobs?.[1]).toBe('+Inf');
  });

  it('dataQualityReportGaugeHook renders the report into the share gauge', () => {
    const ae = fakeAnalyticsEngine();
    const report: DataQualityReport = {
      totalOffers: 10,
      staleCount: 1,
      unavailableCount: 0,
      estimatedCount: 7,
      verifiedCount: 2,
      implausibleVolumeCount: 2,
      flaggedIssues: [],
    };
    dataQualityReportGaugeHook(envWith(ae))(report);
    expect(ae.points).toHaveLength(1);
    expect(ae.points[0].indexes).toEqual([IMPLAUSIBLE_VOLUME_SHARE_GAUGE]);
    expect(ae.points[0].doubles?.[0]).toBeCloseTo(0.2);
  });

  it('every writer no-ops safely without the METRICS binding', () => {
    const env = envWith(null);
    expect(() => recordZeroPriceRejections(env, 1, 'alko')).not.toThrow();
    expect(() => recordImplausibleVolumeShare(env, 1, 4)).not.toThrow();
    expect(() => recordAlkoReferenceCoverage(env, 1, 4)).not.toThrow();
    expect(() => recordTransportRowsPerCarrier(env, { posti: 1 })).not.toThrow();
    expect(() => recordFeedLastSuccessAge(env, 'alko', null)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// D1 measurements — the committed migrations (fake-D1 harness)
// ---------------------------------------------------------------------------

describe('D1 measurements (migrated fake D1)', () => {
  /** Seed 4 catalog products, Alko references on 3 of them, one other-merchant offer. */
  function seedCoverageData(d1: D1DatabaseLike): void {
    for (const id of [1, 2, 3, 4]) {
      void d1
        .prepare(
          `INSERT INTO product_master (id, name, manufacturer, brand, category, unit_volume, container_type, regulatory_classification)
           VALUES (?, ?, 'm', 'b', 'beer', '0.5', 'can', 'beer')`,
        )
        .bind(id, `P${id}`)
        .run();
    }
    const offers: Array<[number, string, number, string]> = [
      // [id, merchant, product, observed_at]
      [1, 'alko', 1, '2026-09-30T06:00:00Z'],
      [2, 'alko', 2, '2026-09-30T06:00:00Z'],
      [3, 'alko', 3, '2026-09-29T06:00:00Z'],
      [4, 'eu-import', 4, '2026-09-30T06:00:00Z'],
    ];
    for (const [id, merchant, productId, observedAt] of offers) {
      void d1
        .prepare(
          `INSERT INTO retail_offers (id, merchant, country, product_id, price_cents, observed_at)
           VALUES (?, ?, 'FI', ?, 100, ?)`,
        )
        .bind(id, merchant, productId, observedAt)
        .run();
    }
  }

  it('measureAlkoReferenceCoverage applies the usable-reference qualification over the catalog', async () => {
    const { d1 } = openMigratedD1();
    seedCoverageData(d1);
    const counts = await measureAlkoReferenceCoverage(d1);
    expect(counts).toEqual({ coveredProducts: 3, totalProducts: 4 });
    expect(alkoReferenceCoverageOf(counts)).toBeCloseTo(0.75);
  });

  it('measureAlkoReferenceCoverage reads zero coverage on an empty database', async () => {
    const { d1 } = openMigratedD1();
    expect(await measureAlkoReferenceCoverage(d1)).toEqual({
      coveredProducts: 0,
      totalProducts: 0,
    });
  });

  it('measureTransportRowsPerCarrier seeds expected carriers at 0 and overlays actual counts', async () => {
    const { d1 } = openMigratedD1();
    const rows: Array<[number, string]> = [
      [1, 'posti'],
      [2, 'posti'],
      [3, 'posti'],
    ];
    for (const [id, carrier] of rows) {
      void d1
        .prepare(
          `INSERT INTO transport_offers (id, carrier, origin_country, destination_country, package_tier, price_cents)
           VALUES (?, ?, 'FI', 'FI', 'parcel', 500)`,
        )
        .bind(id, carrier)
        .run();
    }
    const rowsByCarrier = await measureTransportRowsPerCarrier(d1);
    // fransberg, norrlog, omniva, and pakettipojat are expected curated
    // carriers with no rows — honest 0s (the spec scenario: the panel
    // shows zero), never absent.
    expect(rowsByCarrier).toEqual({
      fransberg: 0,
      norrlog: 0,
      omniva: 0,
      pakettipojat: 0,
      posti: 3,
    });
  });

  it('measureTransportRowsPerCarrier yields all-zero points for an empty table', async () => {
    const { d1 } = openMigratedD1();
    expect(await measureTransportRowsPerCarrier(d1)).toEqual({
      fransberg: 0,
      norrlog: 0,
      omniva: 0,
      pakettipojat: 0,
      posti: 0,
    });
  });

  it('measureFeedLastSuccesses reads the newest offer per live registry feed', async () => {
    const { d1 } = openMigratedD1();
    seedCoverageData(d1);
    const registry: Array<[number, string, string]> = [
      [1, 'alko', 'https://feeds.example/alko.json'],
      [2, 'fresh-onboard', 'https://feeds.example/fresh.json'], // live feed, no offers yet
      [3, 'unwired', ''], // empty feed URL — producer skips, not a feed
    ];
    for (const [id, merchantId, feedUrl] of registry) {
      void d1
        .prepare(
          `INSERT INTO merchant_registry (id, merchant_id, name, country, feed_url, feed_format, polling_interval_ms)
           VALUES (?, ?, ?, 'FI', ?, 'JSON', 86400000)`,
        )
        .bind(id, merchantId, merchantId, feedUrl)
        .run();
    }
    const newest = await measureFeedLastSuccesses(d1);
    expect(Object.keys(newest).sort()).toEqual(['alko', 'fresh-onboard']);
    expect(newest['alko']?.toISOString()).toBe('2026-09-30T06:00:00.000Z');
    // Live feed that has never published an offer → null (the +Inf sentinel at write time).
    expect(newest['fresh-onboard']).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// One-tick writer — emission order + per-gauge isolation
// ---------------------------------------------------------------------------

describe('measureAndRecordDataQualityGauges (fake AE + fake D1)', () => {
  function seedAll(d1: D1DatabaseLike): void {
    for (const id of [1, 2]) {
      void d1
        .prepare(
          `INSERT INTO product_master (id, name, manufacturer, brand, category, unit_volume, container_type, regulatory_classification)
           VALUES (?, ?, 'm', 'b', 'beer', '0.5', 'can', 'beer')`,
        )
        .bind(id, `P${id}`)
        .run();
    }
    void d1
      .prepare(
        `INSERT INTO retail_offers (id, merchant, country, product_id, price_cents, observed_at)
         VALUES (1, 'alko', 'FI', 1, 100, '2026-08-30T06:00:00Z')`,
      )
      .run();
    void d1
      .prepare(
        `INSERT INTO merchant_registry (id, merchant_id, name, country, feed_url, feed_format, polling_interval_ms)
         VALUES (1, 'alko', 'Alko', 'FI', 'https://feeds.example/alko.json', 'JSON', 86400000)`,
      )
      .run();
    void d1
      .prepare(
        `INSERT INTO transport_offers (id, carrier, origin_country, destination_country, package_tier, price_cents)
         VALUES (1, 'posti', 'FI', 'FI', 'parcel', 500)`,
      )
      .run();
  }

  it('writes coverage, per-carrier rows, and per-feed age in stable order', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-30T12:00:00Z'));
    const ae = fakeAnalyticsEngine();
    const { d1 } = openMigratedD1();
    seedAll(d1);
    const env = { DB: d1, METRICS: ae.binding } as unknown as Env;

    const result = await measureAndRecordDataQualityGauges(env);

    expect(result.errors).toEqual([]);
    expect(result.coverage).toEqual({
      coveredProducts: 1,
      totalProducts: 2,
      ratio: 0.5,
    });
    expect(result.transportRows).toEqual({
      fransberg: 0,
      norrlog: 0,
      omniva: 0,
      pakettipojat: 0,
      posti: 1,
    });
    expect(result.feedAges).toEqual({ alko: 6 * 3600 });

    const indexes = ae.points.map((p) => p.indexes?.[0]);
    expect(indexes[0]).toBe(ALKO_REFERENCE_COVERAGE_GAUGE);
    // One row point per expected curated carrier, sorted (fransberg,
    // norrlog, omniva, pakettipojat, posti).
    expect(indexes.slice(1, 6)).toEqual([
      TRANSPORT_OFFER_ROWS_GAUGE,
      TRANSPORT_OFFER_ROWS_GAUGE,
      TRANSPORT_OFFER_ROWS_GAUGE,
      TRANSPORT_OFFER_ROWS_GAUGE,
      TRANSPORT_OFFER_ROWS_GAUGE,
    ]);
    expect(indexes[6]).toBe(FEED_LAST_SUCCESS_AGE_GAUGE);
    expect(ae.points[1].blobs?.[2]).toBe('{"carrier":"fransberg"}');
    expect(ae.points[2].blobs?.[2]).toBe('{"carrier":"norrlog"}');
    expect(ae.points[3].blobs?.[2]).toBe('{"carrier":"omniva"}');
    expect(ae.points[4].blobs?.[2]).toBe('{"carrier":"pakettipojat"}');
    expect(ae.points[5].blobs?.[2]).toBe('{"carrier":"posti"}');
    expect(ae.points[2].doubles?.[0]).toBe(0);
    expect(ae.points[5].doubles?.[0]).toBe(1);
    expect(ae.points[6].doubles?.[0]).toBe(6 * 3600);
  });

  it('isolates a failing measurement — the other gauges still write', async () => {
    const ae = fakeAnalyticsEngine();
    const { d1 } = openMigratedD1();
    seedAll(d1);
    const failingDb: D1DatabaseLike = {
      prepare(query: string): ReturnType<D1DatabaseLike['prepare']> {
        if (query.includes('transport_offers')) {
          throw new Error('D1 unavailable');
        }
        return d1.prepare(query);
      },
      batch: (statements) => d1.batch(statements),
    };
    const env = { DB: failingDb, METRICS: ae.binding } as unknown as Env;

    const result = await measureAndRecordDataQualityGauges(env);

    expect(result.transportRows).toBeNull();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain(TRANSPORT_OFFER_ROWS_GAUGE);
    expect(result.coverage).not.toBeNull();
    expect(result.feedAges).not.toBeNull();
    // Coverage + feed points exist; transport rows alone is missing.
    const indexes = ae.points.map((p) => p.indexes?.[0]);
    expect(indexes).toContain(ALKO_REFERENCE_COVERAGE_GAUGE);
    expect(indexes).toContain(FEED_LAST_SUCCESS_AGE_GAUGE);
    expect(indexes).not.toContain(TRANSPORT_OFFER_ROWS_GAUGE);
  });
});
