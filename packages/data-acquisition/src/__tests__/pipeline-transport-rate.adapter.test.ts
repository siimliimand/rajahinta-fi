/**
 * Tests for the governance-gated transport-rate refresh (task 7.4).
 *
 * Pins the pipeline contract: carriers without GRANTED governance
 * permission are skipped before any fetch or write (default-off), a
 * successful refresh appends offers with VERIFIED reliability, and the
 * result carries the newest observedAt the freshness alert measures.
 *
 * @module PipelineTransportRateAdapterTests
 */
import { describe, it, expect, vi } from 'vitest';
import { PipelineTransportRateAdapter } from '../adapters/pipeline-transport-rate.adapter';
import type { ICarrierRateSource, CarrierRateOffer } from '../interfaces/carrier-rate-source.port';
import type {
  ITransportOfferWritePort,
  TransportOfferWrite,
} from '../interfaces/transport-offer-write.port';
import type { SourceGovernanceService } from '@rajahinta/core-domain';
import type { PermissionCheckResult } from '@rajahinta/core-domain';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const OBSERVED = new Date('2026-08-26T06:00:00Z');

function rate(overrides: Partial<CarrierRateOffer> = {}): CarrierRateOffer {
  return {
    carrier: 'posti',
    originCountry: 'FI',
    destinationCountry: 'FI',
    weightMinKg: 0,
    weightMaxKg: 2,
    packageTier: 'parcel',
    priceCents: 690,
    currency: 'EUR',
    sellerInvolvementIndicator: false,
    observedAt: OBSERVED,
    ...overrides,
  };
}

