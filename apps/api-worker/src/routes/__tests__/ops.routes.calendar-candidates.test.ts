/**
 * Ops calendar-candidates route tests (task 4.1, change
 * calendar-event-automation) over the FULL app composition (createApp()
 * + registerOpsRoutes + registerCalendarRoutes — the exact composition
 * index.ts wires; the /ops/console/* opsAccess prefix comes from the
 * guard registration) on the fake-D1 harness.
 *
 * Pinning here (spec "Operator review queue"): the ops access guard
 * denies an unauthenticated listing/accept/reject before any data; an
 * accepted PENDING candidate becomes a PUBLICLY VISIBLE calendar event
 * per its chosen status (CONFIRMED date / EXPECTED window), with the
 * candidate's draft texts when the operator overrides nothing; an
 * invalid form combination fails contract-level (400, the validator's
 * own words) and leaves the candidate PENDING with nothing written; a
 * rejected candidate is terminal REJECTED and RETAINED (the dedup row
 * survives — no delete path); both decisions write their audit rows,
 * attributed; and candidates never surface on any public endpoint (the
 * public calendar routes return only calendar_events rows).
 *
 * @module OpsCalendarCandidatesRoutesTest
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
import { createD1Shim } from '../../../../../packages/data-platform/src/repositories/d1/__tests__/d1-test-harness';
import { D1AuditEventRepository } from '../../../../../packages/data-platform/src/repositories/d1/audit-event.repository';
import type { DatabaseSync } from 'node:sqlite';
import type { Env } from '../../env';
import type { D1DatabaseLike } from '../../../../../packages/data-platform/src/d1/executor';

/** Migrated in-memory database wrapped in the raw()-capable D1 shim. */
function openCandidatesD1(): { db: DatabaseSync; d1: D1DatabaseLike } {
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

/** Insert one candidate row under explicit control. */
function seedCandidate(
  db: DatabaseSync,
  candidate: {
    id: number;
    source?: string;
    url: string;
    title: string;
    publishedAt: string;
    status?: string;
    draftFi?: string | null;
    draftEn?: string | null;
  },
): void {
  db.prepare(
    `INSERT INTO calendar_event_candidates (
       id, source, url, title, published_at, status, draft_fi, draft_en
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    candidate.id,
    candidate.source ?? 'vero-fi-news',
    candidate.url,
    candidate.title,
    candidate.publishedAt,
    candidate.status ?? 'PENDING',
    candidate.draftFi ?? null,
    candidate.draftEn ?? null,
  );
}

/** The stored status of one candidate row (decision + retention pin). */
function storedStatus(db: DatabaseSync, id: number): string {
  const row = db
    .prepare('SELECT status FROM calendar_event_candidates WHERE id = ?')
    .get(id) as { status: string } | undefined;
  return row?.status ?? 'MISSING';
}

interface QueueJson {
  items: {
    id: number;
    source: string;
    url: string;
    title: string;
    publishedAt: string;
    status: string;
    draftFi: string | null;
    draftEn: string | null;
  }[];
  total: number;
}

async function queueList(
  app: ReturnType<typeof buildApp>,
  env: Env,
): Promise<QueueJson> {
  const res = await request(app, env, '/ops/console/calendar-candidates', {
    headers: OPS,
  });
  expect(res.status).toBe(200);
  return (await res.json()) as QueueJson;
}

async function accept(
  app: ReturnType<typeof buildApp>,
  env: Env,
  id: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = OPS_JSON,
): Promise<Response> {
  return request(app, env, `/ops/console/calendar-candidates/${id}/accept`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

async function reject(
  app: ReturnType<typeof buildApp>,
  env: Env,
  id: number,
  body: Record<string, unknown> = { operator: 'ops@example.invalid' },
  headers: Record<string, string> = OPS_JSON,
): Promise<Response> {
  return request(app, env, `/ops/console/calendar-candidates/${id}/reject`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

interface PublicEvent {
  id: number;
  eventType: string;
  status: string;
  occurrenceDate: string | null;
  expectedWindow: string | null;
  sourceUrl: string;
  titleFi: string;
  titleEn: string;
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

/** The operator's accept form for the canonical CONFIRMED scenario. */
const CONFIRMED_ACCEPT = {
  operator: 'ops@example.invalid',
  eventType: 'RATE_DECISION',
  status: 'CONFIRMED',
  occurrenceDate: '2027-01-01',
  titleFi: 'Valmistevero muuttuu 1.1.2027',
  titleEn: 'Excise changes on 1 January 2027',
  summaryFi: 'Verohallinnon päätös on julkaistu.',
  summaryEn: 'The tax administration decision is out.',
};

// ---------------------------------------------------------------------------
// Guard — ops access precedes every candidates operation
// ---------------------------------------------------------------------------

describe('ops access guard — /ops/console/calendar-candidates', () => {
  it('rejects an unauthenticated listing, accept, and reject with the fail-closed 403 before any data', async () => {
    const { db, d1 } = openCandidatesD1();
    seedCandidate(db, {
      id: 1,
      url: 'https://www.vero.fi/news/excise-2027',
      title: 'Valmisteveromuutos 2027',
      publishedAt: '2026-10-01',
    });
    const app = composedApp();

    // Listing: no bearer at all.
    await expectEnvelope(
      await request(app, permissiveEnv(d1), '/ops/console/calendar-candidates'),
      403,
      { message: 'Forbidden' },
    );

    // Accept: a wrong bearer is equally blind.
    await expectEnvelope(
      await accept(
        app,
        permissiveEnv(d1),
        1,
        CONFIRMED_ACCEPT,
        { ...OPS_JSON, authorization: 'Bearer not-the-token' },
      ),
      403,
      { message: 'Forbidden' },
    );

    // Reject: unconfigured ops surface — fail closed, same envelope.
    await expectEnvelope(
      await reject(app, lockedEnv(d1), 1),
      403,
      { message: 'Forbidden' },
    );

    // Nothing was written by any denial: the candidate is untouched and
    // neither decision nor event exists in the audit trail.
    expect(storedStatus(db, 1)).toBe('PENDING');
    expect(await auditRows(d1, 'calendar_candidate')).toHaveLength(0);
    expect(await auditRows(d1, 'calendar_event')).toHaveLength(0);

    // With the right bearer the queued row is still the only one.
    expect((await queueList(app, permissiveEnv(d1))).total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Accept — publicly visible event per its status, candidate marked, audited
// ---------------------------------------------------------------------------

describe('POST /ops/console/calendar-candidates/:id/accept', () => {
  it('accepts a PENDING candidate into a CONFIRMED event that is publicly visible, marks ACCEPTED, and audits both sides', async () => {
    const { db, d1 } = openCandidatesD1();
    seedCandidate(db, {
      id: 1,
      url: 'https://www.vero.fi/news/excise-2027',
      title: 'Valmisteveromuutos 2027',
      publishedAt: '2026-10-01',
    });
    const app = composedApp();
    const env = permissiveEnv(d1);

    const res = await accept(app, env, 1, CONFIRMED_ACCEPT);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: number;
      status: string;
      eventId: number;
      event: { status: string; sourceUrl: string };
    };
    expect(body).toMatchObject({
      id: 1,
      status: 'ACCEPTED',
      eventId: 1,
    });
    expect(body.event).toMatchObject({
      status: 'CONFIRMED',
      sourceUrl: 'https://www.vero.fi/news/excise-2027',
    });

    // The event is publicly visible per its status: dated CONFIRMED row,
    // sourced from the candidate's URL.
    const year = await publicYear(app, env, 2027);
    expect(year.events).toHaveLength(1);
    expect(year.events[0]).toMatchObject({
      eventType: 'RATE_DECISION',
      status: 'CONFIRMED',
      occurrenceDate: '2027-01-01',
      expectedWindow: null,
      sourceUrl: 'https://www.vero.fi/news/excise-2027',
    });

    // The candidate left the queue as ACCEPTED.
    expect(storedStatus(db, 1)).toBe('ACCEPTED');
    expect((await queueList(app, env)).total).toBe(0);

    // Two audit rows: the created event and the attributed decision.
    const events = await auditRows(d1, 'calendar_event');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      entityId: String(body.eventId),
      action: 'created',
      author: 'ops@example.invalid',
    });
    const decisions = await auditRows(d1, 'calendar_candidate');
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      entityId: '1',
      action: 'confirmed',
      author: 'ops@example.invalid',
    });
  });

  it('accepts an EXPECTED window using the candidate draft texts when the operator overrides nothing', async () => {
    const { db, d1 } = openCandidatesD1();
    seedCandidate(db, {
      id: 2,
      source: 'alko-press-sttinfo',
      url: 'https://www.sttinfo.fi/release/alko-hinnastomaaliskuu',
      title: 'Alkon hinnastomuutos maaliskuussa',
      publishedAt: '2026-10-02',
      draftFi: 'Alkon hinnastot muuttuvat maaliskuun lopussa.',
      draftEn: 'Alko price lists change at the end of March.',
    });
    const app = composedApp();
    const env = permissiveEnv(d1);

    const res = await accept(app, env, 2, {
      operator: 'ops@example.invalid',
      eventType: 'ALKO_PRICE_LIST',
      status: 'EXPECTED',
      expectedWindow: '2027-03',
    });
    expect(res.status).toBe(200);

    // Public per its status: the window, no date; the watcher's drafts
    // filled both locales (no overrides given).
    const year = await publicYear(app, env, 2027);
    expect(year.events).toHaveLength(1);
    expect(year.events[0]).toMatchObject({
      eventType: 'ALKO_PRICE_LIST',
      status: 'EXPECTED',
      occurrenceDate: null,
      expectedWindow: '2027-03',
      titleFi: 'Alkon hinnastot muuttuvat maaliskuun lopussa.',
      titleEn: 'Alko price lists change at the end of March.',
      sourceUrl: 'https://www.sttinfo.fi/release/alko-hinnastomaaliskuu',
    });
    expect(storedStatus(db, 2)).toBe('ACCEPTED');
    expect(await auditRows(d1, 'calendar_candidate')).toHaveLength(1);
  });

  it('prefers the operator overrides over the drafts, field by field', async () => {
    const { db, d1 } = openCandidatesD1();
    seedCandidate(db, {
      id: 3,
      url: 'https://www.vero.fi/news/valmisteverotaulukko',
      title: 'Verohallinnon verotaulukko julkaistu',
      publishedAt: '2026-10-03',
      draftFi: 'Luonnos fi',
      draftEn: 'Draft en',
    });
    const app = composedApp();
    const env = permissiveEnv(d1);

    const res = await accept(app, env, 3, {
      operator: 'ops@example.invalid',
      eventType: 'TAX_TABLE_PUBLICATION',
      status: 'CONFIRMED',
      occurrenceDate: '2026-08-12',
      titleFi: 'Verotaulukko 2027 on julkaistu',
      summaryEn: 'The 2027 tax table is published.',
      // titleEn + summaryFi fall back to the drafts.
    });
    expect(res.status).toBe(200);

    const year = await publicYear(app, env, 2026);
    expect(year.events[0]).toMatchObject({
      titleFi: 'Verotaulukko 2027 on julkaistu',
      titleEn: 'Draft en',
      summaryFi: 'Luonnos fi',
      summaryEn: 'The 2027 tax table is published.',
    });
  });
});

// ---------------------------------------------------------------------------
// Accept refusals — contract-level, nothing written, candidate stays PENDING
// ---------------------------------------------------------------------------

describe('accept refusals keep the candidate PENDING', () => {
  it('rejects an invalid precision combination with a contract-level 400 and writes nothing', async () => {
    const { db, d1 } = openCandidatesD1();
    seedCandidate(db, {
      id: 1,
      url: 'https://www.vero.fi/news/excise-2027',
      title: 'Valmisteveromuutos 2027',
      publishedAt: '2026-10-01',
      draftFi: 'Luonnos fi',
      draftEn: 'Draft en',
    });
    const app = composedApp();
    const env = permissiveEnv(d1);

    // An EXPECTED row claiming day precision — the event contract's split,
    // failing in its own words before anything is written.
    const body = await expectEnvelope(
      await accept(app, env, 1, {
        operator: 'ops@example.invalid',
        eventType: 'RATE_DECISION',
        status: 'EXPECTED',
        occurrenceDate: '2027-01-01',
      }),
      400,
      { error: 'ValidationError' },
    );
    expect(String(body.message)).toContain(
      'an EXPECTED event must not carry an exact occurrence date',
    );

    // Candidate still queued, no public event, no audit trail entries.
    expect(storedStatus(db, 1)).toBe('PENDING');
    expect((await queueList(app, env)).total).toBe(1);
    expect((await publicYear(app, env, 2027)).events).toHaveLength(0);
    expect(await auditRows(d1, 'calendar_candidate')).toHaveLength(0);
    expect(await auditRows(d1, 'calendar_event')).toHaveLength(0);
  });

  it('rejects an accept with neither override nor draft for a locale, naming the field', async () => {
    const { db, d1 } = openCandidatesD1();
    seedCandidate(db, {
      id: 1,
      url: 'https://www.vero.fi/news/excise-2027',
      title: 'Valmisteveromuutos 2027',
      publishedAt: '2026-10-01',
      draftFi: 'Luonnos fi',
      // No draftEn — the English override is mandatory.
    });
    const app = composedApp();
    const env = permissiveEnv(d1);

    const body = await expectEnvelope(
      await accept(app, env, 1, {
        ...CONFIRMED_ACCEPT,
        titleFi: undefined,
        titleEn: undefined,
        summaryFi: undefined,
        summaryEn: undefined,
      }),
      400,
      { error: 'ValidationError' },
    );
    expect(String(body.message)).toContain('titleEn');

    expect(storedStatus(db, 1)).toBe('PENDING');
    expect((await publicYear(app, env, 2027)).events).toHaveLength(0);
  });

  it('surfaces an unknown event type as a 400 naming the closed vocabulary', async () => {
    const { db, d1 } = openCandidatesD1();
    seedCandidate(db, {
      id: 1,
      url: 'https://www.vero.fi/news/excise-2027',
      title: 'Valmisteveromuutos 2027',
      publishedAt: '2026-10-01',
      draftFi: 'Luonnos fi',
      draftEn: 'Draft en',
    });
    const app = composedApp();
    const env = permissiveEnv(d1);

    const body = await expectEnvelope(
      await accept(app, env, 1, {
        ...CONFIRMED_ACCEPT,
        eventType: 'NOT_A_TYPE',
      }),
      400,
      { error: 'ValidationError' },
    );
    expect(String(body.message)).toContain('FI_EXCISE_CHANGE');
    expect(storedStatus(db, 1)).toBe('PENDING');
  });

  it('answers 404 for an unknown candidate and 409 for an already-decided one', async () => {
    const { db, d1 } = openCandidatesD1();
    seedCandidate(db, {
      id: 1,
      url: 'https://www.vero.fi/news/excise-2027',
      title: 'Valmisteveromuutos 2027',
      publishedAt: '2026-10-01',
      status: 'REJECTED',
      draftFi: 'Luonnos fi',
      draftEn: 'Draft en',
    });
    const app = composedApp();
    const env = permissiveEnv(d1);

    await expectEnvelope(
      await accept(app, env, 999, { ...CONFIRMED_ACCEPT, draftFi: 'x', draftEn: 'y', summaryFi: 'x', summaryEn: 'y' }),
      404,
      { error: 'Not Found' },
    );

    // A decided candidate can never be re-decided — terminal states, and
    // the failed accept created no event.
    const body = await expectEnvelope(
      await accept(app, env, 1, CONFIRMED_ACCEPT),
      409,
      { error: 'InvalidTransition' },
    );
    expect(String(body.message)).toContain('REJECTED, not PENDING');
    expect(storedStatus(db, 1)).toBe('REJECTED');
    expect((await publicYear(app, env, 2027)).events).toHaveLength(0);
    expect(await auditRows(d1, 'calendar_event')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Reject — terminal, retained for dedup, audited
// ---------------------------------------------------------------------------

describe('POST /ops/console/calendar-candidates/:id/reject', () => {
  it('marks REJECTED, retains the row for URL dedup, and audits the decision', async () => {
    const { db, d1 } = openCandidatesD1();
    seedCandidate(db, {
      id: 1,
      url: 'https://www.vero.fi/news/unrelated-press-release',
      title: 'Julkaisu, joka ei koske kalenteria',
      publishedAt: '2026-10-04',
    });
    const app = composedApp();
    const env = permissiveEnv(d1);

    const res = await reject(app, env, 1, {
      operator: 'ops@example.invalid',
      note: 'Not calendar-relevant',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: 1,
      status: 'REJECTED',
      url: 'https://www.vero.fi/news/unrelated-press-release',
    });

    // Retention is the point: the row survives AS REJECTED — the dedup
    // key that keeps the same announcement out of the queue forever.
    expect(storedStatus(db, 1)).toBe('REJECTED');
    const rowCount = (
      db.prepare('SELECT COUNT(*) AS n FROM calendar_event_candidates').get() as {
        n: number;
      }
    ).n;
    expect(rowCount).toBe(1);

    // Off the worklist, attributed on the audit trail.
    expect((await queueList(app, env)).total).toBe(0);
    const rows = await auditRows(d1, 'calendar_candidate');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entityId: '1',
      action: 'updated',
      author: 'ops@example.invalid',
    });
  });

  it('answers 404 for an unknown candidate and 409 for an already-accepted one without touching it', async () => {
    const { db, d1 } = openCandidatesD1();
    seedCandidate(db, {
      id: 1,
      url: 'https://www.vero.fi/news/excise-2027',
      title: 'Valmisteveromuutos 2027',
      publishedAt: '2026-10-01',
      status: 'ACCEPTED',
    });
    const app = composedApp();
    const env = permissiveEnv(d1);

    await expectEnvelope(await reject(app, env, 999), 404, {
      error: 'Not Found',
    });

    const body = await expectEnvelope(await reject(app, env, 1), 409, {
      error: 'InvalidTransition',
    });
    expect(String(body.message)).toContain('ACCEPTED, not PENDING');
    expect(storedStatus(db, 1)).toBe('ACCEPTED');
    expect(await auditRows(d1, 'calendar_candidate')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Listing — the PENDING worklist, newest detected first
// ---------------------------------------------------------------------------

describe('GET /ops/console/calendar-candidates — listing', () => {
  it('lists only PENDING rows, newest published first with the deterministic url tiebreak', async () => {
    const { db, d1 } = openCandidatesD1();
    seedCandidate(db, {
      id: 1,
      url: 'https://www.vero.fi/news/b-old',
      title: 'Older announcement',
      publishedAt: '2026-10-02',
    });
    seedCandidate(db, {
      id: 2,
      url: 'https://www.vero.fi/news/b-new',
      title: 'Newer announcement, url after c',
      publishedAt: '2026-10-05',
    });
    seedCandidate(db, {
      id: 3,
      url: 'https://www.vero.fi/news/c-new',
      title: 'Newer announcement, url after b',
      publishedAt: '2026-10-05',
    });
    seedCandidate(db, {
      id: 4,
      url: 'https://www.vero.fi/news/decided',
      title: 'Already rejected',
      publishedAt: '2026-10-06',
      status: 'REJECTED',
    });
    const app = composedApp();

    const body = await queueList(app, permissiveEnv(d1));
    expect(body.total).toBe(3);
    // Newest first; the same-day pair ties on the url ascending.
    expect(body.items.map((item) => item.id)).toEqual([2, 3, 1]);
    expect(body.items.map((item) => item.url)).toEqual([
      'https://www.vero.fi/news/b-new',
      'https://www.vero.fi/news/c-new',
      'https://www.vero.fi/news/b-old',
    ]);
    // The worklist rows carry exactly the review facts (source, url,
    // title, detected date, drafts) — no workflow state beyond status.
    expect(body.items[0]).toMatchObject({
      source: 'vero-fi-news',
      title: 'Newer announcement, url after c',
      publishedAt: '2026-10-05',
      status: 'PENDING',
    });
  });
});

// ---------------------------------------------------------------------------
// Public pin — candidates never surface on any public endpoint
// ---------------------------------------------------------------------------

describe('candidates never appear on public endpoints', () => {
  it('the public calendar routes return only calendar_events rows — no candidate ever leaks', async () => {
    const { db, d1 } = openCandidatesD1();
    seedCandidate(db, {
      id: 1,
      url: 'https://www.vero.fi/news/pending-secret',
      title: 'Salainen jono-rivi',
      publishedAt: '2026-10-01',
      draftFi: 'Luonnos fi',
      draftEn: 'Draft en',
    });
    seedCandidate(db, {
      id: 2,
      url: 'https://www.vero.fi/news/rejected-secret',
      title: 'Hylätty jono-rivi',
      publishedAt: '2026-10-02',
      status: 'REJECTED',
    });
    const app = composedApp();
    const env = permissiveEnv(d1);

    // Both reads: the year listing and the next-event selection.
    const year = await publicYear(app, env, 2026);
    expect(year.events).toHaveLength(0);
    const next = await request(app, env, '/api/v1/calendar/next', {
      headers: AGE_OK,
    });
    const nextBody = (await next.json()) as Record<string, unknown>;

    // Neither response carries any candidate fact — not the URLs, not
    // the titles, not the drafts. The queue's only doors are the
    // /ops/console ones.
    for (const payload of [JSON.stringify(year), JSON.stringify(nextBody)]) {
      expect(payload).not.toContain('pending-secret');
      expect(payload).not.toContain('rejected-secret');
      expect(payload).not.toContain('Salainen jono-rivi');
      expect(payload).not.toContain('Luonnos fi');
    }

    // And the decisions do not change that: accepting one candidate
    // publishes exactly the event row — the candidate's URL rides only
    // as the event's official sourceUrl (the event contract's own
    // sourced-row shape), never as a queue row.
    await accept(app, env, 1, CONFIRMED_ACCEPT);
    const after = await publicYear(app, env, 2027);
    expect(after.events).toHaveLength(1);
    expect(after.events[0]).toMatchObject({
      status: 'CONFIRMED',
      sourceUrl: 'https://www.vero.fi/news/pending-secret',
    });
    const serialized = JSON.stringify(after);
    // The retained REJECTED row is still invisible, and no candidate
    // workflow fields (drafts, statuses) ride the public payload.
    expect(serialized).not.toContain('rejected-secret');
    expect(serialized).not.toContain('Hylätty jono-rivi');
    expect(serialized).not.toContain('Luonnos fi');
  });
});
