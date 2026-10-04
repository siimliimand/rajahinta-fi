/**
 * Ops console route parity tests (task 3.8).
 *
 * Expectations ported from the ops suites:
 * - packages/application-api/src/ops/__tests__/ops-console.access.test.ts
 *   (deny-before-data: ops access),
 * - ops-governance.service.test.ts (list shape; grant/revoke/list now
 *   read/write the durable D1 source_governance store — covered in depth
 *   by ops.routes.governance.test.ts, task 2.2),
 * - ops-dataset-confirmation.service.test.ts (queue shape, tax review
 *   resolution, audit write),
 * - ops-correction-queue.service.test.ts / ops-audit-trail.service.test.ts
 *   (fail-closed queue; audit trail reads with limit clamps).
 *
 * Task 3.2 (change alko-reference-matching-pipeline) adds the
 * match-review surface to its siblings: the full queue lifecycle driven
 * through the console API from the matching pass's repository seam
 * (enqueue), the CONFIRMED/REJECTED history listings, blank-attribution
 * refusal (nothing decided, nothing audited), and guard fail-closed on
 * the four new paths. The focused error-mapping cases live in
 * ops.routes.match-review.test.ts (task 3.1).
 *
 * Task 5.1 (change transport-confidence-unlock) adds the offer
 * verification surface: attribution recorded, audit row written,
 * re-verify overwrites and re-audits, and the guard fails closed —
 * no token means no status change and no audit row.
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
  seedOffer,
  seedProduct,
} from './harness';
import { WorkerAuditService } from '../../adapters/audit';
import { D1ConsumptionNormsRepository } from '../../../../../packages/data-platform/src/repositories/d1/consumption-norms.repository';
import { D1MatchReviewRepository } from '../../../../../packages/data-platform/src/repositories/d1/match-review.repository';
import { D1ReferenceLinkRepository } from '../../../../../packages/data-platform/src/repositories/d1/reference-link.repository';
import type { MatchReviewEnqueueInput } from '../../../../../packages/data-platform/src/abstracts';

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

// ---------------------------------------------------------------------------
// Match-review queue (task 3.2, change alko-reference-matching-pipeline) —
// lifecycle, attribution, guard. The 3.1 file owns the focused
// error-mapping cases (404, re-decide 409, conflict→supersede); these
// cover the seams it doesn't: enqueue via the repository, the history
// listings, and the fail-closed attribution contract.
// ---------------------------------------------------------------------------

/** A scored candidate exactly as the matching pass emits it (design D2). */
function candidate(
  pair: { foreignProductId: number; alkoProductId: number; score: number },
  identity: Partial<Pick<MatchReviewEnqueueInput, 'foreignName' | 'alkoName'>> = {},
): MatchReviewEnqueueInput {
  return {
    ...pair,
    confidence: 'HIGH',
    matchMethod: 'fuzzy',
    foreignName: identity.foreignName ?? 'Karhu III 0,33 l  %4.7',
    foreignBrand: 'Karhu',
    foreignAbv: 4.7,
    foreignVolume: 0.33,
    alkoName: identity.alkoName ?? 'Karhu III',
    alkoBrand: 'Karhu',
    alkoAbv: 4.7,
    alkoVolume: 0.33,
  };
}

