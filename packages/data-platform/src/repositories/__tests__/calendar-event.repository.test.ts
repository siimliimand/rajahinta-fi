/**
 * DrizzleCalendarEventRepository — real-SQLite tests over the migrated
 * D1 harness (task 3.1, change tax-change-calendar): year filtering
 * with no cross-year bleed, the deterministic stated order from the pure
 * domain comparator, next-event precedence (CONFIRMED beats EXPECTED in
 * the same period; an in-progress window stays upcoming until its window
 * has ended), the port registration in DataPlatformModule, and the
 * committed 2026 seed rows flowing through the port.
 *
 * @module DrizzleCalendarEventRepositoryTest
 */
import { describe, it, expect } from 'vitest';
import type { Provider } from '@nestjs/common';
import {
  CALENDAR_EVENT_REPOSITORY_PORT,
  InvalidCalendarInputError,
} from '@rajahinta/core-domain';
import { openMigratedD1 } from '../d1/__tests__/d1-test-harness';
import {
  DrizzleCalendarEventRepository,
} from '../calendar-event.repository';
import { DataPlatformModule } from '../../data-platform.module';
import {
  CALENDAR_EVENTS_SEED,
  seedCalendarEvents,
} from '../../seed/calendar-events.seed';
import type { D1DatabaseLike } from '../../d1/executor';

// ---------------------------------------------------------------------------
// Fixture helpers — every test opens its own migrated in-memory database
// ---------------------------------------------------------------------------

/** Fixture row — only the identity/period columns are significant. */
interface FixtureEvent {
  readonly id: number;
  readonly year: number;
  readonly eventType: string;
  readonly status: 'CONFIRMED' | 'EXPECTED';
  readonly occurrenceDate: string | null;
  readonly expectedWindow: string | null;
}

/** Insert one fixture row straight through the table's CHECK constraints. */
async function insertEvent(
  d1: D1DatabaseLike,
  event: FixtureEvent,
): Promise<void> {
  await d1
    .prepare(
      'INSERT INTO calendar_events ' +
        '(id, year, event_type, status, occurrence_date, expected_window, ' +
        'title_fi, title_en, summary_fi, summary_en, source_url) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      event.id,
      event.year,
      event.eventType,
      event.status,
      event.occurrenceDate,
      event.expectedWindow,
      `Tapahtuma ${event.id} FI`,
      `Event ${event.id} EN`,
      `Yhteenveto ${event.id}`,
      `Summary ${event.id}`,
      'https://example.com/source',
    )
    .run();
}

/** Fresh database + adapter — no state bleeds between tests. */
function makeRepo(): { d1: D1DatabaseLike; repo: DrizzleCalendarEventRepository } {
  const { d1 } = openMigratedD1();
  return { d1, repo: new DrizzleCalendarEventRepository(d1) };
}

// ---------------------------------------------------------------------------
// listByYear — year filtering
// ---------------------------------------------------------------------------

describe('DrizzleCalendarEventRepository.listByYear — year filtering', () => {
  it('returns only the requested year — no cross-year bleed', async () => {
    const { d1, repo } = makeRepo();
    await insertEvent(d1, {
      id: 1,
      year: 2025,
      eventType: 'FI_EXCISE_CHANGE',
      status: 'CONFIRMED',
      occurrenceDate: '2025-06-01',
      expectedWindow: null,
    });
    await insertEvent(d1, {
      id: 2,
      year: 2026,
      eventType: 'FI_EXCISE_CHANGE',
      status: 'CONFIRMED',
      occurrenceDate: '2026-01-01',
      expectedWindow: null,
    });
    await insertEvent(d1, {
      id: 3,
      year: 2026,
      eventType: 'ALKO_PRICE_LIST',
      status: 'EXPECTED',
      occurrenceDate: null,
      expectedWindow: '2026-09',
    });
    await insertEvent(d1, {
      id: 4,
      year: 2027,
      eventType: 'RATE_DECISION',
      status: 'EXPECTED',
      occurrenceDate: null,
      expectedWindow: '2027-Q1',
    });

    const y2026 = await repo.listByYear(2026);
    expect(y2026.map((e) => e.id)).toEqual([2, 3]);

    const y2025 = await repo.listByYear(2025);
    expect(y2025.map((e) => e.id)).toEqual([1]);

    // A year with no sourced events yet is a valid empty response.
    await expect(repo.listByYear(2024)).resolves.toEqual([]);
  });

  it('maps rows to the domain shape — camelCase fields, no createdAt leak', async () => {
    const { d1, repo } = makeRepo();
    await insertEvent(d1, {
      id: 7,
      year: 2026,
      eventType: 'TAX_TABLE_PUBLICATION',
      status: 'CONFIRMED',
      occurrenceDate: '2026-08-06',
      expectedWindow: null,
    });

    const [event] = await repo.listByYear(2026);
    expect(event).toEqual({
      id: 7,
      year: 2026,
      eventType: 'TAX_TABLE_PUBLICATION',
      status: 'CONFIRMED',
      occurrenceDate: '2026-08-06',
      expectedWindow: null,
      titleFi: 'Tapahtuma 7 FI',
      titleEn: 'Event 7 EN',
      summaryFi: 'Yhteenveto 7',
      summaryEn: 'Summary 7',
      sourceUrl: 'https://example.com/source',
    });
  });
});

