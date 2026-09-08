/**
 * Verified-outcome route tests (task 3.2, change
 * trust-and-reach-roadmap) over the FULL app composition on the fake-D1
 * harness.
 *
 * Pins (spec calculation-outcomes):
 * - the 60-day window boundary: exactly the window is accepted, the
 *   first millisecond after is rejected with nothing stored;
 * - duplicates: the second report for the same (record, account) is a
 *   409 and the stored outcome stays untouched;
 * - ownership: another account's record is a 403, an unknown record a
 *   404;
 * - the public accuracy statistic: count + within-margin share + as-of
 *   with the module's user-reported labels; the empty state is count 0
 *   and a null share (never a fabricated percentage);
 * - the history extension: `?outcomes=1` flags records still missing
 *   outcomes while the default shape stays the plain id array.
 *
 * @module OutcomesRoutesTest
 */

import { describe, it, expect } from 'vitest';
import {
  buildApp,
  expectEnvelope,
  issueSessionToken,
  openMigratedD1,
  permissiveEnv,
  request,
  seedAccount,
  seedCalculationRecord,
  seedProduct,
} from './harness';
import { D1CalculationOutcomeRepository } from '../../../../../packages/data-platform/src/repositories/d1/calculation-outcome.repository';
import { USER_REPORTED_OUTCOMES_LABEL_FI } from '../../../../../packages/core-domain/src/outcomes/outcomes.types';

/** Canonical two-account fixture: 7 reports, 9 owns the foreign record. */
function seedAccounts(db: ReturnType<typeof openMigratedD1>['db']): void {
  seedAccount(db, { id: 7, userId: 'user-7', email: 'user-7@example.invalid', tier: 'FREE' });
  seedAccount(db, { id: 9, userId: 'user-9', email: 'user-9@example.invalid', tier: 'FREE' });
}

interface Setup {
  db: ReturnType<typeof openMigratedD1>['db'];
  d1: ReturnType<typeof openMigratedD1>['d1'];
  token7: string;
  token9: string;
}

async function setup(): Promise<Setup> {
  const { db, d1 } = openMigratedD1();
  seedAccounts(db);
  return {
    db,
    d1,
    token7: await issueSessionToken(d1, 7),
    token9: await issueSessionToken(d1, 9),
  };
}

/** Shift a record's calculation timestamp to `days` days before now. */
function ageRecord(db: Setup['db'], recordId: number, days: number, ms = 0): void {
  const calculatedAt = new Date(Date.now() - days * 86_400_000 - ms).toISOString();
  db.prepare('UPDATE calculation_records SET calculated_at = ? WHERE id = ?').run(
    calculatedAt,
    recordId,
  );
}

function postOutcome(
  setup_: Setup,
  token: string,
  recordId: number,
  reportedTotalCents: number,
): Promise<Response> {
  const app = buildApp();
  return request(app, permissiveEnv(setup_.d1), `/api/v1/calculations/${recordId}/outcome`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `rajahinta_session=${token}`,
    },
    body: JSON.stringify({ reportedTotalCents }),
  });
}