function grantedCheck(): PermissionCheckResult {
  return {
    merchantId: 'posti',
    permissionStatus: 'GRANTED',
    sources: [
      {
        id: 1,
        merchantId: 'posti',
        acquisitionMethod: 'LICENSED_PROVIDER',
        permissionStatus: 'GRANTED',
        sourceUrl: 'https://www.posti.fi/api/price-list/parcels.json',
        statusReason: null,
        lastVerifiedAt: new Date('2026-01-01T00:00:00Z'),
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ],
    hasWarnings: false,
  };
}

function createGovernance(
  result: PermissionCheckResult | Error,
): SourceGovernanceService {
  const checkPermission = vi.fn<() => Promise<PermissionCheckResult>>();
  if (result instanceof Error) checkPermission.mockRejectedValue(result);
  else checkPermission.mockResolvedValue(result);
  return { checkPermission } as unknown as SourceGovernanceService;
}

function createSource(
  rates: CarrierRateOffer[],
  errors: string[] = [],
): ICarrierRateSource {
  return { carrierId: 'posti', fetchRates: vi.fn().mockResolvedValue({ rates, errors }) };
}

function createWritePort(newest: Date | null = OBSERVED) {
  const inserted: TransportOfferWrite[] = [];
  const port: ITransportOfferWritePort = {
    insertOffers: vi.fn(async (offers: readonly TransportOfferWrite[]) => {
      inserted.push(...offers);
      return { inserted: offers.length };
    }),
    findNewestObservedAt: vi.fn(async () => newest),
  };
  return { port, inserted };
}

function createAdapter(
  governance: SourceGovernanceService,
  source: ICarrierRateSource,
  writePort: ITransportOfferWritePort,
) {
  const sources = new Map<string, ICarrierRateSource>([[source.carrierId, source]]);
  return {
    adapter: new PipelineTransportRateAdapter(governance, sources, writePort),
    sources,
  };
}

// ---------------------------------------------------------------------------
// Governance gate
// ---------------------------------------------------------------------------

describe('PipelineTransportRateAdapter — governance gate', () => {
  it('skips a carrier with no governance records (default-off)', async () => {
    const governance = createGovernance({ ...grantedCheck(), sources: [] });
    const source = createSource([rate()]);
    const { port, inserted } = createWritePort();
    const { adapter } = createAdapter(governance, source, port);

    const result = await adapter.refreshCarrierRates('posti');

    expect(result.ratesUpdated).toBe(0);
    expect(source.fetchRates).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
    // Freshness still evaluated: newest timestamp returned even on skip.
    expect(result.newestOfferObservedAt).toEqual(OBSERVED);
  });

  it('skips a carrier whose permission is PENDING', async () => {
    const governance = createGovernance({ ...grantedCheck(), permissionStatus: 'PENDING' });
    const source = createSource([rate()]);
    const { port } = createWritePort();
    const { adapter } = createAdapter(governance, source, port);

    const result = await adapter.refreshCarrierRates('posti');

    expect(result.ratesUpdated).toBe(0);
    expect(source.fetchRates).not.toHaveBeenCalled();
  });

  it('skips a carrier when the governance check errors (fail closed)', async () => {
    const governance = createGovernance(new Error('repository down'));
    const source = createSource([rate()]);
    const { port } = createWritePort();
    const { adapter } = createAdapter(governance, source, port);

    const result = await adapter.refreshCarrierRates('posti');

    expect(result.ratesUpdated).toBe(0);
    expect(source.fetchRates).not.toHaveBeenCalled();
  });

  it('skips an unknown carrier id without touching the write port', async () => {
    const governance = createGovernance(grantedCheck());
    const source = createSource([rate()]);
    const { port } = createWritePort();
    const { adapter } = createAdapter(governance, source, port);

    const result = await adapter.refreshCarrierRates('dhl');

    expect(result.ratesUpdated).toBe(0);
    expect(source.fetchRates).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Refresh + persistence
// ---------------------------------------------------------------------------

describe('PipelineTransportRateAdapter — refresh', () => {
  it('appends GRANTED carrier rates with VERIFIED reliability', async () => {
    const governance = createGovernance(grantedCheck());
    const source = createSource([rate(), rate({ priceCents: 1240, weightMinKg: 2, weightMaxKg: 10 })]);
    const { port, inserted } = createWritePort();
    const { adapter } = createAdapter(governance, source, port);

    const result = await adapter.refreshCarrierRates('posti');

    expect(result.ratesUpdated).toBe(2);
    expect(inserted).toHaveLength(2);
    expect(inserted.every((w) => w.reliabilityStatus === 'VERIFIED')).toBe(true);
    expect(result.newestOfferObservedAt).toEqual(OBSERVED);
  });

  it('appends nothing when the source returns only errors', async () => {
    const governance = createGovernance(grantedCheck());
    const source = createSource([], ['Posti fetch failed: HTTP 503']);
    const { port, inserted } = createWritePort(new Date('2026-01-01T00:00:00Z'));
    const { adapter } = createAdapter(governance, source, port);

    const result = await adapter.refreshCarrierRates('posti');

    expect(result.ratesUpdated).toBe(0);
    expect(inserted).toHaveLength(0);
    expect(result.newestOfferObservedAt).toEqual(new Date('2026-01-01T00:00:00Z'));
  });

  it('refreshes every registered carrier on the "*" wildcard', async () => {
    const governance = createGovernance(grantedCheck());
    const posti = createSource([rate()]);
    const dhl = { ...createSource([rate({ carrier: 'dhl' })]), carrierId: 'dhl' } as ICarrierRateSource;
    const { port } = createWritePort();
    const sources = new Map<string, ICarrierRateSource>([
      [posti.carrierId, posti],
      [dhl.carrierId, dhl],
    ]);
    const adapter = new PipelineTransportRateAdapter(governance, sources, port);

    const result = await adapter.refreshCarrierRates('*');

    expect(posti.fetchRates).toHaveBeenCalledTimes(1);
    expect(dhl.fetchRates).toHaveBeenCalledTimes(1);
    expect(result.ratesUpdated).toBe(2);
  });

  it('a governance-skipped carrier does not block the others', async () => {
    const checkPermission = vi.fn(async (carrierId: string) => {
      if (carrierId === 'posti') {
        return { ...grantedCheck(), merchantId: 'posti' };
      }
      return { ...grantedCheck(), merchantId: 'dhl', permissionStatus: 'PENDING' as const };
    });
    const governance = { checkPermission } as unknown as SourceGovernanceService;

    const posti = createSource([rate()]);
    const dhl = { ...createSource([rate({ carrier: 'dhl' })]), carrierId: 'dhl' } as ICarrierRateSource;
    const { port, inserted } = createWritePort();
    const sources = new Map<string, ICarrierRateSource>([
      [posti.carrierId, posti],
      [dhl.carrierId, dhl],
    ]);
    const adapter = new PipelineTransportRateAdapter(governance, sources, port);

    const result = await adapter.refreshCarrierRates('*');

    expect(result.ratesUpdated).toBe(1);
    expect(inserted.every((w) => w.rate.carrier === 'posti')).toBe(true);
  });
});