// ---------------------------------------------------------------------------
// listByYear — deterministic order (the pure comparator's total order)
// ---------------------------------------------------------------------------

describe('DrizzleCalendarEventRepository.listByYear — deterministic order', () => {
  /** Same-period precedence + tie-break fixtures, in shuffled insert order. */
  const FIXTURES: FixtureEvent[] = [
    // 2026-Q4 window — period start 2026-10-01, EXPECTED (sorts last of the day)
    {
      id: 30,
      year: 2026,
      eventType: 'RATE_DECISION',
      status: 'EXPECTED',
      occurrenceDate: null,
      expectedWindow: '2026-Q4',
    },
    // Same day, CONFIRMED — beats the EXPECTED window in the same period
    {
      id: 10,
      year: 2026,
      eventType: 'RATE_DECISION',
      status: 'CONFIRMED',
      occurrenceDate: '2026-10-01',
      expectedWindow: null,
    },
    // Earlier period — March window sorts first overall
    {
      id: 20,
      year: 2026,
      eventType: 'ALKO_PRICE_LIST',
      status: 'EXPECTED',
      occurrenceDate: null,
      expectedWindow: '2026-03',
    },
    // Same day, CONFIRMED, earlier event type (FI < RATE in code-unit order)
    {
      id: 11,
      year: 2026,
      eventType: 'FI_EXCISE_CHANGE',
      status: 'CONFIRMED',
      occurrenceDate: '2026-10-01',
      expectedWindow: null,
    },
  ];

  /** The stated order: period start, CONFIRMED first, then event type, then id. */
  const EXPECTED_IDS = [20, 11, 10, 30];

  it('returns rows in the stated order regardless of row read order', async () => {
    const { d1, repo } = makeRepo();
    for (const fixture of FIXTURES) {
      await insertEvent(d1, fixture);
    }

    const events = await repo.listByYear(2026);
    expect(events.map((e) => e.id)).toEqual(EXPECTED_IDS);
  });

  it('two identical calls produce item-for-item identical output', async () => {
    const { d1, repo } = makeRepo();
    for (const fixture of FIXTURES) {
      await insertEvent(d1, fixture);
    }

    const first = await repo.listByYear(2026);
    const second = await repo.listByYear(2026);
    expect(second).toEqual(first);
    expect(second.map((e) => e.id)).toEqual(first.map((e) => e.id));
  });

  it('insert order does not affect the output order', async () => {
    const a = makeRepo();
    const b = makeRepo();
    for (const fixture of FIXTURES) {
      await insertEvent(a.d1, fixture);
    }
    for (const fixture of [...FIXTURES].reverse()) {
      await insertEvent(b.d1, fixture);
    }

    const fromA = await a.repo.listByYear(2026);
    const fromB = await b.repo.listByYear(2026);
    expect(fromB).toEqual(fromA);
  });
});

// ---------------------------------------------------------------------------
// findNext — precedence, window boundary, cross-year reads
// ---------------------------------------------------------------------------

