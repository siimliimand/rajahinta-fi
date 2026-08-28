/**
 * PipelinePriceIngestionAdapter registry-consumption tests (task 7.3 /
 * 7.2 leftover, change technical-assessment-remediation; design D7).
 *
 * Pins the fail-closed registry semantics: the registry row IS the
 * merchant config — an absent merchant is an onboarding error, a bogus
 * feed format is an operator-facing error, and a present row runs the
 * pipeline with registry-derived configuration. The static
 * merchants.config.ts is gone; nothing fabricates configs.
 *
 * @module PipelinePriceIngestionAdapterTest
 */
import { describe, it, expect, vi } from 'vitest';
import type {
  MerchantRegistryRecord,
  MerchantRegistryRepository,
} from '@rajahinta/data-platform';
import { PipelinePriceIngestionAdapter } from '../adapters/pipeline-price-ingestion.adapter';
import type { PipelineOrchestratorService } from '../services/pipeline-orchestrator.service';
import { merchantConfigFromRegistry } from '../interfaces/merchant-config.interface';

function registryRow(
  merchantId: string,
  overrides: Partial<MerchantRegistryRecord> = {},
): MerchantRegistryRecord {
  return {
    id: 1,
    merchantId,
    name: merchantId,
    country: 'FI',
    feedUrl: `https://${merchantId}.example.invalid/feed`,
    feedFormat: 'json',
    pollingIntervalMs: 3_600_000,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakeRegistry(
  findByMerchantId: (merchantId: string) => Promise<MerchantRegistryRecord | null>,
): MerchantRegistryRepository {
  return {
    findByMerchantId: vi.fn(findByMerchantId),
  } as unknown as MerchantRegistryRepository;
}

function fakePipeline() {
  return {
    runForMerchant: vi.fn().mockResolvedValue({
      merchantId: 'x',
      recordsFetched: 3,
      recordsAdded: 2,
      recordsUpdated: 1,
      offersChanged: 0,
      errors: [],
      durationMs: 5,
      contentViolations: [],
    }),
  };
}

function createAdapter(
  registry: MerchantRegistryRepository,
  pipeline: ReturnType<typeof fakePipeline> = fakePipeline(),
): { adapter: PipelinePriceIngestionAdapter; pipeline: ReturnType<typeof fakePipeline> } {
  return {
    adapter: new PipelinePriceIngestionAdapter(
      pipeline as unknown as PipelineOrchestratorService,
      registry,
    ),
    pipeline,
  };
}

describe('PipelinePriceIngestionAdapter (registry-backed)', () => {
  it('runs the pipeline with the configuration derived from the registry row', async () => {
    const row = registryRow('systembolaget', { country: 'SE', feedFormat: 'json' });
    const { adapter, pipeline } = createAdapter(
      fakeRegistry(async (id) => (id === 'systembolaget' ? row : null)),
    );

    const result = await adapter.ingestMerchantPrices(
      'systembolaget',
      'https://stale-url-from-job-data.example.invalid',
    );

    expect(result.productsIngested).toBe(3);
    expect(result.errors).toEqual([]);
    expect(pipeline.runForMerchant).toHaveBeenCalledTimes(1);
    expect(pipeline.runForMerchant).toHaveBeenCalledWith({
      merchantId: 'systembolaget',
      name: 'systembolaget',
      country: 'SE',
      feedUrl: row.feedUrl,
      feedFormat: 'json',
      pollingIntervalMs: 3_600_000,
    });
  });

  it('fails closed for a merchant absent from the registry — no fabricated config', async () => {
    const { adapter, pipeline } = createAdapter(fakeRegistry(async () => null));

    const result = await adapter.ingestMerchantPrices('unknown-merchant', 'https://x.invalid');

    expect(result.productsIngested).toBe(0);
    expect(result.errors).toEqual([
      expect.stringContaining('not in the merchant registry'),
    ]);
    expect(pipeline.runForMerchant).not.toHaveBeenCalled();
  });

  it('surfaces an unsupported registry feed format instead of fetching with it', async () => {
    const { adapter, pipeline } = createAdapter(
      fakeRegistry(async () => registryRow('alko', { feedFormat: 'rss' })),
    );

    const result = await adapter.ingestMerchantPrices('alko', '');

    expect(result.productsIngested).toBe(0);
    expect(result.errors).toEqual([
      expect.stringContaining('unsupported feed format "rss"'),
    ]);
    expect(pipeline.runForMerchant).not.toHaveBeenCalled();
  });
});

describe('merchantConfigFromRegistry', () => {
  it('narrows the registry feed format onto the pipeline union (case-insensitive)', () => {
    const derived = merchantConfigFromRegistry(
      registryRow('alko', { feedFormat: 'JSON' }),
    );
    expect(derived).toEqual({
      config: expect.objectContaining({ feedFormat: 'json' }),
    });
  });

  it('returns an error for a format the pipeline cannot parse', () => {
    const derived = merchantConfigFromRegistry(
      registryRow('alko', { feedFormat: 'rss' }),
    );
    expect(derived).toEqual({ error: expect.stringContaining('unsupported feed format') });
  });
});