describe('match-review console lifecycle (enqueue → decide → history listings)', () => {
  it('walks queue → confirm → CONFIRMED views + live link → reject → REJECTED', async () => {
    const { db, d1 } = openMigratedD1();
    // Both sides FK to product_master — seed the parents first.
    for (const id of [7, 2, 9, 3]) seedProduct(db, { id });
    const reviews = new D1MatchReviewRepository(d1);
    const first = await reviews.enqueue(
      candidate({ foreignProductId: 7, alkoProductId: 2, score: 88 }),
    );
    const second = await reviews.enqueue(
      candidate(
        { foreignProductId: 9, alkoProductId: 3, score: 74 },
        { foreignName: 'Olvi III 0,5 l', alkoName: 'Olvi III' },
      ),
    );
    expect(first.outcome).toBe('created');
    expect(second.outcome).toBe('created');

    const app = buildApp();
    const env = authedEnv(d1);

    // The default view serves the pending queue, score-desc.
    const pending = await request(app, env, '/ops/console/match-review', { headers: OPS });
    expect(pending.status).toBe(200);
    const pendingBody = (await pending.json()) as Record<string, any>;
    expect(pendingBody.total).toBe(2);
    expect(pendingBody.items.map((r: Record<string, unknown>) => r.id)).toEqual([
      first.id,
      second.id,
    ]);

    const confirm = await request(app, env, `/ops/console/match-review/${first.id}/confirm`, {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ operator: 'ops-1', note: 'Same beer' }),
    });
    expect(confirm.status).toBe(200);
    const confirmedBody = (await confirm.json()) as Record<string, any>;
    expect(confirmedBody).toMatchObject({
      id: first.id,
      status: 'CONFIRMED',
      foreignProductId: 7,
      alkoProductId: 2,
    });
    const linkId = confirmedBody.linkId as number;

    // The queue drained to the undecided candidate; the decision history
    // and the repository's live-link sweep agree with the decision.
    const pendingAfter = await request(app, env, '/ops/console/match-review', { headers: OPS });
    expect(((await pendingAfter.json()) as Record<string, any>).total).toBe(1);

    const confirmedList = await request(
      app,
      env,
      '/ops/console/match-review?status=CONFIRMED',
      { headers: OPS },
    );
    const confirmedListBody = (await confirmedList.json()) as Record<string, any>;
    expect(confirmedListBody.total).toBe(1);
    expect(confirmedListBody.items[0]).toMatchObject({ id: first.id, status: 'CONFIRMED' });

    const liveLinks = await new D1ReferenceLinkRepository(d1).listConfirmed();
    expect(
      liveLinks.map((link) => ({
        id: link.id,
        foreignProductId: link.foreignProductId,
        alkoProductId: link.alkoProductId,
        confirmedBy: link.confirmedBy,
      })),
    ).toEqual([
      { id: linkId, foreignProductId: 7, alkoProductId: 2, confirmedBy: 'ops-1' },
    ]);

    const reject = await request(app, env, `/ops/console/match-review/${second.id}/reject`, {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ operator: 'ops-2' }),
    });
    expect(reject.status).toBe(200);
    expect((await reject.json()) as Record<string, any>).toMatchObject({
      id: second.id,
      status: 'REJECTED',
    });

    const rejectedList = await request(
      app,
      env,
      '/ops/console/match-review?status=REJECTED',
      { headers: OPS },
    );
    const rejectedListBody = (await rejectedList.json()) as Record<string, any>;
    expect(rejectedListBody.total).toBe(1);
    expect(rejectedListBody.items[0]).toMatchObject({ id: second.id, status: 'REJECTED' });
    const drained = await request(app, env, '/ops/console/match-review', { headers: OPS });
    expect(((await drained.json()) as Record<string, any>).total).toBe(0);

    // Decided is terminal across decisions too — confirming the REJECTED
    // candidate is the same immutability 409 as re-confirming a CONFIRMED one.
    const crossConfirm = await request(
      app,
      env,
      `/ops/console/match-review/${second.id}/confirm`,
      {
        method: 'POST',
        headers: JSON_HDRS,
        body: JSON.stringify({ operator: 'ops-2' }),
      },
    );
    await expectEnvelope(crossConfirm, 409, { error: 'InvalidTransition' });

    // Both decisions carry their operator into the append-only trail.
    const trail = await request(app, env, '/ops/console/audit?limit=10', { headers: OPS });
    const trailBody = (await trail.json()) as Record<string, any>;
    expect(trailBody.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'match_review',
          entityId: String(first.id),
          action: 'confirmed',
          author: 'ops-1',
        }),
        expect.objectContaining({
          entityType: 'match_review',
          entityId: String(second.id),
          action: 'updated',
          author: 'ops-2',
        }),
      ]),
    );
  });

  it('refuses blank attribution with 400 — candidate stays PENDING, no link, no audit', async () => {
    const { db, d1 } = openMigratedD1();
    for (const id of [7, 2]) seedProduct(db, { id });
    const enqueued = await new D1MatchReviewRepository(d1).enqueue(
      candidate({ foreignProductId: 7, alkoProductId: 2, score: 88 }),
    );
    const app = buildApp();
    const env = authedEnv(d1);

    for (const operator of ['', '   ']) {
      const confirm = await request(
        app,
        env,
        `/ops/console/match-review/${enqueued.id}/confirm`,
        {
          method: 'POST',
          headers: JSON_HDRS,
          body: JSON.stringify({ operator }),
        },
      );
      await expectEnvelope(confirm, 400, {
        message: 'operator must be a non-empty string (max 128 chars)',
      });

      const reject = await request(
        app,
        env,
        `/ops/console/match-review/${enqueued.id}/reject`,
        {
          method: 'POST',
          headers: JSON_HDRS,
          body: JSON.stringify({ operator }),
        },
      );
      await expectEnvelope(reject, 400, {
        message: 'operator must be a non-empty string (max 128 chars)',
      });
    }

    // Nothing moved: the candidate is still reviewable, unattributed, and
    // no decision artifacts (link or audit row) were written.
    const row = db
      .prepare('SELECT status, decided_by FROM match_review WHERE id = ?')
      .get(enqueued.id) as Record<string, unknown>;
    expect(row).toEqual({ status: 'PENDING', decided_by: null });
    expect(
      (db.prepare('SELECT count(*) AS n FROM product_reference_links').get() as { n: number }).n,
    ).toBe(0);
    expect(
      (
        db
          .prepare("SELECT count(*) AS n FROM audit_events WHERE entity_type = 'match_review'")
          .get() as { n: number }
      ).n,
    ).toBe(0);
  });
});

