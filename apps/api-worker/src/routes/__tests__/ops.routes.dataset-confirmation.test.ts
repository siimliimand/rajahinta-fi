/**
 * Rate-dataset confirmation route tests (task 3.2, change
 * calendar-event-automation) over the FULL app composition (createApp()
 * + registerOpsRoutes + registerCalendarRoutes — the exact composition
 * index.ts wires) on the fake-D1 harness.
 *
 * Pinning here (spec "Calendar event fan-out at the rate-confirmation
 * gate"): confirming a NEW-effective-year dataset version creates the
 * CONFIRMED FI_EXCISE_CHANGE event dated 1 January, sourced from the
 * version's tax_rules official_source, visible through the PUBLIC
 * calendar API in the same response, with both audit rows (the
 * tax_dataset confirmation record and the calendar_event creation);
 * re-confirmation does not duplicate; an injected calendar-repository
 * failure does not fail the confirmation and is logged (fail-open);
 * an already-covered year creates nothing; unknown versions 404.
 *
 * @module OpsDatasetConfirmationRoutesTest
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
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
import { seedCalendarEvents, CALENDAR_EVENTS_SEED } from '../../../../../packages/data-platform/src/seed/calendar-events.seed';
import { D1AuditEventRepository } from '../../../../../packages/data-platform/src/repositories/d1/audit-event.repository';
// The raw()-capable shim over the migrated database — the drizzle select
// path the calendar repository drives reads rows through `raw()` (see
// ops.routes.calendar-events.test.ts; the repository suite uses the same
// shim).
import { createD1Shim } from '../../../../../packages/data-platform/src/repositories/d1/__tests__/d1-test-harness';
import type { DatabaseSync } from 'node:sqlite';
import type { Env } from '../../env';
import type { D1DatabaseLike } from '../../../../../packages/data-platform/src/d1/executor';

/** Migrated in-memory database (the raw()-capable shim included). */
function openD1(): { db: DatabaseSync; d1: D1DatabaseLike } {
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

/** Insert one tax_rules row with explicit version/effective/source control. */
function seedVersionRule(
  db: DatabaseSync,
  rule: {
    id: number;
    taxType?: string;
    productCategory?: string;
    rate: number;
    effectiveFrom: string;
    versionLabel: string;
    officialSource: string;
    formula?: string;
  },
): void {
  db.prepare(
    `INSERT INTO tax_rules (
       id, tax_type, product_category, rate, effective_from, effective_to,
       exemption_conditions, calculation_formula_reference, official_source,
       verification_date, version_label, created_at
     ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)`,
  ).run(
    rule.id,
    rule.taxType ?? 'excise',
    rule.productCategory ?? 'beer',
    rule.rate,
    rule.effectiveFrom,
    rule.formula ?? 'PER_CENTILITRE_ETHANOL',
    rule.officialSource,
    new Date().toISOString(),
    rule.versionLabel,
    new Date().toISOString(),
  );
}

/** Approve one dataset version (the confirmation gate under test). */
function approve(
  app: ReturnType<typeof buildApp>,
  env: Env,
  versionLabel: string,
  headers: Record<string, string> = OPS_JSON,
): Promise<Response> {
  return request(
    app,
    env,
    `/ops/console/confirmations/tax/${encodeURIComponent(versionLabel)}/approve`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ operator: 'ops@example.invalid' }),
    },
  );
}

interface PublicEvent {
  id: number;
  eventType: string;
  status: string;
  occurrenceDate: string | null;
  expectedWindow: string | null;
  sourceUrl: string;
  titleFi: string;
  summaryEn: string;
}

interface EventsJson {
  year: number;
  events: PublicEvent[];
}

async function publicYear(
  app: ReturnType<typeof buildApp>,
  env: Env,
  year: number,
): Promise<EventsJson> {
  const res = await request(app, env, `/api/v1/calendar/events?year=${year}`, {
    headers: AGE_OK,
  });
  expect(res.status).toBe(200);
  return (await res.json()) as EventsJson;
}

interface AuditRow {
  entityType: string;
  entityId: string;
  action: string;
  author: string;
}

async function auditRows(
  d1: D1DatabaseLike,
  entityType: string,
): Promise<AuditRow[]> {
  const entries = await new D1AuditEventRepository(d1).query({ entityType });
  return entries.map((entry) => ({
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    author: entry.author,
  }));
}