describe('DrizzleCalendarEventRepository.findNext — precedence', () => {
  async function seedQuarterPair(): Promise<{
    repo: DrizzleCalendarEventRepository;
  }> {
    const { d1, repo } = makeRepo();
    // Same period start 2026-10-01: an EXPECTED Q4 window and a CONFIRMED day.
    await insertEvent(d1, {
      id: 2,
      year: 2026,
      eventType: 'RATE_DECISION',
      status: 'EXPECTED',
      occurrenceDate: null,
      expectedWindow: '2026-Q4',
    });
    await insertEvent(d1, {
      id: 1,
      year: 2026,
      eventType: 'RATE_DECISION',
      status: 'CONFIRMED',
      occurrenceDate: '2026-10-01',
      expectedWindow: null,
    });
    return { repo };
  }

  it('CONFIRMED beats the EXPECTED window in the same period', async () => {
    const { repo } = await seedQuarterPair();
    const next = await repo.findNext('2026-09-15');
    expect(next?.id).toBe(1);
    expect(next?.status).toBe('CONFIRMED');
  });

  it('a window whose start has passed stays upcoming until it has ended', async () => {
    const { repo } = await seedQuarterPair();
    // The CONFIRMED day is gone; the Q4 window (ends 2026-12-31) is current.
    const next = await repo.findNext('2026-11-15');
    expect(next?.id).toBe(2);
    expect(next?.status).toBe('EXPECTED');

    // The window-end day itself is still inclusive.
    const lastDay = await repo.findNext('2026-12-31');
    expect(lastDay?.id).toBe(2);
  });

  it('returns null once every event is past — nothing is invented', async () => {
    const { repo } = await seedQuarterPair();
    await expect(repo.findNext('2027-01-01')).resolves.toBeNull();
  });

  it('returns null when no events exist at all', async () => {
    const { repo } = makeRepo();
    await expect(repo.findNext('2026-06-01')).resolves.toBeNull();
  });

  it('only-past events are never returned', async () => {
    const { d1, repo } = makeRepo();
    await insertEvent(d1, {
      id: 1,
      year: 2026,
      eventType: 'FI_EXCISE_CHANGE',
      status: 'CONFIRMED',
      occurrenceDate: '2026-01-01',
      expectedWindow: null,
    });
    await expect(repo.findNext('2026-06-01')).resolves.toBeNull();
  });

  it('finds future-year events even when the current year is exhausted', async () => {
    const { d1, repo } = makeRepo();
    await insertEvent(d1, {
      id: 1,
      year: 2026,
      eventType: 'FI_EXCISE_CHANGE',
      status: 'CONFIRMED',
      occurrenceDate: '2026-01-01',
      expectedWindow: null,
    });
    await insertEvent(d1, {
      id: 5,
      year: 2027,
      eventType: 'FI_EXCISE_CHANGE',
      status: 'CONFIRMED',
      occurrenceDate: '2027-03-01',
      expectedWindow: null,
    });

    // No upper year bound: the 2027 row is reachable from late 2026.
    const next = await repo.findNext('2026-12-30');
    expect(next?.id).toBe(5);
  });

  it('keeps a one-year-back window eligible despite a mis-year row', async () => {
    const { d1, repo } = makeRepo();
    // The read window starts one year back so a row whose window end
    // reaches past its own year column stays eligible (ops-input
    // robustness; the seed self-check would reject this row).
    await insertEvent(d1, {
      id: 9,
      year: 2025,
      eventType: 'ALKO_PRICE_LIST',
      status: 'EXPECTED',
      occurrenceDate: null,
      expectedWindow: '2026-03',
    });
    const next = await repo.findNext('2026-02-15');
    expect(next?.id).toBe(9);
  });

  it('rejects a malformed fromDate as a caller-contract violation', async () => {
    const { repo } = makeRepo();
    await expect(repo.findNext('not-a-date')).rejects.toBeInstanceOf(
      InvalidCalendarInputError,
    );
    await expect(repo.findNext('2026-02-30')).rejects.toBeInstanceOf(
      InvalidCalendarInputError,
    );
  });
});

