/**
 * Ops console match-review surface (task 3.1, change
 * alko-reference-matching-pipeline; design D2) — the side-by-side queue
 * listing, the attributed confirm/reject decisions driven through the
 * REAL D1 repositories on the node:sqlite migrated database, and the
 * typed error mapping (404 unknown, 409 already-decided, 409 per-side
 * link conflict + the supersede that unblocks it). Guard fail-closed is
 * asserted for the new paths — they ride the same /ops/console/*
 * opsAccess() prefix (bearer fail-closed, IP allowlist honored).
 *
 * @module OpsRoutesMatchReviewTest
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
  seedProduct,
} from './harness';

const OPS = { authorization: `Bearer ${FAKE_OPS_TOKEN}` };
const JSON_HDRS = { 'content-type': 'application/json', ...OPS };

function authedEnv(d1: Parameters<typeof permissiveEnv>[0]): ReturnType<typeof permissiveEnv> {
  return permissiveEnv(d1);
}

/**
 * Insert a PENDING match_review row exactly as the matching pass's
 * repository writes it (both sides' identity frozen at enqueue). Both
 * sides carry FKs to product_master — seed the parents first.
 */
function seedReview(
  db: import('node:sqlite').DatabaseSync,
  review: {
    foreignProductId: number;
    alkoProductId: number;
    confidence?: string;
    matchMethod?: string;
    score: number;
    foreignName: string;
    foreignBrand?: string | null;
    foreignAbv?: number | null;
    foreignVolume?: number | null;
    alkoName: string;
    alkoBrand?: string | null;
    alkoAbv?: number | null;
    alkoVolume?: number | null;
  },
): number {
  const row = db
    .prepare(
      `INSERT INTO match_review (
         foreign_product_id, alko_product_id, confidence, match_method, score,
         foreign_name, foreign_brand, foreign_abv, foreign_volume,
         alko_name, alko_brand, alko_abv, alko_volume
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      review.foreignProductId,
      review.alkoProductId,
      review.confidence ?? 'HIGH',
      review.matchMethod ?? 'fuzzy',
      review.score,
      review.foreignName,
      review.foreignBrand ?? null,
      review.foreignAbv ?? null,
      review.foreignVolume ?? null,
      review.alkoName,
      review.alkoBrand ?? null,
      review.alkoAbv ?? null,
      review.alkoVolume ?? null,
    );
  return Number(row.lastInsertRowid);
}

describe('match-review surface — deny before any data (guard fail-closed)', () => {
  it('403s every new path without credentials, serves with the bearer', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const locked = lockedEnv(d1);

    const list = await request(app, locked, '/ops/console/match-review');
    await expectEnvelope(list, 403, { message: 'Forbidden' });

    const confirm = await request(app, locked, '/ops/console/match-review/1/confirm', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ operator: 'ops-1' }),
    });
    await expectEnvelope(confirm, 403, { message: 'Forbidden' });

    const reject = await request(app, locked, '/ops/console/match-review/1/reject', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ operator: 'ops-1' }),
    });
    await expectEnvelope(reject, 403, { message: 'Forbidden' });

    const supersede = await request(
      app,
      locked,
      '/ops/console/reference-links/1/supersede',
      {
        method: 'POST',
        headers: JSON_HDRS,
        body: JSON.stringify({ operator: 'ops-1' }),
      },
    );
    await expectEnvelope(supersede, 403, { message: 'Forbidden' });

    // Configured → the queue serves (empty).
    const ok = await request(app, authedEnv(d1), '/ops/console/match-review', {
      headers: OPS,
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ items: [], total: 0 });
  });
});

describe('GET /ops/console/match-review — side-by-side queue', () => {
  it('lists both universes side by side, deterministic order, status filter', async () => {
    const { db, d1 } = openMigratedD1();
    for (const id of [7, 2, 9, 3, 10, 4]) seedProduct(db, { id });
    const lower = seedReview(db, {
      foreignProductId: 7,
      alkoProductId: 2,
      score: 82,
      confidence: 'HIGH',
      matchMethod: 'fuzzy',
      foreignName: 'Karhu III 0,33 l  %4.7',
      foreignBrand: 'Karhu',
      foreignAbv: 4.7,
      foreignVolume: 0.33,
      alkoName: 'Karhu III',
      alkoBrand: 'Karhu',
      alkoAbv: 4.7,
      alkoVolume: 0.33,
    });
    const higher = seedReview(db, {
      foreignProductId: 9,
      alkoProductId: 3,
      score: 91,
      confidence: 'MEDIUM',
      foreignName: 'Olvi III 0,33 l',
      alkoName: 'Olvi III',
    });
    // A decided row must leave the default (PENDING) view.
    db.prepare(
      `UPDATE match_review SET status = 'REJECTED',
         decided_by = 'ops-seed', decided_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      new Date().toISOString(),
      new Date().toISOString(),
      seedReview(db, {
        foreignProductId: 10,
        alkoProductId: 4,
        score: 50,
        foreignName: 'Lapin Kulta',
        alkoName: 'Lapin Kulta I',
      }),
    );

    const app = buildApp();
    const env = authedEnv(d1);

    const res = await request(app, env, '/ops/console/match-review', { headers: OPS });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.total).toBe(2);
    // Repository order: score DESC (review triage), pair ids as tiebreakers.
    expect(body.items.map((r: Record<string, any>) => r.id)).toEqual([higher, lower]);

    const [first] = body.items;
    expect(first).toMatchObject({
      id: higher,
      status: 'PENDING',
      foreign: {
        productId: 9,
        name: 'Olvi III 0,33 l',
        brand: null,
        abv: null,
        volume: null,
      },
      alko: { productId: 3, name: 'Olvi III', brand: null, abv: null, volume: null },
      confidence: 'MEDIUM',
      method: 'fuzzy',
      score: 91,
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });

    const rejected = await request(app, env, '/ops/console/match-review?status=REJECTED', {
      headers: OPS,
    });
    const rejectedBody = (await rejected.json()) as Record<string, any>;
    expect(rejectedBody.total).toBe(1);
    expect(rejectedBody.items[0].status).toBe('REJECTED');

    const bad = await request(app, env, '/ops/console/match-review?status=BOGUS', {
      headers: OPS,
    });
    await expectEnvelope(bad, 400, { error: 'ValidationError' });
  });
});

