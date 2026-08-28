/**
 * Tests for FxRateDatasetService.
 *
 * The lifecycle invariants here are launch-blocking policy (design D2):
 * no path may auto-publish a dataset version, publication requires an
 * attributed operator, and resolution follows the observation date. Uses
 * an in-memory port — the domain service is storage-free.
 *
 * @module FxRateDatasetServiceTests
 */
import { describe, it, expect } from 'vitest';
import {
  FxRateDatasetService,
  FxDatasetVersionConflictError,
  FxDatasetNotFoundError,
  FxDatasetInvalidTransitionError,
  InvalidFxDatasetInputError,
} from '../fx-dataset.service';
import type { IFxRateDatasetRepositoryPort } from '../ports/fx-rate-dataset-repository.port';
import type { FxDatasetVersion, FxRateEntry, NewFxDataset } from '../fx-dataset.types';

// ---------------------------------------------------------------------------
// In-memory port fake
// ---------------------------------------------------------------------------

function row(input: NewFxDataset, id: number, status: FxDatasetVersion['status']): FxDatasetVersion {
  return {
    id,
    versionLabel: input.versionLabel,
    sourceName: input.sourceName,
    sourceUrl: input.sourceUrl ?? null,
    referenceDate: input.referenceDate,
    status,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo ?? null,
    confirmedBy: null,
    confirmedAt: null,
    createdAt: new Date('2026-08-28T06:00:00Z'),
  };
}

class InMemoryFxRepo implements IFxRateDatasetRepositoryPort {
  datasets: FxDatasetVersion[] = [];
  rates = new Map<number, FxRateEntry[]>();
  private nextId = 1;

