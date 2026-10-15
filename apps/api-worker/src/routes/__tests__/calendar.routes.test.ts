/**
 * Tax-change calendar route tests (task 3.2, change
 * tax-change-calendar) over the FULL app composition (createApp() +
 * registerCalendarRoutes — the exact composition index.ts wires, age
 * gate + DEFAULT rate limit on the routes themselves) on the fake-D1
 * harness.
 *
 * Pinning here: the deterministic repeated responses (two identical
 * requests → byte-identical bodies; the seed set's stated order —
 * period start, CONFIRMED before EXPECTED in the same period, then
 * type, then id), the verbatim sourced-row pass-through, the always-on
 * structural disclaimer (module-doc policy) with fi default and en
 * explicit, the next-event payload (status included, daysUntil for
 * CONFIRMED, window + null countdown for EXPECTED, CONFIRMED beats
 * EXPECTED at the same period start), the contract-level 400s for bad
 * queries (messages name the valid values) — and the age-gate contract
 * (403 AGE_GATE_REQUIRED without confirmation, both endpoints).
 *
 * @module CalendarRoutesTest
 */

import { describe, it, expect } from 'vitest';
import {
  buildApp,
  expectEnvelope,
  openMigratedD1,
  permissiveEnv,
  request,
} from './harness';
import { registerCalendarRoutes } from '../calendar.routes';
import { seedCalendarEvents } from '../../../../../packages/data-platform/src/seed/calendar-events.seed';
// The raw()-capable shim over the migrated database — the drizzle select
// path the calendar repository drives reads rows through `raw()`, which
// the api-worker fake-D1 shim does not carry. The repository suite
// (task 3.1) runs on this same shim; the migrations stay the routes
// harness's (module-relative paths, cwd-independent).
import { createD1Shim } from '../../../../../packages/data-platform/src/repositories/d1/__tests__/d1-test-harness';
import type { DatabaseSync } from 'node:sqlite';
import type { Env } from '../../env';
import type { D1DatabaseLike } from '../../../../../packages/data-platform/src/d1/executor';

/** Migrated in-memory database wrapped in the raw()-capable D1 shim. */
function openCalendarD1(): { db: DatabaseSync; d1: D1DatabaseLike } {
  const { db } = openMigratedD1();
  return { db, d1: createD1Shim(db) };
}

/**
 * index.ts registers both handlers behind their per-route age gate and
 * DEFAULT limiter (same slot as the other route ports); the test
 * composition mirrors that exactly.
 */
function calendarApp(): ReturnType<typeof buildApp> {
  const app = buildApp();
  registerCalendarRoutes(app);
  return app;
}

function calendarEnv(d1: D1DatabaseLike, overrides: Partial<Env> = {}): Env {
  return permissiveEnv(d1, overrides);
}

const AGE_OK = { 'x-age-confirmed': 'confirmed-test-token' };

async function getEvents(
  app: ReturnType<typeof buildApp>,
  env: Env,
  query = '',
  headers: Record<string, string> = AGE_OK,
): Promise<Response> {
  return request(app, env, `/api/v1/calendar/events${query}`, { headers });
}

async function getNext(
  app: ReturnType<typeof buildApp>,
  env: Env,
  query = '',
  headers: Record<string, string> = AGE_OK,
): Promise<Response> {
  return request(app, env, `/api/v1/calendar/next${query}`, { headers });
}

// ---------------------------------------------------------------------------
// Seed helpers — the real 2026 seed set + explicit test rows
// ---------------------------------------------------------------------------

/** The six seeded 2026 rows (ids in the verified-facts note's order). */
async function seedSix2026Events(d1: D1DatabaseLike): Promise<void> {
  const result = await seedCalendarEvents(d1);
  expect(result).toEqual({ inserted: 6, skipped: 0 });
}