describe('POST /api/v1/calculations/:id/outcome — window boundaries', () => {
  it('accepts a report just inside the window (inclusive boundary)', async () => {
    const s = await setup();
    seedProduct(s.db, { id: 1 });
    seedCalculationRecord(s.db, { id: 100, productMasterId: 1, totalCents: 1000, sessionId: 'user-7' });
    // Exactly 60 days is the inclusive boundary (pinned by the core-domain
    // suite with an injected clock); here the request's own `now` is the
    // clock, so the record is aged 60 days MINUS one second.
    ageRecord(s.db, 100, 60, -1_000);

    const res = await postOutcome(s, s.token7, 100, 1050);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { withinMargin: boolean; reportedTotalCents: number };
    expect(body.reportedTotalCents).toBe(1050);
    expect(body.withinMargin).toBe(true); // 50 ≤ 5% of 1000
  });

  it('rejects one millisecond past the window and stores nothing', async () => {
    const s = await setup();
    seedProduct(s.db, { id: 1 });
    seedCalculationRecord(s.db, { id: 100, productMasterId: 1, totalCents: 1000, sessionId: 'user-7' });
    ageRecord(s.db, 100, 60, 1);

    const res = await postOutcome(s, s.token7, 100, 1050);
    await expectEnvelope(res, 400, { error: 'WINDOW_EXPIRED' });

    const stored = await new D1CalculationOutcomeRepository(s.d1).findByCalculationRecordId(100);
    expect(stored).toHaveLength(0);
  });

  it('rejects non-positive totals with 400', async () => {
    const s = await setup();
    seedProduct(s.db, { id: 1 });
    seedCalculationRecord(s.db, { id: 100, productMasterId: 1, totalCents: 1000, sessionId: 'user-7' });

    for (const reported of [0, -5]) {
      const res = await postOutcome(s, s.token7, 100, reported);
      await expectEnvelope(res, 400, { error: 'REPORTED_TOTAL_NOT_POSITIVE' });
    }
  });
});

describe('POST /api/v1/calculations/:id/outcome — duplicates', () => {
  it('rejects a second report with 409 and leaves the stored outcome untouched', async () => {
    const s = await setup();
    seedProduct(s.db, { id: 1 });
    seedCalculationRecord(s.db, { id: 100, productMasterId: 1, totalCents: 1000, sessionId: 'user-7' });

    const first = await postOutcome(s, s.token7, 100, 1050);
    expect(first.status).toBe(201);
    const stored = await new D1CalculationOutcomeRepository(s.d1).findByCalculationRecordId(100);
    expect(stored).toHaveLength(1);
    const original = stored[0]!;

    const second = await postOutcome(s, s.token7, 100, 9999);
    await expectEnvelope(second, 409, { error: 'OUTCOME_ALREADY_EXISTS' });

    const after = await new D1CalculationOutcomeRepository(s.d1).findByCalculationRecordId(100);
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(original.id);
    expect(after[0]!.reportedTotalCents).toBe(original.reportedTotalCents);
    expect(after[0]!.reportedAt).toEqual(original.reportedAt);
  });

  it('allows the SAME record for a DIFFERENT account (guard is per pair)', async () => {
    const s = await setup();
    seedProduct(s.db, { id: 1 });
    // Record 100 owned by user-7; record 101 also owned by user-7 — the
    // different account reporting its OWN record is fine.
    seedCalculationRecord(s.db, { id: 101, productMasterId: 1, totalCents: 500, sessionId: 'user-9' });

    const res = await postOutcome(s, s.token9, 101, 510);
    expect(res.status).toBe(201);
  });
});

describe('POST /api/v1/calculations/:id/outcome — ownership', () => {
  it('rejects another account\'s record with 403', async () => {
    const s = await setup();
    seedProduct(s.db, { id: 1 });
    seedCalculationRecord(s.db, { id: 100, productMasterId: 1, sessionId: 'user-9' });

    const res = await postOutcome(s, s.token7, 100, 500);
    await expectEnvelope(res, 403, { error: 'NOT_RECORD_OWNER' });
  });

  it('answers 404 for an unknown record', async () => {
    const s = await setup();
    const res = await postOutcome(s, s.token7, 404404, 500);
    await expectEnvelope(res, 404, { error: 'RECORD_NOT_FOUND' });
  });

  it('rejects an anonymous caller with the 401 session envelope', async () => {
    const s = await setup();
    const app = buildApp();
    const res = await request(app, permissiveEnv(s.d1), '/api/v1/calculations/1/outcome', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reportedTotalCents: 100 }),
    });
    await expectEnvelope(res, 401, { error: 'SessionRequired' });
  });
});

