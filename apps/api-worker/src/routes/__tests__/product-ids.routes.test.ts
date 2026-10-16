/**
 * Product-id enumeration route tests (task 1.1, change
 * sitemap-tree-coverage).
 *
 * Covers the task's verification list end-to-end over the real app +
 * fake-D1 harness: gate, slice ordering/stability/no-overlap across
 * successive offset pages, lastmod truth vs fixture rows, the 5,000
 * limit clamp (over-ask serves the cap, never an error), listing-universe
 * scoping (held/quarantined rows never enumerate), and an honest error
 * when the read fails.
 *
 * The aggregate-query cost measurement that feeds the D5 fallback
 * decision lives with the repository read
 * (product-id-slice.repository.test.ts + the SQL constant's doc block).
 *
 * @module ProductIdsRoutesTest
 */

import { describe, it, expect } from 'vitest';
import {
  buildApp,
  expectEnvelope,
  openMigratedD1,
  permissiveEnv,
  request,
  seedOffer,
  seedProduct,
} from './harness';
import type { D1DatabaseLike } from '../../../../../packages/data-platform/src/d1/executor';

const AGE = { 'x-age-confirmed': 'confirmed' };

/** Set a product row's updated_at to a controlled instant (fixture truth). */
function setUpdatedAt(
  db: ReturnType<typeof openMigratedD1>['db'],
  id: number,
  updatedAt: string,
): void {
  db.prepare('UPDATE product_master SET updated_at = ? WHERE id = ?').run(
    updatedAt,
    id,
  );
}

interface IdsResponse {
  items: Array<{ id: number; lastmod: string }>;
  total: number;
}