describe('match-review paths — deny before any data (ops guard fail-closed)', () => {
  it('403s the queue, confirm, reject, and supersede without OPS_BEARER_TOKEN', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const locked = lockedEnv(d1);

    const list = await request(app, locked, '/ops/console/match-review');
    await expectEnvelope(list, 403, { message: 'Forbidden' });

    for (const path of [
      '/ops/console/match-review/1/confirm',
      '/ops/console/match-review/1/reject',
      '/ops/console/reference-links/1/supersede',
    ]) {
      const res = await request(app, locked, path, {
        method: 'POST',
        headers: JSON_HDRS,
        body: JSON.stringify({ operator: 'ops-1' }),
      });
      await expectEnvelope(res, 403, { message: 'Forbidden' });
    }
  });
});

// ---------------------------------------------------------------------------
// Offer verification (task 5.1, transport-confidence-unlock) — the
// owner-gated human write path for VERIFIED (design D7).
// ---------------------------------------------------------------------------

/** Read an offer row straight from the store (assertions see raw DDL). */
function verifyOfferRow(
  db: import('node:sqlite').DatabaseSync,
  id: number,
): { reliability_status: string; verified_at: string | null; verified_by: string | null } {
  return db
    .prepare(
      'SELECT reliability_status, verified_at, verified_by FROM retail_offers WHERE id = ?',
    )
    .get(id) as { reliability_status: string; verified_at: string | null; verified_by: string | null };
}

