/**
 * Event-calculator route tests (task 4.3, change
 * product-roadmap-phases-1-4) over the FULL app composition
 * (createApp() + registerEventCalcRoutes — the exact composition
 * index.ts wires, flag gate + rate limit on the route itself) on the
 * fake-D1 harness.
 *
 * Pinning here: the validation caps (guests 1..500, durationHours
 * 1..72, whole hours), flag-off 403 (EVENT_CALCULATOR, same envelope
 * shape the alerts gate uses — 4.6 integration tests rely on this
 * class of contract), the NO_PUBLISHED_NORMS empty state (pending
 * norms invisible, wrong profile/date not resolved), the STRUCTURAL
 * disclaimer field on every result, and version-aware idempotency
 * (byte-identical repeats within a norms version; a published newer
 * version yields a fresh result under the same request).
 *
 * @module EventCalcRoutesTest
 */

import { describe, it, expect } from 'vitest';
import {
  createApp,
  expectEnvelope,
  lockedEnv,
  openMigratedD1,
  permissiveEnv,
  request,
} from './harness';
import { registerEventCalcRoutes } from '../event-calc.routes';
import { D1ConsumptionNormsRepository } from '../../../../../packages/data-platform/src/repositories/d1/consumption-norms.repository';
import type { ConsumptionNormInsert } from '../../../../../packages/data-platform/src/repositories/d1/consumption-norms.repository';
import type { Env } from '../../env';
import type { D1DatabaseLike } from '../../../../../packages/data-platform/src/d1/executor';

/**
 * index.ts registers the event-calculator handler behind its route-level
 * gate+limiter (same slot as the other route ports); the test composition
 * mirrors that exactly.
 */
function eventCalcApp(): ReturnType<typeof createApp> {
  const app = createApp();
  registerEventCalcRoutes(app);
  return app;
}

function eventCalcEnv(d1: D1DatabaseLike, overrides: Partial<Env> = {}): Env {
  return permissiveEnv(d1, { ...overrides, FF_EVENT_CALCULATOR: 'true' });
}

const CITATION = 'Curated test norm — https://example.invalid/norms';

/** Append one norms version (single row) and publish it — the only PUBLISHED path. */
async function seedPublishedNorm(
  d1: D1DatabaseLike,
  overrides: Partial<ConsumptionNormInsert> = {},
): Promise<number> {
  const repo = new D1ConsumptionNormsRepository(d1);
  const row: ConsumptionNormInsert = {
    versionLabel: 'norms-test-2026.1',
    drinkType: 'beer',
    eventProfile: 'casual_gathering',
    normValuePerGuestPerHour: 0.5,
    sourceCitation: CITATION,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    ...overrides,
  };
  const [created] = await repo.createPendingVersion([row]);
  const published = await repo.publish(created.id, 'ops-test');
  expect(published).not.toBeNull();
  return created.id;
}

const EVENT = {
  guests: 10,
  durationHours: 4,
  eventProfile: 'casual_gathering',
  eventDate: '2026-06-01',
};

