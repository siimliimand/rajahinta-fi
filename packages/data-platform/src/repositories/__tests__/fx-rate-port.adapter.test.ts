/**
 * FxRateDatasetRepositoryAdapter tests (task 1.3, change
 * technical-assessment-remediation).
 *
 * Pins the binding contract between the Drizzle FX repository and the
 * core-domain port: NewFxDataset inputs map onto dataset+rate rows with
 * the rate serialized for pg numeric, persisted rows map back onto the
 * domain version shape with the pg numeric string coerced to a number
 * at this boundary, and creation is always PENDING_CONFIRMATION
 * regardless of what the caller passes.
 *
 * @module FxRateDatasetRepositoryAdapterTest
 */
import { describe, it, expect, vi } from 'vitest';
import { FxRateDatasetRepositoryAdapter } from '../fx-rate-port.adapter';
import { DrizzleFxRateRepository } from '../fx-rate.repository';
import type { FxRateDatasetRecord, FxRateRow } from '../../abstracts';

const DATASET_ROW: FxRateDatasetRecord = {
  id: 7,
  versionLabel: 'ecb-2026-08-27',
  sourceName: 'ecb-reference-rates',
  sourceUrl: 'https://api.frankfurter.dev/v1/latest',
  referenceDate: '2026-08-27',
  status: 'PENDING_CONFIRMATION',
  effectiveFrom: new Date('2026-08-27T00:00:00.000Z'),
  effectiveTo: null,
  confirmedBy: null,
  confirmedAt: null,
  createdAt: new Date('2026-08-28T02:00:00.000Z'),
};

const RATE_ROWS: FxRateRow[] = [
  {
    id: 1,
    datasetId: 7,
    baseCurrency: 'EUR',
    quoteCurrency: 'SEK',
    rate: '11.290000000000',
    createdAt: new Date(),
  },
];

function fakeRepo(overrides: Partial<DrizzleFxRateRepository> = {}): DrizzleFxRateRepository {
  const base = {
    createDataset: vi.fn().mockResolvedValue(DATASET_ROW),
    findDatasetById: vi.fn().mockResolvedValue(DATASET_ROW),
    findDatasetByVersionLabel: vi.fn().mockResolvedValue(DATASET_ROW),
    findPendingDatasets: vi.fn().mockResolvedValue([DATASET_ROW]),
    findPublishedDatasetEffectiveOn: vi.fn().mockResolvedValue(null),
    publishDataset: vi.fn().mockResolvedValue({
      ...DATASET_ROW,
      status: 'PUBLISHED',
      confirmedBy: 'ops@example.invalid',
      confirmedAt: new Date(),
    }),
    findRatesForDataset: vi.fn().mockResolvedValue(RATE_ROWS),
    resolveRate: vi.fn().mockResolvedValue(null),
  };
  return { ...base, ...overrides } as unknown as DrizzleFxRateRepository;
}

describe('FxRateDatasetRepositoryAdapter', () => {
  it('maps a NewFxDataset onto dataset + rate rows, forcing PENDING_CONFIRMATION', async () => {
    const repo = fakeRepo();
    const adapter = new FxRateDatasetRepositoryAdapter(repo);

    const version = await adapter.createDataset({
      versionLabel: 'ecb-2026-08-27',
      sourceName: 'ecb-reference-rates',
      sourceUrl: 'https://api.frankfurter.dev/v1/latest',
      referenceDate: '2026-08-27',
      effectiveFrom: new Date('2026-08-27T00:00:00.000Z'),
      rates: [{ baseCurrency: 'EUR', quoteCurrency: 'SEK', rate: 11.29 }],
    });

    expect(repo.createDataset).toHaveBeenCalledWith(
      expect.objectContaining({
        versionLabel: 'ecb-2026-08-27',
        sourceUrl: 'https://api.frankfurter.dev/v1/latest',
        status: 'PENDING_CONFIRMATION',
        effectiveTo: null,
      }),
      [{ baseCurrency: 'EUR', quoteCurrency: 'SEK', rate: '11.29' }],
    );
    expect(version.id).toBe(7);
    expect(version.status).toBe('PENDING_CONFIRMATION');
    expect(version.versionLabel).toBe('ecb-2026-08-27');
  });

  it('coerces the pg numeric rate string to a number at the boundary', async () => {
    const repo = fakeRepo();
    const adapter = new FxRateDatasetRepositoryAdapter(repo);

    const rates = await adapter.findRatesForDataset(7);

    expect(rates).toEqual([
      { baseCurrency: 'EUR', quoteCurrency: 'SEK', rate: 11.29 },
    ]);
  });

  it('delegates the manual publish transition and maps the confirmed row', async () => {
    const repo = fakeRepo();
    const adapter = new FxRateDatasetRepositoryAdapter(repo);

    const published = await adapter.publishDataset(7, 'ops@example.invalid');

    expect(repo.publishDataset).toHaveBeenCalledWith(7, 'ops@example.invalid');
    expect(published?.status).toBe('PUBLISHED');
    expect(published?.confirmedBy).toBe('ops@example.invalid');
  });

  it('surfaces the pending-review queue from the repository', async () => {
    const repo = fakeRepo();
    const adapter = new FxRateDatasetRepositoryAdapter(repo);

    const pending = await adapter.findPendingDatasets();

    expect(pending).toHaveLength(1);
    expect(pending[0].versionLabel).toBe('ecb-2026-08-27');
  });

  it('rejects an unknown lifecycle status rather than inventing one', async () => {
    const repo = fakeRepo({
      findDatasetByVersionLabel: vi.fn().mockResolvedValue({
        ...DATASET_ROW,
        status: 'SUPERSEDED',
      }),
    });
    const adapter = new FxRateDatasetRepositoryAdapter(repo);

    await expect(adapter.findDatasetByVersionLabel('x')).rejects.toThrow(
      /not a known FX dataset lifecycle state/i,
    );
  });
});
