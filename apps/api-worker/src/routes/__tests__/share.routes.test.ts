/**
 * Share-permalink route tests (task 6.1, change
 * trust-and-reach-roadmap) over the FULL app composition on the fake-D1
 * harness.
 *
 * Pins (spec share-permalinks, design D6):
 * - the snapshot is a FROZEN COPY: mutating (or effectively pruning)
 *   the original record after the share never changes what the public
 *   link renders;
 * - the snapshot carries NO account fields — assembly is a closed
 *   projection, and a personal-data field riding in free-form record
 *   JSON trips the strip assertion into a refusal with nothing stored;
 * - ownership: a foreign or unclaimed record is the same 404 (no
 *   record-id oracle);
 * - the public GET is anonymous, treats malformed and unknown ids
 *   identically, and includes the structural disclaimer.
 *
 * @module ShareRoutesTest
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

async function postShare(s: Setup, token: string, recordId: number): Promise<Response> {
  const app = buildApp();
  return request(app, permissiveEnv(s.d1), `/api/v1/calculations/${recordId}/share`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `rajahinta_session=${token}` },
    body: JSON.stringify({}),
  });
}

interface ShareBody {
  publicId: string;
  createdAt: string;
}

async function createShareForOwnedRecord(s: Setup): Promise<ShareBody> {
  seedProduct(s.db, { id: 1 });
  seedCalculationRecord(s.db, { id: 100, productMasterId: 1, totalCents: 873, sessionId: 'user-7' });
  const res = await postShare(s, s.token7, 100);
  expect(res.status).toBe(201);
  return (await res.json()) as ShareBody;
}

describe('POST /api/v1/calculations/:id/share', () => {
  it('returns a fresh 22-character public id bound to the frozen copy', async () => {
    const s = await setup();
    const first = await createShareForOwnedRecord(s);
    expect(first.publicId).toHaveLength(22);
    expect(first.publicId).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(new Date(first.createdAt).toISOString()).toBe(first.createdAt);

    // A second share of the same record is a NEW snapshot.
    const second = await postShare(s, s.token7, 100);
    expect(((await second.json()) as ShareBody).publicId).not.toBe(first.publicId);
  });

  it('rejects an anonymous caller with the 401 session envelope', async () => {
    const s = await setup();
    const app = buildApp();
    const res = await request(app, permissiveEnv(s.d1), '/api/v1/calculations/1/share', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    await expectEnvelope(res, 401, { error: 'SessionRequired' });
  });

  it('a foreign record and an unclaimed record are the same 404 (no id oracle)', async () => {
    const s = await setup();
    seedProduct(s.db, { id: 1 });
    seedCalculationRecord(s.db, { id: 100, productMasterId: 1, sessionId: 'user-9' }); // foreign
    seedCalculationRecord(s.db, { id: 101, productMasterId: 1, sessionId: null }); // unclaimed

    const foreign = await postShare(s, s.token7, 100);
    const unclaimed = await postShare(s, s.token7, 101);
    const unknown = await postShare(s, s.token7, 404404);
    expect(foreign.status).toBe(404);
    expect(unclaimed.status).toBe(404);
    expect(unknown.status).toBe(404);

    const foreignBody = (await foreign.json()) as { message: string; error: string };
    const unknownBody = (await unknown.json()) as { message: string; error: string };
    expect(foreignBody.error).toBe(unknownBody.error);
    // The message only echoes the id the CALLER supplied — it names
    // nothing about the record store.
    expect(foreignBody.message).toContain('100');
    expect(unknownBody.message).toContain('404404');
  });

  it('the strip assertion refuses a snapshot carrying personal data (nothing stored)', async () => {
    const s = await setup();
    seedProduct(s.db, { id: 1 });
    // A record whose disclaimer JSON carries a personal-data field.
    seedCalculationRecord(s.db, { id: 100, productMasterId: 1, sessionId: 'user-7' });
    s.db
      .prepare('UPDATE calculation_records SET disclaimer = ? WHERE id = 100')
      .run(JSON.stringify({ text: 'x', language: 'fi', version: '1', userId: 'user-7' }));

    const res = await postShare(s, s.token7, 100);
    await expectEnvelope(res, 500, { error: 'SnapshotPersonalDataViolation' });

    // Nothing was persisted under any public id.
    const count = (
      await s.d1.prepare('SELECT COUNT(*) AS n FROM share_snapshots').first<{ n: number }>()
    )!.n;
    expect(count).toBe(0);
  });
});

describe('GET /api/v1/share/:publicId — frozen copy semantics', () => {
  it('renders the frozen copy anonymously, disclaimer included', async () => {
    const s = await setup();
    const { publicId } = await createShareForOwnedRecord(s);
    const app = buildApp();

    const res = await request(app, permissiveEnv(s.d1), `/api/v1/share/${publicId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      publicId: string;
      snapshot: {
        type: string;
        totalCents: number;
        product: { name: string };
        disclaimer: { text: string } | null;
      };
      createdAt: string;
    };
    expect(body.publicId).toBe(publicId);
    expect(body.snapshot.type).toBe('landed-cost-snapshot');
    expect(body.snapshot.totalCents).toBe(873);
    expect(body.snapshot.product.name).toBe('Karhu III');
    // The structural disclaimer rides the frozen copy (not UI-only).
    expect(body.snapshot.disclaimer).not.toBeNull();
    expect((body.snapshot.disclaimer as { text: string }).text).toContain('arvioita');
  });

  it('the snapshot is FROZEN: later changes to the record do not affect it', async () => {
    const s = await setup();
    const { publicId } = await createShareForOwnedRecord(s);
    const app = buildApp();

    // The record is later modified (and even deleted — the prune case).
    s.db
      .prepare('UPDATE calculation_records SET total_cents = 999999 WHERE id = 100')
      .run();
    s.db.prepare('DELETE FROM calculation_records WHERE id = 100').run();

    const res = await request(app, permissiveEnv(s.d1), `/api/v1/share/${publicId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { snapshot: { totalCents: number } };
    expect(body.snapshot.totalCents).toBe(873);
  });

  it('the frozen copy carries NO account fields', async () => {
    const s = await setup();
    const { publicId } = await createShareForOwnedRecord(s);
    const app = buildApp();

    const res = await request(app, permissiveEnv(s.d1), `/api/v1/share/${publicId}`);
    const body = (await res.json()) as { snapshot: Record<string, unknown> };
    const serialized = JSON.stringify(body.snapshot).toLowerCase();
    for (const banned of ['userid', 'user_id', 'accountid', 'account_id', 'session', 'user-7', 'email']) {
      expect(serialized).not.toContain(banned);
    }
    // The documented key set, exactly.
    expect(Object.keys(body.snapshot).sort()).toEqual(
      [
        'breakdown',
        'calculatedAt',
        'confidence',
        'currency',
        'destination',
        'disclaimer',
        'product',
        'quantity',
        'totalCents',
        'type',
      ].sort(),
    );
  });

  it('malformed and unknown ids get the identical 404 (no existence leakage)', async () => {
    const s = await setup();
    const app = buildApp();

    const malformed = await request(
      app,
      permissiveEnv(s.d1),
      '/api/v1/share/too-short-id',
    );
    const wellFormed = await request(
      app,
      permissiveEnv(s.d1),
      `/api/v1/share/${'a'.repeat(22)}`,
    );
    expect(malformed.status).toBe(404);
    expect(wellFormed.status).toBe(404);

    const malformedBody = (await malformed.json()) as { message: string; error: string };
    const wellFormedBody = (await wellFormed.json()) as { message: string; error: string };
    expect(malformedBody.error).toBe(wellFormedBody.error);
    expect(malformedBody.message).toBe(wellFormedBody.message);
  });
});