function jsonInit(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

interface EventCalcJson {
  status: string;
  normsVersion?: string;
  lines?: {
    drinkType: string;
    needMl: number;
    needLitres: number;
    plannedUnits: { sizeMl: number; description: string; quantity: number }[];
    surplusMl: number;
  }[];
  disclaimer?: { text: string; language: string; version: string };
}

async function postEvent(
  app: ReturnType<typeof createApp>,
  env: Env,
  body: unknown = EVENT,
): Promise<Response> {
  return request(app, env, '/api/v1/event-calc', jsonInit(body));
}

// ---------------------------------------------------------------------------
// Gate: flag-off 403 (EVENT_CALCULATOR)
// ---------------------------------------------------------------------------

describe('POST /api/v1/event-calc — gate', () => {
  it('rejects with 403 while EVENT_CALCULATOR is off (alerts 403 shape)', async () => {
    const { d1 } = openMigratedD1();
    const app = eventCalcApp();
    const res = await postEvent(app, lockedEnv(d1));
    await expectEnvelope(res, 403, {
      message: 'Feature "EVENT_CALCULATOR" is not enabled',
    });
  });
});

// ---------------------------------------------------------------------------
// Validation — caps and shapes
// ---------------------------------------------------------------------------

describe('POST /api/v1/event-calc — validation caps', () => {
  it.each([0, -5, 0.5, 501, 10_000])('rejects guests=%s with 400', async (guests) => {
    const { d1 } = openMigratedD1();
    const app = eventCalcApp();
    const res = await postEvent(app, eventCalcEnv(d1), { ...EVENT, guests });
    await expectEnvelope(res, 400, { error: 'ValidationError' });
  });

  it.each([0, -1, 2.5, 73])('rejects durationHours=%s with 400 (whole hours only)', async (durationHours) => {
    const { d1 } = openMigratedD1();
    const app = eventCalcApp();
    const res = await postEvent(app, eventCalcEnv(d1), { ...EVENT, durationHours });
    await expectEnvelope(res, 400, { error: 'ValidationError' });
  });

  it('rejects an unknown profile and a non-ISO date with 400', async () => {
    const { d1 } = openMigratedD1();
    const app = eventCalcApp();
    const env = eventCalcEnv(d1);
    const badProfile = await postEvent(app, env, { ...EVENT, eventProfile: 'wedding' });
    await expectEnvelope(badProfile, 400, { error: 'ValidationError' });
    const badDate = await postEvent(app, env, { ...EVENT, eventDate: '2026/06/01' });
    await expectEnvelope(badDate, 400, { error: 'ValidationError' });
  });

  it('accepts the caps as boundaries (guests=500, durationHours=72)', async () => {
    const { d1 } = openMigratedD1();
    await seedPublishedNorm(d1);
    const app = eventCalcApp();
    const res = await postEvent(app, eventCalcEnv(d1), {
      ...EVENT,
      guests: 500,
      durationHours: 72,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventCalcJson;
    expect(body.status).toBe('COMPUTED');
    // 0.5 l × 500 guests × 72 h in exact integer ml.
    expect(body.lines![0]!.needMl).toBe(18_000_000);
  });
});

// ---------------------------------------------------------------------------
// Norms resolution — explicit empty state
// ---------------------------------------------------------------------------

describe('POST /api/v1/event-calc — norms resolution', () => {
  it('returns 200 NO_PUBLISHED_NORMS when nothing was ever published', async () => {
    const { d1 } = openMigratedD1();
    const app = eventCalcApp();
    const res = await postEvent(app, eventCalcEnv(d1));
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventCalcJson;
    expect(body.status).toBe('NO_PUBLISHED_NORMS');
    expect(body.disclaimer).toMatchObject({ language: 'fi', version: '1.0' });
  });

  it('treats PENDING_CONFIRMATION norms as invisible (nothing published yet)', async () => {
    const { d1 } = openMigratedD1();
    const repo = new D1ConsumptionNormsRepository(d1);
    await repo.createPendingVersion([
      {
        versionLabel: 'norms-pending-1',
        drinkType: 'beer',
        eventProfile: 'casual_gathering',
        normValuePerGuestPerHour: 0.5,
        sourceCitation: CITATION,
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      },
    ]);
    const app = eventCalcApp();
    const res = await postEvent(app, eventCalcEnv(d1));
    expect(res.status).toBe(200);
    expect(((await res.json()) as EventCalcJson).status).toBe('NO_PUBLISHED_NORMS');
  });

  it('does not resolve norms of a different profile or before the effective window', async () => {
    const { d1 } = openMigratedD1();
    await seedPublishedNorm(d1, { eventProfile: 'dinner_party' });
    const app = eventCalcApp();
    const env = eventCalcEnv(d1);
    const wrongProfile = await postEvent(app, env);
    expect(((await wrongProfile.json()) as EventCalcJson).status).toBe('NO_PUBLISHED_NORMS');

    await seedPublishedNorm(d1, { versionLabel: 'norms-test-2026.2', effectiveFrom: '2026-07-01' });
    const before = await postEvent(app, env);
    expect(((await before.json()) as EventCalcJson).status).toBe('NO_PUBLISHED_NORMS');
  });
});

// ---------------------------------------------------------------------------
// Computed result — structural disclaimer
// ---------------------------------------------------------------------------

describe('POST /api/v1/event-calc — computed result', () => {
  it('returns the shopping list naming the norms version, with the structural disclaimer', async () => {
    const { d1 } = openMigratedD1();
    await seedPublishedNorm(d1);
    const app = eventCalcApp();
    const res = await postEvent(app, eventCalcEnv(d1));
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventCalcJson;

    expect(body.status).toBe('COMPUTED');
    expect(body.normsVersion).toBe('norms-test-2026.1');
    expect(body.lines).toHaveLength(1);
    const line = body.lines![0]!;
    expect(line.drinkType).toBe('beer');
    expect(line.needMl).toBe(20_000); // 0.5 l × 10 guests × 4 h
    expect(line.needLitres).toBe(20);
    expect(line.plannedUnits!.length).toBeGreaterThanOrEqual(1);
    expect(line.plannedUnits![0]!.description).toBeTruthy();
    expect(line.surplusMl).toBeGreaterThanOrEqual(0);

    // Structural field, not a string: same keys as the disclaimer module.
    expect(body.disclaimer).toEqual({
      text: expect.stringContaining('kulutusnormeihin'),
      language: 'fi',
      version: '1.0',
    });
  });
});

// ---------------------------------------------------------------------------
// Version-aware idempotency
// ---------------------------------------------------------------------------

describe('POST /api/v1/event-calc — version-aware idempotency', () => {
  it('serves a byte-identical repeat (X-Cache HIT) and a fresh result after a norms bump', async () => {
    const { d1 } = openMigratedD1();
    await seedPublishedNorm(d1, { versionLabel: 'norms-v1' });
    const app = eventCalcApp();
    const env = eventCalcEnv(d1);

    const first = await postEvent(app, env);
    expect(first.status).toBe(200);
    expect(first.headers.get('X-Cache')).toBe('MISS');
    const firstBody = (await first.json()) as EventCalcJson;
    expect(firstBody.normsVersion).toBe('norms-v1');
    const firstHash = first.headers.get('X-Content-Hash');
    expect(firstHash).not.toBeNull();

    const repeat = await postEvent(app, env);
    expect(repeat.headers.get('X-Cache')).toBe('HIT');
    expect(repeat.headers.get('X-Content-Hash')).toBe(firstHash);
    expect(await repeat.json()).toEqual(firstBody);

    // A NEWER version published effective on the same date changes the
    // resolved dataset version → fresh result, not a stale HIT.
    await seedPublishedNorm(d1, {
      versionLabel: 'norms-v2',
      normValuePerGuestPerHour: 0.6,
      effectiveFrom: '2026-02-01',
    });
    const afterBump = await postEvent(app, env);
    expect(afterBump.headers.get('X-Cache')).toBe('MISS');
    const bumpBody = (await afterBump.json()) as EventCalcJson;
    expect(bumpBody.normsVersion).toBe('norms-v2');
    expect(bumpBody.lines![0]!.needMl).toBe(24_000); // 0.6 l × 10 × 4
    expect(afterBump.headers.get('X-Content-Hash')).not.toBe(firstHash);
  });
});
