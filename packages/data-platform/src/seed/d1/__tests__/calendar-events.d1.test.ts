/**
 * Tests for the 2026 tax-change-calendar seed (task 1.3, change
 * tax-change-calendar): `seed/calendar-events.seed.ts`,
 * `generateCalendarEventsSql()`, and the calendar fields of the
 * verification contract.
 *
 * Pins the properties task 1.3's correctness rests on:
 *
 * 1. Idempotency — seeding twice (generated SQL, function seed, or both
 *    in any order) leaves exactly the six 2026 rows, no duplicates; and
 *    an ops-console in-place edit (task 5.1's EXPECTED → CONFIRMED
 *    upgrade) survives every re-seed untouched — the seed is
 *    bootstrap-only.
 *
 * 2. Integration read — the year-2026 read returns all six events with
 *    their status/precision split and a non-empty official sourceUrl
 *    matching the verified-facts note, and the seed texts carry none of
 *    the figures the note flags as UNVERIFIED.
 *
 * 3. Parity — the generated SQL and the function seed land rows
 *    row-for-row equal (one source of truth, two apply paths).
 *
 * 4. Verification gates — buildVerifySql()'s calendar assertions pass a
 *    seeded database, trip on a wiped one, and tolerate ops-added rows
 *    (floor semantics).
 *
 * @module Tests/Seed/D1/CalendarEvents
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  SEED_SQL_FILES,
  SeedVerificationError,
  assertVerificationRow,
  buildExpectations,
  buildVerifySql,
  generateCalendarEventsSql,
} from '../generate';
import { openMigratedD1 } from '../../../repositories/d1/__tests__/d1-test-harness';
import {
  CALENDAR_EVENTS_SEED,
  seedCalendarEvents,
} from '../../calendar-events.seed';

/** All columns both apply paths set (created_at is the wall-clock default). */
const PARITY_COLUMNS =
  'id, year, event_type, status, occurrence_date, expected_window, ' +
  'title_fi, title_en, summary_fi, summary_en, source_url';

function selectEvents(db: DatabaseSync): unknown[] {
  return db
    .prepare(`SELECT ${PARITY_COLUMNS} FROM calendar_events ORDER BY id`)
    .all();
}

/** The event identity the verified-facts note fixes for each seed row. */
const EXPECTED_EVENTS: Array<{
  id: number;
  eventType: string;
  status: 'CONFIRMED' | 'EXPECTED';
  occurrenceDate: string | null;
  expectedWindow: string | null;
  sourceUrl: string;
}> = [
  {
    id: 1,
    eventType: 'FI_EXCISE_CHANGE',
    status: 'CONFIRMED',
    occurrenceDate: '2026-01-01',
    expectedWindow: null,
    sourceUrl:
      'https://www.vero.fi/en/businesses-and-corporations/taxes-and-charges/excise-taxation/excise-duty-on-alcohol-and-alcoholic-beverages/Excise-duty-table-for-alcohol-and-alcoholic-beveragesoholijuomaverotaulukko/',
  },
  {
    id: 2,
    eventType: 'EE_EXCISE_CHANGE',
    status: 'CONFIRMED',
    occurrenceDate: '2026-01-01',
    expectedWindow: null,
    sourceUrl: 'https://www.emta.ee/en/business-client/taxes-and-payment/excise-duties/alcohol',
  },
  {
    id: 3,
    eventType: 'ALKO_PRICE_LIST',
    status: 'EXPECTED',
    occurrenceDate: null,
    expectedWindow: '2026-03',
    sourceUrl: 'https://www.alko.fi/fi/alko-oy/uutishuone/verotusmuutokset-2026',
  },
  {
    id: 4,
    eventType: 'ALKO_PRICE_LIST',
    status: 'EXPECTED',
    occurrenceDate: null,
    expectedWindow: '2026-09',
    sourceUrl: 'https://www.alko.fi/fi/alko-oy/uutishuone/verotusmuutokset-2026',
  },
  {
    id: 5,
    eventType: 'TAX_TABLE_PUBLICATION',
    status: 'CONFIRMED',
    occurrenceDate: '2026-08-06',
    expectedWindow: null,
    sourceUrl:
      'https://www.vero.fi/syventavat-vero-ohjeet/paatokset/371142/verohallinnon-paatos-alkoholi-ja-alkoholijuomaveron-maarasta',
  },
  {
    id: 6,
    eventType: 'RATE_DECISION',
    status: 'EXPECTED',
    occurrenceDate: null,
    expectedWindow: '2026-Q4',
    sourceUrl:
      'https://www.vero.fi/tietoa-verohallinnosta/uutishuone/verotuksen_muutoksia/valmisteverotuksen-muutoksia-1.1.2027',
  },
];

