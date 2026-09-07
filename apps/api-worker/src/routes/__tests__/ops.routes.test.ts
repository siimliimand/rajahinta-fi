/**
 * Ops console route parity tests (task 3.8).
 *
 * Expectations ported from the ops suites:
 * - packages/application-api/src/ops/__tests__/ops-console.access.test.ts
 *   (deny-before-data: ops access),
 * - ops-governance.service.test.ts (list shape; mutations here fail
 *   closed — documented 3.8 scope note),
 * - ops-dataset-confirmation.service.test.ts (queue shape, tax review
 *   resolution, audit write),
 * - ops-correction-queue.service.test.ts / ops-audit-trail.service.test.ts
 *   (fail-closed queue; audit trail reads with limit clamps).
 *
 * @module OpsRoutesTest
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
import { D1ConsumptionNormsRepository } from '../../../../../packages/data-platform/src/repositories/d1/consumption-norms.repository';

const OPS = { authorization: `Bearer ${FAKE_OPS_TOKEN}` };
const JSON_HDRS = { 'content-type': 'application/json', ...OPS };

function authedEnv(d1: Parameters<typeof permissiveEnv>[0]): ReturnType<typeof permissiveEnv> {
  return permissiveEnv(d1);
}

/** Insert a registry merchant row and return its id. */
function seedRegistryMerchant(
  db: import('node:sqlite').DatabaseSync,
  merchant: { merchantId: string; name: string; country?: string },
): void {
  db.prepare(
    `INSERT INTO merchant_registry (
       merchant_id, name, country, feed_url, feed_format, polling_interval_ms
     ) VALUES (?, ?, ?, ?, 'json', 3_600_000)`,
  ).run(merchant.merchantId, merchant.name, merchant.country ?? 'SE', 'https://feed.example');
}

describe('ops console — deny before any data (ops-console.access parity)', () => {
  it('403s without credentials', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();

    // Unconfigured → fail closed.
    const closed = await request(app, lockedEnv(d1), '/ops/console/audit');
    await expectEnvelope(closed, 403, { message: 'Forbidden' });

    // Configured → the trail endpoint serves.
    const ok = await request(app, authedEnv(d1), '/ops/console/audit', { headers: OPS });
    expect(ok.status).toBe(200);
  });
});

describe('GET/POST /ops/console/governance', () => {
  it('lists registry merchants with fail-closed PENDING permission state', async () => {
    const { db, d1 } = openMigratedD1();
    seedRegistryMerchant(db, { merchantId: 'eu-import', name: 'EU Import' });
    seedRegistryMerchant(db, { merchantId: 'alko', name: 'Alko', country: 'FI' });
    const app = buildApp();

    const res = await request(app, authedEnv(d1), '/ops/console/governance', { headers: OPS });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.total).toBe(2);
    expect(body.items.map((m: Record<string, unknown>) => m.merchantId)).toEqual([
      'alko',
      'eu-import',
    ]);
    for (const item of body.items) {
      expect(item.permissionStatus).toBe('PENDING');
      expect(item.sourceCount).toBe(0);
      expect(item.hasWarnings).toBe(false);
    }
  });

  it('fails grant/revoke closed with 503 (no D1 governance store)', async () => {
    const { db, d1 } = openMigratedD1();
    seedRegistryMerchant(db, { merchantId: 'alko', name: 'Alko', country: 'FI' });
    const app = buildApp();

    const grant = await request(app, authedEnv(d1), '/ops/console/governance/alko/grant', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({
        operator: 'ops-1',
        acquisitionMethod: 'RETAILER_API',
        sourceUrl: 'https://alko.example/api',
      }),
    });
    const grantBody = await expectEnvelope(grant, 503, { error: 'StoreUnavailable' });
    expect(grantBody.message).toContain('no D1 counterpart');

    // Validation still precedes the unavailable store (controller parity).
    const badGrant = await request(app, authedEnv(d1), '/ops/console/governance/alko/grant', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ operator: 'ops-1', acquisitionMethod: 'SCRAPING' }),
    });
    await expectEnvelope(badGrant, 400, {
      message: expect.stringContaining('acquisitionMethod must be one of'),
    });

    const revoke = await request(app, authedEnv(d1), '/ops/console/governance/alko/revoke', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ operator: 'ops-1', reason: 'legal hold' }),
    });
    await expectEnvelope(revoke, 503, { error: 'StoreUnavailable' });

    const noReason = await request(app, authedEnv(d1), '/ops/console/governance/alko/revoke', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ operator: 'ops-1' }),
    });
    await expectEnvelope(noReason, 400, { message: 'reason is required for revocation' });
  });
});

