/**
 * Ops console route parity tests (task 3.8).
 *
 * Expectations ported from the ops suites:
 * - packages/application-api/src/ops/__tests__/ops-console.access.test.ts
 *   (deny-before-data: ops access + OPERATOR_CONSOLE flag),
 * - ops-governance.service.test.ts (list shape; mutations here fail
 *   closed — documented 3.8 scope note),
 * - ops-dataset-confirmation.service.test.ts (queue shape, publish
 *   transition, predecessor-based cache invalidation, audit write),
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
import { D1FxRateRepository } from '../../../../../packages/data-platform/src/repositories/d1/fx-rate.repository';

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

async function seedPendingFxDatasetAsync(
  fx: D1FxRateRepository,
  versionLabel: string,
): Promise<number> {
  const created = await fx.createDataset(
    {
      versionLabel,
      sourceName: 'ecb-reference-rates',
      sourceUrl: 'https://www.ecb.example',
      referenceDate: '2026-08-28',
      effectiveFrom: new Date('2026-08-29T00:00:00.000Z'),
      effectiveTo: null,
      status: 'PENDING_CONFIRMATION',
    },
    [{ baseCurrency: 'EUR', quoteCurrency: 'SEK', rate: '11.20' }],
  );
  return created.id;
}

describe('ops console — deny before any data (ops-console.access parity)', () => {
  it('403s without credentials, and with ops config but the flag off', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();

    // Unconfigured → fail closed.
    const closed = await request(app, lockedEnv(d1), '/ops/console/audit');
    await expectEnvelope(closed, 403, { message: 'Forbidden' });

    // Ops config but console flag off (default in lockedEnv) → dark.
    const dark = await request(
      app,
      permissiveEnv(d1, { FF_OPERATOR_CONSOLE: undefined }),
      '/ops/console/audit',
      { headers: OPS },
    );
    await expectEnvelope(dark, 403, {
      message: 'Feature "OPERATOR_CONSOLE" is not enabled',
    });

    // Configured + flag → the trail endpoint serves.
    const ok = await request(app, authedEnv(d1), '/ops/console/audit', { headers: OPS });
    expect(ok.status).toBe(200);
  });
});

describe('GET/POST /ops/console/governance', () => {
  it('lists registry merchants with fail-closed PENDING permission state', async () => {
    const { db, d1 } = openMigratedD1();
    seedRegistryMerchant(db, { merchantId: 'systembolaget', name: 'Systembolaget' });
    seedRegistryMerchant(db, { merchantId: 'alko', name: 'Alko', country: 'FI' });
    const app = buildApp();

    const res = await request(app, authedEnv(d1), '/ops/console/governance', { headers: OPS });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.total).toBe(2);
    expect(body.items.map((m: Record<string, unknown>) => m.merchantId)).toEqual([
      'alko',
      'systembolaget',
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
  it('lists pending FX datasets with their rates (tax reviews fail-closed empty)', async () => {
    const { d1 } = openMigratedD1();
    const fx = new D1FxRateRepository(d1);
    await seedPendingFxDatasetAsync(fx, 'ecb-2026-08-28.1');
    const app = buildApp();

    const res = await request(app, authedEnv(d1), '/ops/console/confirmations', {
      headers: OPS,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.fx).toHaveLength(1);
    expect(body.fx[0]).toMatchObject({
      versionLabel: 'ecb-2026-08-28.1',
      status: 'PENDING_CONFIRMATION',
      sourceName: 'ecb-reference-rates',
      referenceDate: '2026-08-28',
    });
    expect(body.fx[0].rates).toEqual([
      { baseCurrency: 'EUR', quoteCurrency: 'SEK', rate: 11.2 },
    ]);
    expect(body.taxReviews).toEqual([]);
  });

  it('publishes a pending FX dataset: 404 unknown, 409 wrong state, 200 transition + audit', async () => {
    const { d1 } = openMigratedD1();
    const fx = new D1FxRateRepository(d1);
    // The currently effective (predecessor) dataset — already published.
    await fx.createDataset(
      {
        versionLabel: 'ecb-2026-08-21.1',
        sourceName: 'ecb-reference-rates',
        referenceDate: '2026-08-21',
        effectiveFrom: new Date('2026-08-22T00:00:00.000Z'),
        effectiveTo: null,
        status: 'PUBLISHED',
        confirmedBy: 'ops-0',
        confirmedAt: new Date('2026-08-21T12:00:00.000Z'),
      },
      [{ baseCurrency: 'EUR', quoteCurrency: 'SEK', rate: '11.10' }],
    );
    const pendingId = await seedPendingFxDatasetAsync(fx, 'ecb-2026-08-28.1');
    const app = buildApp();
    const env = authedEnv(d1);

    const missing = await request(app, env, '/ops/console/confirmations/fx/999/confirm', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ operator: 'ops-1' }),
    });
    await expectEnvelope(missing, 404, { message: 'FX dataset 999 not found' });

    // Publish the pending dataset — the ONLY PENDING → PUBLISHED path.
    const ok = await request(
      app,
      env,
      `/ops/console/confirmations/fx/${pendingId}/confirm`,
      {
        method: 'POST',
        headers: JSON_HDRS,
        body: JSON.stringify({ operator: 'ops-1', note: 'ECB rates verified' }),
      },
    );
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as Record<string, any>;
    expect(body).toMatchObject({
      id: pendingId,
      versionLabel: 'ecb-2026-08-28.1',
      status: 'PUBLISHED',
      invalidatedVersion: 'ecb-2026-08-21.1',
    });
    expect(body.confirmedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Republishing is an invalid transition (409).
    const again = await request(app, env, `/ops/console/confirmations/fx/${pendingId}/confirm`, {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ operator: 'ops-1' }),
    });
    await expectEnvelope(again, 409, {});

    // The action was audited to the durable D1 store.
    const trail = await request(app, env, '/ops/console/audit?limit=10', { headers: OPS });
    const trailBody = (await trail.json()) as Record<string, any>;
    const entry = trailBody.items.find(
      (e: Record<string, any>) => e.entityType === 'fx_rate_dataset',
    );
    expect(entry).toMatchObject({
      entityType: 'fx_rate_dataset',
      entityId: 'ecb-2026-08-28.1',
      action: 'confirmed',
      author: 'ops-1',
      reason: 'ECB rates verified',
    });
  });

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
         ) VALUES (?, 'fx_rate_dataset', ?, 'confirmed', 'ops-seed', 'seed', ?)`,
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