describe('POST /ops/console/offers/:id/verify — the human VERIFIED write path', () => {
  it('sets VERIFIED with attribution and audits the decision', async () => {
    const { db, d1 } = openMigratedD1();
    const productId = seedProduct(db);
    // Offers are born ESTIMATED — the ingestion contract this endpoint
    // exists to supersede.
    const offerId = seedOffer(db, { productId, reliabilityStatus: 'ESTIMATED' });
    const app = buildApp();
    const env = authedEnv(d1);

    const res = await request(app, env, `/ops/console/offers/${offerId}/verify`, {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ operator: 'ops-1', note: 'price checked on alko.fi' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: offerId,
      merchant: 'alko',
      productId,
      reliabilityStatus: 'VERIFIED',
      verifiedAt: expect.any(String),
      verifiedBy: 'ops-1',
    });

    const row = verifyOfferRow(db, offerId);
    expect(row.reliability_status).toBe('VERIFIED');
    expect(row.verified_by).toBe('ops-1');
    expect(row.verified_at).toEqual(expect.any(String));

    const events = await new WorkerAuditService(d1).queryChanges({ limit: 10 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      entityType: 'retail_offer',
      entityId: String(offerId),
      action: 'confirmed',
      author: 'ops-1',
      reason: 'price checked on alko.fi',
      previousValue: { reliabilityStatus: 'ESTIMATED' },
    });
    expect(events[0]!.newValue).toEqual({
      reliabilityStatus: 'VERIFIED',
      verifiedAt: row.verified_at,
      verifiedBy: 'ops-1',
    });
  });

  it('requires operator attribution and 404s unknown offers — refusals write nothing', async () => {
    const { db, d1 } = openMigratedD1();
    const productId = seedProduct(db);
    const offerId = seedOffer(db, { productId, reliabilityStatus: 'ESTIMATED' });
    const app = buildApp();
    const env = authedEnv(d1);

    const noOperator = await request(
      app,
      env,
      `/ops/console/offers/${offerId}/verify`,
      {
        method: 'POST',
        headers: JSON_HDRS,
        body: JSON.stringify({ note: 'no operator named' }),
      },
    );
    await expectEnvelope(noOperator, 400, {
      message: expect.stringContaining('operator must be a non-empty string'),
    });

    const missing = await request(app, env, '/ops/console/offers/9999/verify', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ operator: 'ops-1' }),
    });
    await expectEnvelope(missing, 404, { message: 'Retail offer 9999 not found' });

    // Both refusals left the offer and the trail untouched.
    const row = verifyOfferRow(db, offerId);
    expect(row.reliability_status).toBe('ESTIMATED');
    expect(row.verified_at).toBeNull();
    expect(row.verified_by).toBeNull();
    expect(await new WorkerAuditService(d1).queryChanges({ limit: 10 })).toEqual([]);
  });

  it('re-verify overwrites the attribution and appends a fresh audit row', async () => {
    const { db, d1 } = openMigratedD1();
    const productId = seedProduct(db);
    const offerId = seedOffer(db, { productId, reliabilityStatus: 'ESTIMATED' });
    const app = buildApp();
    const env = authedEnv(d1);
    const verify = (operator: string) =>
      request(app, env, `/ops/console/offers/${offerId}/verify`, {
        method: 'POST',
        headers: JSON_HDRS,
        body: JSON.stringify({ operator }),
      });

    expect((await verify('ops-1')).status).toBe(200);
    const second = await verify('ops-2');
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { verifiedAt: string };

    // Re-verification overwrites the pair in place — there is no
    // un-verify, only a newer operator decision.
    const row = verifyOfferRow(db, offerId);
    expect(row.reliability_status).toBe('VERIFIED');
    expect(row.verified_by).toBe('ops-2');
    expect(row.verified_at).toBe(secondBody.verifiedAt);

    // Two decisions, two rows — history lives in the audit trail
    // (newest first), and a note-less verify takes the default reason.
    const events = await new WorkerAuditService(d1).queryChanges({ limit: 10 });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ author: 'ops-2', reason: 'Offer verified via operator console' });
    expect(events[1]).toMatchObject({ author: 'ops-1' });
  });
});

describe('offer verify path — deny before any data (ops guard fail-closed)', () => {
  it('403s without OPS_BEARER_TOKEN — no status change, no audit row', async () => {
    const { db, d1 } = openMigratedD1();
    const productId = seedProduct(db);
    const offerId = seedOffer(db, { productId, reliabilityStatus: 'ESTIMATED' });
    const app = buildApp();

    const res = await request(app, lockedEnv(d1), `/ops/console/offers/${offerId}/verify`, {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ operator: 'ops-1' }),
    });
    await expectEnvelope(res, 403, { message: 'Forbidden' });

    const row = verifyOfferRow(db, offerId);
    expect(row.reliability_status).toBe('ESTIMATED');
    expect(row.verified_at).toBeNull();
    expect(row.verified_by).toBeNull();
    expect(await new WorkerAuditService(d1).queryChanges({ limit: 10 })).toEqual([]);
  });
});
