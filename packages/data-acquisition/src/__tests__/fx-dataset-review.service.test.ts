/**
 * FX dataset review service tests (task 1.3, change
 * technical-assessment-remediation; design D2).
 *
 * Pins the governance semantics of the recurring FX check against the
 * REAL FxRateDatasetService over an in-memory port:
 * - a new source reference date creates exactly one PENDING_CONFIRMATION
 *   dataset (the confirmation task) — never a published one;
 * - re-checking the same reference date is a no-op (idempotent labels);
 * - source failures are reported, never thrown;
 * - a lost creation race (version conflict) degrades to a no-op.
 *
 * @module FxDatasetReviewServiceTest
 */
import { describe, it, expect, vi } from 'vitest';
import {
  FxRateDatasetService,
  type FxDatasetVersion,
  type FxRateEntry,
  type IFxRateDatasetRepositoryPort,
  type NewFxDataset,
} from '@rajahinta/core-domain';
import { FxDatasetReviewService } from '../services/fx-dataset-review.service';
import type { FxRateSnapshot, IFxRateSource } from '../interfaces/fx-rate-source.port';

/**
 * Conflict error stand-in with the domain error's name — the review
 * service discriminates by name because the core-domain error classes
 * are not re-exported at the package root.
 */
class FxDatasetVersionConflictError extends Error {
  constructor(versionLabel: string) {
    super(`FX dataset version "${versionLabel}" already exists — datasets are append-only`);
    this.name = 'FxDatasetVersionConflictError';
  }
}

// ---------------------------------------------------------------------------
// In-memory FX dataset port (repository contract honoured)
// ---------------------------------------------------------------------------

class InMemoryFxPort implements IFxRateDatasetRepositoryPort {
  datasets: FxDatasetVersion[] = [];
  private readonly ratesByDataset = new Map<number, FxRateEntry[]>();
  private nextId = 1;

  async createDataset(input: NewFxDataset): Promise<FxDatasetVersion> {
    if (this.datasets.some((d) => d.versionLabel === input.versionLabel)) {
      throw new FxDatasetVersionConflictError(input.versionLabel);
    }
    const dataset: FxDatasetVersion = {
      id: this.nextId++,
      versionLabel: input.versionLabel,
      sourceName: input.sourceName,
      sourceUrl: input.sourceUrl ?? null,
      referenceDate: input.referenceDate,
      status: 'PENDING_CONFIRMATION',
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
      confirmedBy: null,
      confirmedAt: null,
      createdAt: new Date(),
    };
    this.datasets.push(dataset);
    this.ratesByDataset.set(dataset.id, [...input.rates]);
    return dataset;
  }

  async findDatasetByVersionLabel(versionLabel: string) {
    return this.datasets.find((d) => d.versionLabel === versionLabel) ?? null;
  }

  async findDatasetById(id: number) {
    return this.datasets.find((d) => d.id === id) ?? null;
  }

  async findPendingDatasets() {
    return this.datasets.filter((d) => d.status === 'PENDING_CONFIRMATION');
  }

  async findPublishedDatasetEffectiveOn(_asOf: Date) {
    return this.datasets.filter((d) => d.status === 'PUBLISHED')[0] ?? null;
  }

  async publishDataset(id: number, confirmedBy: string) {
    const index = this.datasets.findIndex((d) => d.id === id);
    if (index === -1 || this.datasets[index].status !== 'PENDING_CONFIRMATION') return null;
    const published: FxDatasetVersion = {
      ...this.datasets[index],
      status: 'PUBLISHED',
      confirmedBy,
      confirmedAt: new Date(),
    };
    this.datasets[index] = published;
    return published;
  }

  async findRatesForDataset(datasetId: number) {
    return this.ratesByDataset.get(datasetId) ?? [];
  }
}

// ---------------------------------------------------------------------------
// Source fakes
// ---------------------------------------------------------------------------

function snapshotFor(referenceDate: string): FxRateSnapshot {
  return {
    sourceId: 'ecb',
    sourceName: 'ecb-reference-rates',
    sourceUrl: null,
    referenceDate,
    rates: [
      { baseCurrency: 'EUR', quoteCurrency: 'SEK', rate: 11.294 },
      { baseCurrency: 'EUR', quoteCurrency: 'GBP', rate: 0.8571 },
    ],
  };
}

