/**
 * January calendar-skeleton cron tests (task 3.1, change
 * calendar-event-automation) — the integration the task pins, over the
 * FULL default path (real DrizzleCalendarEventRepository year read +
 * the console-parity insert) against the migrated fake-D1 harness:
 *
 * - a tick over an empty calendar inserts the two EXPECTED rows for the
 *   CURRENT year (the default clock read — no year seam passed);
 * - the second tick inserts nothing: rerun creates no duplicates;
 * - a year already carrying ONE Alko row inserts nothing — the
 *   all-or-nothing year rule lives in the pure generator, and this
 *   suite pins that the repository read feeds it;
 * - non-Alko rows in the year never block generation;
 * - generated rows are rhythm only (EXPECTED, month windows, the rhythm
 *   source, no occurrence date);
 * - the wrapper is fail-open: a failing insert is logged, never raised;
 * - router wiring for the annual January pattern.
 *
 * @module CalendarSkeletonCronTest
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { type DatabaseSync } from 'node:sqlite';
// The migrated in-memory database — the raw()-capable data-platform shim
// wraps it (the drizzle select path the calendar repository drives reads
// rows through raw(); the ops calendar-events suite uses the same combo).
import { openMigratedD1 } from '../../analytics/__tests__/fake-d1';
import { createD1Shim } from '../../../../../packages/data-platform/src/repositories/d1/__tests__/d1-test-harness';
import {
  CALENDAR_SKELETON_CRON,
  handleCalendarSkeleton,
  runCalendarSkeleton,
} from '../calendar-skeleton';
import { handlersForCron } from '../router';
import { createLogger, type Logger } from '../../logger';
import { ALKO_RHYTHM_SOURCE_URL } from '../../../../../packages/core-domain/src/calendar/calendar.skeleton';
import type { Env } from '../../env';
import type { D1DatabaseLike } from '../../../../../packages/data-platform/src/d1/executor';

const LOG: Logger = createLogger('error');
const YEAR = new Date().getUTCFullYear();

interface Row {
  id: number;
  year: number;
  event_type: string;
  status: string;
  occurrence_date: string | null;
  expected_window: string | null;
  source_url: string;
}

/** Migrated in-memory calendar store over the raw()-capable D1 shim. */
function openCalendarD1(): { db: DatabaseSync; d1: D1DatabaseLike; env: Env } {
  const { db } = openMigratedD1();
  const d1 = createD1Shim(db);
  return { db, d1, env: { DB: d1 } as unknown as Env };
}

function rows(db: DatabaseSync): Row[] {
  return db
    .prepare(
      'SELECT id, year, event_type, status, occurrence_date, expected_window, source_url FROM calendar_events ORDER BY id',
    )
    .all() as unknown as Row[];
}

/** Seed one non-Alko row for the year (an operator-confirmed fact). */
async function seedExciseRow(d1: D1DatabaseLike, year: number): Promise<void> {
  await d1.prepare(
    'INSERT INTO calendar_events ' +
      '(id, year, event_type, status, occurrence_date, expected_window, ' +
      'title_fi, title_en, summary_fi, summary_en, source_url) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      1,
      year,
      'FI_EXCISE_CHANGE',
      'CONFIRMED',
      `${year}-01-01`,
      null,
      'Valmistevero muuttui',
      'Excise changed',
      'Vahvistettu tosiasia.',
      'A confirmed fact.',
      ALKO_RHYTHM_SOURCE_URL,
    )
    .run();
}

