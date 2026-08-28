/**
 * AccountService — calculation-history persistence on the repository path.
 *
 * Regression tests (reported e2e defect): with a calculation-record
 * repository bound, addCalculationToHistory must actually link the record
 * to the account (it was a silent no-op), and GET history / the GDPR
 * export must read the claimed records back (they always returned
 * empty because they read the in-memory account list).
 *
 * @module AccountHistoryServiceTest
 */

import { describe, it, expect } from 'vitest';
import {
  CalculationRecordRepository,
  type CalculationHistoryEntry,
} from '@rajahinta/data-platform';
import type { calculationRecords as calculationRecordsTable } from '@rajahinta/data-platform';
import { AccountService } from '../account.service';

type RecordRow = typeof calculationRecordsTable.$inferSelect;

/** In-memory CalculationRecordRepository — records links like the DB. */
class FakeCalculationRecordRepository extends CalculationRecordRepository {
  private readonly rows = new Map<number, RecordRow>();
  private nextId = 1;

  seed(partial: Partial<RecordRow> & { totalCents: number }): number {
    const id = this.nextId++;
    this.rows.set(id, {
      id,
      productMasterId: 1,
      retailOfferIds: null,
      transportOfferId: null,
      exciseRuleVersionId: null,
      containerDutyRuleVersionId: null,
      breakdown: [],
      confidence: 'HIGH',
      quantity: 1,
      destination: 'FI',
      disclaimer: 'disclaimer',
      sessionId: null,
      calculatedAt: new Date('2026-01-01T00:00:00Z'),
      ...partial,
    } as RecordRow);
    return id;
  }

  override async create(
    record: typeof calculationRecordsTable.$inferInsert,
  ): Promise<RecordRow> {
    const id = this.nextId++;
    const row = { id, ...record } as RecordRow;
    this.rows.set(id, row);
    return row;
  }

  override async findById(id: number): Promise<RecordRow | null> {
    return this.rows.get(id) ?? null;
  }

  override async findBySession(sessionId: string): Promise<RecordRow[]> {
    return [...this.rows.values()]
      .filter((r) => r.sessionId === sessionId)
      .sort((a, b) => a.calculatedAt.getTime() - b.calculatedAt.getTime());
  }

  override async linkSession(
    recordId: number,
    sessionId: string,
  ): Promise<boolean> {
    const row = this.rows.get(recordId);
    if (!row || row.sessionId !== null) return false;
    row.sessionId = sessionId;
    return true;
  }

  override async findHistoryEntriesBySession(
    sessionId: string,
  ): Promise<CalculationHistoryEntry[]> {
    const rows: RecordRow[] = await this.findBySession(sessionId);
    return rows.map((r) => ({
      calculationId: r.id,
      calculatedAt: r.calculatedAt,
      totalCents: r.totalCents,
      quantity: r.quantity,
      productName: 'TEST Product',
    }));
  }

  override async findCalculationRecordIdsByEntity(): Promise<number[]> {
    return [];
  }
}

function makeService(repo: FakeCalculationRecordRepository): AccountService {
  // Repositories first per the constructor shape; the calculation-record
  // repository is the last positional parameter.
  return new AccountService(undefined, undefined, undefined, undefined, undefined, repo);
}

describe('AccountService calculation history — repository path', () => {
  it('addCalculationToHistory links the record to the account session', async () => {
    const repo = new FakeCalculationRecordRepository();
    const recordId = repo.seed({ totalCents: 1234 });
    const service = makeService(repo);

    await service.addCalculationToHistory('user-a', recordId);

    expect((await repo.findById(recordId))?.sessionId).toBe('user-a');
  });

  it('first claim wins — an already-linked record is never reassigned', async () => {
    const repo = new FakeCalculationRecordRepository();
    const recordId = repo.seed({ totalCents: 1234 });
    const service = makeService(repo);

    await service.addCalculationToHistory('user-a', recordId);
    await service.addCalculationToHistory('user-b', recordId);

    expect((await repo.findById(recordId))?.sessionId).toBe('user-a');
    expect(await service.getCalculationHistory('user-b')).toEqual([]);
  });

  it('linking an unknown record id is an idempotent no-op', async () => {
    const repo = new FakeCalculationRecordRepository();
    const service = makeService(repo);

    await expect(
      service.addCalculationToHistory('user-a', 999999),
    ).resolves.toBeUndefined();
  });

  it('getCalculationHistory returns the claimed record IDs', async () => {
    const repo = new FakeCalculationRecordRepository();
    const first = repo.seed({ totalCents: 100 });
    const second = repo.seed({ totalCents: 200 });
    const other = repo.seed({ totalCents: 300 });
    const service = makeService(repo);

    await service.addCalculationToHistory('user-a', second);
    await service.addCalculationToHistory('user-a', first);
    await service.addCalculationToHistory('user-b', other);

    expect(await service.getCalculationHistory('user-a')).toEqual([first, second]);
    expect(await service.getCalculationHistory('user-b')).toEqual([other]);
    expect(await service.getCalculationHistory('user-c')).toEqual([]);
  });

  it('getCalculationHistoryForExport returns real record facts', async () => {
    const repo = new FakeCalculationRecordRepository();
    const recordId = repo.seed({ totalCents: 1499, quantity: 6 });
    const service = makeService(repo);

    await service.addCalculationToHistory('user-a', recordId);
    const history = await service.getCalculationHistoryForExport('user-a');

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      calculationId: recordId,
      totalCents: 1499,
      productName: 'TEST Product',
      quantity: 6,
    });
    expect(history[0].timestamp).toBeInstanceOf(Date);
  });
});

describe('AccountService calculation history — in-memory fallback', () => {
  it('append and read keep working without repositories', async () => {
    const service = new AccountService();
    await service.addCalculationToHistory('user-a', 42);

    expect(await service.getCalculationHistory('user-a')).toEqual([42]);
    const exported = await service.getCalculationHistoryForExport('user-a');
    expect(exported[0]).toMatchObject({
      calculationId: 42,
      productName: 'calculation-42',
    });
  });
});