// ---------------------------------------------------------------------------
// Port registration — the token resolves to the adapter
// ---------------------------------------------------------------------------

describe('DataPlatformModule registration', () => {
  function moduleProviders(): Provider[] {
    return (Reflect.getMetadata('providers', DataPlatformModule) ??
      []) as Provider[];
  }

  function findPortProvider(): { useClass?: unknown } | undefined {
    const portProvider = moduleProviders().find(
      (provider) =>
        typeof provider === 'object' &&
        'provide' in provider &&
        provider.provide === CALENDAR_EVENT_REPOSITORY_PORT,
    );
    return portProvider as { useClass?: unknown } | undefined;
  }

  it('binds CALENDAR_EVENT_REPOSITORY_PORT to DrizzleCalendarEventRepository', () => {
    const portProvider = findPortProvider();
    expect(portProvider).toBeDefined();
    expect(portProvider?.useClass).toBe(DrizzleCalendarEventRepository);
  });

  it('registers the adapter class and exports the port token', () => {
    expect(moduleProviders()).toContain(DrizzleCalendarEventRepository);

    const exports = (Reflect.getMetadata('exports', DataPlatformModule) ??
      []) as unknown[];
    expect(exports).toContain(CALENDAR_EVENT_REPOSITORY_PORT);
    expect(exports).toContain(DrizzleCalendarEventRepository);
  });

  it('constructing without a binding fails loudly on first read', async () => {
    // The DI-container posture (no D1 binding in the pg composition root):
    // construction succeeds, use fails with a descriptive contract error.
    const unbound = new DrizzleCalendarEventRepository();
    await expect(unbound.listByYear(2026)).rejects.toThrow(/no D1 binding/);
    await expect(unbound.findNext('2026-01-01')).rejects.toThrow(/no D1 binding/);
  });
});

// ---------------------------------------------------------------------------
// Seed flow — the committed 2026 rows through the port
// ---------------------------------------------------------------------------

describe('DrizzleCalendarEventRepository over the committed seed', () => {
  it('lists the seeded 2026 set in the stated order', async () => {
    const { d1, repo } = makeRepo();
    const { inserted } = await seedCalendarEvents(d1);
    expect(inserted).toBe(CALENDAR_EVENTS_SEED.length);

    const events = await repo.listByYear(2026);
    // Period starts: 01-01 (id2 EE before id1 FI — same day CONFIRMED,
    // event type ascending), 03-01 (id3), 08-06 (id5), 09-01 (id4),
    // 10-01 (id6 Q4 window).
    expect(events.map((e) => e.id)).toEqual([2, 1, 3, 5, 4, 6]);

    // Row → domain mapping is exact — the seed row IS the domain shape.
    const byId = new Map(CALENDAR_EVENTS_SEED.map((row) => [row.id, row]));
    expect(events).toEqual([2, 1, 3, 5, 4, 6].map((id) => byId.get(id)));
  });

  it('selects the next event from the seeded rows', async () => {
    const { d1, repo } = makeRepo();
    await seedCalendarEvents(d1);

    // On New Year's Day everything is upcoming; the first of the listing
    // wins (EE excise before FI — same period, CONFIRMED, type ascending).
    const atYearStart = await repo.findNext('2026-01-01');
    expect(atYearStart?.id).toBe(2);

    // Mid-October: every CONFIRMED date and the September window are past;
    // the Q4 rate-decision window (ends 2026-12-31) is still upcoming.
    const midOctober = await repo.findNext('2026-10-15');
    expect(midOctober?.id).toBe(6);
    expect(midOctober?.eventType).toBe('RATE_DECISION');
    expect(midOctober?.status).toBe('EXPECTED');
  });

  it('re-seeding is idempotent and never resurrects or duplicates rows', async () => {
    const { d1, repo } = makeRepo();
    await seedCalendarEvents(d1);
    const second = await seedCalendarEvents(d1);
    expect(second).toEqual({ inserted: 0, skipped: CALENDAR_EVENTS_SEED.length });

    const events = await repo.listByYear(2026);
    expect(events).toHaveLength(CALENDAR_EVENTS_SEED.length);
  });
});