describe('handleCalendarSkeleton (full default path over fake D1)', () => {
  it('a tick over an empty calendar inserts the two EXPECTED rows for the current year', async () => {
    const { db, env } = openCalendarD1();

    const result = await handleCalendarSkeleton(env, LOG);

    expect(result).toEqual({ year: YEAR, inserted: 2, outcome: 'inserted' });
    const stored = rows(db);
    expect(stored).toHaveLength(2);
    // Rhythm only: EXPECTED, one month window each, no occurrence date,
    // the official Alko rhythm statement as the single source.
    expect(stored.map((row) => row.expected_window)).toEqual([
      `${YEAR}-03`,
      `${YEAR}-09`,
    ]);
    for (const row of stored) {
      expect(row.year).toBe(YEAR);
      expect(row.event_type).toBe('ALKO_PRICE_LIST');
      expect(row.status).toBe('EXPECTED');
      expect(row.occurrence_date).toBeNull();
      expect(row.source_url).toBe(ALKO_RHYTHM_SOURCE_URL);
      expect(row.id).toBeGreaterThan(0);
    }
  });

  it('the second tick inserts nothing — rerun creates no duplicates', async () => {
    const { db, env } = openCalendarD1();
    await handleCalendarSkeleton(env, LOG);

    const second = await handleCalendarSkeleton(env, LOG);

    expect(second).toEqual({ year: YEAR, inserted: 0, outcome: 'year-covered' });
    expect(rows(db)).toHaveLength(2);
  });

  it('a year carrying ONE Alko row inserts nothing — all-or-nothing year rule through the repository read', async () => {
    const { db, d1, env } = openCalendarD1();
    // A partial pair (spring only, operator-upgraded to a confirmed fact)
    // — exactly the state the all-or-nothing rule exists for.
    await d1.prepare(
      'INSERT INTO calendar_events ' +
        '(id, year, event_type, status, occurrence_date, expected_window, ' +
        'title_fi, title_en, summary_fi, summary_en, source_url) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        1,
        YEAR,
        'ALKO_PRICE_LIST',
        'CONFIRMED',
        `${YEAR}-03-31`,
        null,
        'Alkon kevät (vahvistettu)',
        'Alko spring (confirmed)',
        'Vahvistettu rivi.',
        'A confirmed row.',
        ALKO_RHYTHM_SOURCE_URL,
      )
      .run();

    const result = await handleCalendarSkeleton(env, LOG);

    expect(result).toEqual({ year: YEAR, inserted: 0, outcome: 'year-covered' });
    // The operator's confirmed row is untouched; no autumn half was appended.
    const stored = rows(db);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.occurrence_date).toBe(`${YEAR}-03-31`);
  });

  it('non-Alko rows in the year do not block generation', async () => {
    const { db, env } = openCalendarD1();
    await seedExciseRow(env.DB, YEAR);

    const result = await handleCalendarSkeleton(env, LOG);

    expect(result).toEqual({ year: YEAR, inserted: 2, outcome: 'inserted' });
    const stored = rows(db);
    expect(stored).toHaveLength(3);
    expect(
      stored.filter((row) => row.event_type === 'ALKO_PRICE_LIST'),
    ).toHaveLength(2);
  });
});

describe('the default year — the cron tick is the one clock read', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('targets the current UTC year at tick time (no year seam passed)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${YEAR + 1}-03-04T10:00:00Z`));
    const { db, env } = openCalendarD1();

    const result = await handleCalendarSkeleton(env, LOG);

    expect(result.year).toBe(YEAR + 1);
    expect(rows(db).map((row) => row.year)).toEqual([YEAR + 1, YEAR + 1]);
  });
});

describe('fail-open wrapper (runCalendarSkeleton — the router entry)', () => {
  function makeLog(): Logger & { error: ReturnType<typeof vi.fn> } {
    return {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger & { error: ReturnType<typeof vi.fn> };
  }

  it('a failing insert is logged, never raised — the tick completes', async () => {
    const { d1 } = openCalendarD1();
    const log = makeLog();
    // The MAX(id) read succeeds; the INSERT write rejects (D1 unavailable).
    const brokenD1: D1DatabaseLike = {
      ...d1,
      prepare(sql: string) {
        const bound = d1.prepare(sql);
        if (/INSERT INTO calendar_events/.test(sql)) {
          return {
            ...bound,
            bind(...values: unknown[]) {
              bound.bind(...values);
              return {
                run: () => Promise.reject(new Error('D1 write unavailable')),
              };
            },
          };
        }
        return bound;
      },
    } as D1DatabaseLike;

    const result = await runCalendarSkeleton(
      { DB: brokenD1 } as unknown as Env,
      log,
    );

    expect(result).toBeNull();
    expect(log.error).toHaveBeenCalledTimes(1);
    const fields = log.error.mock.calls[0]?.[0] as { message: string };
    expect(fields.message).toContain('D1 write unavailable');
  });
});

describe('router wiring', () => {
  it('rides the annual January pattern alone', () => {
    expect(CALENDAR_SKELETON_CRON).toBe('0 0 1 1 *');
    expect(handlersForCron(CALENDAR_SKELETON_CRON).map((h) => h.name)).toEqual([
      'calendar-skeleton',
    ]);
  });
});