describe('calendar seed module contract (task 1.3)', () => {
  it('ships exactly the six verified 2026 events with deterministic ids', () => {
    expect(CALENDAR_EVENTS_SEED.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(CALENDAR_EVENTS_SEED.map((r) => r.eventType)).toEqual([
      'FI_EXCISE_CHANGE',
      'EE_EXCISE_CHANGE',
      'ALKO_PRICE_LIST',
      'ALKO_PRICE_LIST',
      'TAX_TABLE_PUBLICATION',
      'RATE_DECISION',
    ]);
    expect(CALENDAR_EVENTS_SEED.every((r) => r.year === 2026)).toBe(true);
  });

  it('carries the note\u2019s status/precision split and official source per row', () => {
    for (const expected of EXPECTED_EVENTS) {
      const row = CALENDAR_EVENTS_SEED.find((r) => r.id === expected.id)!;
      expect(row.eventType).toBe(expected.eventType);
      expect(row.status).toBe(expected.status);
      expect(row.occurrenceDate).toBe(expected.occurrenceDate);
      expect(row.expectedWindow).toBe(expected.expectedWindow);
      expect(row.sourceUrl).toBe(expected.sourceUrl);
      // FI and EN titles + summaries are non-empty (the validator also
      // enforces this at module load — asserted here as documentation).
      expect(row.titleFi.trim().length).toBeGreaterThan(0);
      expect(row.titleEn.trim().length).toBeGreaterThan(0);
      expect(row.summaryFi.trim().length).toBeGreaterThan(0);
      expect(row.summaryEn.trim().length).toBeGreaterThan(0);
    }
  });

  it('never quotes the figures the verified-facts note flags as UNVERIFIED', () => {
    // The EE consumer examples "0.5 l beer +~10 snt" / "spirits bottle
    // +~30 snt" have no official source — only the official EMTA rates
    // may appear in seed text.
    for (const row of CALENDAR_EVENTS_SEED) {
      const texts = [row.titleFi, row.titleEn, row.summaryFi, row.summaryEn];
      for (const text of texts) {
        expect(text).not.toMatch(/\+~?10\s*snt/i);
        expect(text).not.toMatch(/\+~?30\s*snt/i);
      }
    }
  });

  it('emits one guarded INSERT with explicit ids and no created_at', () => {
    const sql = generateCalendarEventsSql();
    expect(sql).toContain('INSERT OR IGNORE INTO "calendar_events"');
    expect(sql).toContain('"id"');
    expect(sql).not.toContain('"created_at"');
    for (const { eventType } of CALENDAR_EVENTS_SEED) {
      expect(sql).toContain(`'${eventType}'`);
    }
  });
});

describe('calendar seed idempotency (node:sqlite)', () => {
  const DB_TEST_TIMEOUT_MS = 30_000;

  it('re-applying the generated SQL leaves exactly the six rows, no duplicates', () => {
    const { db } = openMigratedD1();
    const sql = generateCalendarEventsSql();

    db.exec(sql);
    db.exec(sql);
    db.exec(sql);

    const rows = selectEvents(db);
    expect(rows).toHaveLength(CALENDAR_EVENTS_SEED.length);
    const ids = (rows as Array<{ id: number }>).map((r) => r.id);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6]);
  }, DB_TEST_TIMEOUT_MS);

  it('running the function seed twice reports insert-then-skip and lands six rows', async () => {
    const { d1, db } = openMigratedD1();

    const first = await seedCalendarEvents(d1);
    expect(first).toEqual({
      inserted: CALENDAR_EVENTS_SEED.length,
      skipped: 0,
    });

    const second = await seedCalendarEvents(d1);
    expect(second).toEqual({ inserted: 0, skipped: CALENDAR_EVENTS_SEED.length });

    expect(selectEvents(db)).toHaveLength(CALENDAR_EVENTS_SEED.length);
  }, DB_TEST_TIMEOUT_MS);

  it('interleaving both apply paths never duplicates (function over SQL and back)', async () => {
    const { d1, db } = openMigratedD1();

    db.exec(generateCalendarEventsSql());
    await seedCalendarEvents(d1);
    db.exec(generateCalendarEventsSql());
    await seedCalendarEvents(d1);

    expect(selectEvents(db)).toHaveLength(CALENDAR_EVENTS_SEED.length);
  }, DB_TEST_TIMEOUT_MS);

  it('an ops-console status upgrade survives re-seeding in place, never duplicated', async () => {
    // Task 5.1's edit path: the spring Alko row is upgraded EXPECTED →
    // CONFIRMED on the same id (no delete exists). The id-based guard is
    // what keeps a period-keyed guard from resurrecting the pre-edit
    // status as a duplicate row.
    const { d1, db } = openMigratedD1();

    db.exec(generateCalendarEventsSql());
    db.exec(
      `UPDATE calendar_events
       SET status = 'CONFIRMED', occurrence_date = '2026-03-27', expected_window = NULL
       WHERE id = 3`,
    );

    db.exec(generateCalendarEventsSql());
    await seedCalendarEvents(d1);

    expect(selectEvents(db)).toHaveLength(CALENDAR_EVENTS_SEED.length);
    const upgraded = db
      .prepare(
        `SELECT status, occurrence_date, expected_window FROM calendar_events WHERE id = 3`,
      )
      .get() as { status: string; occurrence_date: string; expected_window: null };
    expect(upgraded).toEqual({
      status: 'CONFIRMED',
      occurrence_date: '2026-03-27',
      expected_window: null,
    });
  }, DB_TEST_TIMEOUT_MS);
});

