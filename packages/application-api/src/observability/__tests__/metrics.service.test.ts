/**
 * Tests for PrometheusMetricsService — the FIX-M metric contract.
 *
 * Covers the freshness gauges and per-status counters the PrometheusRule
 * alerts consume (infra/monitoring/README.md): initial zero state, the
 * stale-price-share ratio (including the empty-audit case), transport
 * offer age (including the no-offers +Inf case), counter accumulation,
 * and the DataQualityService static gauge hook wiring.
 *
 * Direct instantiation (no @nestjs/testing, METRICS_PORT unset so the
 * HTTP listener never starts) matching the sibling-test pattern.
 *
 * @module PrometheusMetricsServiceTest
 */

import { describe, it, expect, afterEach } from 'vitest';
import { DataQualityService, type QualityCheckOffer } from '@rajahinta/data-acquisition';
import type { ReliabilityService } from '@rajahinta/core-domain';
import { PrometheusMetricsService } from '../metrics.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReport(overrides: Partial<{
  totalOffers: number;
  staleCount: number;
  unavailableCount: number;
  estimatedCount: number;
  verifiedCount: number;
}> = {}) {
  return {
    totalOffers: 0,
    staleCount: 0,
    unavailableCount: 0,
    estimatedCount: 0,
    verifiedCount: 0,
    ...overrides,
    flaggedIssues: [],
  };
}

/** Minimal ReliabilityService stub: 24h threshold, STALE beyond it. */
function stubReliability(): ReliabilityService {
  return {
    stalenessThresholdFor: () => ({ milliseconds: 86_400_000 }),
    assessDataRecency: (observedAt: Date) =>
      Date.now() - observedAt.getTime() > 86_400_000 ? 'STALE' : 'VERIFIED',
  } as unknown as ReliabilityService;
}

/** Extract a named gauge/counter sample value from the exposition text. */
function sampleValue(body: string, name: string, labelFilter = ''): number {
  const line = body
    .split('\n')
    .find(
      (l) =>
        l.startsWith(name + (labelFilter ? `{${labelFilter}` : ' ')) ||
        l.startsWith(`${name}{${labelFilter}`),
    );
  if (line === undefined) throw new Error(`no sample for ${name}{${labelFilter}}`);
  return Number(line.split(' ').pop());
}

function offer(ageHours: number): QualityCheckOffer {
  return {
    merchant: 'test-merchant',
    productId: 1,
    observedAt: new Date(Date.now() - ageHours * 3_600_000),
    reliabilityStatus: 'VERIFIED',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PrometheusMetricsService', () => {
  let service: PrometheusMetricsService;

  afterEach(() => {
    // The constructor wires the static DQ hook — detach so test instances
    // cannot leak into other suites.
    DataQualityService.setQualityReportHook(null);
  });

  function create(): PrometheusMetricsService {
    service = new PrometheusMetricsService();
    return service;
  }

  /** Registry exposition text — the same code path the HTTP handler serves. */
  async function exposition(svc = service): Promise<string> {
    return (svc as unknown as { registry: { metrics(): Promise<string> } }).registry.metrics();
  }

  it('renders both gauges at 0 before any data flows', async () => {
    const svc = create();
    const body = await exposition(svc);
    expect(sampleValue(body, 'rajahinta_data_quality_stale_price_share_ratio')).toBe(0);
    expect(sampleValue(body, 'rajahinta_transport_newest_offer_age_seconds')).toBe(0);
  });

  it('renders the per-status counters at 0', async () => {
    const svc = create();
    const body = await exposition(svc);
    for (const status of ['verified', 'stale', 'estimated', 'unavailable']) {
      expect(
        sampleValue(body, 'rajahinta_data_quality_offers_total', `status="${status}"`),
      ).toBe(0);
    }
  });

  it('sets the stale-price share from a quality report', async () => {
    const svc = create();
    svc.recordQualityReport(
      makeReport({ totalOffers: 10, staleCount: 3, verifiedCount: 7 }),
    );
    const body = await exposition(svc);
    expect(sampleValue(body, 'rajahinta_data_quality_stale_price_share_ratio')).toBeCloseTo(0.3, 10);
    expect(sampleValue(body, 'rajahinta_data_quality_offers_total', 'status="stale"')).toBe(3);
    expect(sampleValue(body, 'rajahinta_data_quality_offers_total', 'status="verified"')).toBe(7);
  });

  it('reports share 0 when nothing was audited', async () => {
    const svc = create();
    svc.recordQualityReport(makeReport({ totalOffers: 0 }));
    const body = await exposition(svc);
    expect(sampleValue(body, 'rajahinta_data_quality_stale_price_share_ratio')).toBe(0);
  });

  it('accumulates counters across reports', async () => {
    const svc = create();
    svc.recordQualityReport(makeReport({ totalOffers: 4, staleCount: 1, verifiedCount: 3 }));
    svc.recordQualityReport(makeReport({ totalOffers: 4, staleCount: 2, estimatedCount: 2 }));
    const body = await exposition(svc);
    expect(sampleValue(body, 'rajahinta_data_quality_offers_total', 'status="stale"')).toBe(3);
    expect(sampleValue(body, 'rajahinta_data_quality_offers_total', 'status="estimated"')).toBe(2);
    // Share is last-write-wins (gauge), not cumulative: 2/4.
    expect(sampleValue(body, 'rajahinta_data_quality_stale_price_share_ratio')).toBe(0.5);
  });

  it('sets the transport offer age gauge in seconds', async () => {
    const svc = create();
    svc.setTransportNewestOfferAge(432_000);
    const body = await exposition(svc);
    expect(sampleValue(body, 'rajahinta_transport_newest_offer_age_seconds')).toBe(432_000);
  });

  it('renders +Inf when no transport offers exist', async () => {
    const svc = create();
    svc.setTransportNewestOfferAge(null);
    const body = await exposition(svc);
    expect(body).toMatch(
      /^rajahinta_transport_newest_offer_age_seconds \+Inf$/m,
    );
  });

  it('wires itself as the DataQualityService gauge hook (constructor)', async () => {
    const svc = create(); // constructor registers the static hook
    const dataQuality = new DataQualityService(stubReliability());

    // One fresh (1h old) and two stale (48h old) offers → share 2/3.
    dataQuality.runQualityCheck([offer(1), offer(48), offer(48)]);

    const body = await exposition(svc);
    expect(sampleValue(body, 'rajahinta_data_quality_stale_price_share_ratio')).toBeCloseTo(
      2 / 3,
      10,
    );
    expect(sampleValue(body, 'rajahinta_data_quality_offers_total', 'status="stale"')).toBe(2);
    expect(sampleValue(body, 'rajahinta_data_quality_offers_total', 'status="verified"')).toBe(1);
  });
});
