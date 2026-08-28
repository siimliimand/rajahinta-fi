import { describe, it, expect, vi } from 'vitest';
import { PipelineOrchestratorService } from '../services/pipeline-orchestrator.service';
import type { MerchantConfig } from '../interfaces/merchant-config.interface';
import type { SourceGovernanceService, PermissionCheckResult } from '@rajahinta/core-domain';
import { DataQualityService } from '../services/data-quality.service';
import { ReliabilityService } from '@rajahinta/core-domain';
import { ContentLintService } from '../content/content-lint.service';
import type {
  IOfferChangeHook,
  ChangedOfferEvent,
} from '../interfaces/offer-change-hook.interface';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MERCHANT: MerchantConfig = {
  merchantId: 'alko',
  name: 'Alko',
  country: 'FI',
  feedUrl: 'https://www.alko.fi/feed',
  feedFormat: 'json',
  pollingIntervalMs: 3_600_000,
};

const MERCHANT_NO_URL: MerchantConfig = {
  ...MERCHANT,
  feedUrl: '',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockPermissionCheckResult(
  overrides: Partial<PermissionCheckResult> & { permissionStatus: PermissionCheckResult['permissionStatus'] },
): PermissionCheckResult {
  return {
    merchantId: MERCHANT.merchantId,
    sources: [],
    hasWarnings: false,
    ...overrides,
  };
}

/** A mapped pair as the mapping mock returns it (loose shape is fine). */
function mappedPair(overrides: Record<string, unknown> = {}) {
  return {
    product: { name: 'Test Product', id: 'p1' },
    offerInput: {
      productId: 'p1',
      country: 'DE',
      priceCents: 100,
      reliabilityStatus: 'ESTIMATED',
      observedAt: new Date('2026-08-26T10:00:00Z'),
      ...overrides,
    },
  };
}

function createService(
  overrides: {
    governanceCheck?: () => Promise<PermissionCheckResult>;
    feedResult?: { records: unknown[]; errors: string[] };
    mappedPairs?: Array<ReturnType<typeof mappedPair>>;
    offerResults?: Array<{ offerId: number; changed: boolean }>;
    offerChangeHook?: IOfferChangeHook;
  } = {},
): PipelineOrchestratorService {
  const governanceMock = {
    checkPermission: vi.fn().mockImplementation(
      overrides.governanceCheck ??
        (() => Promise.resolve(mockPermissionCheckResult({ permissionStatus: 'GRANTED', sources: [{ id: 1 }] as any[] }))),
    ),
  } as unknown as SourceGovernanceService;

  const feedMock = {
    fetchFromMerchant: vi.fn().mockResolvedValue(
      overrides.feedResult ?? { records: [{ id: 'p1', name: 'Test' }], errors: [] },
    ),
  } as any;

  const pairs = overrides.mappedPairs ?? [mappedPair()];
  const mappingMock = {
    mapBatch: vi.fn().mockReturnValue(pairs),
  } as any;

  const offerResults = overrides.offerResults ?? [{ offerId: 101, changed: false }];
  let offerCall = 0;
  const upsertMock = {
    upsertProduct: vi.fn().mockImplementation(() => {
      // Deterministic per-pair product IDs (1, 2, ... by call order)
      const i = upsertMock.upsertProduct.mock.calls.length - 1;
      return Promise.resolve({ productId: i + 1, created: true });
    }),
    upsertOffer: vi.fn().mockImplementation(() => {
      const result = offerResults[Math.min(offerCall, offerResults.length - 1)];
      offerCall++;
      return Promise.resolve(result);
    }),
  } as any;

  const qualityMock = new DataQualityService(new ReliabilityService());

  const contentLintMock = {
    lintProductContent: vi.fn().mockReturnValue({ violations: [] }),
  } as unknown as ContentLintService;

  return new PipelineOrchestratorService(
    feedMock,
    mappingMock,
    qualityMock,
    upsertMock,
    governanceMock,
    contentLintMock,
    overrides.offerChangeHook,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PipelineOrchestratorService', () => {
  describe('runForMerchant', () => {
    it('skips merchant with empty feed URL', async () => {
      const service = createService();
      const report = await service.runForMerchant(MERCHANT_NO_URL);

      expect(report.recordsFetched).toBe(0);
      expect(report.recordsAdded).toBe(0);
      expect(report.errors).toEqual([]);
      expect(report.gateResult).toBeUndefined();
      expect(report.contentViolations).toEqual([]);
    });

    it('skips merchant with PENDING permission status', async () => {
      const service = createService({
        governanceCheck: () =>
          Promise.resolve(
            mockPermissionCheckResult({
              permissionStatus: 'PENDING',
              sources: [{ id: 1, permissionStatus: 'PENDING' }] as any[],
            }),
          ),
      });

      const report = await service.runForMerchant(MERCHANT);

      expect(report.recordsFetched).toBe(0);
      expect(report.recordsAdded).toBe(0);
      expect(report.gateResult).toBeDefined();
      expect(report.gateResult!.permitted).toBe(false);
      expect(report.gateResult!.status).toBe('PENDING');
      expect(report.gateResult!.reason).toContain('PENDING');
      expect(report.contentViolations).toEqual([]);
    });

    it('skips merchant with REVOKED permission status', async () => {
      const service = createService({
        governanceCheck: () =>
          Promise.resolve(
            mockPermissionCheckResult({
              permissionStatus: 'REVOKED',
              sources: [{ id: 1, permissionStatus: 'REVOKED' }] as any[],
            }),
          ),
      });

      const report = await service.runForMerchant(MERCHANT);

      expect(report.recordsFetched).toBe(0);
      expect(report.gateResult).toBeDefined();
      expect(report.gateResult!.permitted).toBe(false);
      expect(report.gateResult!.status).toBe('REVOKED');
    });

    it('skips merchant with EXPIRED permission status', async () => {
      const service = createService({
        governanceCheck: () =>
          Promise.resolve(
            mockPermissionCheckResult({
              permissionStatus: 'EXPIRED',
              sources: [{ id: 1, permissionStatus: 'EXPIRED' }] as any[],
            }),
          ),
      });

      const report = await service.runForMerchant(MERCHANT);

      expect(report.recordsFetched).toBe(0);
      expect(report.gateResult).toBeDefined();
      expect(report.gateResult!.permitted).toBe(false);
      expect(report.gateResult!.status).toBe('EXPIRED');
    });

    it('treats merchants with no governance records as PENDING (off)', async () => {
      const service = createService({
        governanceCheck: () =>
          Promise.resolve(
            mockPermissionCheckResult({
              permissionStatus: 'PENDING',
              sources: [],
            }),
          ),
      });

      const report = await service.runForMerchant(MERCHANT);

      expect(report.recordsFetched).toBe(0);
      expect(report.gateResult).toBeDefined();
      expect(report.gateResult!.permitted).toBe(false);
      expect(report.gateResult!.status).toBe('PENDING');
      expect(report.gateResult!.reason).toContain('No governance records');
    });

    it('treats merchants when governance check throws as PENDING (off)', async () => {
      const service = createService({
        governanceCheck: () =>
          Promise.reject(new Error('Repository connection failed')),
      });

      const report = await service.runForMerchant(MERCHANT);

      expect(report.recordsFetched).toBe(0);
      expect(report.gateResult).toBeDefined();
      expect(report.gateResult!.permitted).toBe(false);
      expect(report.gateResult!.status).toBe('PENDING');
      expect(report.gateResult!.reason).toContain('Governance check error');
    });

    it('proceeds with ingestion when permission is GRANTED', async () => {
      const service = createService({
        governanceCheck: () =>
          Promise.resolve(
            mockPermissionCheckResult({
              permissionStatus: 'GRANTED',
              sources: [{ id: 1, permissionStatus: 'GRANTED' }] as any[],
            }),
          ),
        feedResult: { records: [{ id: 'p1', name: 'Test Product' }], errors: [] },
      });

      const report = await service.runForMerchant(MERCHANT);

      expect(report.gateResult).toBeUndefined();
      expect(report.recordsFetched).toBe(1);
      expect(report.recordsAdded).toBe(1);
      expect(report.errors).toEqual([]);
      expect(report.durationMs).toBeGreaterThanOrEqual(0);
      expect(report.qualityReport).toBeDefined();
      expect(report.qualityReport!.totalOffers).toBe(1);
      expect(report.contentViolations).toEqual([]);
    });

    it('passes through fetch errors when records are empty', async () => {
      const service = createService({
        governanceCheck: () =>
          Promise.resolve(
            mockPermissionCheckResult({
              permissionStatus: 'GRANTED',
              sources: [{ id: 1, permissionStatus: 'GRANTED' }] as any[],
            }),
          ),
        feedResult: { records: [], errors: ['HTTP 503'] },
      });

      const report = await service.runForMerchant(MERCHANT);

      expect(report.recordsFetched).toBe(0);
      expect(report.errors).toEqual(['HTTP 503']);
      expect(report.gateResult).toBeUndefined();
      expect(report.contentViolations).toEqual([]);
    });
  });

  describe('runForMerchant — offer-change hook (task 2.2)', () => {
    it('invokes the hook exactly once per changed offer with the offer payload', async () => {
      const onOfferChanged = vi.fn().mockResolvedValue(undefined);
      const observedAtA = new Date('2026-08-26T10:00:00Z');
      const observedAtB = new Date('2026-08-26T10:00:01Z');
      const service = createService({
        mappedPairs: [
          mappedPair({ priceCents: 1099, observedAt: observedAtA }),
          mappedPair({ priceCents: 2499, observedAt: observedAtB }),
        ],
        offerResults: [
          { offerId: 501, changed: true },
          { offerId: 502, changed: true },
        ],
        offerChangeHook: { onOfferChanged },
      });

      const report = await service.runForMerchant(MERCHANT);

      expect(onOfferChanged).toHaveBeenCalledTimes(2);
      const first = onOfferChanged.mock.calls[0][0] as ChangedOfferEvent;
      expect(first).toEqual({
        productId: 1,
        offerId: 501,
        merchant: 'alko',
        country: 'DE',
        priceCents: 1099,
        reliabilityStatus: 'ESTIMATED',
        observedAt: observedAtA,
      });
      const second = onOfferChanged.mock.calls[1][0] as ChangedOfferEvent;
      expect(second.offerId).toBe(502);
      expect(second.productId).toBe(2);
      expect(second.priceCents).toBe(2499);
      expect(report.offersChanged).toBe(2);
    });

    it('never invokes the hook for unchanged offers (unchanged re-scrapes append no observation)', async () => {
      const onOfferChanged = vi.fn().mockResolvedValue(undefined);
      const service = createService({
        mappedPairs: [mappedPair(), mappedPair()],
        offerResults: [
          { offerId: 501, changed: false },
          { offerId: 502, changed: false },
        ],
        offerChangeHook: { onOfferChanged },
      });

      const report = await service.runForMerchant(MERCHANT);

      expect(onOfferChanged).not.toHaveBeenCalled();
      expect(report.offersChanged).toBe(0);
      // Offers are still upserted and quality-checked as before
      expect(report.recordsAdded).toBe(2);
      expect(report.qualityReport).toBeDefined();
      expect(report.qualityReport!.totalOffers).toBe(2);
    });

    it('invokes the hook only for the changed offer in a mixed batch', async () => {
      const onOfferChanged = vi.fn().mockResolvedValue(undefined);
      const service = createService({
        mappedPairs: [
          mappedPair({ priceCents: 100 }),
          mappedPair({ priceCents: 200 }),
          mappedPair({ priceCents: 300 }),
        ],
        offerResults: [
          { offerId: 501, changed: false },
          { offerId: 502, changed: true },
          { offerId: 503, changed: false },
        ],
        offerChangeHook: { onOfferChanged },
      });

      const report = await service.runForMerchant(MERCHANT);

      expect(onOfferChanged).toHaveBeenCalledTimes(1);
      expect((onOfferChanged.mock.calls[0][0] as ChangedOfferEvent).offerId).toBe(502);
      expect(report.offersChanged).toBe(1);
    });

    it('isolates hook failures — logs, continues remaining offers, run stays clean', async () => {
      const onOfferChanged = vi
        .fn()
        .mockRejectedValueOnce(new Error('Classification gate rejected product 1'))
        .mockResolvedValueOnce(undefined);
      const service = createService({
        mappedPairs: [mappedPair(), mappedPair()],
        offerResults: [
          { offerId: 501, changed: true },
          { offerId: 502, changed: true },
        ],
        offerChangeHook: { onOfferChanged },
      });

      const report = await service.runForMerchant(MERCHANT);

      // Both changed offers reached the hook despite the first failure
      expect(onOfferChanged).toHaveBeenCalledTimes(2);
      // The ingestion run itself is unaffected: upserts counted, no errors
      expect(report.recordsAdded).toBe(2);
      expect(report.offersChanged).toBe(2);
      expect(report.errors).toEqual([]);
      expect(report.qualityReport!.totalOffers).toBe(2);
    });

    it('runs changed offers without a registered hook (optional port)', async () => {
      const service = createService({
        offerResults: [{ offerId: 501, changed: true }],
      });

      const report = await service.runForMerchant(MERCHANT);

      expect(report.offersChanged).toBe(1);
      expect(report.recordsAdded).toBe(1);
      expect(report.errors).toEqual([]);
    });
  });

  describe('runAll', () => {
    it('runs pipeline for each merchant and returns reports', async () => {
      const service = createService({
        governanceCheck: () =>
          Promise.resolve(
            mockPermissionCheckResult({
              permissionStatus: 'GRANTED',
              sources: [{ id: 1, permissionStatus: 'GRANTED' }] as any[],
            }),
          ),
      });

      const reports = await service.runAll([
        MERCHANT,
        { ...MERCHANT, merchantId: 'systembolaget' },
      ]);

      expect(reports).toHaveLength(2);
      expect(reports[0].merchantId).toBe('alko');
      expect(reports[1].merchantId).toBe('systembolaget');
    });
  });
});