describe('GET /api/v1/products/ids (sitemap enumeration)', () => {
  it('is guarded by the age gate (products-listing parity)', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();

    const noAge = await request(
      app,
      permissiveEnv(d1),
      '/api/v1/products/ids',
    );
    await expectEnvelope(noAge, 403, {
      message: expect.stringMatching(/age confirmation required/i),
      code: 'AGE_GATE_REQUIRED',
    });
  });

  it('serves the literal path — never captured by /api/v1/products/:id', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    const app = buildApp();

    // A :id capture would 400 with ParseIntPipe's validation body.
    const res = await request(
      app,
      permissiveEnv(d1),
      '/api/v1/products/ids?limit=1',
      { headers: AGE },
    );
    expect(res.status).toBe(200);
  });

  it('returns id-ordered items with the exact total', async () => {
    const { db, d1 } = openMigratedD1();
    // Deliberately out of insertion order; the slice orders by id.
    seedProduct(db, { id: 3, name: 'C' });
    seedProduct(db, { id: 1, name: 'A' });
    seedProduct(db, { id: 2, name: 'B' });
    const app = buildApp();

    const res = await request(
      app,
      permissiveEnv(d1),
      '/api/v1/products/ids?limit=2',
      { headers: AGE },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as IdsResponse;
    expect(body.total).toBe(3);
    expect(body.items.map((i) => i.id)).toEqual([1, 2]);
    // lastmod is a stored-instant string, never a generation-time value.
    for (const item of body.items) {
      expect(item.lastmod).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it('slices stably with no overlap across successive offset pages', async () => {
    const { db, d1 } = openMigratedD1();
    for (let id = 1; id <= 25; id += 1) {
      seedProduct(db, { id, name: `Product ${id}` });
    }
    const app = buildApp();

    const fetchSlice = async (offset: number): Promise<IdsResponse> => {
      const res = await request(
        app,
        permissiveEnv(d1),
        `/api/v1/products/ids?offset=${offset}&limit=10`,
        { headers: AGE },
      );
      expect(res.status).toBe(200);
      return (await res.json()) as IdsResponse;
    };

    const page1 = await fetchSlice(0);
    const page2 = await fetchSlice(10);
    const page3 = await fetchSlice(20);
    expect(page1.total).toBe(25);
    expect(page2.total).toBe(25);
    expect(page3.total).toBe(25);

    const all = [...page1.items, ...page2.items, ...page3.items].map(
      (i) => i.id,
    );
    // Full coverage, strictly ascending, zero overlap.
    expect(all).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    // Stability: the same slice request answers identically.
    expect(await fetchSlice(10)).toEqual(page2);
    // A past-the-end offset serves an empty slice with the true total.
    const page4 = await fetchSlice(25);
    expect(page4.items).toEqual([]);
    expect(page4.total).toBe(25);
  });

  it('reports truthful lastmod: freshest offer wins over row update; offers older than the row keep updated_at; offer-less rows keep updated_at', async () => {
    const { db, d1 } = openMigratedD1();
    const ROW_UPDATED_AT = '2026-03-01T00:00:00.000Z';

    // 1: freshest offer (2026-04) is later than the row update → offer ts.
    seedProduct(db, { id: 1 });
    setUpdatedAt(db, 1, ROW_UPDATED_AT);
    seedOffer(db, {
      id: 11,
      productId: 1,
      observedAt: '2026-04-01T12:00:00.000Z',
    });
    seedOffer(db, {
      id: 12,
      productId: 1,
      observedAt: '2026-02-01T12:00:00.000Z',
    });

    // 2: every offer (2026-01) is older than the row update → updated_at.
    seedProduct(db, { id: 2 });
    setUpdatedAt(db, 2, ROW_UPDATED_AT);
    seedOffer(db, {
      id: 21,
      productId: 2,
      observedAt: '2026-01-15T00:00:00.000Z',
    });

    // 3: no offers at all → updated_at (D5's per-row fallback level).
    seedProduct(db, { id: 3 });
    setUpdatedAt(db, 3, ROW_UPDATED_AT);

    const app = buildApp();
    const res = await request(
      app,
      permissiveEnv(d1),
      '/api/v1/products/ids',
      { headers: AGE },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as IdsResponse;
    const byId = new Map(body.items.map((i) => [i.id, i.lastmod]));

    expect(byId.get(1)).toBe('2026-04-01T12:00:00.000Z');
    expect(byId.get(2)).toBe(ROW_UPDATED_AT);
    expect(byId.get(3)).toBe(ROW_UPDATED_AT);
  });

  it('excludes rows outside the listing universe from items and total', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    // Held for review (0029): outside every listing surface.
    seedProduct(db, { id: 2 });
    db.prepare(
      "UPDATE product_master SET review_hold_reason = 'nonalcoholic_in_alcohol_category' WHERE id = 2",
    ).run();
    // Quarantined by the name gate (0037): excluded from listings.
    seedProduct(db, { id: 3 });
    db.prepare(
      "UPDATE product_master SET name_quality = 'quarantined' WHERE id = 3",
    ).run();

    const app = buildApp();
    const res = await request(
      app,
      permissiveEnv(d1),
      '/api/v1/products/ids',
      { headers: AGE },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as IdsResponse;
    expect(body.total).toBe(1);
    expect(body.items.map((i) => i.id)).toEqual([1]);
  });

  it('clamps an over-ask limit at 5,000 without error, and defaults the absent limit to the same cap', async () => {
    const { db, d1 } = openMigratedD1();
    for (let id = 1; id <= 5_001; id += 1) {
      seedProduct(db, { id, name: `Product ${id}` });
    }
    const app = buildApp();

    const overAsk = await request(
      app,
      permissiveEnv(d1),
      '/api/v1/products/ids?limit=999999',
      { headers: AGE },
    );
    expect(overAsk.status).toBe(200);
    const clamped = (await overAsk.json()) as IdsResponse;
    expect(clamped.total).toBe(5_001);
    expect(clamped.items).toHaveLength(5_000);
    expect(clamped.items[0]!.id).toBe(1);
    expect(clamped.items[4_999]!.id).toBe(5_000);

    // The capped slices still partition the catalog with no overlap.
    const rest = await request(
      app,
      permissiveEnv(d1),
      '/api/v1/products/ids?offset=5000&limit=999999',
      { headers: AGE },
    );
    expect(rest.status).toBe(200);
    const tail = (await rest.json()) as IdsResponse;
    expect(tail.items.map((i) => i.id)).toEqual([5_001]);

    // Absent limit = the same 5,000 default.
    const absent = await request(app, permissiveEnv(d1), '/api/v1/products/ids', {
      headers: AGE,
    });
    expect(absent.status).toBe(200);
    expect(((await absent.json()) as IdsResponse).items).toHaveLength(5_000);
  });

  it('surfaces a read failure as an honest 500, never a partial payload', async () => {
    const { db } = openMigratedD1();
    seedProduct(db, { id: 1 });
    const app = buildApp();
    // The failure happens at READ time (the batched statements reject) —
    // the shape a real D1 outage presents.
    const failingStatement = {
      bind: () => failingStatement,
      all: async () => {
        throw new Error('d1 read failed');
      },
    };
    const failingD1 = {
      prepare: () => failingStatement,
      batch: async () => {
        throw new Error('d1 read failed');
      },
    } as unknown as D1DatabaseLike;

    const res = await request(app, permissiveEnv(failingD1), '/api/v1/products/ids', {
      headers: AGE,
    });
    await expectEnvelope(res, 500, { message: 'd1 read failed' });
  });
});
