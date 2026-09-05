/**
 * Operator-console producer-link route tests (task 6.1, change
 * product-roadmap-phases-1-4) over the FULL app composition
 * (createApp() — registerOpsRoutes rides the /ops/console guard prefix)
 * on the fake-D1 harness, mirroring the ferry-offer console tests.
 *
 * Pinning here: create lands DRAFT with a NORMALIZED producer key
 * echoed back, the audited one-way publish, DRAFT-only editability
 * (409 ImmutablePublishedLink once published), the mandatory deletion
 * reason, self-link rejection, the complete-evidence listing, and the
 * audit contract — entityType 'producer_link', one append-only event
 * per mutation, acting operator from the shared console operator
 * field. The matching path behind these rows is an exact normalized
 * producer-key lookup; no scoring/similarity field exists in the DTO
 * surface (spec: producer-matching).
 *
 * @module ProducerLinksRoutesTest
 */

import { describe, it, expect } from 'vitest';
import {
  buildApp,
  expectEnvelope,
  FAKE_OPS_TOKEN,
  openMigratedD1,
  permissiveEnv,
  request,
  seedProduct,
} from './harness';
import { D1AuditEventRepository } from '../../../../../packages/data-platform/src/repositories/d1/audit-event.repository';
import type { Env } from '../../env';
import type { D1DatabaseLike } from '../../../../../packages/data-platform/src/d1/executor';

const OPS = { authorization: `Bearer ${FAKE_OPS_TOKEN}` };
const OPS_JSON = { 'content-type': 'application/json', ...OPS };
const OPERATOR = 'ops@example.invalid';

function env(d1: D1DatabaseLike): Env {
  return permissiveEnv(d1);
}

/** The console DTO — the producer key arrives deliberately unnormalized. */
const LINK = {
  operator: OPERATOR,
  alkoProductId: 1,
  siblingProductId: 2,
  producerKey: '  Henri   COQUARD ',
  manufacturer: 'Henri Coquard S.A.S.',
  sourceUrl: 'https://systembolaget.example/produkt/coquard-bourgogne',
  reviewer: 'curator@example.invalid',
  reviewedAt: '2026-09-01T12:00:00.000Z',
};

function post(
  app: ReturnType<typeof buildApp>,
  e: Env,
  path: string,
  body: unknown,
): Promise<Response> {
  return request(app, e, path, {
    method: 'POST',
    headers: OPS_JSON,
    body: JSON.stringify(body),
  });
}

