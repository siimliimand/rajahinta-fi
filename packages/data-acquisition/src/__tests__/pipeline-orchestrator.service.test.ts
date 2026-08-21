import { describe, it, expect, vi } from 'vitest';
import { PipelineOrchestratorService } from '../services/pipeline-orchestrator.service';
import type { MerchantConfig } from '../config/merchants.config';
import type { SourceGovernanceService, PermissionCheckResult } from '@rajahinta/core-domain';
import { DataQualityService } from '../services/data-quality.service';
import { ReliabilityService } from '@rajahinta/core-domain';
import { ContentLintService } from '../content/content-lint.service';

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

function createService(
  overrides: {
    governanceCheck?: () => Promise<PermissionCheckResult>;
    feedResult?: { records: unknown[]; errors: string[] };
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

  const mappingMock = {
    mapBatch: vi.fn().mockReturnValue([
      {
        product: { name: 'Test Product', id: 'p1' },
        offerInput: {
          productId: 'p1',
          priceCents: 100,
          reliability: 'ESTIMATED',
          observedAt: new Date(),
        },
      },
    ]),
  } as any;

  const upsertMock = {
    upsertProduct: vi.fn().mockResolvedValue({ productId: 'p1', created: true }),
    upsertOffer: vi.fn().mockResolvedValue(undefined),
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