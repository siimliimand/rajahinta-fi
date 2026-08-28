/**
 * Alko adapter golden-dataset tests (task 7.5, change
 * technical-assessment-remediation; designs D6/D7).
 *
 * The golden fixture IS the payload contract (no live API entitlement):
 * these assertions pin the parser's exact output so any drift — from a
 * contract change in the parser or from a real feed wired later — fails
 * here instead of corrupting the domestic reference data.
 *
 * Also pins the governance-relevant behaviour: EUR-only list (Posti
 * precedent — non-EUR feeds are rejected until conversion exists),
 * Finnish category mapping through the shared source-category
 * normalization, per-item rejection of unmappable categories and
 * price-less reference rows, and EUR-native provenance (no FX version).
 *
 * @module AlkoFeedAdapterTest
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { AlkoFeedAdapter, parseAlkoAssortment } from '../adapters/alko.adapter';
import {
  ALKO_GOLDEN_PAYLOAD,
  ALKO_GOLDEN_PRODUCTS,
} from '../adapters/__fixtures__/alko-assortment.fixture';
import type { SourceGovernanceService, PermissionCheckResult } from '@rajahinta/core-domain';
import { PipelineOrchestratorService } from '../services/pipeline-orchestrator.service';
import { FeedIngestionService } from '../services/feed-ingestion.service';
import { DataMappingService } from '../services/data-mapping.service';
import { DataQualityService } from '../services/data-quality.service';
import { ReliabilityService } from '@rajahinta/core-domain';
import { ContentLintService } from '../content/content-lint.service';
import type { IUpsertRepository } from '../interfaces/upsert-port.interface';

const CONFIG = {
  feedUrl: 'https://registry-configured-alko-feed.example.invalid/assortment',
  feedFormat: 'json' as const,
};

function stubFetch(payload: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => payload,
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseAlkoAssortment — golden dataset', () => {
  const { records, errors } = parseAlkoAssortment(ALKO_GOLDEN_PAYLOAD);

  it('maps every well-formed golden row — 8 records, 2 per-item rejections', () => {
    expect(records).toHaveLength(8);
    expect(errors).toHaveLength(2);
  });

  it('produces exactly these canonical records (category → EUR cents)', () => {
    expect(records).toEqual([
      expect.objectContaining({ productId: '000001', category: 'beer', priceCents: 195, regulatoryClassification: 'beer' }),
      expect.objectContaining({ productId: '000002', category: 'beer', priceCents: 155 }),
      // Siideri → canonical cider → tax category other_fermented: the
      // record's category field carries the TAX key (gate + excise).
      expect.objectContaining({ productId: '000003', category: 'other_fermented', priceCents: 225, regulatoryClassification: 'other_fermented' }),
      expect.objectContaining({ productId: '000004', category: 'wine_still', priceCents: 897 }),
      expect.objectContaining({ productId: '000005', category: 'wine_sparkling', priceCents: 498 }),
      expect.objectContaining({ productId: '000006', category: 'spirits', priceCents: 1699 }),
      expect.objectContaining({ productId: '000007', category: 'other_fermented', priceCents: 295 }),
      expect.objectContaining({ productId: '000008', category: 'wine_sparkling', priceCents: 649, alcoholByVolume: 0 }),
    ]);
  });

  it('carries EUR-native provenance: original equals canonical, no FX version', () => {
    for (const record of records) {
      expect(record.currency).toBe('EUR');
      expect(record.originalCurrency).toBe('EUR');
      expect(record.originalPriceCents).toBe(record.priceCents);
      expect(record.fxDatasetVersion).toBeUndefined();
    }
  });

  it('keeps the EAN and Finnish deposit-system flag on reference records', () => {
    expect(records[0].ean).toBe('6411000000018');
    expect(records[0].depositSystem).toBe(true);
  });

  it('rejects the unmappable assortment group per-item to the correction queue', () => {
    expect(errors[0]).toContain('000009');
    expect(errors[0]).toContain('Juomasekoitukset ja muut');
    expect(errors[0]).toContain('correction queue');
  });

  it('rejects a price-less reference row per-item', () => {
    expect(errors[1]).toContain('000010');
    expect(errors[1]).toContain('invalid price');
  });

  it('golden fixture stays exhaustive — every fixture product appears once', () => {
    const mapped = new Set(records.map((r) => r.productId));
    const rejected = new Set(
      errors.map((e) => e.match(/product (\d+)/)?.[1]).filter(Boolean),
    );
    for (const product of ALKO_GOLDEN_PRODUCTS) {
      expect(mapped.has(product.productId) || rejected.has(product.productId)).toBe(true);
    }
  });
});

describe('parseAlkoAssortment — contract guards', () => {
  it('rejects a payload from another source', () => {
    const { records, errors } = parseAlkoAssortment({
      ...ALKO_GOLDEN_PAYLOAD,
      source: 'systembolaget',
    });
    expect(records).toEqual([]);
    expect(errors[0]).toContain('expected "alko"');
  });

  it('rejects a non-EUR price list (Posti precedent — conversion is task 1.4)', () => {
    const { records, errors } = parseAlkoAssortment({
      ...ALKO_GOLDEN_PAYLOAD,
      currency: 'SEK',
    });
    expect(records).toEqual([]);
    expect(errors[0]).toContain('is not EUR');
  });

  it('rejects payloads without a products array', () => {
    const { records, errors } = parseAlkoAssortment({ source: 'alko', currency: 'EUR' });
    expect(records).toEqual([]);
    expect(errors[0]).toContain('no products array');
  });
});

describe('AlkoFeedAdapter', () => {
  it('exposes the registry merchantId and maps through fetch', async () => {
    const fetchMock = stubFetch(ALKO_GOLDEN_PAYLOAD);
    const adapter = new AlkoFeedAdapter();

    expect(adapter.merchantId).toBe('alko');

    const { records, errors } = await adapter.fetch(CONFIG);

    expect(fetchMock).toHaveBeenCalledWith(CONFIG.feedUrl);
    expect(records).toHaveLength(8);
    expect(errors).toHaveLength(2);
  });

  it('reports HTTP failures as errors instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Unavailable',
      json: async () => ({}),
    }));

    const { records, errors } = await new AlkoFeedAdapter().fetch(CONFIG);

    expect(records).toEqual([]);
    expect(errors).toEqual([expect.stringContaining('HTTP 503')]);
  });
});

describe('Alko through the governance-gated pipeline (task 7.5, design D6)', () => {
  function grantedGovernance(): SourceGovernanceService {
    return {
      checkPermission: vi.fn().mockResolvedValue({
        merchantId: 'alko',
        permissionStatus: 'GRANTED',
        sources: [{ id: 1 }],
        hasWarnings: false,
      } as unknown as PermissionCheckResult),
    } as unknown as SourceGovernanceService;
  }

  function pipelineWith(
    governance: SourceGovernanceService,
    upsert: IUpsertRepository,
  ): PipelineOrchestratorService {
    const adapters = new Map();
    adapters.set('alko', new AlkoFeedAdapter());
    return new PipelineOrchestratorService(
      new FeedIngestionService(adapters),
      new DataMappingService(),
      new DataQualityService(new ReliabilityService()),
      upsert,
      governance,
      new ContentLintService(),
    );
  }

  const ALKO_REGISTRY_CONFIG = {
    merchantId: 'alko',
    name: 'Alko',
    country: 'FI',
    feedUrl: CONFIG.feedUrl,
    feedFormat: 'json' as const,
    pollingIntervalMs: 3_600_000,
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GRANTED: golden offers enter comparison data with reliability status and provenance', async () => {
    stubFetch(ALKO_GOLDEN_PAYLOAD);
    const upserts: Array<Record<string, unknown>> = [];
    const upsert: IUpsertRepository = {
      upsertProduct: vi.fn().mockImplementation((_input) => {
        const productId = upserts.length + 1;
        return Promise.resolve({ productId, created: true });
      }),
      upsertOffer: vi.fn().mockImplementation((input) => {
        upserts.push(input as Record<string, unknown>);
        return Promise.resolve({ offerId: upserts.length, changed: true });
      }),
    };

    const report = await pipelineWith(grantedGovernance(), upsert)
      .runForMerchant(ALKO_REGISTRY_CONFIG);

    // 8 well-formed golden rows upserted; the 2 rejected rows surface
    // as fetch errors, never as silent drops.
    expect(report.recordsAdded).toBe(8);
    expect(report.recordsFetched).toBe(8);
    expect(report.errors).toHaveLength(2);
    expect(report.gateResult).toBeUndefined();

    for (const offer of upserts) {
      expect(offer.merchant).toBe('alko');
      expect(offer.country).toBe('FI');
      expect(offer.currency).toBe('EUR');
      expect(offer.reliabilityStatus).toBe('ESTIMATED');
      expect(typeof offer.priceCents).toBe('number');
    }
  });

  it('not GRANTED: the gate skips the domestic reference merchant before any fetch', async () => {
    const fetchMock = stubFetch(ALKO_GOLDEN_PAYLOAD);
    const upsert: IUpsertRepository = {
      upsertProduct: vi.fn(),
      upsertOffer: vi.fn(),
    };
    const pending = {
      checkPermission: vi.fn().mockResolvedValue({
        merchantId: 'alko',
        permissionStatus: 'PENDING',
        sources: [{ id: 1 }],
        hasWarnings: false,
      } as unknown as PermissionCheckResult),
    } as unknown as SourceGovernanceService;

    const report = await pipelineWith(pending, upsert).runForMerchant(ALKO_REGISTRY_CONFIG);

    expect(report.recordsFetched).toBe(0);
    expect(report.gateResult?.permitted).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(upsert.upsertOffer).not.toHaveBeenCalled();
  });
});
