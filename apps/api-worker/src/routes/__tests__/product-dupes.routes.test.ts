/**
 * Product dupes route tests (task 6.3, change product-roadmap-phases-1-4)
 * over the FULL app composition (createApp() + registerProductDupesRoutes
 * — the exact composition index.ts wires, flag gate + rate limit on the
 * route itself) on the fake-D1 harness.
 *
 * Pinning here: flag-off 403 (PRODUCER_DUPE_FINDER), the exact-key
 * matching contract (only PUBLISHED rows; a near-miss producer key
 * matches NOTHING — no fuzzy fallback), complete evidence on every
 * returned link, empty result = 200 with an empty list (never a 404),
 * unknown product = the product read route's 404 semantics, and the
 * per-IP DEFAULT rate-limit profile (60/min → 429 on the 61st).
 *
 * @module ProductDupesRoutesTest
 */

import { describe, it, expect } from 'vitest';
import {
  buildApp,
  expectEnvelope,
  lockedEnv,
  openMigratedD1,
  permissiveEnv,
  request,
  seedProduct,
} from './harness';
import { registerProductDupesRoutes } from '../product-dupes.routes';
import { D1ProducerLinksRepository } from '../../../../../packages/data-platform/src/repositories/d1/producer-links.repository';
import type { Env } from '../../env';
import type { D1DatabaseLike } from '../../../../../packages/data-platform/src/d1/executor';

/**
 * index.ts registers the dupes handler behind its route-level gate+
 * limiter (same slot as the other route ports); the test composition
 * mirrors that exactly.
 */
function dupesApp(): ReturnType<typeof buildApp> {
  const app = buildApp();
  registerProductDupesRoutes(app);
  return app;
}

function dupesEnv(d1: D1DatabaseLike, overrides: Partial<Env> = {}): Env {
  return permissiveEnv(d1, { ...overrides, FF_PRODUCER_DUPE_FINDER: 'true' });
}

interface DupeJson {
  siblingProductId: number;
  producerKey: string;
  manufacturer: string;
  sourceUrl: string;
  reviewer: string;
  reviewedAt: string;
}

interface DupesJson {
  dupes: DupeJson[];
}

async function getDupes(
  app: ReturnType<typeof buildApp>,
  env: Env,
  productId: number | string,
): Promise<Response> {
  return request(app, env, `/api/v1/products/${productId}/dupes`);
}

/** Seed products + one PUBLISHED link; both product references must exist (FKs). */
async function seedPublishedLink(
  d1: D1DatabaseLike,
  overrides: Partial<{
    alkoProductId: number;
    siblingProductId: number;
    producerKey: string;
    manufacturer: string;
    sourceUrl: string;
  }> = {},
): Promise<void> {
  const repo = new D1ProducerLinksRepository(d1);
  const created = await repo.create({
    alkoProductId: overrides.alkoProductId ?? 1,
    siblingProductId: overrides.siblingProductId ?? 2,
    producerKey: overrides.producerKey ?? '  Hartwall ',
    manufacturer: overrides.manufacturer ?? 'Hartwall Oyj',
    sourceUrl: overrides.sourceUrl ?? 'https://systembolaget.example/hartwall-lager',
    reviewer: 'curator@example.invalid',
    reviewedAt: '2026-09-01T12:00:00.000Z',
  });
  const published = await repo.publish(created.id);
  expect(published).not.toBeNull();
}

// ---------------------------------------------------------------------------
// Gate: flag-off 403 (PRODUCER_DUPE_FINDER)
// ---------------------------------------------------------------------------

describe('GET /api/v1/products/:id/dupes — gate', () => {
  it('rejects with 403 while PRODUCER_DUPE_FINDER is off (route 403 envelope shape)', async () => {
    const { d1 } = openMigratedD1();
    const app = dupesApp();
    const res = await getDupes(app, lockedEnv(d1), 1);
    await expectEnvelope(res, 403, {
      message: 'Feature "PRODUCER_DUPE_FINDER" is not enabled',
    });
  });
});

// ---------------------------------------------------------------------------
// Evidence-backed results — exact key, complete evidence, DRAFT invisible
// ---------------------------------------------------------------------------