/** A raw calendar_events insert (values must satisfy the schema CHECKs). */
async function insertEvent(
  d1: D1DatabaseLike,
  event: {
    id: number;
    year: number;
    eventType: string;
    status: 'CONFIRMED' | 'EXPECTED';
    occurrenceDate: string | null;
    expectedWindow: string | null;
    titleFi?: string;
    titleEn?: string;
    sourceUrl?: string;
  },
): Promise<void> {
  await d1
    .prepare(
      `INSERT INTO calendar_events (
         id, year, event_type, status, occurrence_date, expected_window,
         title_fi, title_en, summary_fi, summary_en, source_url
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      event.id,
      event.year,
      event.eventType,
      event.status,
      event.occurrenceDate,
      event.expectedWindow,
      event.titleFi ?? 'Testitapahtuma',
      event.titleEn ?? 'Test event',
      'Testin yhteenveto.',
      'Test summary.',
      event.sourceUrl ?? 'https://www.vero.example/test',
    )
    .run();
}

/** An ISO date `days` whole days from now (UTC — no timezone in the figures). */
function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

interface EventJson {
  id: number;
  year: number;
  eventType: string;
  status: string;
  occurrenceDate: string | null;
  expectedWindow: string | null;
  titleFi: string;
  titleEn: string;
  summaryFi: string;
  summaryEn: string;
  sourceUrl: string;
}

interface EventsJson {
  year: number;
  disclaimer: { text: string; language: string; version: string };
  events: EventJson[];
}

interface NextJson {
  fromDate: string;
  event: EventJson;
  status: string;
  daysUntil: number | null;
  expectedWindow: string | null;
  disclaimer: { text: string; language: string; version: string };
}

// ---------------------------------------------------------------------------
// GET /api/v1/calendar/events — deterministic year listing
// ---------------------------------------------------------------------------

describe('GET /api/v1/calendar/events', () => {
  it('lists the 2026 seed set in the deterministic stated order with every sourced field', async () => {
    const { d1 } = openCalendarD1();
    await seedSix2026Events(d1);
    const app = calendarApp();
    const env = calendarEnv(d1);

    const res = await getEvents(app, env, '?year=2026');
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventsJson;
    expect(body.year).toBe(2026);

    // The one total order: period start, then CONFIRMED before EXPECTED
    // in the same period, then event type, then id. The two 2026-01-01
    // CONFIRMED rows order by type (EE_ < FI_), the windows sort by
    // their window starts (March < August < September < Q4/October).
    expect(body.events.map((event) => event.id)).toEqual([2, 1, 3, 5, 4, 6]);

    // Verbatim sourced-row pass-through: both locale texts, the official
    // source URL, and the status/precision split per row.
    const fi = body.events.find((event) => event.id === 1)!;
    expect(fi.status).toBe('CONFIRMED');
    expect(fi.occurrenceDate).toBe('2026-01-01');
    expect(fi.expectedWindow).toBeNull();
    expect(fi.titleEn).toBe('Finnish wine and cider excise rose on 1 January 2026');
    expect(fi.sourceUrl).toContain('vero.fi');

    const q4 = body.events.find((event) => event.id === 6)!;
    expect(q4.status).toBe('EXPECTED');
    expect(q4.occurrenceDate).toBeNull();
    expect(q4.expectedWindow).toBe('2026-Q4');
  });

  it('answers identical bodies on repeated identical requests (determinism)', async () => {
    const { d1 } = openCalendarD1();
    await seedSix2026Events(d1);
    const app = calendarApp();
    const env = calendarEnv(d1);

    const first = await getEvents(app, env, '?year=2026');
    const second = await getEvents(app, env, '?year=2026');
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(JSON.stringify(await first.json())).toBe(
      JSON.stringify(await second.json()),
    );
  });

  it('carries the structural rhythm disclaimer on every listing — fi default, en explicit', async () => {
    const { d1 } = openCalendarD1();
    await seedSix2026Events(d1);
    const app = calendarApp();
    const env = calendarEnv(d1);

    const fi = (await (await getEvents(app, env, '?year=2026')).json()) as EventsJson;
    expect(fi.disclaimer.language).toBe('fi');
    expect(fi.disclaimer.version).toBe('1.0');
    expect(fi.disclaimer.text).toContain('Vuosirytmi');

    const en = (await (
      await getEvents(app, env, '?year=2026&language=en')
    ).json()) as EventsJson;
    expect(en.disclaimer.language).toBe('en');
    expect(en.disclaimer.text).toContain('Annual rhythm');
  });

  it('answers 200 with an empty list for a year with no sourced events', async () => {
    const { d1 } = openCalendarD1();
    await seedSix2026Events(d1);
    const app = calendarApp();
    const body = (await (
      await getEvents(app, calendarEnv(d1), '?year=2031')
    ).json()) as EventsJson;
    expect(body.year).toBe(2031);
    expect(body.events).toEqual([]);
    // Disclaimer policy: ALWAYS present on this endpoint (module doc).
    expect(body.disclaimer.version).toBe('1.0');
  });

  it.each([
    ['year=abcd', /year must be an integer calendar year/],
    ['', /year must be an integer calendar year/],
    ['year=', /year must be an integer calendar year/],
    ['year=2026.5', /year must be an integer calendar year/],
    ['year=2026&language=sv', /language must be one of: fi, en/],
  ])('rejects a bad query (%s) with the contract-level 400', async (query, message) => {
    const { d1 } = openCalendarD1();
    await seedSix2026Events(d1);
    const app = calendarApp();
    const body = await expectEnvelope(
      await getEvents(app, calendarEnv(d1), `?${query}`),
      400,
      { error: 'ValidationError' },
    );
    expect(String(body.message)).toMatch(message as RegExp);
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/calendar/next — next upcoming event
// ---------------------------------------------------------------------------

describe('GET /api/v1/calendar/next', () => {
  it('returns the next CONFIRMED event with its status and daysUntil countdown', async () => {
    const { d1 } = openCalendarD1();
    // Only one row — upcoming by construction relative to the route's
    // clock read (today + 10 whole days, UTC).
    await insertEvent(d1, {
      id: 101,
      year: Number(isoDaysFromNow(10).slice(0, 4)),
      eventType: 'ALKO_PRICE_LIST',
      status: 'CONFIRMED',
      occurrenceDate: isoDaysFromNow(10),
      expectedWindow: null,
    });
    const app = calendarApp();
    const env = calendarEnv(d1);

    const res = await getNext(app, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as NextJson;
    expect(body.status).toBe('CONFIRMED');
    expect(body.event.id).toBe(101);
    expect(body.event.status).toBe('CONFIRMED');
    expect(body.event.occurrenceDate).toBe(isoDaysFromNow(10));
    expect(body.daysUntil).toBe(10);
    expect(body.expectedWindow).toBeNull();
    expect(body.disclaimer.version).toBe('1.0');
  });

  it('returns the next EXPECTED window event with no countdown', async () => {
    const { d1 } = openCalendarD1();
    // The window sits five years out, so it stays the nearest upcoming
    // event regardless of the run date.
    const farYear = new Date().getUTCFullYear() + 5;
    await insertEvent(d1, {
      id: 102,
      year: farYear,
      eventType: 'RATE_DECISION',
      status: 'EXPECTED',
      occurrenceDate: null,
      expectedWindow: `${farYear}-06`,
    });
    const app = calendarApp();
    const body = (await (await getNext(app, calendarEnv(d1))).json()) as NextJson;
    expect(body.status).toBe('EXPECTED');
    expect(body.event.id).toBe(102);
    expect(body.daysUntil).toBeNull();
    expect(body.expectedWindow).toBe(`${farYear}-06`);
  });

  it('prefers a CONFIRMED exact date over an EXPECTED window at the same period start', async () => {
    const { d1 } = openCalendarD1();
    // Same period start (the window's first day): the day-precision fact
    // is the stronger one and must win the selection.
    const farYear = new Date().getUTCFullYear() + 5;
    await insertEvent(d1, {
      id: 103,
      year: farYear,
      eventType: 'ALKO_PRICE_LIST',
      status: 'EXPECTED',
      occurrenceDate: null,
      expectedWindow: `${farYear}-06`,
    });
    await insertEvent(d1, {
      id: 104,
      year: farYear,
      eventType: 'EE_EXCISE_CHANGE',
      status: 'CONFIRMED',
      occurrenceDate: `${farYear}-06-01`,
      expectedWindow: null,
    });
    const app = calendarApp();
    const body = (await (await getNext(app, calendarEnv(d1))).json()) as NextJson;
    expect(body.event.id).toBe(104);
    expect(body.status).toBe('CONFIRMED');
    expect(body.daysUntil).not.toBeNull();
  });

  it('answers 404 when nothing is upcoming (empty calendar)', async () => {
    const { d1 } = openCalendarD1();
    const app = calendarApp();
    await expectEnvelope(await getNext(app, calendarEnv(d1)), 404, {
      error: 'Not Found',
    });
  });

  it('answers identical bodies on repeated identical requests (determinism)', async () => {
    const { d1 } = openCalendarD1();
    await insertEvent(d1, {
      id: 105,
      year: Number(isoDaysFromNow(3).slice(0, 4)),
      eventType: 'TAX_TABLE_PUBLICATION',
      status: 'CONFIRMED',
      occurrenceDate: isoDaysFromNow(3),
      expectedWindow: null,
    });
    const app = calendarApp();
    const env = calendarEnv(d1);

    const first = await getNext(app, env);
    const second = await getNext(app, env);
    expect(JSON.stringify(await first.json())).toBe(
      JSON.stringify(await second.json()),
    );
  });

  it('rejects a bad language query with the contract-level 400', async () => {
    const { d1 } = openCalendarD1();
    const app = calendarApp();
    const body = await expectEnvelope(
      await getNext(app, calendarEnv(d1), '?language=fr'),
      400,
      { error: 'ValidationError' },
    );
    expect(String(body.message)).toMatch(/language must be one of: fi, en/);
  });
});

// ---------------------------------------------------------------------------
// Guards — age gate precedes both handlers
// ---------------------------------------------------------------------------

describe('GET /api/v1/calendar[...] — age gate', () => {
  it('rejects an unconfirmed caller with 403 AGE_GATE_REQUIRED on both endpoints', async () => {
    const { d1 } = openCalendarD1();
    await seedSix2026Events(d1);
    const app = calendarApp();
    const env = calendarEnv(d1);

    await expectEnvelope(await getEvents(app, env, '?year=2026', {}), 403, {
      error: 'Forbidden',
      code: 'AGE_GATE_REQUIRED',
    });
    await expectEnvelope(await getNext(app, env, '', {}), 403, {
      error: 'Forbidden',
      code: 'AGE_GATE_REQUIRED',
    });
  });

  it('admits a confirmed caller on both endpoints', async () => {
    const { d1 } = openCalendarD1();
    await seedSix2026Events(d1);
    const app = calendarApp();
    const env = calendarEnv(d1);

    expect((await getEvents(app, env, '?year=2026')).status).toBe(200);
    expect((await getNext(app, env)).status).toBe(200);
  });
});
