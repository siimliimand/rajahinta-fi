/**
 * Ops calendar-events route tests (task 5.1, change
 * tax-change-calendar) over the FULL app composition (createApp() +
 * registerOpsRoutes + registerCalendarRoutes — the exact composition
 * index.ts wires; the /ops/console/* opsAccess prefix comes from the
 * guard registration) on the fake-D1 harness.
 *
 * Pinning here: the ops access guard (an unauthenticated create is
 * rejected before any data — fail-closed too), the full maintenance
 * loop (create a 2027 CONFIRMED RATE_DECISION → it appears on the
 * public year listing per its status; update the seeded EXPECTED
 * 2026-Q4 row in place to CONFIRMED → same id, dated row, window
 * cleared), the audit trail (a calendar_event row after create AND
 * after update, attributed to the operator), the persistence-boundary
 * vocabulary validation surfaced as contract-level 400s (unknown type
 * naming the valid types; an EXPECTED row claiming a date), the 404 on
 * a missing id — and the deliberate absence of a delete route.
 *
 * @module OpsCalendarEventsRoutesTest
 */

import { describe, it, expect } from 'vitest';
import {
  buildApp,
  expectEnvelope,
  FAKE_OPS_TOKEN,
  lockedEnv,
  openMigratedD1,
  permissiveEnv,
  request,
} from './harness';
import { registerOpsRoutes } from '../ops.routes';
import { registerCalendarRoutes } from '../calendar.routes';
import { seedCalendarEvents } from '../../../../../packages/data-platform/src/seed/calendar-events.seed';
// The raw()-capable shim over the migrated database — the drizzle select
// path the calendar repository drives reads rows through `raw()` (see
// calendar.routes.test.ts; the repository suite uses the same shim).
import { createD1Shim } from '../../../../../packages/data-platform/src/repositories/d1/__tests__/d1-test-harness';
import { D1AuditEventRepository } from '../../../../../packages/data-platform/src/repositories/d1/audit-event.repository';
import type { DatabaseSync } from 'node:sqlite';
import type { Env } from '../../env';
import type { D1DatabaseLike } from '../../../../../packages/data-platform/src/d1/executor';

/** Migrated in-memory database wrapped in the raw()-capable D1 shim. */
function openCalendarD1(): { db: DatabaseSync; d1: D1DatabaseLike } {
  const { db } = openMigratedD1();
  return { db, d1: createD1Shim(db) };
}

/**
 * index.ts registers the ops handlers behind the guard prefix and the
 * calendar reads behind their route-local chain; the test composition
 * mirrors that exactly.
 */
function composedApp(): ReturnType<typeof buildApp> {
  const app = buildApp();
  registerOpsRoutes(app);
  registerCalendarRoutes(app);
  return app;
}

const OPS = { authorization: `Bearer ${FAKE_OPS_TOKEN}` };
const OPS_JSON = { 'content-type': 'application/json', ...OPS };
const AGE_OK = { 'x-age-confirmed': 'confirmed-test-token' };

/** The event the spec scenario creates: a 2027 rate decision. */
const RATE_DECISION_2027 = {
  operator: 'ops@example.invalid',
  year: 2027,
  eventType: 'RATE_DECISION',
  status: 'CONFIRMED',
  occurrenceDate: '2027-01-01',
  titleFi: 'Valmistevero muuttuu 1.1.2027',
  titleEn: 'Excise changes on 1 January 2027',
  summaryFi: 'Hallituksen esityksen mukaiset valmisteverotasot.',
  summaryEn: 'The government-bill excise levels.',
  sourceUrl: 'https://www.vero.fi/example/2027',
};

interface CalendarEventJson {
  id: number;
  year: number;
  eventType: string;
  status: string;
  occurrenceDate: string | null;
  expectedWindow: string | null;
  sourceUrl: string;
}

interface EventsJson {
  year: number;
  events: CalendarEventJson[];
}

interface ConsoleListJson {
  items: CalendarEventJson[];
  total: number;
}