describe('/ops/console/confirmations', () => {
  it('fails tax-review approve/reject closed with 503 (no D1 store)', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = authedEnv(d1);

    for (const action of ['approve', 'reject']) {
      const res = await request(
        app,
        env,
        `/ops/console/confirmations/tax/abc-123/${action}`,
        {
          method: 'POST',
          headers: JSON_HDRS,
          body: JSON.stringify({ operator: 'ops-1' }),
        },
      );
      await expectEnvelope(res, 503, { error: 'StoreUnavailable' });
    }
  });

  it('lists pending consumption norms by version (tax reviews fail-closed empty) and publishes via confirm: 404 unknown, 409 terminal, audit', async () => {
    const { d1 } = openMigratedD1();
    const norms = new D1ConsumptionNormsRepository(d1);
    const [created] = await norms.createPendingVersion([
      {
        versionLabel: 'norms-2026.1',
        drinkType: 'beer',
        eventProfile: 'casual_gathering',
        normValuePerGuestPerHour: 0.32,
        sourceCitation: 'cited source — https://example.invalid/norms',
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      },
    ]);
    const app = buildApp();
    const env = authedEnv(d1);

    const list = await request(app, env, '/ops/console/confirmations', { headers: OPS });
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as Record<string, any>;
    expect(listBody.taxReviews).toEqual([]);
    expect(listBody.consumptionNorms).toHaveLength(1);
    expect(listBody.consumptionNorms[0]).toMatchObject({
      versionLabel: 'norms-2026.1',
      status: 'PENDING_CONFIRMATION',
    });
    expect(listBody.consumptionNorms[0].rows).toEqual([
      expect.objectContaining({
        id: created.id,
        drinkType: 'beer',
        eventProfile: 'casual_gathering',
        normValuePerGuestPerHour: 0.32,
      }),
    ]);

    const missing = await request(
      app,
      env,
      '/ops/console/confirmations/consumption-norms/999/confirm',
      { method: 'POST', headers: JSON_HDRS, body: JSON.stringify({ operator: 'ops-1' }) },
    );
    await expectEnvelope(missing, 404, { message: 'Consumption norm 999 not found' });

    const ok = await request(
      app,
      env,
      `/ops/console/confirmations/consumption-norms/${created.id}/confirm`,
      {
        method: 'POST',
        headers: JSON_HDRS,
        body: JSON.stringify({ operator: 'ops-1', note: 'Citations verified' }),
      },
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()) as Record<string, any>).toMatchObject({
      id: created.id,
      versionLabel: 'norms-2026.1',
      status: 'PUBLISHED',
    });

    // PUBLISHED is terminal — republish is a 409.
    const again = await request(
      app,
      env,
      `/ops/console/confirmations/consumption-norms/${created.id}/confirm`,
      { method: 'POST', headers: JSON_HDRS, body: JSON.stringify({ operator: 'ops-1' }) },
    );
    await expectEnvelope(again, 409, { error: 'InvalidTransition' });

    const trail = await request(app, env, '/ops/console/audit?limit=10', { headers: OPS });
    const trailBody = (await trail.json()) as Record<string, any>;
    expect(trailBody.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'consumption_norm',
          entityId: 'norms-2026.1',
          action: 'confirmed',
          author: 'ops-1',
        }),
      ]),
    );
  });
});

describe('/ops/console/corrections — fail-closed queue', () => {
  it('rejects list, open, and resolve with 503 while the store has no D1 table', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = authedEnv(d1);

    const list = await request(app, env, '/ops/console/corrections', { headers: OPS });
    await expectEnvelope(list, 503, { error: 'StoreUnavailable' });

    const open = await request(app, env, '/ops/console/corrections', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({
        targetType: 'calculation',
        targetId: 5,
        reason: 'figures look wrong',
        operator: 'ops-1',
      }),
    });
    await expectEnvelope(open, 503, { error: 'StoreUnavailable' });

    // Validation still precedes the store check (controller parity).
    const invalid = await request(app, env, '/ops/console/corrections', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({
        targetType: 'merchant',
        targetId: 0,
        reason: '',
        operator: '',
      }),
    });
    await expectEnvelope(invalid, 400, {
      message: expect.stringContaining('targetType must be'),
    });

    const resolve = await request(app, env, '/ops/console/corrections/5/resolve', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ operator: 'ops-1' }),
    });
    await expectEnvelope(resolve, 503, { error: 'StoreUnavailable' });
  });
});

describe('GET /ops/console/audit — durable trail reads', () => {
  it('surfaces append-only audit_events newest first, with limit clamps', async () => {
    const { db, d1 } = openMigratedD1();
    // Seed three entries with distinct timestamps (append-only writes).
    const now = Date.now();
    for (const [index, entity] of ['a', 'b', 'c'].entries()) {
      db.prepare(
        `INSERT INTO audit_events (
           id, entity_type, entity_id, action, author, reason, occurred_at
         ) VALUES (?, 'seed_entity', ?, 'confirmed', 'ops-seed', 'seed', ?)`,
      ).run(
        `id-${index}`,
        entity,
        new Date(now - index * 1000).toISOString(),
      );
    }
    const app = buildApp();
    const env = authedEnv(d1);

    const res = await request(app, env, '/ops/console/audit?limit=2', { headers: OPS });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.total).toBe(2);
    expect(body.items[0]!.entityId).toBe('a'); // newest first
    expect(body.items[0]!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Garbage / out-of-range limits clamp to the documented bounds.
    const garbage = await request(app, env, '/ops/console/audit?limit=abc', { headers: OPS });
    expect(garbage.status).toBe(200);
    const garbageBody = (await garbage.json()) as Record<string, any>;
    expect(garbageBody.total).toBe(3); // default 25 ≥ seeded rows

    const zero = await request(app, env, '/ops/console/audit?limit=0', { headers: OPS });
    const zeroBody = (await zero.json()) as Record<string, any>;
    expect(zeroBody.total).toBe(1); // clamped to ≥ 1
  });
});
