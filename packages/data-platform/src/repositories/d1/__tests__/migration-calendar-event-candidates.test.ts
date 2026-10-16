/**
 * Migration 0039 (change calendar-event-automation, task 1.2) — the
 * calendar_event_candidates table. Proves, against the real SQLite
 * engine with the committed migrations applied on a fresh D1 database:
 *
 *   - the table exists with the canonical status CHECK (the closed
 *     PENDING | ACCEPTED | REJECTED review vocabulary);
 *   - PENDING, ACCEPTED, and REJECTED rows insert cleanly — drafts
 *     nullable or filled — with the ISO-8601 created_at default firing;
 *   - the url UNIQUE index is structural: a duplicate URL rejects with
 *     the storage constraint (the dedup half the pure layer's
 *     exact-string decision relies on);
 *   - an unknown status rejects with the CHECK constraint;
 *   - calendar_event_candidates_queue_idx exists and serves the
 *     review-queue read (filter status, order published_at).
 *
 * @module D1Migration0039Test
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';

const { db } = openMigratedD1();

function insertCandidate(overrides: {
  id: number;
  url: string;
  status: string;
  draftFi?: string | null;
  draftEn?: string | null;
}): void {
  db.prepare(
    `INSERT INTO calendar_event_candidates (
       id, source, url, title, published_at, status, draft_fi, draft_en
     ) VALUES (?, 'vero-fi-news', ?, ?, '2026-10-15', ?, ?, ?)`,
  ).run(
    overrides.id,
    overrides.url,
    `Ilmoitus ${overrides.id}`,
    overrides.status,
    overrides.draftFi ?? null,
    overrides.draftEn ?? null,
  );
}

describe('migration 0039 — calendar_event_candidates on a fresh D1 database', () => {
  it('creates the table with the canonical status CHECK', () => {
    const table = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'calendar_event_candidates'",
      )
      .get() as { sql: string };
    // SQLite stores CHECK text verbatim as written (this migration's
    // drizzle-generated style quotes identifiers with backticks); the
    // 0038 precedent asserts the double-quoted canonical form, so
    // normalize before matching.
    const sql = table.sql.replace(/[`"]/g, '"');
    expect(sql).toContain(
      `"calendar_event_candidates"."status" IN ('PENDING', 'ACCEPTED', 'REJECTED')`,
    );
  });

  it('accepts PENDING, ACCEPTED, and REJECTED rows across the draft shapes', () => {
    // PENDING — the watcher's insert, drafts pre-filled.
    insertCandidate({
      id: 1,
      url: 'https://vero.fi/en/press-release/valmisteverot-2027',
      status: 'PENDING',
      draftFi: 'Valmisteverot muuttuvat.',
      draftEn: 'Excise duties change.',
    });
    // ACCEPTED — the operator's terminal decision, drafts as extracted.
    insertCandidate({
      id: 2,
      url: 'https://alko.fi/en/ajankohtaista/hinnastokevat',
      status: 'ACCEPTED',
      draftFi: 'Kevään hinnasto.',
    });
    // REJECTED — retained on purpose: its URL keeps deduplicating.
    insertCandidate({
      id: 3,
      url: 'https://thl.fi/aiheet/paihteet',
      status: 'REJECTED',
    });

    const rows = db
      .prepare(
        `SELECT id, source, url, title, published_at, status, draft_fi, draft_en, created_at
         FROM calendar_event_candidates ORDER BY id`,
      )
      .all() as Array<Record<string, string | number | null>>;
    expect(rows).toEqual([
      {
        id: 1,
        source: 'vero-fi-news',
        url: 'https://vero.fi/en/press-release/valmisteverot-2027',
        title: 'Ilmoitus 1',
        published_at: '2026-10-15',
        status: 'PENDING',
        draft_fi: 'Valmisteverot muuttuvat.',
        draft_en: 'Excise duties change.',
        // The ISO_8601_NOW column default fired — ISO-8601 UTC TEXT shape.
        created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      },
      {
        id: 2,
        source: 'vero-fi-news',
        url: 'https://alko.fi/en/ajankohtaista/hinnastokevat',
        title: 'Ilmoitus 2',
        published_at: '2026-10-15',
        status: 'ACCEPTED',
        draft_fi: 'Kevään hinnasto.',
        draft_en: null,
        created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      },
      {
        id: 3,
        source: 'vero-fi-news',
        url: 'https://thl.fi/aiheet/paihteet',
        title: 'Ilmoitus 3',
        published_at: '2026-10-15',
        status: 'REJECTED',
        draft_fi: null,
        draft_en: null,
        created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      },
    ]);
  });

  it('rejects a duplicate URL through the structural UNIQUE index — any status', () => {
    // The exact-string rule at rest: the same URL cannot re-enter the
    // queue even with a different status — a re-decided announcement
    // would corrupt both the queue and the dedup guarantee.
    insertCandidate({ id: 10, url: 'https://vero.fi/uutiset/123', status: 'PENDING' });
    expect(() =>
      insertCandidate({ id: 11, url: 'https://vero.fi/uutiset/123', status: 'PENDING' }),
    ).toThrow(/UNIQUE constraint failed/);
    expect(() =>
      insertCandidate({ id: 12, url: 'https://vero.fi/uutiset/123', status: 'REJECTED' }),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it('rejects an unknown status through the CHECK constraint', () => {
    expect(() =>
      insertCandidate({ id: 20, url: 'https://vero.fi/uutiset/456', status: 'MAYBE' }),
    ).toThrow(/CHECK constraint failed/);
  });

  it('serves the review-queue read through calendar_event_candidates_queue_idx', () => {
    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'calendar_event_candidates' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    expect(indexes.map((i) => i.name)).toEqual([
      'calendar_event_candidates_queue_idx',
      'calendar_event_candidates_url_unique',
    ]);

    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT id, source, url, title, published_at
         FROM calendar_event_candidates
         WHERE status = ?
         ORDER BY published_at, url`,
      )
      .all('PENDING') as Array<{ detail: string }>;
    expect(
      plan.some((p) => /USING INDEX calendar_event_candidates_queue_idx/.test(p.detail)),
    ).toBe(true);
  });
});