describe('GET /api/v1/accuracy — public statistic', () => {
  it('empty state: count 0, null share, user-reported label (honest zero)', async () => {
    const s = await setup();
    const app = buildApp();
    const res = await request(app, permissiveEnv(s.d1), '/api/v1/accuracy');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      count: number;
      withinMarginShare: number | null;
      asOf: string;
      label: { fi: string; en: string };
    };
    expect(body.count).toBe(0);
    expect(body.withinMarginShare).toBeNull();
    expect(new Date(body.asOf).toISOString()).toBe(body.asOf);
    expect(body.label.fi).toBe(USER_REPORTED_OUTCOMES_LABEL_FI);
  });

  it('computed read-time: count and within-margin share over stored outcomes', async () => {
    const s = await setup();
    seedProduct(s.db, { id: 1 });
    seedCalculationRecord(s.db, { id: 100, productMasterId: 1, totalCents: 1000, sessionId: 'user-7' });
    const repo = new D1CalculationOutcomeRepository(s.d1);
    await repo.create({
      calculationRecordId: 100,
      reporterAccountId: 7,
      estimateDigest: { totalCents: 1000 },
      estimatedTotalCents: 1000,
      reportedTotalCents: 1040, // within 5% (≤ 50)
    });
    await repo.create({
      calculationRecordId: 101,
      reporterAccountId: 9,
      estimateDigest: { totalCents: 1000 },
      estimatedTotalCents: 1000,
      reportedTotalCents: 2000, // outside
    });

    const app = buildApp();
    const res = await request(app, permissiveEnv(s.d1), '/api/v1/accuracy');
    const body = (await res.json()) as { count: number; withinMarginShare: number };
    expect(body.count).toBe(2);
    expect(body.withinMarginShare).toBeCloseTo(0.5, 10);
  });

  it('counts a deviation of exactly 5% as within margin', async () => {
    const s = await setup();
    const repo = new D1CalculationOutcomeRepository(s.d1);
    await repo.create({
      calculationRecordId: 100,
      reporterAccountId: 7,
      estimateDigest: { totalCents: 1000 },
      estimatedTotalCents: 1000,
      reportedTotalCents: 1050, // exactly 5% of 1000
    });

    const app = buildApp();
    const res = await request(app, permissiveEnv(s.d1), '/api/v1/accuracy');
    const body = (await res.json()) as { withinMarginShare: number };
    expect(body.withinMarginShare).toBe(1);
  });
});

describe('history outcome flags (GET /api/v1/account/history)', () => {
  it('default shape stays the plain id array', async () => {
    const s = await setup();
    seedProduct(s.db, { id: 1 });
    seedCalculationRecord(s.db, { id: 100, productMasterId: 1, sessionId: 'user-7' });
    seedCalculationRecord(s.db, { id: 101, productMasterId: 1, sessionId: 'user-7' });

    const app = buildApp();
    const res = await request(app, permissiveEnv(s.d1), '/api/v1/account/history', {
      headers: { cookie: `rajahinta_session=${s.token7}` },
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as number[]).toEqual([100, 101]);
  });

  it('?outcomes=1 flags records still missing outcomes for the prompt', async () => {
    const s = await setup();
    seedProduct(s.db, { id: 1 });
    seedCalculationRecord(s.db, { id: 100, productMasterId: 1, sessionId: 'user-7' });
    seedCalculationRecord(s.db, { id: 101, productMasterId: 1, sessionId: 'user-7' });
    seedCalculationRecord(s.db, { id: 102, productMasterId: 1, sessionId: 'user-9' }); // foreign

    await new D1CalculationOutcomeRepository(s.d1).create({
      calculationRecordId: 101,
      reporterAccountId: 7,
      estimateDigest: { totalCents: 873 },
      estimatedTotalCents: 873,
      reportedTotalCents: 900,
    });

    const app = buildApp();
    const res = await request(app, permissiveEnv(s.d1), '/api/v1/account/history?outcomes=1', {
      headers: { cookie: `rajahinta_session=${s.token7}` },
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { recordId: number; outcomeReported: boolean }[]).toEqual([
      { recordId: 100, outcomeReported: false },
      { recordId: 101, outcomeReported: true },
    ]);
  });
});