  async createDataset(input: NewFxDataset): Promise<FxDatasetVersion> {
    // The real adapter forces PENDING_CONFIRMATION regardless of input;
    // the fake mirrors that storage-boundary invariant.
    const created = row(input, this.nextId++, 'PENDING_CONFIRMATION');
    this.datasets.push(created);
    this.rates.set(created.id, [...input.rates]);
    return created;
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

  async findPublishedDatasetEffectiveOn(asOf: Date) {
    let best: FxDatasetVersion | null = null;
    for (const d of this.datasets) {
      if (d.status !== 'PUBLISHED') continue;
      if (d.effectiveFrom.getTime() > asOf.getTime()) continue;
      if (d.effectiveTo !== null && d.effectiveTo.getTime() <= asOf.getTime()) continue;
      if (best === null || d.effectiveFrom.getTime() > best.effectiveFrom.getTime()) best = d;
    }
    return best;
  }

  async publishDataset(id: number, confirmedBy: string) {
    const index = this.datasets.findIndex((d) => d.id === id);
    const dataset = this.datasets[index];
    if (dataset === undefined || dataset.status !== 'PENDING_CONFIRMATION') return null;
    const published: FxDatasetVersion = {
      ...dataset,
      status: 'PUBLISHED',
      confirmedBy,
      confirmedAt: new Date(),
    };
    this.datasets[index] = published;
    return { ...published };
  }

  async findRatesForDataset(datasetId: number) {
    return this.rates.get(datasetId) ?? [];
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function payload(overrides: Partial<NewFxDataset> = {}): NewFxDataset {
  return {
    versionLabel: 'ecb-2026-08-27.1',
    sourceName: 'ecb-reference-rates',
    sourceUrl: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',
    referenceDate: '2026-08-27',
    effectiveFrom: new Date('2026-08-27T16:00:00Z'),
    effectiveTo: null,
    rates: cleanRates(),
    ...overrides,
  };
}

function cleanRates(): FxRateEntry[] {
  return [
    { baseCurrency: 'EUR', quoteCurrency: 'SEK', rate: 11.32 },
    { baseCurrency: 'EUR', quoteCurrency: 'GBP', rate: 0.85 },
  ];
}

function createService() {
  const repo = new InMemoryFxRepo();
  return { repo, service: new FxRateDatasetService(repo) };
}

// ---------------------------------------------------------------------------
// createPendingDataset
// ---------------------------------------------------------------------------

describe('FxRateDatasetService.createPendingDataset', () => {
  it('creates the version in PENDING_CONFIRMATION — never effective on arrival', async () => {
    const { service } = createService();
    const created = await service.createPendingDataset(payload({ rates: cleanRates() }));

    expect(created.status).toBe('PENDING_CONFIRMATION');
    expect(created.confirmedBy).toBeNull();
    expect(created.confirmedAt).toBeNull();
  });

  it('rejects a duplicate version label — datasets are append-only', async () => {
    const { service } = createService();
    const input = payload({ rates: cleanRates() });
    await service.createPendingDataset(input);

    await expect(service.createPendingDataset(input)).rejects.toThrow(FxDatasetVersionConflictError);
  });

  it('rejects an empty rate list', async () => {
    const { service } = createService();
    await expect(service.createPendingDataset(payload({ rates: [] }))).rejects.toThrow(InvalidFxDatasetInputError);
  });

  it('rejects non-positive rates', async () => {
    const { service } = createService();
    const bad = [{ baseCurrency: 'EUR', quoteCurrency: 'SEK', rate: 0 }];
    await expect(service.createPendingDataset(payload({ rates: bad }))).rejects.toThrow(InvalidFxDatasetInputError);
  });

  it('rejects duplicate pairs, in either direction', async () => {
    const { service } = createService();
    const dup = [
      { baseCurrency: 'EUR', quoteCurrency: 'SEK', rate: 11.3 },
      { baseCurrency: 'SEK', quoteCurrency: 'EUR', rate: 0.088 },
    ];
    await expect(service.createPendingDataset(payload({ rates: dup }))).rejects.toThrow(InvalidFxDatasetInputError);
  });

  it('rejects a malformed referenceDate', async () => {
    const { service } = createService();
    await expect(
      service.createPendingDataset(payload({ referenceDate: '27.8.2026', rates: cleanRates() })),
    ).rejects.toThrow(InvalidFxDatasetInputError);
  });

  it('rejects an effectiveTo on or before effectiveFrom', async () => {
    const { service } = createService();
    await expect(
      service.createPendingDataset(
        payload({
          effectiveFrom: new Date('2026-08-27T16:00:00Z'),
          effectiveTo: new Date('2026-08-27T16:00:00Z'),
          rates: cleanRates(),
        }),
      ),
    ).rejects.toThrow(InvalidFxDatasetInputError);
  });
});

// ---------------------------------------------------------------------------
// confirmPublication
// ---------------------------------------------------------------------------

describe('FxRateDatasetService.confirmPublication', () => {
  it('publishes a pending dataset and records the confirming operator', async () => {
    const { service } = createService();
    const created = await service.createPendingDataset(payload({ rates: cleanRates() }));

    const published = await service.confirmPublication(created.id, 'operator@rajahinta.fi');

    expect(published.status).toBe('PUBLISHED');
    expect(published.confirmedBy).toBe('operator@rajahinta.fi');
    expect(published.confirmedAt).not.toBeNull();
  });

  it('refuses publication without an attributed operator', async () => {
    const { service } = createService();
    const created = await service.createPendingDataset(payload({ rates: cleanRates() }));

    await expect(service.confirmPublication(created.id, '   ')).rejects.toThrow(
      FxDatasetInvalidTransitionError,
    );
  });

  it('refuses to publish the same version twice', async () => {
    const { service } = createService();
    const created = await service.createPendingDataset(payload({ rates: cleanRates() }));
    await service.confirmPublication(created.id, 'operator@rajahinta.fi');

    await expect(service.confirmPublication(created.id, 'operator@rajahinta.fi')).rejects.toThrow(
      FxDatasetInvalidTransitionError,
    );
  });

  it('fails with FxDatasetNotFoundError for an unknown id', async () => {
    const { service } = createService();
    await expect(service.confirmPublication(999, 'operator@rajahinta.fi')).rejects.toThrow(
      FxDatasetNotFoundError,
    );
  });

  it('no creation path publishes: creating the same payload twice never yields an effective version implicitly', async () => {
    const { service, repo } = createService();
    await service.createPendingDataset(payload({ versionLabel: 'a', rates: cleanRates() }));
    // A differently-labelled second version also stays pending until confirmed.
    await service.createPendingDataset(payload({ versionLabel: 'b', rates: cleanRates() }));

    expect((await repo.findPendingDatasets()).length).toBe(2);
    expect(await repo.findPublishedDatasetEffectiveOn(new Date('2026-08-28T12:00:00Z'))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveRate — by observation date
// ---------------------------------------------------------------------------

describe('FxRateDatasetService.resolveRate', () => {
  it('uses the dataset effective on the observation date, not the newest one', async () => {
    const { service } = createService();
    const jan = await service.createPendingDataset(
      payload({
        versionLabel: 'ecb-2026-01-01.1',
        referenceDate: '2026-01-01',
        effectiveFrom: new Date('2026-01-01T16:00:00Z'),
        effectiveTo: new Date('2026-02-01T16:00:00Z'),
        rates: [{ baseCurrency: 'EUR', quoteCurrency: 'SEK', rate: 11.0 }],
      }),
    );
    const feb = await service.createPendingDataset(
      payload({
        versionLabel: 'ecb-2026-02-01.1',
        referenceDate: '2026-02-01',
        effectiveFrom: new Date('2026-02-01T16:00:00Z'),
        effectiveTo: null,
        rates: [{ baseCurrency: 'EUR', quoteCurrency: 'SEK', rate: 11.5 }],
      }),
    );
    await service.confirmPublication(jan.id, 'op');
    await service.confirmPublication(feb.id, 'op');

    const janObservation = await service.resolveRate('EUR', 'SEK', new Date('2026-01-15T12:00:00Z'));
    expect(janObservation?.rate).toBe(11.0);
    expect(janObservation?.dataset.versionLabel).toBe('ecb-2026-01-01.1');

    const febObservation = await service.resolveRate('EUR', 'SEK', new Date('2026-02-15T12:00:00Z'));
    expect(febObservation?.rate).toBe(11.5);
  });

  it('resolves an inverted pair from an EUR-based dataset', async () => {
    const { service } = createService();
    const created = await service.createPendingDataset(payload({ rates: cleanRates() }));
    await service.confirmPublication(created.id, 'op');

    const result = await service.resolveRate('SEK', 'EUR', new Date('2026-08-28T12:00:00Z'));
    expect(result).not.toBeNull();
    expect(result!.rate).toBeCloseTo(1 / 11.32, 12);
    expect(result!.inverted).toBe(true);
  });

  it('returns null when the pair is absent — callers reject, never 1:1', async () => {
    const { service } = createService();
    const created = await service.createPendingDataset(payload({ rates: cleanRates() }));
    await service.confirmPublication(created.id, 'op');

    expect(await service.resolveRate('EUR', 'JPY', new Date('2026-08-28T12:00:00Z'))).toBeNull();
  });

  it('returns null while the covering dataset is still PENDING_CONFIRMATION', async () => {
    const { service } = createService();
    await service.createPendingDataset(payload({ rates: cleanRates() }));

    expect(await service.resolveRate('EUR', 'SEK', new Date('2026-08-28T12:00:00Z'))).toBeNull();
  });

  it('returns null when no dataset covers the observation date', async () => {
    const { service } = createService();
    const created = await service.createPendingDataset(payload({ rates: cleanRates() }));
    await service.confirmPublication(created.id, 'op');

    expect(await service.resolveRate('EUR', 'SEK', new Date('2020-01-01T00:00:00Z'))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Review queue
// ---------------------------------------------------------------------------

describe('FxRateDatasetService.listPendingDatasets', () => {
  it('lists only PENDING_CONFIRMATION versions — the human confirmation queue', async () => {
    const { service } = createService();
    const a = await service.createPendingDataset(payload({ versionLabel: 'a', rates: cleanRates() }));
    await service.createPendingDataset(payload({ versionLabel: 'b', rates: cleanRates() }));
    await service.confirmPublication(a.id, 'op');

    const pending = await service.listPendingDatasets();
    expect(pending.map((d) => d.versionLabel)).toEqual(['b']);
  });
});

// ---------------------------------------------------------------------------
// Provenance traceability (task 1.6): an offer converted at ingestion
// records the dataset version label; that label must resolve back to the
// exact dataset record that produced the rate — offer → version label →
// dataset row, no gaps.
// ---------------------------------------------------------------------------

describe('FxRateDatasetService — provenance traceability', () => {
  it('a resolved rate names a dataset version that resolves back to the same record', async () => {
    const { service } = createService();
    const created = await service.createPendingDataset(
      payload({ rates: cleanRates() }),
    );
    await service.confirmPublication(created.id, 'operator@rajahinta.fi');

    const resolved = await service.resolveRate(
      'SEK',
      'EUR',
      new Date('2026-08-28T12:00:00Z'),
    );
    expect(resolved).not.toBeNull();

    // The label carried on converted offers resolves to the dataset row.
    const traced = await service.getDatasetByVersion(
      resolved!.dataset.versionLabel,
    );
    expect(traced).not.toBeNull();
    expect(traced!.id).toBe(resolved!.dataset.id);
    expect(traced!.versionLabel).toBe('ecb-2026-08-27.1');
    expect(traced!.status).toBe('PUBLISHED');
    expect(traced!.sourceName).toBe('ecb-reference-rates');
    expect(traced!.confirmedBy).toBe('operator@rajahinta.fi');
  });

  it('the rate entries of the traced version reproduce the conversion', async () => {
    const { repo, service } = createService();
    const created = await service.createPendingDataset(
      payload({ rates: cleanRates() }),
    );
    await service.confirmPublication(created.id, 'op');

    const resolved = await service.resolveRate(
      'SEK',
      'EUR',
      new Date('2026-08-28T12:00:00Z'),
    );
    const entries = await repo.findRatesForDataset(resolved!.dataset.id);

    // The stored EUR/SEK entry inverted reproduces the SEK→EUR rate the
    // offer converted with — the audit trail recomputes the number.
    const eurSek = entries.find(
      (e) => e.baseCurrency === 'EUR' && e.quoteCurrency === 'SEK',
    );
    expect(eurSek).toBeDefined();
    expect(1 / eurSek!.rate).toBeCloseTo(resolved!.rate, 12);
  });

  it('historical versions stay traceable after a newer version is published', async () => {
    const { service } = createService();
    const jan = await service.createPendingDataset(
      payload({
        versionLabel: 'ecb-2026-01-01.1',
        referenceDate: '2026-01-01',
        effectiveFrom: new Date('2026-01-01T16:00:00Z'),
        effectiveTo: new Date('2026-02-01T16:00:00Z'),
        rates: [{ baseCurrency: 'EUR', quoteCurrency: 'SEK', rate: 11.0 }],
      }),
    );
    await service.confirmPublication(jan.id, 'op');
    const janResolved = await service.resolveRate(
      'SEK',
      'EUR',
      new Date('2026-01-15T12:00:00Z'),
    );

    const feb = await service.createPendingDataset(
      payload({
        versionLabel: 'ecb-2026-02-01.1',
        referenceDate: '2026-02-01',
        effectiveFrom: new Date('2026-02-01T16:00:00Z'),
        effectiveTo: null,
        rates: [{ baseCurrency: 'EUR', quoteCurrency: 'SEK', rate: 11.5 }],
      }),
    );
    await service.confirmPublication(feb.id, 'op');

    // The January provenance still resolves after February went live —
    // a past observation's conversion stays explainable.
    const traced = await service.getDatasetByVersion(
      janResolved!.dataset.versionLabel,
    );
    expect(traced!.id).toBe(jan.id);
    expect(traced!.effectiveTo).not.toBeNull();
  });
});