describe('POST /ops/console/match-review/:id/confirm — the trust gate', () => {
  it('promotes PENDING → CONFIRMED link + decided row, attributed and audited', async () => {
    const { db, d1 } = openMigratedD1();
    for (const id of [7, 2]) seedProduct(db, { id });
    const reviewId = seedReview(db, {
      foreignProductId: 7,
      alkoProductId: 2,
      score: 88,
      foreignName: 'Karhu III 0,33 l  %4.7',
      foreignBrand: 'Karhu',
      foreignAbv: 4.7,
      foreignVolume: 0.33,
      alkoName: 'Karhu III',
      alkoBrand: 'Karhu',
      alkoAbv: 4.7,
      alkoVolume: 0.33,
    });
    const app = buildApp();
    const env = authedEnv(d1);

    const ok = await request(app, env, `/ops/console/match-review/${reviewId}/confirm`, {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ operator: 'ops-1', note: 'Same beer' }),
    });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as Record<string, any>;
    expect(body).toMatchObject({
      id: reviewId,
      status: 'CONFIRMED',
      foreignProductId: 7,
      alkoProductId: 2,
      confirmedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(body.linkId).toBeGreaterThan(0);

    // The link exists, attributed; the review row flipped, attributed.
    const link = db
      .prepare(
        `SELECT foreign_product_id, alko_product_id, status, confirmed_by
           FROM product_reference_links WHERE id = ?`,
      )
      .get(body.linkId) as Record<string, unknown>;
    expect(link).toEqual({
      foreign_product_id: 7,
      alko_product_id: 2,
      status: 'CONFIRMED',
      confirmed_by: 'ops-1',
    });
    const review = db
      .prepare('SELECT status, decided_by FROM match_review WHERE id = ?')
      .get(reviewId) as Record<string, unknown>;
    expect(review).toEqual({ status: 'CONFIRMED', decided_by: 'ops-1' });

    // The audit row carries the operator and the decision facts.
    const trail = await request(app, env, '/ops/console/audit?limit=10', { headers: OPS });
    const trailBody = (await trail.json()) as Record<string, any>;
    expect(trailBody.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'match_review',
          entityId: String(reviewId),
          action: 'confirmed',
          author: 'ops-1',
        }),
      ]),
    );

    // Decided rows are immutable — a second confirm is a 409.
    const again = await request(app, env, `/ops/console/match-review/${reviewId}/confirm`, {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ operator: 'ops-1' }),
    });
    await expectEnvelope(again, 409, { error: 'InvalidTransition' });
  });

  it('validates the operator pair and 404s unknown candidates', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = authedEnv(d1);

    const noOperator = await request(app, env, '/ops/console/match-review/1/confirm', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({}),
    });
    await expectEnvelope(noOperator, 400, {
      message: 'operator must be a non-empty string (max 128 chars)',
    });

    const missing = await request(app, env, '/ops/console/match-review/999/confirm', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ operator: 'ops-1' }),
    });
    await expectEnvelope(missing, 404, { message: 'Match review 999 not found' });
  });
});