describe('calendar seed parity — generated SQL vs function seed (node:sqlite)', () => {
  const DB_TEST_TIMEOUT_MS = 30_000;

  it('both apply paths land rows row-for-row equal, ids included', async () => {
    const viaFunction = openMigratedD1();
    const viaSql = openMigratedD1();

    await seedCalendarEvents(viaFunction.d1);
    viaSql.db.exec(generateCalendarEventsSql());

    expect(selectEvents(viaFunction.db)).toHaveLength(CALENDAR_EVENTS_SEED.length);
    expect(selectEvents(viaSql.db)).toEqual(selectEvents(viaFunction.db));
  }, DB_TEST_TIMEOUT_MS);
});

describe('calendar seed integration read (year 2026)', () => {
  const DB_TEST_TIMEOUT_MS = 30_000;

  it('returns all six events with non-empty official sources matching the note', async () => {
    const { d1, db } = openMigratedD1();
    await seedCalendarEvents(d1);

    const rows = db
      .prepare(
        `SELECT id, year, event_type, status, occurrence_date, expected_window, source_url
         FROM calendar_events WHERE year = 2026 ORDER BY id`,
      )
      .all() as Array<{
      id: number;
      year: number;
      event_type: string;
      status: string;
      occurrence_date: string | null;
      expected_window: string | null;
      source_url: string;
    }>;

    expect(rows).toHaveLength(6);
    expect(rows).toEqual(
      EXPECTED_EVENTS.map((e) => ({
        id: e.id,
        year: 2026,
        event_type: e.eventType,
        status: e.status,
        occurrence_date: e.occurrenceDate,
        expected_window: e.expectedWindow,
        source_url: e.sourceUrl,
      })),
    );
    for (const row of rows) {
      expect(row.source_url.trim().length).toBeGreaterThan(0);
      expect(new URL(row.source_url).protocol).toMatch(/^https?:$/);
    }
  }, DB_TEST_TIMEOUT_MS);
});

describe('calendar seed verification gates (design D3)', () => {
  const DB_TEST_TIMEOUT_MS = 30_000;

  function applyAllSeeds(db: DatabaseSync): void {
    for (const { generate } of SEED_SQL_FILES) {
      db.exec(generate());
    }
  }

  it('passes on a fully seeded database', () => {
    const { db } = openMigratedD1();
    applyAllSeeds(db);
    const row = db.prepare(buildVerifySql()).get() as Record<string, unknown>;
    expect(() => assertVerificationRow(row)).not.toThrow();
    expect(row['calendar_events_total']).toBe(CALENDAR_EVENTS_SEED.length);
    expect(row['spot_fi_excise_change_rows']).toBe(1);
  }, DB_TEST_TIMEOUT_MS);

  it('trips with the calendar gate when the table was wiped', () => {
    const { db } = openMigratedD1();
    applyAllSeeds(db);
    db.exec('DELETE FROM calendar_events');

    const row = db.prepare(buildVerifySql()).get() as Record<string, unknown>;
    expect(() => assertVerificationRow(row)).toThrow(SeedVerificationError);
    expect(() => assertVerificationRow(row)).toThrow(/calendar_events_total/);
  }, DB_TEST_TIMEOUT_MS);

  it('tolerates an ops-created 2027 event (floor, not exact total)', () => {
    const { db } = openMigratedD1();
    applyAllSeeds(db);
    // The ops console's create path (task 5.1) legitimately grows the
    // table past the seed set — the gate must not fail the deploy.
    db.exec(
      `INSERT INTO calendar_events (id, year, event_type, status, occurrence_date, expected_window,
          title_fi, title_en, summary_fi, summary_en, source_url)
       VALUES (100, 2027, 'FI_EXCISE_CHANGE', 'CONFIRMED', '2027-01-01', NULL,
          'Testi', 'Test', 'Testi', 'Test', 'https://www.vero.fi')`,
    );

    const row = db.prepare(buildVerifySql()).get() as Record<string, unknown>;
    expect(() => assertVerificationRow(row)).not.toThrow();
    expect(row['calendar_events_total']).toBe(CALENDAR_EVENTS_SEED.length + 1);
  }, DB_TEST_TIMEOUT_MS);

  it('derives the gate counts from the same seed constants', () => {
    const expectations = buildExpectations();
    expect(expectations.calendarEventsTotal).toBe(CALENDAR_EVENTS_SEED.length);
    expect(expectations.spotCalendarEventRows).toEqual({
      fieldName: 'spot_fi_excise_change_rows',
      expected: 1,
    });
  });
});