async function createEvent(
  app: ReturnType<typeof buildApp>,
  env: Env,
  body: Record<string, unknown>,
  headers: Record<string, string> = OPS_JSON,
): Promise<Response> {
  return request(app, env, '/ops/console/calendar-events', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

async function updateEvent(
  app: ReturnType<typeof buildApp>,
  env: Env,
  id: number,
  body: Record<string, unknown>,
): Promise<Response> {
  return request(app, env, `/ops/console/calendar-events/${id}`, {
    method: 'POST',
    headers: OPS_JSON,
    body: JSON.stringify(body),
  });
}

async function publicYear(
  app: ReturnType<typeof buildApp>,
  env: Env,
  year: number,
): Promise<EventsJson> {
  const res = await request(
    app,
    env,
    `/api/v1/calendar/events?year=${year}`,
    { headers: AGE_OK },
  );
  expect(res.status).toBe(200);
  return (await res.json()) as EventsJson;
}

interface CalendarAuditRow {
  entityId: string;
  action: string;
  author: string;
}

/** The calendar_event audit rows, newest-first as the repository reads them. */
async function calendarAuditRows(
  d1: D1DatabaseLike,
): Promise<CalendarAuditRow[]> {
  const entries = await new D1AuditEventRepository(d1).query({
    entityType: 'calendar_event',
  });
  return entries.map((entry) => ({
    entityId: entry.entityId,
    action: entry.action,
    author: entry.author,
  }));
}

// ---------------------------------------------------------------------------
// Guard — ops access precedes every calendar-events operation
// ---------------------------------------------------------------------------

describe('POST /ops/console/calendar-events — ops access guard', () => {
  it('rejects an unauthenticated create with the fail-closed 403 before any data', async () => {
    const { d1 } = openCalendarD1();
    const app = composedApp();
    const env = permissiveEnv(d1);

    // No bearer at all.
    const anonymous = await request(app, env, '/ops/console/calendar-events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(RATE_DECISION_2027),
    });
    await expectEnvelope(anonymous, 403, { message: 'Forbidden' });

    // A wrong bearer is equally blind (no feedback which control failed).
    const wrong = await createEvent(app, env, RATE_DECISION_2027, {
      ...OPS_JSON,
      authorization: 'Bearer not-the-token',
    });
    await expectEnvelope(wrong, 403, { message: 'Forbidden' });

    // Unconfigured ops surface: fail-closed, same envelope.
    const locked = await createEvent(
      app,
      lockedEnv(d1),
      RATE_DECISION_2027,
      { ...OPS_JSON, authorization: `Bearer ${FAKE_OPS_TOKEN}` },
    );
    await expectEnvelope(locked, 403, { message: 'Forbidden' });

    // And nothing was written by any of the denials.
    const after = await request(app, permissiveEnv(d1), '/ops/console/calendar-events', {
      headers: OPS,
    });
    expect(((await after.json()) as ConsoleListJson).total).toBe(0);
  });

  it('keeps the listing behind the guard too', async () => {
    const { d1 } = openCalendarD1();
    const app = composedApp();
    await expectEnvelope(
      await request(app, permissiveEnv(d1), '/ops/console/calendar-events'),
      403,
      { message: 'Forbidden' },
    );
  });
});

// ---------------------------------------------------------------------------
// Create → public visibility + audit
// ---------------------------------------------------------------------------

describe('/ops/console/calendar-events — create', () => {
  it('creates a 2027 CONFIRMED RATE_DECISION that appears on the public year listing, and audits the action', async () => {
    const { d1 } = openCalendarD1();
    const app = composedApp();
    const env = permissiveEnv(d1);

    const created = await createEvent(app, env, RATE_DECISION_2027);
    expect(created.status).toBe(200);
    const body = (await created.json()) as CalendarEventJson;
    expect(body.id).toBe(1); // first ops-created row lands beyond the empty table
    expect(body.status).toBe('CONFIRMED');
    expect(body.occurrenceDate).toBe('2027-01-01');
    expect(body.expectedWindow).toBeNull();

    // The public API serves it per its status: exact date, no window.
    const year = await publicYear(app, env, 2027);
    expect(year.events).toHaveLength(1);
    expect(year.events[0]).toMatchObject({
      id: body.id,
      eventType: 'RATE_DECISION',
      status: 'CONFIRMED',
      occurrenceDate: '2027-01-01',
      expectedWindow: null,
      sourceUrl: RATE_DECISION_2027.sourceUrl,
    });

    // The action is on the audit trail, attributed.
    const rows = await calendarAuditRows(d1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entityId: String(body.id),
      action: 'created',
      author: 'ops@example.invalid',
    });
  });

  it('surfaces vocabulary and precision violations as contract-level 400s naming the valid values', async () => {
    const { d1 } = openCalendarD1();
    const app = composedApp();
    const env = permissiveEnv(d1);

    // Unknown event type — the message names the closed vocabulary.
    const badTypeBody = await expectEnvelope(
      await createEvent(app, env, {
        ...RATE_DECISION_2027,
        eventType: 'NOT_A_TYPE',
      }),
      400,
      { error: 'ValidationError' },
    );
    expect(String(badTypeBody.message)).toContain('FI_EXCISE_CHANGE');

    // An EXPECTED row claiming day precision — the validator's split.
    const datedExpectedBody = await expectEnvelope(
      await createEvent(app, env, {
        ...RATE_DECISION_2027,
        status: 'EXPECTED',
        occurrenceDate: '2027-01-01',
      }),
      400,
      { error: 'ValidationError' },
    );
    expect(String(datedExpectedBody.message)).toContain(
      'EXPECTED forbids occurrence_date',
    );

    // An unsourced row cannot exist.
    const unsourced = await createEvent(app, env, {
      ...RATE_DECISION_2027,
      sourceUrl: '',
    });
    expect(unsourced.status).toBe(400);

    // A missing operator is rejected like every console mutation.
    const noOperator = await createEvent(app, env, {
      ...RATE_DECISION_2027,
      operator: undefined,
    });
    expect(noOperator.status).toBe(400);

    // None of the rejections wrote a row or an audit entry.
    const list = await request(app, env, '/ops/console/calendar-events', {
      headers: OPS,
    });
    expect(((await list.json()) as ConsoleListJson).total).toBe(0);
    expect(await calendarAuditRows(d1)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Update — in-place transition + audit
// ---------------------------------------------------------------------------

describe('/ops/console/calendar-events/:id — update', () => {
  it('upgrades the seeded EXPECTED 2026-Q4 row to CONFIRMED in place (same id, window cleared) and audits the edit', async () => {
    const { d1 } = openCalendarD1();
    expect((await seedCalendarEvents(d1)).inserted).toBe(6);
    const app = composedApp();
    const env = permissiveEnv(d1);

    const updated = await updateEvent(app, env, 6, {
      operator: 'ops@example.invalid',
      note: 'Parliament decided; date confirmed',
      year: 2026,
      eventType: 'RATE_DECISION',
      status: 'CONFIRMED',
      occurrenceDate: '2026-12-17',
      titleFi: 'Eduskunta vahvisti verotaulukon 17.12.2026',
      titleEn: 'Parliament confirmed the tax table on 17 December 2026',
      summaryFi: 'Laki hyväksyttiin ja tule voimaan 1.1.2027.',
      summaryEn: 'The act passed and takes effect on 1 January 2027.',
      sourceUrl: 'https://www.eduskunta.example/HE-172-2026',
    });
    expect(updated.status).toBe(200);
    const body = (await updated.json()) as CalendarEventJson;
    expect(body.id).toBe(6);
    expect(body.status).toBe('CONFIRMED');
    expect(body.occurrenceDate).toBe('2026-12-17');
    expect(body.expectedWindow).toBeNull();

    // Public listing follows the upgrade: dated fact, no window.
    const year = await publicYear(app, env, 2026);
    const upgraded = year.events.find((event) => event.id === 6);
    expect(upgraded).toMatchObject({
      status: 'CONFIRMED',
      occurrenceDate: '2026-12-17',
      expectedWindow: null,
    });

    // Audit carries the before/after pair (EXPECTED window → CONFIRMED date).
    const rows = await calendarAuditRows(d1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entityId: '6',
      action: 'updated',
      author: 'ops@example.invalid',
    });
    const entries = await new D1AuditEventRepository(d1).query({
      entityType: 'calendar_event',
    });
    expect(entries[0]?.previousValue).toMatchObject({
      status: 'EXPECTED',
      expectedWindow: '2026-Q4',
    });
    expect(entries[0]?.newValue).toMatchObject({
      status: 'CONFIRMED',
      occurrenceDate: '2026-12-17',
      expectedWindow: null,
    });
  });

  it('answers 404 for a missing id and keeps rejecting malformed content', async () => {
    const { d1 } = openCalendarD1();
    const app = composedApp();
    const env = permissiveEnv(d1);

    const missing = await updateEvent(app, env, 999, RATE_DECISION_2027);
    // 404 fires after validation (the body above is valid content).
    await expectEnvelope(missing, 404, { error: 'Not Found' });

    const invalid = await updateEvent(app, env, 1, {
      ...RATE_DECISION_2027,
      status: 'MAYBE',
    });
    expect(invalid.status).toBe(400);
  });

  it('keeps the update behind the guard and exposes NO delete route', async () => {
    const { d1 } = openCalendarD1();
    const app = composedApp();
    const env = permissiveEnv(d1);

    await expectEnvelope(
      await request(app, env, '/ops/console/calendar-events/1', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(RATE_DECISION_2027),
      }),
      403,
      { message: 'Forbidden' },
    );

    // No delete endpoint exists in this maintenance path (spec) — the
    // ferry-style delete route falls through to the 404 envelope.
    const noDelete = await request(
      app,
      env,
      '/ops/console/calendar-events/1/delete',
      { method: 'POST', headers: OPS_JSON, body: JSON.stringify({ operator: 'ops@example.invalid' }) },
    );
    expect(noDelete.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Listing — the console view over the same rows the public API serves
// ---------------------------------------------------------------------------

describe('GET /ops/console/calendar-events — listing', () => {
  it('lists every event across years in the deterministic order', async () => {
    const { d1 } = openCalendarD1();
    expect((await seedCalendarEvents(d1)).inserted).toBe(6);
    const app = composedApp();
    const env = permissiveEnv(d1);

    await createEvent(app, env, RATE_DECISION_2027);

    const list = await request(app, env, '/ops/console/calendar-events', {
      headers: OPS,
    });
    expect(list.status).toBe(200);
    const body = (await list.json()) as ConsoleListJson;
    expect(body.total).toBe(7);
    // Year ascending, then the pure module's in-year total order — the
    // two same-day CONFIRMED rows sort by event type (EE_ before FI_),
    // exactly as the public listing orders them.
    expect(body.items.map((event) => event.id)).toEqual([
      2, 1, 3, 5, 4, 6, 7,
    ]);
  });
});
