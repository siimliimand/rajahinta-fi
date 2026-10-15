/**
 * Migration 0038 (change tax-change-calendar, task 1.2) — the
 * calendar_events table. Proves, against the real SQLite engine with
 * the committed migrations applied on a fresh D1 database:
 *
 *   - the table exists with the three canonical CHECKs (closed event
 *     type and status vocabularies, status/period coupling);
 *   - a CONFIRMED row (exact occurrence_date) and EXPECTED rows
 *     ('YYYY-MM' and 'YYYY-Qn' windows) insert cleanly, with the
 *     ISO-8601 created_at default firing;
 *   - values outside the closed vocabularies are rejected, and the
 *     status/precision coupling rejects every shape the validator
 *     rejects (CONFIRMED without a date, EXPECTED with a date, EXPECTED
 *     without a window);
 *   - calendar_events_year_period_idx exists and serves the year-range
 *     read (the homepage widget's single indexed next-event query).
 *
 * @module D1Migration0038Test
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';

const { db } = openMigratedD1();

function insertEvent(overrides: {
  id: number;
  eventType: string;
  status: string;
  occurrenceDate: string | null;
  expectedWindow: string | null;
}): void {
  db.prepare(
    `INSERT INTO calendar_events (
       id, year, event_type, status, occurrence_date, expected_window,
       title_fi, title_en, summary_fi, summary_en, source_url
     ) VALUES (?, 2026, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    overrides.id,
    overrides.eventType,
    overrides.status,
    overrides.occurrenceDate,
    overrides.expectedWindow,
    'Testitapahtuma',
    'Test event',
    'Testitiivistelmä.',
    'Test summary.',
    'https://vero.fi/artikkeli/valmisteverot-2026',
  );
}

describe('migration 0038 — calendar_events on a fresh D1 database', () => {
  it('creates the table with the three canonical CHECK constraints', () => {
    const table = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'calendar_events'")
      .get() as { sql: string };
    // SQLite stores CHECK text verbatim as written (this migration's
    // drizzle-generated style quotes identifiers with backticks); the
    // 0033 precedent asserts the double-quoted canonical form, so
    // normalize before matching.
    const sql = table.sql.replace(/[`"]/g, '"');
    expect(sql).toContain(
      `"calendar_events"."event_type" IN ('FI_EXCISE_CHANGE', 'EE_EXCISE_CHANGE', 'ALKO_PRICE_LIST', 'TAX_TABLE_PUBLICATION', 'RATE_DECISION')`,
    );
    expect(sql).toContain(`"calendar_events"."status" IN ('CONFIRMED', 'EXPECTED')`);
    expect(sql).toContain(
      `("calendar_events"."status" = 'CONFIRMED' AND "calendar_events"."occurrence_date" IS NOT NULL AND "calendar_events"."expected_window" IS NULL) OR ("calendar_events"."status" = 'EXPECTED' AND "calendar_events"."occurrence_date" IS NULL AND "calendar_events"."expected_window" IS NOT NULL)`,
    );
  });

  it('accepts a CONFIRMED event with its exact occurrence date', () => {
    insertEvent({
      id: 1,
      eventType: 'FI_EXCISE_CHANGE',
      status: 'CONFIRMED',
      occurrenceDate: '2026-01-01',
      expectedWindow: null,
    });
    const row = db
      .prepare(
        `SELECT year, event_type, status, occurrence_date, expected_window,
                title_fi, title_en, summary_fi, summary_en, source_url, created_at
         FROM calendar_events WHERE id = 1`,
      )
      .get() as Record<string, string | number | null>;
    expect(row).toEqual({
      year: 2026,
      event_type: 'FI_EXCISE_CHANGE',
      status: 'CONFIRMED',
      occurrence_date: '2026-01-01',
      expected_window: null,
      title_fi: 'Testitapahtuma',
      title_en: 'Test event',
      summary_fi: 'Testitiivistelmä.',
      summary_en: 'Test summary.',
      source_url: 'https://vero.fi/artikkeli/valmisteverot-2026',
      // The ISO_8601_NOW column default fired — ISO-8601 UTC TEXT shape.
      created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    });
  });

  it('accepts EXPECTED events with month and quarter windows', () => {
    insertEvent({
      id: 2,
      eventType: 'ALKO_PRICE_LIST',
      status: 'EXPECTED',
      occurrenceDate: null,
      expectedWindow: '2026-09',
    });
    insertEvent({
      id: 3,
      eventType: 'RATE_DECISION',
      status: 'EXPECTED',
      occurrenceDate: null,
      expectedWindow: '2027-Q4',
    });
    const windows = db
      .prepare(
        `SELECT expected_window FROM calendar_events
         WHERE status = 'EXPECTED' ORDER BY expected_window`,
      )
      .all() as Array<{ expected_window: string }>;
    expect(windows.map((w) => w.expected_window)).toEqual(['2026-09', '2027-Q4']);
  });

  it('rejects an unknown event type and an unknown status', () => {
    expect(() =>
      insertEvent({
        id: 10,
        eventType: 'ALKO_SALE',
        status: 'CONFIRMED',
        occurrenceDate: '2026-03-02',
        expectedWindow: null,
      }),
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      insertEvent({
        id: 11,
        eventType: 'FI_EXCISE_CHANGE',
        status: 'PREDICTED',
        occurrenceDate: '2026-03-02',
        expectedWindow: null,
      }),
    ).toThrow(/CHECK constraint failed/);
  });

  it('rejects every status/precision shape the validator rejects', () => {
    // CONFIRMED without occurrence_date.
    expect(() =>
      insertEvent({
        id: 12,
        eventType: 'FI_EXCISE_CHANGE',
        status: 'CONFIRMED',
        occurrenceDate: null,
        expectedWindow: null,
      }),
    ).toThrow(/CHECK constraint failed/);
    // CONFIRMED with a window instead of a date.
    expect(() =>
      insertEvent({
        id: 13,
        eventType: 'FI_EXCISE_CHANGE',
        status: 'CONFIRMED',
        occurrenceDate: null,
        expectedWindow: '2026-01',
      }),
    ).toThrow(/CHECK constraint failed/);
    // EXPECTED with an occurrence_date — day precision a rhythm row must not claim.
    expect(() =>
      insertEvent({
        id: 14,
        eventType: 'ALKO_PRICE_LIST',
        status: 'EXPECTED',
        occurrenceDate: '2026-09-01',
        expectedWindow: null,
      }),
    ).toThrow(/CHECK constraint failed/);
    // EXPECTED without a window.
    expect(() =>
      insertEvent({
        id: 15,
        eventType: 'ALKO_PRICE_LIST',
        status: 'EXPECTED',
        occurrenceDate: null,
        expectedWindow: null,
      }),
    ).toThrow(/CHECK constraint failed/);
  });

  it('serves the year-range read through calendar_events_year_period_idx', () => {
    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'calendar_events' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    expect(indexes.map((i) => i.name)).toEqual(['calendar_events_year_period_idx']);

    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT id, event_type, status, occurrence_date, expected_window
         FROM calendar_events
         WHERE year = ?`,
      )
      .all(2026) as Array<{ detail: string }>;
    expect(plan.some((p) => /USING INDEX calendar_events_year_period_idx/.test(p.detail))).toBe(
      true,
    );
  });
});
