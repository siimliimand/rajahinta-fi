/**
 * D1FxRateRepository + D1FxRateDatasetRepositoryAdapter — real-SQLite
 * tests (task 2.5) on the node:sqlite harness. Ports the pg repository
 * and port-adapter expectations: batched dataset+rates append, the
 * manual-only publish transition, strict effective-window resolution,
 * numeric-string contract rows, and the adapter's lifecycle mapping.
 *
 * @module D1FxRateRepositoryTest
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import { D1FxRateRepository } from '../fx-rate.repository';
import { D1FxRateDatasetRepositoryAdapter } from '../fx-rate-port.adapter';

const { d1 } = openMigratedD1();
const repo = new D1FxRateRepository(d1);
const adapter = new D1FxRateDatasetRepositoryAdapter(repo);

describe('D1FxRateRepository', () => {
  it('appends the dataset with its rates atomically, always PENDING_CONFIRMATION', async () => {
    const dataset = await repo.createDataset(
      {
        versionLabel: 'ecb-2026-08-01.1',
        sourceName: 'ecb-reference-rates',
        sourceUrl: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',
        referenceDate: '2026-08-01',
        effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
      },
      [
        { baseCurrency: 'EUR', quoteCurrency: 'SEK', rate: '11.290000000000' },
        { baseCurrency: 'EUR', quoteCurrency: 'NOK', rate: '11.610000000000' },
      ],
    );

    expect(dataset.status).toBe('PENDING_CONFIRMATION');
    expect(dataset.versionLabel).toBe('ecb-2026-08-01.1');
    expect(dataset.effectiveFrom).toEqual(new Date('2026-08-01T00:00:00.000Z'));

    const rates = await repo.findRatesForDataset(dataset.id);
    // Contract shape: pg numeric(24,12) decimal text, ordered by (base, quote).
    expect(rates.map((r) => [r.baseCurrency, r.quoteCurrency, r.rate])).toEqual([
      ['EUR', 'NOK', '11.610000000000'],
      ['EUR', 'SEK', '11.290000000000'],
    ]);
  });

  it('looks datasets up by id and version label; unknown ids are null', async () => {
    const created = await repo.createDataset(
      { versionLabel: 'ecb-2026-08-10.1', sourceName: 'ecb', referenceDate: '2026-08-10', effectiveFrom: new Date('2026-08-10T00:00:00.000Z') },
      [],
    );

    expect(await repo.findDatasetById(created.id)).toMatchObject({ versionLabel: 'ecb-2026-08-10.1' });
    expect(await repo.findDatasetByVersionLabel('ecb-2026-08-10.1')).toMatchObject({ id: created.id });
    await expect(repo.findDatasetById(999_999)).resolves.toBeNull();
  });

  it('queues pending datasets oldest-first for review', async () => {
    await repo.createDataset(
      { versionLabel: 'ecb-2026-08-20.1', sourceName: 'ecb', referenceDate: '2026-08-20', effectiveFrom: new Date('2026-08-20T00:00:00.000Z') },
      [],
    );
    await repo.createDataset(
      { versionLabel: 'ecb-2026-08-25.1', sourceName: 'ecb', referenceDate: '2026-08-25', effectiveFrom: new Date('2026-08-25T00:00:00.000Z') },
      [],
    );

    const pending = await repo.findPendingDatasets();
    expect(pending.map((d) => d.versionLabel)).toEqual([
      'ecb-2026-08-01.1',
      'ecb-2026-08-10.1',
      'ecb-2026-08-20.1',
      'ecb-2026-08-25.1',
    ]);
  });

  it('publishes only a PENDING_CONFIRMATION dataset and stamps the confirmer; republish returns null', async () => {
    const created = await repo.createDataset(
      { versionLabel: 'ecb-2026-08-28.1', sourceName: 'ecb', referenceDate: '2026-08-28', effectiveFrom: new Date('2026-08-28T00:00:00.000Z') },
      [],
    );

    const published = await repo.publishDataset(created.id, 'ops@example.invalid');
    expect(published).toMatchObject({
      status: 'PUBLISHED',
      confirmedBy: 'ops@example.invalid',
    });
    expect(published!.confirmedAt).toBeInstanceOf(Date);

    // PUBLISHED is terminal — the constrained UPDATE matches no row.
    await expect(repo.publishDataset(created.id, 'ops-again')).resolves.toBeNull();
    await expect(repo.publishDataset(999_999, 'ops')).resolves.toBeNull();
  });

  it('resolves the rate through the PUBLISHED dataset effective on asOf', async () => {
    const dataset = await repo.findPublishedDatasetEffectiveOn(new Date('2026-08-01T00:00:00.000Z'));
    expect(dataset).toBeNull(); // nothing published yet

    const pending = await repo.createDataset(
      { versionLabel: 'ecb-2026-08-30.1', sourceName: 'ecb', referenceDate: '2026-08-30', effectiveFrom: new Date('2026-08-30T00:00:00.000Z') },
      [{ baseCurrency: 'EUR', quoteCurrency: 'SEK', rate: '11.05' }],
    );
    await repo.publishDataset(pending.id, 'ops');

    // Before the window opens → null.
    await expect(repo.resolveRate('EUR', 'SEK', new Date('2026-08-29T23:59:59.999Z'))).resolves.toBeNull();
    // On the window's opening instant → strict lower bound holds (<=).
    const resolved = await repo.resolveRate('EUR', 'SEK', new Date('2026-08-30T00:00:00.000Z'));
    expect(resolved).not.toBeNull();
    expect(resolved!.rate).toBe(11.05);
    expect(resolved!.dataset.versionLabel).toBe('ecb-2026-08-30.1');
    // Unknown pair inside a published dataset → null; callers reject, never assume 1:1.
    await expect(repo.resolveRate('EUR', 'NOK', new Date('2026-08-31T00:00:00.000Z'))).resolves.toBeNull();
  });

  it('prefers the most recent effectiveFrom when published windows overlap', async () => {
    const older = await repo.createDataset(
      { versionLabel: 'ecb-2026-07-01.1', sourceName: 'ecb', referenceDate: '2026-07-01', effectiveFrom: new Date('2026-07-01T00:00:00.000Z') },
      [{ baseCurrency: 'EUR', quoteCurrency: 'SEK', rate: '11.40' }],
    );
    await repo.publishDataset(older.id, 'ops');

    // Both windows cover 2026-09-01 — the most recent effectiveFrom wins.
    const resolved = await repo.resolveRate('EUR', 'SEK', new Date('2026-09-01T00:00:00.000Z'));
    expect(resolved!.dataset.versionLabel).toBe('ecb-2026-08-30.1');
  });
});

describe('D1FxRateDatasetRepositoryAdapter', () => {
  it('maps a NewFxDataset onto dataset + rate rows, forcing PENDING_CONFIRMATION', async () => {
    const version = await adapter.createDataset({
      versionLabel: 'ecb-adapter-1',
      sourceName: 'ecb-reference-rates',
      referenceDate: '2026-08-28',
      effectiveFrom: new Date('2026-08-28T00:00:00.000Z'),
      rates: [{ baseCurrency: 'EUR', quoteCurrency: 'DKK', rate: 7.4592 }],
    });

    expect(version.status).toBe('PENDING_CONFIRMATION');
    expect(version.effectiveFrom).toBeInstanceOf(Date);
    expect(version.createdAt).toBeInstanceOf(Date);
  });

  it('returns numeric rates for a dataset — coerced at the boundary', async () => {
    const version = await adapter.findDatasetByVersionLabel('ecb-adapter-1');
    expect(version).not.toBeNull();

    const rates = await adapter.findRatesForDataset(version!.id);
    expect(rates).toEqual([
      { baseCurrency: 'EUR', quoteCurrency: 'DKK', rate: 7.4592 },
    ]);
  });

  it('delegates the manual publish transition and surfaces the pending queue', async () => {
    const version = await adapter.findDatasetByVersionLabel('ecb-adapter-1')!;

    const published = await adapter.publishDataset(version!.id, 'ops@example.invalid');
    expect(published!.status).toBe('PUBLISHED');

    // Every dataset so far is published → pending queue holds none of them.
    const pending = await adapter.findPendingDatasets();
    expect(pending.map((d) => d.versionLabel)).not.toContain('ecb-adapter-1');
  });

  it('the schema CHECK is the first guard against an unknown lifecycle status', async () => {
    // The fx_rate_datasets_status_check only admits the two lifecycle
    // states, so a corrupt status cannot reach the adapter's narrowing
    // through any INSERT path — defense in depth starts at the schema.
    await expect(
      d1
        .prepare(
          `INSERT INTO fx_rate_datasets (version_label, source_name, reference_date, status, effective_from)
           VALUES ('corrupt-status.1', 'x', '2026-01-01', 'EFFECTIVE', '2026-01-01T00:00:00.000Z')`,
        )
        .run(),
    ).rejects.toThrow(/CHECK constraint failed/);
  });
});