/** The canonical new-year pair: 2026 rates replaced by 2027 rates. */
function seedNewYearDataset(db: DatabaseSync): void {
  seedVersionRule(db, {
    id: 101,
    rate: 4.0,
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    versionLabel: 'v3.0-2026',
    officialSource: 'https://www.vero.fi/en/excise-duty-table-2026',
  });
  seedVersionRule(db, {
    id: 102,
    rate: 4.4,
    effectiveFrom: '2027-01-01T00:00:00.000Z',
    versionLabel: 'v1.0-2027',
    officialSource: 'https://www.vero.fi/syventavat-vero-ohjeet/paatokset/verohallinnon-paatos-alkoholijuomaveron-maarasta-2027',
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Guard — ops access precedes the confirmation
// ---------------------------------------------------------------------------

describe('POST /ops/console/confirmations/tax/:id/approve — guard', () => {
  it('rejects an unauthenticated confirmation with the fail-closed 403', async () => {
    const { d1 } = openD1();
    const app = composedApp();

    const anonymous = await request(
      app,
      permissiveEnv(d1),
      '/ops/console/confirmations/tax/v1.0-2027/approve',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operator: 'ops@example.invalid' }),
      },
    );
    await expectEnvelope(anonymous, 403, { message: 'Forbidden' });

    const locked = await approve(
      app,
      lockedEnv(d1),
      'v1.0-2027',
      { ...OPS_JSON, authorization: `Bearer ${FAKE_OPS_TOKEN}` },
    );
    await expectEnvelope(locked, 403, { message: 'Forbidden' });

    // Nothing was written by the denials.
    expect(await auditRows(d1, 'tax_dataset')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Confirmation → CONFIRMED event, official source, public visibility, audit
// ---------------------------------------------------------------------------

describe('rate-dataset confirmation — calendar fan-out', () => {
  it('confirming a new-effective-year version creates the CONFIRMED event with the official source, publicly visible, audited', async () => {
    const { db, d1 } = openD1();
    seedNewYearDataset(db);
    const app = composedApp();
    const env = permissiveEnv(d1);

    const res = await approve(app, env, 'v1.0-2027');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: 'v1.0-2027',
      status: 'resolved',
      resolution: 'approve',
    });

    // Public calendar API, same response: the CONFIRMED 1 January row,
    // citing the version's official source.
    const year = await publicYear(app, env, 2027);
    expect(year.events).toHaveLength(1);
    expect(year.events[0]).toMatchObject({
      eventType: 'FI_EXCISE_CHANGE',
      status: 'CONFIRMED',
      occurrenceDate: '2027-01-01',
      expectedWindow: null,
      sourceUrl:
        'https://www.vero.fi/syventavat-vero-ohjeet/paatokset/verohallinnon-paatos-alkoholijuomaveron-maarasta-2027',
    });
    // Text derived from the SAME diff the blog drafts consume: the
    // changed category, the effective date, no window wording.
    expect(year.events[0].titleFi).toContain('1.1.2027');
    expect(year.events[0].summaryEn).toContain('beer');

    // Two audit rows: the confirmation record (attributed) and the
    // auto-created event.
    const confirmations = await auditRows(d1, 'tax_dataset');
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0]).toMatchObject({
      entityId: 'v1.0-2027',
      action: 'confirmed',
      author: 'ops@example.invalid',
    });
    const creations = await auditRows(d1, 'calendar_event');
    expect(creations).toHaveLength(1);
    expect(creations[0]).toMatchObject({ action: 'created' });
  });

  it('re-confirming the same version does not duplicate the event', async () => {
    const { db, d1 } = openD1();
    seedNewYearDataset(db);
    const app = composedApp();
    const env = permissiveEnv(d1);

    expect((await approve(app, env, 'v1.0-2027')).status).toBe(200);
    expect((await approve(app, env, 'v1.0-2027')).status).toBe(200);

    const year = await publicYear(app, env, 2027);
    expect(year.events).toHaveLength(1);

    // The event creation audit stays single too — only the operator's
    // second confirmation action adds a record.
    expect(await auditRows(d1, 'calendar_event')).toHaveLength(1);
    expect(await auditRows(d1, 'tax_dataset')).toHaveLength(2);
  });

  it('confirming a dataset whose effective year is already covered creates nothing', async () => {
    const { db, d1 } = openD1();
    // The seeded 2026 set already carries the year's FI_EXCISE_CHANGE row;
    // the confirmed version's delta is real (2026 rates) but late.
    seedCalendarEvents(d1);
    seedVersionRule(db, {
      id: 201,
      rate: 4.0,
      effectiveFrom: '2025-01-01T00:00:00.000Z',
      versionLabel: 'v2.0-2025',
      officialSource: 'https://www.vero.fi/en/excise-duty-table-2025',
    });
    seedVersionRule(db, {
      id: 202,
      rate: 4.44,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      versionLabel: 'v3.0-2026',
      officialSource: 'https://www.vero.fi/en/excise-duty-table-2026',
    });
    const app = composedApp();
    const env = permissiveEnv(d1);

    const res = await approve(app, env, 'v3.0-2026');
    expect(res.status).toBe(200);

    const year = await publicYear(app, env, 2026);
    expect(year.events).toHaveLength(CALENDAR_EVENTS_SEED.length);
    expect(
      year.events.filter((event) => event.eventType === 'FI_EXCISE_CHANGE'),
    ).toHaveLength(1);
    expect(await auditRows(d1, 'calendar_event')).toHaveLength(0);
  });

  it('an injected calendar-repository failure does not fail the confirmation and is logged', async () => {
    const { db, d1 } = openD1();
    seedNewYearDataset(db);
    const app = composedApp();
    const env = permissiveEnv(d1);

    // Inject the repository failure at the storage boundary: the year
    // read (and any insert) now throws.
    db.exec('DROP TABLE calendar_events');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await approve(app, env, 'v1.0-2027');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: 'v1.0-2027',
      status: 'resolved',
      resolution: 'approve',
    });

    // The failure was caught and logged, not swallowed silently.
    const logged = errorSpy.mock.calls.map(
      (call) => (call[0] as { message?: string })?.message ?? '',
    );
    expect(
      logged.some((message) => message.includes('Calendar event fan-out failed')),
    ).toBe(true);

    // The confirmation record itself survived (only the fan-out failed).
    expect(await auditRows(d1, 'tax_dataset')).toHaveLength(1);
  });

  it('a version with no predecessor-paired rate change confirms without creating an event', async () => {
    const { db, d1 } = openD1();
    seedVersionRule(db, {
      id: 301,
      rate: 4.0,
      effectiveFrom: '2028-01-01T00:00:00.000Z',
      versionLabel: 'v1.0-2028',
      officialSource: 'https://www.vero.fi/en/excise-duty-table-2028',
    });
    const app = composedApp();
    const env = permissiveEnv(d1);

    const res = await approve(app, env, 'v1.0-2028');
    expect(res.status).toBe(200);
    expect(await publicYear(app, env, 2028).then((y) => y.events)).toHaveLength(0);
    expect(await auditRows(d1, 'calendar_event')).toHaveLength(0);
    expect(await auditRows(d1, 'tax_dataset')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Validation — grounded confirmations only
// ---------------------------------------------------------------------------

describe('POST /ops/console/confirmations/tax/:id/approve — validation', () => {
  it('404s an unknown version label without writing anything', async () => {
    const { d1 } = openD1();
    const app = composedApp();
    const env = permissiveEnv(d1);

    await expectEnvelope(await approve(app, env, 'v9.9-2099'), 404, {});

    expect(await auditRows(d1, 'tax_dataset')).toHaveLength(0);
    expect(await auditRows(d1, 'calendar_event')).toHaveLength(0);
  });

  it('400s a missing operator identity (attribution is mandatory)', async () => {
    const { db, d1 } = openD1();
    seedNewYearDataset(db);
    const app = composedApp();
    const env = permissiveEnv(d1);

    const res = await request(
      app,
      env,
      '/ops/console/confirmations/tax/v1.0-2027/approve',
      {
        method: 'POST',
        headers: OPS_JSON,
        body: JSON.stringify({}),
      },
    );
    await expectEnvelope(res, 400, {});

    expect(await auditRows(d1, 'tax_dataset')).toHaveLength(0);
  });

  it('400s a blank version label', async () => {
    const { d1 } = openD1();
    const app = composedApp();
    const env = permissiveEnv(d1);

    // Whitespace-only label (URL-encoded into the path segment).
    await expectEnvelope(await approve(app, env, '  '), 400, {});
  });

  it('lets the reject action stay fail-closed with 503 (no review store)', async () => {
    const { d1 } = openD1();
    const app = composedApp();
    const env = permissiveEnv(d1);

    const res = await request(
      app,
      env,
      '/ops/console/confirmations/tax/v1.0-2027/reject',
      {
        method: 'POST',
        headers: OPS_JSON,
        body: JSON.stringify({ operator: 'ops@example.invalid' }),
      },
    );
    await expectEnvelope(res, 503, { error: 'StoreUnavailable' });
  });
});
