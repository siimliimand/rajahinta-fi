/**
 * D1FerryPriceRepository — real-SQLite tests (task 2.1, change
 * ferry-onboard-prices) on the node:sqlite harness with the committed
 * migrations applied (0034 inclusive).
 *
 * The load-bearing case is upsert idempotence on the observation
 * identity (operator, route, label, observed_at): re-running the
 * monthly cron over an unchanged dataset must converge — same id,
 * corrected columns overwritten, no duplicate row — while a later
 * observation date must land a NEW row (append-only history). The raw
 * CHECK/NOT NULL cases pin citation and observation date as
 * unrepresentable-to-omit at the SQL boundary (the spec refuses
 * uncited rows), and the empty-state read pins the designed zero-rows
 * condition (Viking Line has no rows until operator transcription —
 * an empty operator is a normal state, not an error).
 *
 * @module D1FerryPriceRepositoryTest
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import {
  D1FerryPriceRepository,
  type FerryPriceUpsertInput,
} from '../ferry-price.repository';

/** Fresh migrated database + repo per test — the ordering assertions
 * need a controlled table, not a shared one. */
function makeRepo() {
  const { db, d1 } = openMigratedD1();
  return { db, d1, repo: new D1FerryPriceRepository(d1) };
}

/** One curated dataset row, as the monthly cron emits it. */
function observation(
  overrides: Partial<FerryPriceUpsertInput> = {},
): FerryPriceUpsertInput {
  return {
    operator: 'tallink',
    route: 'Helsinki–Tallinn',
    label: 'Finlandia Redberry 100 cl',
    priceCents: 1799,
    observedAt: new Date('2026-10-01T00:00:00.000Z'),
    citation:
      'https://shopping-onboard.tallink.com/en/megastar/product/strong-alcohol',
    ...overrides,
  };
}

describe('D1FerryPriceRepository.upsertObservation', () => {
  it('inserts a new observation and reads it back with full provenance', async () => {
    const { repo } = makeRepo();

    const result = await repo.upsertObservation(observation());
    expect(result.id).toBeGreaterThan(0);

    const rows = await repo.findPublished();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: result.id,
      operator: 'tallink',
      route: 'Helsinki–Tallinn',
      label: 'Finlandia Redberry 100 cl',
      priceCents: 1799,
      citation:
        'https://shopping-onboard.tallink.com/en/megastar/product/strong-alcohol',
    });
    expect(rows[0].observedAt).toEqual(new Date('2026-10-01T00:00:00.000Z'));
    expect(rows[0].createdAt).toBeInstanceOf(Date);
  });

  it('re-running the same observation identity converges: same id, corrected columns overwritten, no duplicate', async () => {
    const { repo } = makeRepo();

    const first = await repo.upsertObservation(observation({ priceCents: 1799 }));
    const second = await repo.upsertObservation(
      observation({ priceCents: 1849, citation: 'https://example.com/corrected' }),
    );

    expect(second.id).toBe(first.id);
    const rows = await repo.findPublished();
    expect(rows).toHaveLength(1); // no duplicate — the cron re-run converged
    expect(rows[0].priceCents).toBe(1849);
    expect(rows[0].citation).toBe('https://example.com/corrected');
    // The key columns survived the overwrite — they ARE the identity.
    expect(rows[0].observedAt).toEqual(new Date('2026-10-01T00:00:00.000Z'));
  });

  it('a later observation date lands a new row — history is append-only', async () => {
    const { repo } = makeRepo();

    const october = await repo.upsertObservation(
      observation({ priceCents: 1799 }),
    );
    const november = await repo.upsertObservation(
      observation({
        priceCents: 1899,
        observedAt: new Date('2026-11-01T00:00:00.000Z'),
      }),
    );

    expect(november.id).not.toBe(october.id);
    const rows = await repo.findPublished();
    expect(rows).toHaveLength(2);
    // Ordered by observed_at within the identity: October first.
    expect(rows.map((r) => r.observedAt.toISOString())).toEqual([
      '2026-10-01T00:00:00.000Z',
      '2026-11-01T00:00:00.000Z',
    ]);
  });
});