/** Create one link through the console and return its id + echoed body. */
async function createLink(
  app: ReturnType<typeof buildApp>,
  e: Env,
  overrides: Record<string, unknown> = {},
): Promise<{ id: number; status: string; producerKey: string }> {
  const res = await post(app, e, '/ops/console/producer-links', {
    ...LINK,
    ...overrides,
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { id: number; status: string; producerKey: string };
}

/**
 * Audit actions of one entity, compared ORDER-INSENSITIVELY: the
 * repository orders newest-first by timestamp with a random-UUID
 * tie-break, so same-millisecond writes have no deterministic
 * sequence. WHICH actions were audited (and by whom) is the contract
 * pinned here; the ordering discipline belongs to the audit repo's
 * own suite (ferry console-test parity).
 */
async function auditActions(d1: D1DatabaseLike): Promise<string[]> {
  const entries = await new D1AuditEventRepository(d1).query({
    entityType: 'producer_link',
  });
  for (const entry of entries) {
    expect(entry.entityType).toBe('producer_link');
    expect(entry.author).toBe(OPERATOR);
  }
  return entries.map((entry) => entry.action).sort();
}

describe('/ops/console/producer-links — audited CRUD', () => {
  it('creates a DRAFT with a normalized key, publishes it, and audits both actions', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    seedProduct(db, { id: 2, name: 'Bourgogne Rouge' });
    const app = buildApp();
    const e = env(d1);

    const created = await createLink(app, e);
    expect(created.status).toBe('DRAFT');
    // The echoed (and stored) key is normalized — the raw form is
    // never persisted (the exact-lookup contract).
    expect(created.producerKey).toBe('henri coquard');

    const published = await post(app, e, `/ops/console/producer-links/${created.id}/publish`, {
      operator: OPERATOR,
    });
    expect(published.status).toBe(200);
    expect(((await published.json()) as { status: string }).status).toBe('PUBLISHED');

    // The console listing carries the COMPLETE evidence (R9).
    const list = await request(app, e, '/ops/console/producer-links', {
      headers: OPS,
    });
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      items: {
        id: number;
        alkoProductId: number;
        siblingProductId: number;
        producerKey: string;
        manufacturer: string;
        sourceUrl: string;
        reviewer: string;
        reviewedAt: string;
        status: string;
      }[];
      total: number;
    };
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({
      id: created.id,
      alkoProductId: 1,
      siblingProductId: 2,
      producerKey: 'henri coquard',
      manufacturer: 'Henri Coquard S.A.S.',
      reviewer: 'curator@example.invalid',
      reviewedAt: '2026-09-01T12:00:00.000Z',
      status: 'PUBLISHED',
    });

    const rows = await new D1AuditEventRepository(d1).query({
      entityType: 'producer_link',
    });
    expect(rows.map((row) => row.action).sort()).toEqual(['confirmed', 'created']);
    for (const row of rows) {
      expect(row.entityType).toBe('producer_link');
      expect(row.entityId).toBe(String(created.id));
      expect(row.author).toBe(OPERATOR);
    }
  });

  it('updates a DRAFT link, refuses to update a PUBLISHED one (409), and audits the edit', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    seedProduct(db, { id: 2, name: 'Bourgogne Rouge' });
    const app = buildApp();
    const e = env(d1);

    const { id } = await createLink(app, e);

    const updated = await post(app, e, `/ops/console/producer-links/${id}`, {
      operator: OPERATOR,
      producerKey: 'Coquard  Henri',
      sourceUrl: 'https://systembolaget.example/produkt/coquard-v2',
    });
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as { producerKey: string }).producerKey).toBe(
      'coquard henri',
    );

    await post(app, e, `/ops/console/producer-links/${id}/publish`, {
      operator: OPERATOR,
    });
    const immutable = await post(app, e, `/ops/console/producer-links/${id}`, {
      operator: OPERATOR,
      sourceUrl: 'https://x.example/v2',
    });
    await expectEnvelope(immutable, 409, { error: 'ImmutablePublishedLink' });

    expect(await auditActions(d1)).toEqual(['confirmed', 'created', 'updated']);
  });

  it('deletes with a mandatory reason, removes the link, and audits the deletion', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    seedProduct(db, { id: 2, name: 'Bourgogne Rouge' });
    const app = buildApp();
    const e = env(d1);

    const { id } = await createLink(app, e);
    await post(app, e, `/ops/console/producer-links/${id}/publish`, {
      operator: OPERATOR,
    });

    // Reason mandatory.
    const noReason = await post(app, e, `/ops/console/producer-links/${id}/delete`, {
      operator: OPERATOR,
    });
    expect(noReason.status).toBe(400);

    const removed = await post(app, e, `/ops/console/producer-links/${id}/delete`, {
      operator: OPERATOR,
      reason: 'source no longer verifiable',
    });
    expect(removed.status).toBe(200);

    const list = await request(app, e, '/ops/console/producer-links', {
      headers: OPS,
    });
    expect(((await list.json()) as { total: number }).total).toBe(0);

    expect(await auditActions(d1)).toEqual(['confirmed', 'created', 'deleted']);
  });
});

describe('/ops/console/producer-links — validation', () => {
  it.each([
    ['sourceUrl', { sourceUrl: 'ftp://x.example' }],
    ['reviewedAt', { reviewedAt: 'not-a-timestamp' }],
    ['producerKey', { producerKey: '' }],
    ['self-link', { siblingProductId: 1 }],
    ['operator', { operator: '' }],
  ])('rejects a bad %s with 400', async (_label, overrides) => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    seedProduct(db, { id: 2, name: 'Bourgogne Rouge' });
    const app = buildApp();
    const res = await post(app, env(d1), '/ops/console/producer-links', {
      ...LINK,
      ...overrides,
    });
    expect(res.status).toBe(400);
  });

  it('answers 404 for mutations on an unknown id and 409 for a republish', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    seedProduct(db, { id: 2, name: 'Bourgogne Rouge' });
    const app = buildApp();
    const e = env(d1);

    await expectEnvelope(
      await post(app, e, '/ops/console/producer-links/999999', {
        operator: OPERATOR,
        producerKey: 'x',
      }),
      404,
      { message: 'Producer link 999999 not found' },
    );
    await expectEnvelope(
      await post(app, e, '/ops/console/producer-links/999999/publish', {
        operator: OPERATOR,
      }),
      404,
      { message: 'Producer link 999999 not found' },
    );
    await expectEnvelope(
      await post(app, e, '/ops/console/producer-links/999999/delete', {
        operator: OPERATOR,
        reason: 'cleanup',
      }),
      404,
      { message: 'Producer link 999999 not found' },
    );

    const { id } = await createLink(app, e);
    await post(app, e, `/ops/console/producer-links/${id}/publish`, {
      operator: OPERATOR,
    });
    // PUBLISHED is terminal — republish is a 409, not a silent no-op.
    await expectEnvelope(
      await post(app, e, `/ops/console/producer-links/${id}/publish`, {
        operator: OPERATOR,
      }),
      409,
      { error: 'InvalidTransition' },
    );
  });
});