describe('GET /api/v1/products/:id/dupes — evidence-backed results', () => {
  it('returns only PUBLISHED links matching the product manufacturer key, with complete evidence', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, name: 'Karjala III', manufacturer: 'Hartwall' });
    seedProduct(db, { id: 2, name: 'Lapin Kulta III', manufacturer: 'Hartwall' });
    seedProduct(db, { id: 3, name: 'Koff III', manufacturer: 'Hartwall' });
    // Published link for product 1 (key arrives unnormalized — stored normalized).
    await seedPublishedLink(d1, { alkoProductId: 1, siblingProductId: 2 });
    // DRAFT link for product 1 — work in progress, invisible to the public API.
    await new D1ProducerLinksRepository(d1).create({
      alkoProductId: 1,
      siblingProductId: 3,
      producerKey: 'hartwall',
      manufacturer: 'Hartwall Oyj',
      sourceUrl: 'https://systembolaget.example/koff',
      reviewer: 'curator@example.invalid',
      reviewedAt: '2026-09-02T12:00:00.000Z',
    });
    // Published link for ANOTHER product — must not leak into product 1.
    await seedPublishedLink(d1, { alkoProductId: 3, siblingProductId: 2 });

    const app = dupesApp();
    const res = await getDupes(app, dupesEnv(d1), 1);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DupesJson;

    // Exact shape — the complete evidence set and nothing else (data
    // minimization: no scoring/similarity field exists to return).
    expect(body.dupes).toEqual([
      {
        siblingProductId: 2,
        producerKey: 'hartwall',
        manufacturer: 'Hartwall Oyj',
        sourceUrl: 'https://systembolaget.example/hartwall-lager',
        reviewer: 'curator@example.invalid',
        reviewedAt: '2026-09-01T12:00:00.000Z',
      },
    ]);
  });

  it('matches by EXACT normalized key only — a near-miss key returns no links', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, manufacturer: 'Hartwall' });
    seedProduct(db, { id: 2, manufacturer: 'Hartwall' });
    // Curated under a DIFFERENT producer key ('hartwall oyj' ≠ 'hartwall').
    await seedPublishedLink(d1, {
      alkoProductId: 1,
      siblingProductId: 2,
      producerKey: 'Hartwall Oyj',
    });

    const app = dupesApp();
    const res = await getDupes(app, dupesEnv(d1), 1);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DupesJson;
    expect(body.dupes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Empty result and unknown product — the 200-empty vs 404 contract
// ---------------------------------------------------------------------------

describe('GET /api/v1/products/:id/dupes — empty result / unknown product', () => {
  it('returns 200 with an empty list when the product has no curated links (never a 404)', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 7, manufacturer: 'Olvi' });

    const app = dupesApp();
    const res = await getDupes(app, dupesEnv(d1), 7);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DupesJson;
    expect(body).toEqual({ dupes: [] });
  });

  it('rejects an unknown product id with the product-route 404 semantics', async () => {
    const { d1 } = openMigratedD1();
    const app = dupesApp();
    const res = await getDupes(app, dupesEnv(d1), 424242);
    await expectEnvelope(res, 404, { message: 'Product 424242 not found' });
  });

  it('rejects a non-integer product id with the ParseIntPipe 400 body', async () => {
    const { d1 } = openMigratedD1();
    const app = dupesApp();
    const res = await getDupes(app, dupesEnv(d1), 'not-a-number');
    await expectEnvelope(res, 400, { error: 'Bad Request' });
  });
});

// ---------------------------------------------------------------------------
// Rate-limit profile — DEFAULT, public unauthenticated read (60/min)
// ---------------------------------------------------------------------------

describe('GET /api/v1/products/:id/dupes — rate-limit profile', () => {
  it('admits sixty requests per minute per IP (DEFAULT) and rejects the sixty-first with 429', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, manufacturer: 'Hartwall' });
    seedProduct(db, { id: 2, manufacturer: 'Hartwall' });
    await seedPublishedLink(d1);
    const app = dupesApp();
    const env = dupesEnv(d1); // one shared env = one shared DO limiter bucket

    for (let i = 0; i < 60; i++) {
      const res = await getDupes(app, env, 1);
      expect(res.status).toBe(200);
    }

    const sixtyFirst = await getDupes(app, env, 1);
    await expectEnvelope(sixtyFirst, 429, { error: 'TooManyRequests' });
    expect(sixtyFirst.headers.get('Retry-After')).not.toBeNull();
  });
});