describe('D1FerryPriceRepository.findPublished', () => {
  it('orders rows by (operator, route, label, observed_at) regardless of insert order', async () => {
    const { repo } = makeRepo();

    // Insert deliberately out of order — the read must not care.
    await repo.upsertObservation(
      observation({ operator: 'viking', label: 'Absolut 70 cl', priceCents: 1599 }),
    );
    await repo.upsertObservation(
      observation({
        operator: 'eckero',
        route: 'Helsinki–Tallinn',
        label: 'Jaloviina Yrtti 30%, 3 x 50 cl',
        priceCents: 4170,
      }),
    );
    await repo.upsertObservation(
      observation({ operator: 'tallink', label: 'Absolut 70 cl', priceCents: 1699 }),
    );
    await repo.upsertObservation(
      observation({
        operator: 'tallink',
        label: 'Finlandia Redberry 100 cl',
        priceCents: 1799,
      }),
    );

    const rows = await repo.findPublished();
    expect(rows.map((r) => [r.operator, r.label])).toEqual([
      ['eckero', 'Jaloviina Yrtti 30%, 3 x 50 cl'],
      ['tallink', 'Absolut 70 cl'],
      ['tallink', 'Finlandia Redberry 100 cl'],
      ['viking', 'Absolut 70 cl'],
    ]);
  });

  it('filters by route when given one and keeps the deterministic order', async () => {
    const { repo } = makeRepo();

    await repo.upsertObservation(
      observation({ operator: 'tallink', route: 'Turku–Stockholm', label: 'Absolut 70 cl' }),
    );
    await repo.upsertObservation(
      observation({ operator: 'eckero', label: 'Jaloviina Yrtti 30%, 3 x 50 cl' }),
    );
    await repo.upsertObservation(
      observation({ operator: 'tallink', label: 'Finlandia Redberry 100 cl' }),
    );

    const helsinkiRows = await repo.findPublished('Helsinki–Tallinn');
    expect(helsinkiRows.map((r) => [r.operator, r.route])).toEqual([
      ['eckero', 'Helsinki–Tallinn'],
      ['tallink', 'Helsinki–Tallinn'],
    ]);

    const turkuRows = await repo.findPublished('Turku–Stockholm');
    expect(turkuRows).toHaveLength(1);
    expect(turkuRows[0].label).toBe('Absolut 70 cl');
  });

  it('returns [] on a fresh migrated database — the designed empty state', async () => {
    const { repo } = makeRepo();

    expect(await repo.findPublished()).toEqual([]);
    // A route with no rows (e.g. anything Viking until operator
    // transcription) is the same normal condition, not an error.
    expect(await repo.findPublished('Helsinki–Stockholm')).toEqual([]);
  });
});

describe('ferry_price_observations schema boundary (migration 0034)', () => {
  it('makes citation and observed_at unrepresentable to omit (NOT NULL)', () => {
    const { db } = makeRepo();

    const insert = (observedAt: string | null, citation: string | null) =>
      db
        .prepare(
          `INSERT INTO ferry_price_observations (operator, route, label, price_cents, observed_at, citation)
           VALUES ('tallink', 'Helsinki–Tallinn', 'X 70 cl', 1799, ?, ?)`,
        )
        .run(observedAt, citation);

    expect(() => insert(null, 'https://c')).toThrow(/NOT NULL constraint failed/);
    expect(() => insert('2026-10-01T00:00:00.000Z', null)).toThrow(
      /NOT NULL constraint failed/,
    );
  });

  it('rejects blank text columns and non-positive prices (CHECKs)', () => {
    const { db } = makeRepo();

    const insert = (
      operator: string,
      route: string,
      label: string,
      priceCents: number,
      citation: string,
    ) =>
      db
        .prepare(
          `INSERT INTO ferry_price_observations (operator, route, label, price_cents, observed_at, citation)
           VALUES (?, ?, ?, ?, '2026-10-01T00:00:00.000Z', ?)`,
        )
        .run(operator, route, label, priceCents, citation);

    const bad: Array<[string, string, string, number, string]> = [
      ['', 'Helsinki–Tallinn', 'X 70 cl', 1799, 'https://c'],
      ['tallink', '', 'X 70 cl', 1799, 'https://c'],
      ['tallink', 'Helsinki–Tallinn', '', 1799, 'https://c'],
      ['tallink', 'Helsinki–Tallinn', 'X 70 cl', 1799, ''],
      ['tallink', 'Helsinki–Tallinn', 'X 70 cl', 0, 'https://c'],
      ['tallink', 'Helsinki–Tallinn', 'X 70 cl', -1, 'https://c'],
    ];
    for (const [operator, route, label, priceCents, citation] of bad) {
      expect(() => insert(operator, route, label, priceCents, citation)).toThrow(
        /CHECK constraint failed/,
      );
    }
  });

  it('a duplicate observation identity is unrepresentable (UNIQUE backs the upsert)', async () => {
    const { repo, db } = makeRepo();

    await repo.upsertObservation(observation());

    expect(() =>
      db
        .prepare(
          `INSERT INTO ferry_price_observations (operator, route, label, price_cents, observed_at, citation)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'tallink',
          'Helsinki–Tallinn',
          'Finlandia Redberry 100 cl',
          1899,
          '2026-10-01T00:00:00.000Z',
          'https://example.com/other',
        ),
    ).toThrow(/UNIQUE constraint failed/);
  });
});