function sourceWith(snapshot: FxRateSnapshot | null, errors: string[] = []): IFxRateSource {
  return {
    sourceId: 'ecb',
    fetchLatestRates: vi.fn().mockResolvedValue({ snapshot, errors }),
  };
}

function createService(source: IFxRateSource, port = new InMemoryFxPort()) {
  return {
    port,
    service: new FxDatasetReviewService(source, new FxRateDatasetService(port)),
  };
}

describe('FxDatasetReviewService', () => {
  it('creates exactly one PENDING_CONFIRMATION dataset for a new reference date', async () => {
    const { port, service } = createService(sourceWith(snapshotFor('2026-08-27')));

    const result = await service.checkForNewRates();

    expect(result.datasetsFound).toBe(1);
    expect(result.requiresConfirmation).toBe(true);
    expect(result.detectedVersions).toEqual(['ecb-2026-08-27']);
    expect(result.errors).toEqual([]);

    expect(port.datasets).toHaveLength(1);
    expect(port.datasets[0].status).toBe('PENDING_CONFIRMATION');
    expect(port.datasets[0].confirmedBy).toBeNull();
    expect(port.datasets[0].effectiveTo).toBeNull();
  });

  it('is idempotent — a known reference date creates nothing on re-check', async () => {
    const { service } = createService(sourceWith(snapshotFor('2026-08-27')));

    await service.checkForNewRates();
    const second = await service.checkForNewRates();

    expect(second.datasetsFound).toBe(0);
    expect(second.requiresConfirmation).toBe(true);
    expect(second.detectedVersions).toEqual(['ecb-2026-08-27']);
  });

  it('reports an already-published reference date as nothing new', async () => {
    const port = new InMemoryFxPort();
    const { service } = createService(sourceWith(snapshotFor('2026-08-27')), port);

    await service.checkForNewRates();
    const [dataset] = await port.findPendingDatasets();
    await port.publishDataset(dataset.id, 'ops@example.invalid');

    const second = await service.checkForNewRates();

    expect(second.datasetsFound).toBe(0);
    expect(second.requiresConfirmation).toBe(false);
  });

  it('reports source failures instead of throwing', async () => {
    const { service } = createService(
      sourceWith(null, ['ECB fetch failed: HTTP 503']),
    );

    const result = await service.checkForNewRates();

    expect(result.datasetsFound).toBe(0);
    expect(result.requiresConfirmation).toBe(false);
    expect(result.errors).toEqual(['ECB fetch failed: HTTP 503']);
  });

  it('degrades a lost creation race (version conflict) to a no-op', async () => {
    const racingSource: IFxRateSource = {
      sourceId: 'ecb',
      fetchLatestRates: vi.fn().mockResolvedValue({ snapshot: snapshotFor('2026-08-27'), errors: [] }),
    };
    // The repository is empty for the novelty check, but createDataset
    // throws the conflict a concurrent winner would have produced.
    const port = new InMemoryFxPort();
    const spy = vi.spyOn(port, 'findDatasetByVersionLabel').mockResolvedValue(null);
    vi.spyOn(FxRateDatasetService.prototype, 'createPendingDataset')
      .mockRejectedValueOnce(new FxDatasetVersionConflictError('ecb-2026-08-27'));
    const service = new FxDatasetReviewService(racingSource, new FxRateDatasetService(port));

    const result = await service.checkForNewRates();

    expect(result.datasetsFound).toBe(0);
    expect(result.requiresConfirmation).toBe(true);
    spy.mockRestore();
  });

  it('propagates non-conflict creation failures (bad payload)', async () => {
    const badSnapshot: FxRateSnapshot = {
      ...snapshotFor('2026-08-27'),
      rates: [], // violates the dataset invariant
    };
    const { service } = createService(sourceWith(badSnapshot));

    await expect(service.checkForNewRates()).rejects.toThrow(/at least one rate/i);
  });
});