describe('POST /ops/console/match-review/:id/reject — calibration decision', () => {
  it('flips the row REJECTED with attribution, creates NO link, audits', async () => {
    const { db, d1 } = openMigratedD1();
    for (const id of [7, 2]) seedProduct(db, { id });
    const reviewId = seedReview(db, {
      foreignProductId: 7,
      alkoProductId: 2,
      score: 31,
      confidence: 'LOW',
      foreignName: 'Koff III',
      alkoName: 'Karhu III',
    });
    const app = buildApp();
    const env = authedEnv(d1);

    const ok = await request(app, env, `/ops/console/match-review/${reviewId}/reject`, {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ operator: 'ops-2', note: 'Different product' }),
    });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as Record<string, any>;
    expect(body).toMatchObject({
      id: reviewId,
      status: 'REJECTED',
      foreignProductId: 7,
      alkoProductId: 2,
      decidedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });

    // No link was created — a reject is a calibration record only.
    expect(
      (db.prepare('SELECT count(*) AS n FROM product_reference_links').get() as { n: number }).n,
    ).toBe(0);
    const review = db
      .prepare('SELECT status, decided_by FROM match_review WHERE id = ?')
      .get(reviewId) as Record<string, unknown>;
    expect(review).toEqual({ status: 'REJECTED', decided_by: 'ops-2' });

    const trail = await request(app, env, '/ops/console/audit?limit=10', { headers: OPS });
    const trailBody = (await trail.json()) as Record<string, any>;
    expect(trailBody.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'match_review',
          entityId: String(reviewId),
          action: 'updated',
          author: 'ops-2',
        }),
      ]),
    );

    const again = await request(app, env, `/ops/console/match-review/${reviewId}/reject`, {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ operator: 'ops-2' }),
    });
    await expectEnvelope(again, 409, { error: 'InvalidTransition' });
  });
});

describe('per-side link conflict → 409 names the blocking link; supersede unblocks', () => {
  it('keeps the candidate PENDING on conflict, supersedes, then confirms', async () => {
    const { db, d1 } = openMigratedD1();
    for (const id of [7, 2, 9]) seedProduct(db, { id });
    const app = buildApp();
    const env = authedEnv(d1);

    // First candidate confirms cleanly: 7 → 2.
    const first = seedReview(db, {
      foreignProductId: 7,
      alkoProductId: 2,
      score: 90,
      foreignName: 'Karhu III',
      alkoName: 'Karhu III',
    });
    const confirmed = await request(app, env, `/ops/console/match-review/${first}/confirm`, {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ operator: 'ops-1' }),
    });
    const confirmedBody = (await confirmed.json()) as Record<string, any>;
    const liveLinkId = confirmedBody.linkId as number;

    // A second candidate for the SAME Alko side: 9 → 2. The partial
    // unique index on the Alko side refuses the second live link.
    const second = seedReview(db, {
      foreignProductId: 9,
      alkoProductId: 2,
      score: 74,
      foreignName: 'Olvi III',
      alkoName: 'Karhu III',
    });
    const conflict = await request(app, env, `/ops/console/match-review/${second}/confirm`, {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ operator: 'ops-1' }),
    });
    const conflictBody = await expectEnvelope(conflict, 409, {
      error: 'ReferenceLinkConflict',
    });
    expect(conflictBody.conflictingLink).toMatchObject({
      id: liveLinkId,
      foreignProductId: 7,
      alkoProductId: 2,
      confirmedBy: 'ops-1',
    });
    // The whole promotion rolled back — the candidate stays reviewable.
    const stuck = db
      .prepare('SELECT status FROM match_review WHERE id = ?')
      .get(second) as Record<string, unknown>;
    expect(stuck).toEqual({ status: 'PENDING' });

    // Supersede the blocking link, then the confirm goes through.
    const superseded = await request(
      app,
      env,
      `/ops/console/reference-links/${liveLinkId}/supersede`,
      {
        method: 'POST',
        headers: JSON_HDRS,
        body: JSON.stringify({ operator: 'ops-1', note: 'Wrong pair' }),
      },
    );
    expect(superseded.status).toBe(200);
    expect(await superseded.json()).toMatchObject({
      id: liveLinkId,
      status: 'SUPERSEDED',
      foreignProductId: 7,
      alkoProductId: 2,
    });

    const retry = await request(app, env, `/ops/console/match-review/${second}/confirm`, {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ operator: 'ops-1' }),
    });
    expect(retry.status).toBe(200);
    expect((await retry.json()) as Record<string, any>).toMatchObject({
      id: second,
      status: 'CONFIRMED',
      linkId: expect.any(Number),
    });
    expect(
      (
        db
          .prepare(
            `SELECT count(*) AS n FROM product_reference_links WHERE status = 'CONFIRMED'`,
          )
          .get() as { n: number }
      ).n,
    ).toBe(1);

    // Superseding again (or an unknown id) is the same terminal 404.
    const gone = await request(
      app,
      env,
      `/ops/console/reference-links/${liveLinkId}/supersede`,
      {
        method: 'POST',
        headers: JSON_HDRS,
        body: JSON.stringify({ operator: 'ops-1' }),
      },
    );
    await expectEnvelope(gone, 404, {
      message: `Reference link ${liveLinkId} not found or not live (SUPERSEDED is terminal)`,
    });
  });
});
