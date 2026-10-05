/**
 * Search + declaration route parity tests (task 3.5).
 *
 * Expectations ported from:
 * - packages/application-api/src/search/__tests__/search.controller.test.ts
 *   (list/search/ids/pagination/sort + detail shapes),
 * - packages/application-api/src/declaration/__tests__/declaration.controller.test.ts
 *   (handler paths; the composed route's entitlement admits FREE callers
 *   since the all-FREE policy — records persist no classification, so the
 *   summary degrades factually: no derived advance-notice obligation and a
 *   null liability notice, pinned on a bare app below).
 *
 * @module SearchDeclarationRoutesTest
 */

import { describe, it, expect } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import {
  buildApp,
  createApp,
  expectEnvelope,
  issueSessionToken,
  openMigratedD1,
  permissiveEnv,
  request,
  seedAccount,
  seedCalculationRecord,
  seedMerchant,
  seedOffer,
  seedProduct,
} from './harness';
import { registerDeclarationRoutes } from '../declaration.routes';
import { respondToError } from '../../errors';
import type { AppEnv, Env } from '../../env';
import { errorBoundary } from '../../middleware/error-boundary';
import { openMigratedD1 as freshD1 } from '../../analytics/__tests__/fake-d1';

const AGE = { 'x-age-confirmed': 'confirmed' };

describe('GET /api/v1/products (search)', () => {
  it('is guarded by the age gate', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();

    const noAge = await request(app, permissiveEnv(d1), '/api/v1/products');
    await expectEnvelope(noAge, 403, {
      message: expect.stringMatching(/age confirmation required/i),
    });
  });

  it('lists products alphabetically with pagination metadata', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, name: 'Karhu III' });
    seedProduct(db, { id: 2, name: 'Bock Svec' });
    const app = buildApp();

    // Explicit ALPHABETICAL: the absent-sort default is LOWEST_PRICE
    // since task 1.3 (change first-impression-pass) — the name order is
    // now an explicit contract, never the default.
    const res = await request(
      app,
      permissiveEnv(d1),
      '/api/v1/products?sort=ALPHABETICAL',
      { headers: AGE },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ id: number; name: string; lowestPriceCents: number | null }>;
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };

    expect(body.total).toBe(2);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.totalPages).toBe(1);
    expect(body.items.map((i) => i.name)).toEqual([...body.items.map((i) => i.name)].sort());
    // The item projection carries the Phase 1 nulls verbatim.
    expect(body.items[0]!.lowestPriceCents).toBeNull();
  });

  it('ranks free-text queries (golden query parity: karhu)', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, name: 'Karhu III' });
    seedProduct(db, { id: 2, name: 'Koff III' });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/products?q=karhu', {
      headers: AGE,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: number }>; total: number };
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.items[0]!.id).toBe(1);
  });

  it('fetches by ids with name ordering and ignores q (ids precedence)', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, name: 'Karhu III' });
    seedProduct(db, { id: 2, name: 'Bock Svec' });
    const app = buildApp();

    const res = await request(
      app,
      permissiveEnv(d1),
      '/api/v1/products?ids=1,2&q=bock&sort=ALPHABETICAL',
      { headers: AGE },
    );
    const body = (await res.json()) as { items: Array<{ id: number; name: string }>; total: number };
    expect(body.total).toBe(2);
    expect(body.items.map((i) => i.id)).toEqual([2, 1]); // alphabetical, not rank order
  });

  it('paginates deterministically and caps the page size at 100', async () => {
    const { db, d1 } = openMigratedD1();
    for (let i = 1; i <= 5; i++) {
      seedProduct(db, { id: i, name: `Product ${String(i).padStart(2, '0')}` });
    }
    const app = buildApp();

    const page = await request(app, permissiveEnv(d1), '/api/v1/products?page=2&limit=2', {
      headers: AGE,
    });
    const pageBody = (await page.json()) as {
      items: Array<{ id: number }>;
      total: number;
      totalPages: number;
    };
    expect(pageBody.total).toBe(5);
    expect(pageBody.totalPages).toBe(3);
    expect(pageBody.items).toHaveLength(2);

    const capped = await request(app, permissiveEnv(d1), '/api/v1/products?limit=500', {
      headers: AGE,
    });
    const cappedBody = (await capped.json()) as { limit: number };
    expect(cappedBody.limit).toBe(100);
  });

  it('rejects an unknown sort value with 400 — never a silent fallback (task 1.2)', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const res = await request(
      app,
      permissiveEnv(d1),
      '/api/v1/products?sort=LOWEST_LANDED_COST',
      { headers: AGE },
    );
    // The unknown-sort treatment matches the unknown-category contract:
    // unified envelope, the offending value echoed, the valid set named.
    await expectEnvelope(res, 400, {
      message:
        "Unknown sort 'LOWEST_LANDED_COST'. Valid sort orders: ALPHABETICAL, LOWEST_PRICE, ALCOHOL_PERCENTAGE.",
    });
  });

  it('rejects the spec-name unknown sort value (PROMOTED) the same way', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const res = await request(app, permissiveEnv(d1), '/api/v1/products?sort=PROMOTED', {
      headers: AGE,
    });
    await expectEnvelope(res, 400, {
      message:
        "Unknown sort 'PROMOTED'. Valid sort orders: ALPHABETICAL, LOWEST_PRICE, ALCOHOL_PERCENTAGE.",
    });
  });
});

describe('GET /api/v1/products — server-side sort (task 1.2, change client-experience-improvement)', () => {
  /**
   * Catalog fixture: four priced products with distinct lowest prices, a
   * price tie (ids 5/6) and one offer-less product — the offer-less row
   * must sort LAST, never fabricated into the priced order.
   */
  function seedSortCatalog(db: DatabaseSync): void {
    seedProduct(db, { id: 1, name: 'Karhu III', alcoholByVolume: 0.047, unitVolume: 0.33 });
    seedOffer(db, { id: 11, productId: 1, merchant: 'alko', priceCents: 350 });
    seedProduct(db, { id: 2, name: 'Koff III', alcoholByVolume: 0.035, unitVolume: 0.33 });
    seedOffer(db, { id: 21, productId: 2, merchant: 'alko', priceCents: 250 });
    seedProduct(db, { id: 3, name: 'Sandels IVA', alcoholByVolume: 0.053, unitVolume: 0.5 });
    seedOffer(db, { id: 31, productId: 3, merchant: 'alko', priceCents: 480 });
    seedProduct(db, { id: 4, name: 'Lapin Kulta', alcoholByVolume: 0.043, unitVolume: 0.33 });
    seedOffer(db, { id: 41, productId: 4, merchant: 'alko', priceCents: 350 });
    seedProduct(db, { id: 5, name: 'Olvi I', alcoholByVolume: 0.047, unitVolume: 0.33 });
    seedOffer(db, { id: 51, productId: 5, merchant: 'alko', priceCents: 290 });
    seedProduct(db, { id: 6, name: 'Olvi II', alcoholByVolume: 0.047, unitVolume: 0.33 });
    seedOffer(db, { id: 61, productId: 6, merchant: 'alko', priceCents: 290 });
    seedProduct(db, { id: 7, name: 'Offerless Olut', alcoholByVolume: 0.047, unitVolume: 0.33 });
  }

  async function listIds(
    app: ReturnType<typeof buildApp>,
    env: ReturnType<typeof permissiveEnv>,
    query: string,
  ): Promise<{ body: Record<string, unknown>; ids: number[] }> {
    const res = await request(app, env, `/api/v1/products?${query}`, { headers: AGE });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ id: number }>;
      [key: string]: unknown;
    };
    return { body, ids: body.items.map((i) => i.id) };
  }

  it('LOWEST_PRICE orders ascending by lowest observed price, offer-less products last', async () => {
    const { db, d1 } = openMigratedD1();
    seedSortCatalog(db);
    const app = buildApp();
    const env = permissiveEnv(d1);

    const { ids } = await listIds(app, env, 'sort=LOWEST_PRICE');
    // 250 (2) < 290 = 290 (5, 6 — id tie) < 350 = 350 (1, 4 — id tie) < 480 (3);
    // product 7 has no offers — after every priced row.
    expect(ids).toEqual([2, 5, 6, 1, 4, 3, 7]);
  });

  it('LOWEST_PRICE is deterministic — the same data yields the same order on every request', async () => {
    const { db, d1 } = openMigratedD1();
    seedSortCatalog(db);
    const app = buildApp();
    const env = permissiveEnv(d1);

    const first = await listIds(app, env, 'sort=LOWEST_PRICE');
    const second = await listIds(app, env, 'sort=LOWEST_PRICE');
    expect(second.ids).toEqual(first.ids);
    // And across a separate composition over identical seeds.
    const other = openMigratedD1();
    seedSortCatalog(other.db);
    const third = await listIds(buildApp(), permissiveEnv(other.d1), 'sort=LOWEST_PRICE');
    expect(third.ids).toEqual(first.ids);
  });

  it('ALCOHOL_PERCENTAGE orders descending with unknown ABV last and the id tiebreaker', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, name: 'Vahva Olut', alcoholByVolume: 0.085 });
    seedProduct(db, { id: 2, name: 'Keski Olut', alcoholByVolume: 0.047 });
    seedProduct(db, { id: 3, name: 'Kevyt Olut', alcoholByVolume: 0.035 });
    // Two rows share the ABV — the id tiebreak resolves them deterministically.
    seedProduct(db, { id: 4, name: 'Tasu A', alcoholByVolume: 0.053 });
    seedProduct(db, { id: 5, name: 'Tasu B', alcoholByVolume: 0.053 });
    seedProduct(db, { id: 6, name: 'Tuntematon', alcoholByVolume: null });
    const { ids } = await listIds(buildApp(), permissiveEnv(d1), 'sort=ALCOHOL_PERCENTAGE');
    expect(ids).toEqual([1, 4, 5, 2, 3, 6]);
  });

  it('ALCOHOL_PERCENTAGE is deterministic across repeat requests', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, name: 'A', alcoholByVolume: 0.05 });
    seedProduct(db, { id: 2, name: 'B', alcoholByVolume: 0.04 });
    const app = buildApp();
    const env = permissiveEnv(d1);

    const first = await listIds(app, env, 'sort=ALCOHOL_PERCENTAGE');
    const second = await listIds(app, env, 'sort=ALCOHOL_PERCENTAGE');
    expect(second.ids).toEqual(first.ids);
  });

  it('LOWEST_PRICE composes with the category filter and keeps the exact total', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, name: 'Karhu III', category: 'beer' });
    seedOffer(db, { id: 11, productId: 1, merchant: 'alko', priceCents: 350 });
    seedProduct(db, { id: 2, name: 'Franzia', category: 'wine_still' });
    seedOffer(db, { id: 21, productId: 2, merchant: 'alko', priceCents: 900 });
    seedProduct(db, { id: 3, name: 'Apijo', category: 'wine_still' });
    seedOffer(db, { id: 31, productId: 3, merchant: 'alko', priceCents: 700 });
    seedProduct(db, { id: 4, name: 'Offerless Viini', category: 'wine_still' });

    const { body, ids } = await listIds(
      buildApp(),
      permissiveEnv(d1),
      'category=wine_still&sort=LOWEST_PRICE',
    );
    expect(body.total).toBe(3); // exact filtered total, not the priced subset
    expect(ids).toEqual([3, 2, 4]); // price asc within the category, offer-less last
  });

  it('the ranked-q path honors LOWEST_PRICE over real offer aggregates', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, name: 'Karhu III' });
    seedOffer(db, { id: 11, productId: 1, merchant: 'alko', priceCents: 350 });
    seedProduct(db, { id: 2, name: 'Koff III' });
    seedOffer(db, { id: 21, productId: 2, merchant: 'alko', priceCents: 250 });
    seedProduct(db, { id: 3, name: 'Offerless III' });
    const app = buildApp();

    const { ids } = await listIds(app, permissiveEnv(d1), 'q=iii&sort=LOWEST_PRICE');
    // The ranked fetch returns all three rows (name match); the sort
    // reorders by the merged aggregate — offer-less row last.
    expect([...ids].sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(ids[ids.length - 1]).toBe(3);
  });

  it('the ids path honors ALCOHOL_PERCENTAGE instead of name order', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, name: 'Karhu III', alcoholByVolume: 0.047 });
    seedProduct(db, { id: 2, name: 'Bock Svec', alcoholByVolume: 0.085 });
    const app = buildApp();

    const { ids } = await listIds(
      app,
      permissiveEnv(d1),
      'ids=1,2&sort=ALCOHOL_PERCENTAGE',
    );
    expect(ids).toEqual([2, 1]);
  });

  it('an omitted sort defaults to LOWEST_PRICE — identical to the explicit price sort (task 1.3)', async () => {
    const { db, d1 } = openMigratedD1();
    seedSortCatalog(db);
    const app = buildApp();
    const env = permissiveEnv(d1);

    const { ids } = await listIds(app, env, '');
    // Price ascending, offer-less product 7 strictly after every priced
    // row — the exact order of an explicit LOWEST_PRICE request.
    expect(ids).toEqual([2, 5, 6, 1, 4, 3, 7]);
    const explicit = await listIds(app, env, 'sort=LOWEST_PRICE');
    expect(explicit.ids).toEqual(ids);
    // And the legacy alphabetical default is gone: the name order of this
    // fixture differs from the price order.
    const alphabetical = await listIds(app, env, 'sort=ALPHABETICAL');
    expect(alphabetical.ids).not.toEqual(ids);
  });

  it('the ranked-q path defaults to LOWEST_PRICE when sort is absent (keyword-search path, task 1.3)', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, name: 'Karhu III' });
    seedOffer(db, { id: 11, productId: 1, merchant: 'alko', priceCents: 350 });
    seedProduct(db, { id: 2, name: 'Koff III' });
    seedOffer(db, { id: 21, productId: 2, merchant: 'alko', priceCents: 250 });
    seedProduct(db, { id: 3, name: 'Offerless III' });
    const app = buildApp();

    const { ids } = await listIds(app, permissiveEnv(d1), 'q=iii');
    // The ranked fetch returns all three rows (name match); the absent
    // sort defaults to the merged-aggregate price order — 250 < 350,
    // offer-less row strictly last.
    expect(ids).toEqual([2, 1, 3]);
    const explicit = await listIds(
      app,
      permissiveEnv(d1),
      'q=iii&sort=LOWEST_PRICE',
    );
    expect(explicit.ids).toEqual(ids);
  });
});

describe('GET /api/v1/products — combined category + keyword (task 2.1, change client-experience-improvement)', () => {
  /**
   * Three rows ALL matching 'karhu' across two categories, plus a
   * same-category non-match: the combined path must exclude exactly the
   * cross-category match and nothing else.
   */
  function seedCombined(db: DatabaseSync): void {
    seedProduct(db, { id: 1, name: 'Karhu III', brand: 'Karhu', category: 'beer' });
    seedProduct(db, {
      id: 2,
      name: 'Karhuvuori Vaalea',
      brand: 'Karhuvuori',
      category: 'wine_still',
    });
    seedProduct(db, { id: 3, name: 'Karhu IV', brand: 'Karhu', category: 'beer' });
    seedProduct(db, { id: 4, name: 'Koff III', brand: 'Koff', category: 'beer' });
  }

  it('applies the category together with q — only keyword matches in the category', async () => {
    const { db, d1 } = openMigratedD1();
    seedCombined(db);
    const app = buildApp();

    const res = await request(
      app,
      permissiveEnv(d1),
      '/api/v1/products?q=karhu&category=beer',
      { headers: AGE },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ id: number; category: string }>;
      total: number;
    };
    expect(body.total).toBe(2);
    expect(body.items.map((i) => i.id).sort((a, b) => a - b)).toEqual([1, 3]);
    expect(body.items.every((i) => i.category === 'beer')).toBe(true);
  });

  it('never silently ignores the category — the same q without it finds the wine row', async () => {
    const { db, d1 } = openMigratedD1();
    seedCombined(db);
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/products?q=karhu', {
      headers: AGE,
    });
    const body = (await res.json()) as { items: Array<{ id: number }>; total: number };
    expect(body.total).toBe(3);
    expect(body.items.map((i) => i.id)).toContain(2);
  });

  it('a combined q+category with zero matches renders as an honest empty set', async () => {
    const { db, d1 } = openMigratedD1();
    seedCombined(db);
    const app = buildApp();

    const res = await request(
      app,
      permissiveEnv(d1),
      '/api/v1/products?q=karhu&category=spirits',
      { headers: AGE },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; total: number };
    expect(body.total).toBe(0);
    expect(body.items).toEqual([]);
  });

  it('an explicit sort composes with the combined filter — it orders the filtered set only', async () => {
    const { db, d1 } = openMigratedD1();
    seedCombined(db);
    // The wine row is the CHEAPEST karhu match — LOWEST_PRICE over the
    // combined beer set must never let it in or displace the beer order.
    seedOffer(db, { id: 11, productId: 1, merchant: 'alko', priceCents: 350 });
    seedOffer(db, { id: 21, productId: 2, merchant: 'alko', priceCents: 100 });
    seedOffer(db, { id: 31, productId: 3, merchant: 'alko', priceCents: 250 });
    const app = buildApp();

    const res = await request(
      app,
      permissiveEnv(d1),
      '/api/v1/products?q=karhu&category=beer&sort=LOWEST_PRICE',
      { headers: AGE },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ id: number; lowestPriceCents: number | null }>;
      total: number;
    };
    expect(body.total).toBe(2);
    expect(body.items.map((i) => i.id)).toEqual([3, 1]); // 250 < 350, offer shape intact
    expect(body.items.map((i) => i.lowestPriceCents)).toEqual([250, 350]);
  });
});

describe('GET /api/v1/products — zero-result did-you-mean (task 3.2, change finnish-first-client-experience)', () => {
  it('attaches the advisory suggestion on a zero-result query — strictly additive passthrough', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, {
      id: 1,
      name: 'Koskenkorva Viina 60 %',
      brand: 'Koskenkorva',
      category: 'spirits',
    });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/products?q=koskenkrova', {
      headers: AGE,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: unknown[];
      total: number;
      suggestion?: string;
    };
    expect(body.total).toBe(0);
    expect(body.items).toEqual([]);
    expect(body.suggestion).toBe('Koskenkorva');
  });

  it('omits the suggestion field when the query has results', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, name: 'Karhu III' });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/products?q=karhu', {
      headers: AGE,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total: number;
      suggestion?: string;
    };
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(Object.prototype.hasOwnProperty.call(body, 'suggestion')).toBe(false);
  });

  it('a zero-result query with no candidate within the bound stays absent (never null on the wire)', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, name: 'Karhu III' });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/products?q=zzzzzz', {
      headers: AGE,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number; suggestion?: string };
    expect(body.total).toBe(0);
    expect(Object.prototype.hasOwnProperty.call(body, 'suggestion')).toBe(false);
  });

  it('the ids path never suggests — it is not a text query', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, name: 'Karhu III', brand: 'Koskenkorva' });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/products?ids=999', {
      headers: AGE,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number; suggestion?: string };
    expect(body.total).toBe(0);
    expect(Object.prototype.hasOwnProperty.call(body, 'suggestion')).toBe(false);
  });
});

describe('GET /api/v1/products — zero-result suggestion over the widened vocabulary (task 2.2, change consumer-clarity-and-discovery)', () => {
  // The spec scenario's exact shape: the misspelled word appears in
  // product NAMES and the curated synonym map but in NO brand — the
  // brand here stays 'Absolut', so only the widened union (design D2:
  // brand tokens + name tokens + FINNISH_SYNONYM_GROUPS members) can
  // resolve votka → vodka.
  function seedVodkaCatalog(db: DatabaseSync): void {
    seedProduct(db, {
      id: 1,
      name: 'Absolut Vodka Original',
      brand: 'Absolut',
      category: 'spirits',
    });
  }

  it('carries the advisory suggestion for the misspelled category word "votka" — contract otherwise unchanged', async () => {
    const { db, d1 } = openMigratedD1();
    seedVodkaCatalog(db);
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/products?q=votka', {
      headers: AGE,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: unknown[];
      total: number;
      page: number;
      limit: number;
      totalPages: number;
      suggestion?: string;
    };
    // votka→vodka is distance 1 against the union ('viina' is 4); the
    // fi collation's lowercase-first tie puts the curated member 'vodka'
    // ahead of the name token 'Vodka'.
    expect(body.suggestion).toBe('vodka');
    // The misspelling is never silently rewritten: no fuzzy results are
    // injected, so the response still answers the ORIGINAL query — zero
    // results — with the suggestion riding advisory-only beside it.
    expect(body.total).toBe(0);
    expect(body.items).toEqual([]);
    // The envelope contract is otherwise frozen: the legacy pagination
    // fields intact, then the advisory field, then the additive warnings
    // embed — nothing reordered, nothing removed.
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.totalPages).toBe(0);
    expect(Object.keys(body)).toEqual([
      'items',
      'total',
      'page',
      'limit',
      'totalPages',
      'suggestion',
      'merchantWarnings',
    ]);
  });

  it('the suggested word is a real query: "vodka" finds the product and carries no suggestion', async () => {
    const { db, d1 } = openMigratedD1();
    seedVodkaCatalog(db);
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/products?q=vodka', {
      headers: AGE,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ id: number }>;
      total: number;
      suggestion?: string;
    };
    // The chip's follow-up query resolves through the synonym expansion —
    // the advisory word is never a dead end.
    expect(body.total).toBe(1);
    expect(body.items.map((i) => i.id)).toEqual([1]);
    expect(Object.prototype.hasOwnProperty.call(body, 'suggestion')).toBe(false);
  });
});

describe('GET /api/v1/products — catalog browse (task 2.1, change product-catalog)', () => {
  it('filters by a canonical category with deterministic FI order', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, name: 'Karhu III', category: 'beer' });
    seedProduct(db, { id: 2, name: 'Franzia', category: 'wine_still' });
    seedProduct(db, { id: 3, name: 'Apijo', category: 'wine_still' });
    const app = buildApp();

    const res = await request(
      app,
      permissiveEnv(d1),
      '/api/v1/products?category=wine_still&sort=ALPHABETICAL',
      { headers: AGE },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ id: number; category: string }>;
      total: number;
      totalPages: number;
    };
    expect(body.total).toBe(2);
    expect(body.totalPages).toBe(1);
    expect(body.items.map((i) => i.id)).toEqual([3, 2]); // Apijo < Franzia
    expect(body.items.every((i) => i.category === 'wine_still')).toBe(true);
  });

  it('rejects an unknown category with 400 — never an unfiltered fallback', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, name: 'Karhu III' });
    const app = buildApp();

    const res = await request(
      app,
      permissiveEnv(d1),
      '/api/v1/products?category=mead',
      { headers: AGE },
    );
    await expectEnvelope(res, 400, {
      message:
        "Unknown category 'mead'. Valid categories: beer, wine_still, wine_sparkling, intermediate_products, other_fermented, spirits.",
    });
  });

  it('treats a blank category as absent (unfiltered browse)', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, name: 'Karhu III', category: 'beer' });
    seedProduct(db, { id: 2, name: 'Franzia', category: 'wine_still' });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/products?category=', {
      headers: AGE,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number };
    expect(body.total).toBe(2);
  });

  it('reports exact totals beyond the legacy 100-row fetch cap', async () => {
    const { db, d1 } = openMigratedD1();
    for (let i = 1; i <= 105; i++) {
      seedProduct(db, { id: i, name: `Product ${String(i).padStart(3, '0')}` });
    }
    const app = buildApp();

    const first = await request(app, permissiveEnv(d1), '/api/v1/products?limit=100', {
      headers: AGE,
    });
    const firstBody = (await first.json()) as {
      items: unknown[];
      total: number;
      totalPages: number;
    };
    // The legacy path fetched at most MAX_PAGE_SIZE rows and reported the
    // capped subset size; the browse total is the exact catalog size.
    expect(firstBody.total).toBe(105);
    expect(firstBody.totalPages).toBe(2);
    expect(firstBody.items).toHaveLength(100);

    const second = await request(
      app,
      permissiveEnv(d1),
      '/api/v1/products?limit=100&page=2',
      { headers: AGE },
    );
    const secondBody = (await second.json()) as {
      items: Array<{ id: number }>;
      total: number;
    };
    expect(secondBody.total).toBe(105);
    expect(secondBody.items).toHaveLength(5);
  });

  it('populates lowestPriceCents and merchantCount; offer-less products stay null/0', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, name: 'Karhu III' });
    seedOffer(db, { id: 11, productId: 1, priceCents: 420, merchant: 'eu-import' });
    seedOffer(db, { id: 12, productId: 1, priceCents: 350, merchant: 'alko' });
    // Same merchant as offer 12 — counted once (distinct merchants).
    seedOffer(db, { id: 13, productId: 1, priceCents: 390, merchant: 'alko' });
    seedProduct(db, { id: 2, name: 'Offerless Olut' });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/products', {
      headers: AGE,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ id: number; lowestPriceCents: number | null; merchantCount: number }>;
    };
    const karhu = body.items.find((i) => i.id === 1)!;
    // Minimum across the LATEST observation per (product, merchant) —
    // the superseded cheaper alko scrape (350) must not drag the
    // catalog's minimum below what the detail page lists (parity with
    // the current-offer collapse, change data-quality-and-publication-trust).
    expect(karhu.lowestPriceCents).toBe(390);
    expect(karhu.merchantCount).toBe(2); // distinct merchants
    const offerless = body.items.find((i) => i.id === 2)!;
    // Honest absence — no guessed price (design D4).
    expect(offerless.lowestPriceCents).toBeNull();
    expect(offerless.merchantCount).toBe(0);
  });

  it('keeps the catalog browse contract intact alongside the search-row aggregates', async () => {
    // Catalog browse keeps the repository's own all-rows aggregate: a
    // superseded cheaper scrape still counts there (repository scope),
    // while the ids/ranked-q rows match the detail endpoint (below).
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, name: 'Karhu III' });
    seedOffer(db, { id: 11, productId: 1, priceCents: 350 });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/products', {
      headers: AGE,
    });
    const body = (await res.json()) as {
      items: Array<{ id: number; lowestPriceCents: number | null; merchantCount: number }>;
    };
    expect(body.items[0]!).toMatchObject({ id: 1, lowestPriceCents: 350, merchantCount: 1 });
  });
});

describe('GET /api/v1/products — search-row offer aggregates (task 3.1, change unit-integrity-and-result-trust)', () => {
  // Kippis-shaped fixture: a cider whose merchant rescraped a price and a
  // second merchant — the shape that reported null/0 on the ids/ranked-q
  // rows while the detail endpoint listed offers for the same id. The
  // superseded alko scrape (300) must stay invisible: the detail endpoint
  // does not list it, so the row aggregate must not price it in either.
  function seedKippis(db: DatabaseSync): void {
    seedProduct(db, {
      id: 1,
      name: 'Kippis Lingonberry',
      brand: 'Kippis',
      category: 'other_fermented',
    });
    seedOffer(db, {
      id: 11,
      productId: 1,
      merchant: 'alko',
      priceCents: 300,
      observedAt: '2026-09-01T06:00:00.000Z',
    });
    seedOffer(db, {
      id: 12,
      productId: 1,
      merchant: 'alko',
      priceCents: 320,
      observedAt: '2026-09-10T06:00:00.000Z',
    });
    seedOffer(db, { id: 13, productId: 1, merchant: 'saksoinet', priceCents: 420 });
    seedProduct(db, { id: 2, name: 'Offerless Siideri', category: 'other_fermented' });
  }

  async function detailSummary(
    app: ReturnType<typeof buildApp>,
    env: Env,
  ): Promise<{ offerCount: number; bestPrice: number | null }> {
    const res = await request(app, env, '/api/v1/products/1', { headers: AGE });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      offers: Array<{ priceCents: number }>;
      currentBestPriceCents: number | null;
    };
    return { offerCount: body.offers.length, bestPrice: body.currentBestPriceCents };
  }

  it('ranked-q row reports the same offer set as the detail endpoint', async () => {
    const { db, d1 } = openMigratedD1();
    seedKippis(db);
    const app = buildApp();
    const env = permissiveEnv(d1);

    const detail = await detailSummary(app, env);

    const res = await request(app, env, '/api/v1/products?q=kippis', { headers: AGE });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ id: number; lowestPriceCents: number | null; merchantCount: number }>;
    };
    const kippis = body.items.find((i) => i.id === 1)!;
    // Same minimum and same merchant count as the detail response — and
    // never the superseded all-time-low 300.
    expect(kippis.lowestPriceCents).toBe(detail.bestPrice);
    expect(kippis.merchantCount).toBe(detail.offerCount);
    expect(kippis.lowestPriceCents).toBe(320);
    expect(kippis.merchantCount).toBe(2);

    // Offer-less product found by the same query mechanics stays honestly
    // empty (honest absence, never a guessed price).
    const offerlessRes = await request(app, env, '/api/v1/products?q=offerless', {
      headers: AGE,
    });
    const offerlessBody = (await offerlessRes.json()) as {
      items: Array<{ id: number; lowestPriceCents: number | null; merchantCount: number }>;
    };
    const offerless = offerlessBody.items.find((i) => i.id === 2)!;
    expect(offerless.lowestPriceCents).toBeNull();
    expect(offerless.merchantCount).toBe(0);
  });

  it('ids-path row reports the same offer set as the detail endpoint', async () => {
    const { db, d1 } = openMigratedD1();
    seedKippis(db);
    const app = buildApp();
    const env = permissiveEnv(d1);

    const detail = await detailSummary(app, env);

    const res = await request(app, env, '/api/v1/products?ids=1,2', { headers: AGE });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ id: number; lowestPriceCents: number | null; merchantCount: number }>;
    };
    const kippis = body.items.find((i) => i.id === 1)!;
    expect(kippis.lowestPriceCents).toBe(detail.bestPrice);
    expect(kippis.merchantCount).toBe(detail.offerCount);
    expect(kippis.lowestPriceCents).toBe(320);
    expect(kippis.merchantCount).toBe(2);

    const offerless = body.items.find((i) => i.id === 2)!;
    expect(offerless.lowestPriceCents).toBeNull();
    expect(offerless.merchantCount).toBe(0);
  });
});

describe('GET /api/v1/products/:id (detail)', () => {
  it('returns the product with its offers, ISO timestamps, and default deposit status', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, depositSystemStatus: null });
    seedOffer(db, { id: 11, productId: 1, priceCents: 350 });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/products/1', { headers: AGE });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.product.id).toBe(1);
    expect(body.product.depositSystemStatus).toBe(false); // ?? false parity
    expect(body.product.alcoholByVolume).toBeCloseTo(0.047, 6);
    expect(body.offers).toHaveLength(1);
    expect(body.offers[0]!.id).toBe(11);
    expect(body.offers[0]!.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // The informational embed rides along (per-merchant factual
    // aggregate; PENDING governance fail-closed).
    expect(body.merchantReliability).toMatchObject({
      alko: { offerCount: 1, governancePermissionStatus: 'PENDING' },
    });
  });

  it('embeds merchant reliability on the detail response', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    seedOffer(db, { id: 11, productId: 1 });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/products/1', { headers: AGE });
    const body = (await res.json()) as Record<string, any>;
    expect(body.merchantReliability).toBeDefined();
    expect(body.merchantReliability.alko.merchant).toBe('alko');
    // Governance has no D1 store — the status degrades to PENDING (never overstated).
    expect(body.merchantReliability.alko.governancePermissionStatus).toBe('PENDING');
  });

  it('404s an unknown product', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const res = await request(app, permissiveEnv(d1), '/api/v1/products/999', { headers: AGE });
    await expectEnvelope(res, 404, { message: 'Product 999 not found' });
  });

  // fi-locale-surface-hardening 2.5 (design D3): the registry display
  // name rides beside the identifier — additive, id fallback, no
  // reordering, no schema change.
  it('carries the registry display name on each offer, with the raw id as fallback', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    seedMerchant(db, { merchantId: 'alko', name: 'Alko Oy' });
    seedOffer(db, { id: 11, productId: 1, merchant: 'alko', priceCents: 350 });
    seedOffer(db, { id: 12, productId: 1, merchant: 'mydrink', priceCents: 420 });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/products/1', { headers: AGE });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { offers: Array<Record<string, unknown>> };

    // Registered merchant → its registry display name.
    expect(body.offers[0]).toMatchObject({ merchant: 'alko', merchantName: 'Alko Oy' });
    // Unregistered merchant → the raw id (the row stays renderable).
    expect(body.offers[1]).toMatchObject({ merchant: 'mydrink', merchantName: 'mydrink' });

    // The identifier stays byte-identical — it remains the wire and
    // analytics key; the name is one additive field per offer.
    expect(body.offers.map((o) => o.merchant)).toEqual(['alko', 'mydrink']);
  });

  it('degrades a registry read failure to id fallbacks — the detail response never fails on it', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    seedOffer(db, { id: 11, productId: 1, merchant: 'alko', priceCents: 350 });
    // Partial registry outage: the offers join (merchant_id key) keeps
    // working while the name column is gone, so the route's own list
    // read fails and must fail open.
    db.exec('ALTER TABLE merchant_registry DROP COLUMN name');
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/products/1', { headers: AGE });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { offers: Array<Record<string, unknown>> };
    expect(body.offers[0]).toMatchObject({ merchant: 'alko', merchantName: 'alko' });
  });
});

describe('GET /api/v1/products/:id — current-offer collapse (task 4.3)', () => {
  it('collapses repeated scrapes of an unchanged price into one offer carrying the last-observed date', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    seedOffer(db, {
      id: 11,
      productId: 1,
      merchant: 'alko',
      priceCents: 350,
      observedAt: '2026-09-01T06:00:00.000Z',
    });
    seedOffer(db, {
      id: 12,
      productId: 1,
      merchant: 'alko',
      priceCents: 350,
      observedAt: '2026-09-10T06:00:00.000Z',
    });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/products/1', { headers: AGE });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      offers: Array<{ id: number; merchant: string; priceCents: number; observedAt: string }>;
      currentBestPriceCents: number | null;
    };
    expect(body.offers).toHaveLength(1);
    expect(body.offers[0]).toMatchObject({
      id: 12,
      merchant: 'alko',
      priceCents: 350,
      observedAt: '2026-09-10T06:00:00.000Z',
    });
    expect(body.currentBestPriceCents).toBe(350);
  });

  it('supersedes a price move — the newer row wins and the superseded cheaper row cannot drag the best price down', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    seedOffer(db, {
      id: 11,
      productId: 1,
      merchant: 'alko',
      priceCents: 1799,
      observedAt: '2026-09-01T06:00:00.000Z',
    });
    seedOffer(db, {
      id: 12,
      productId: 1,
      merchant: 'alko',
      priceCents: 1999,
      observedAt: '2026-09-10T06:00:00.000Z',
    });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/products/1', { headers: AGE });
    const body = (await res.json()) as {
      offers: Array<{ id: number; priceCents: number; observedAt: string }>;
      currentBestPriceCents: number | null;
    };
    expect(body.offers).toHaveLength(1);
    expect(body.offers[0]).toMatchObject({ id: 12, priceCents: 1999 });
    // The shared lowest-current-offer rule over the deduped set is 1999 —
    // the all-time-low 1799 scrape log row must not resurface here.
    expect(body.currentBestPriceCents).toBe(1999);
  });

  it('keeps every merchant — dedup is per (product, merchant), not global', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    seedOffer(db, {
      id: 11,
      productId: 1,
      merchant: 'alko',
      priceCents: 1799,
      observedAt: '2026-09-01T06:00:00.000Z',
    });
    seedOffer(db, {
      id: 12,
      productId: 1,
      merchant: 'alko',
      priceCents: 1999,
      observedAt: '2026-09-10T06:00:00.000Z',
    });
    seedOffer(db, { id: 13, productId: 1, merchant: 'saksoinet', priceCents: 2100 });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/products/1', { headers: AGE });
    const body = (await res.json()) as {
      offers: Array<{ id: number; merchant: string; observedAt: string }>;
      currentBestPriceCents: number | null;
    };
    expect(body.offers).toHaveLength(2);
    const byMerchant = new Map(body.offers.map((o) => [o.merchant, o]));
    expect(byMerchant.get('alko')).toMatchObject({ id: 12 });
    expect(byMerchant.get('saksoinet')).toMatchObject({ id: 13 });
    expect(body.currentBestPriceCents).toBe(1999);
  });
});

describe('eurPerGram embed', () => {
  // The base shapes — the embed key appends to these exact key lists,
  // in this order.
  const LEGACY_ITEM_KEYS = [
    'id',
    'name',
    'brand',
    'category',
    'alcoholByVolume',
    'unitVolume',
    'containerType',
    'lowestPriceCents',
    'merchantCount',
  ];
  // fi-locale-surface-hardening 2.5 adds the registry display name
  // beside the identifier — additive, on top of the legacy key set
  // (id..reliabilityStatus) and the €/g embed (whose insertion position
  // is unchanged).
  const OFFER_KEYS_WITH_MERCHANT_NAME = [
    'id',
    'merchant',
    'merchantName',
    'country',
    'priceCents',
    'currency',
    'availability',
    'sourceUrl',
    'observedAt',
    'reliabilityStatus',
    'eurPerGram',
  ];

  it('search items carry the metric — explicitly unavailable with MISSING_PRICE when no current offer exists', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 }); // volume + ABV present
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/products', {
      headers: AGE,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<Record<string, unknown>> };
    expect(body.items).toHaveLength(1);
    // One embed shape everywhere: the product has no current offer, so
    // the price input is genuinely absent (design D1, change
    // honest-trust-surfaces) — the metric degrades to an explicit
    // MISSING_PRICE, never a substituted value and never a NaN call.
    expect(body.items[0]!.eurPerGram).toEqual({
      status: 'unavailable',
      centsPerGram: null,
      ethanolGrams: null,
      reason: 'MISSING_PRICE',
    });
    expect(Object.keys(body.items[0]!)).toEqual([...LEGACY_ITEM_KEYS, 'eurPerGram']);
  });

  it('search metric names a missing alcohol fraction before the absent price (module precedence)', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, alcoholByVolume: null });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/products', {
      headers: AGE,
    });
    const body = (await res.json()) as {
      items: Array<{ eurPerGram: Record<string, unknown> }>;
    };
    expect(body.items[0]!.eurPerGram).toEqual({
      status: 'unavailable',
      centsPerGram: null,
      ethanolGrams: null,
      reason: 'MISSING_ALCOHOL_FRACTION',
    });
  });

  it('offer metric is computed from the exact inputs while VERIFIED (density 789 g/l)', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 }); // 0.33 l, ABV 0.047
    seedOffer(db, { id: 11, productId: 1, priceCents: 350 }); // VERIFIED
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/products/1', {
      headers: AGE,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      offers: Array<{
        eurPerGram: {
          status: string;
          ethanolGrams: number;
          centsPerGram: number;
          priceReliability: string;
        };
      }>;
    };
    // 0.33 l × 0.047 × 789 g/l ≈ 12.23739 g ethanol; 350 ¢ / that ≈ 28.6 ¢/g.
    expect(body.offers[0]!.eurPerGram.status).toBe('computed');
    expect(body.offers[0]!.eurPerGram.ethanolGrams).toBeCloseTo(12.23739, 5);
    expect(body.offers[0]!.eurPerGram.centsPerGram).toBeCloseTo(28.60087, 4);
    expect(body.offers[0]!.eurPerGram.priceReliability).toBe('VERIFIED');
    expect(Object.keys(body.offers[0]!)).toEqual(OFFER_KEYS_WITH_MERCHANT_NAME);
  });

  it('a pack row prices the package on the detail path too (task 6.1): ≈ 6.64 ¢/g, was 159.35', async () => {
    const { db, d1 } = openMigratedD1();
    // The live 2900 shape: 2199 ¢ pack, per-unit 0.33 l, 5.3 %, pack
    // count only in the name. The name-parsed 24 units make the offer
    // embed divide by the package total — the live pre-fix path priced
    // the pack against one can (159.35 ¢/g, beer priced like gold).
    seedProduct(db, {
      id: 1,
      name: 'Karhu Olut 5.3% 24×33 l',
      alcoholByVolume: 0.053,
      unitVolume: 0.33,
    });
    seedOffer(db, { id: 11, productId: 1, priceCents: 2199 });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/products/1', {
      headers: AGE,
    });
    const body = (await res.json()) as {
      offers: Array<{
        eurPerGram: { status: string; centsPerGram: number; ethanolGrams: number };
      }>;
    };
    expect(body.offers[0]!.eurPerGram.status).toBe('computed');
    expect(body.offers[0]!.eurPerGram.ethanolGrams).toBeCloseTo(331.19064, 5);
    expect(body.offers[0]!.eurPerGram.centsPerGram).toBeCloseTo(6.6397, 3);
  });

  it('a non-VERIFIED pack offer stays ESTIMATED on the package denominator (live defect shape)', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, {
      id: 1,
      name: 'Karhu Olut 5.3% 24×33 l',
      alcoholByVolume: 0.053,
      unitVolume: 0.33,
    });
    seedOffer(db, {
      id: 11,
      productId: 1,
      priceCents: 2199,
      reliabilityStatus: 'ESTIMATED',
    });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/products/1', {
      headers: AGE,
    });
    const body = (await res.json()) as {
      offers: Array<{ eurPerGram: { status: string; centsPerGram: number } }>;
    };
    // The live defect reported "159.35 ¢/g ESTIMATED" — one can's
    // volume under a pack price. The status honesty is unchanged; the
    // denominator is now the package the price actually covers.
    expect(body.offers[0]!.eurPerGram.status).toBe('ESTIMATED');
    expect(body.offers[0]!.eurPerGram.centsPerGram).toBeCloseTo(6.6397, 3);
  });

  it('a non-VERIFIED offer price yields an ESTIMATED metric (value still returned)', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    seedOffer(db, {
      id: 11,
      productId: 1,
      priceCents: 350,
      reliabilityStatus: 'ESTIMATED',
    });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/products/1', {
      headers: AGE,
    });
    const body = (await res.json()) as {
      offers: Array<{
        eurPerGram: { status: string; priceReliability: string; centsPerGram: number };
      }>;
    };
    expect(body.offers[0]!.eurPerGram.status).toBe('ESTIMATED');
    expect(body.offers[0]!.eurPerGram.priceReliability).toBe('ESTIMATED');
    expect(body.offers[0]!.eurPerGram.centsPerGram).toBeCloseTo(28.60087, 4);
  });

  it('missing alcohol percentage → explicit unavailable, no value substituted', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, alcoholByVolume: null });
    seedOffer(db, { id: 11, productId: 1, priceCents: 350 });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/products/1', {
      headers: AGE,
    });
    const body = (await res.json()) as {
      offers: Array<{ eurPerGram: Record<string, unknown> }>;
    };
    expect(body.offers[0]!.eurPerGram).toEqual({
      status: 'unavailable',
      centsPerGram: null,
      ethanolGrams: null,
      reason: 'MISSING_ALCOHOL_FRACTION',
    });
  });

  it('the embed never reorders the offers across identical requests', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    seedOffer(db, { id: 11, productId: 1, priceCents: 350 });
    seedOffer(db, { id: 12, productId: 1, priceCents: 420, merchant: 'eu-import' });
    const app = buildApp();

    const first = await request(app, permissiveEnv(d1), '/api/v1/products/1', {
      headers: AGE,
    });
    const firstBody = (await first.json()) as { offers: Array<Record<string, unknown>> };

    const second = await request(app, permissiveEnv(d1), '/api/v1/products/1', {
      headers: AGE,
    });
    const secondBody = (await second.json()) as { offers: Array<Record<string, unknown>> };

    // Identical order and identical values across reads — the embed is
    // mapped in place.
    expect(secondBody.offers.map((o) => o.id)).toEqual(firstBody.offers.map((o) => o.id));
    expect(secondBody.offers.map((o) => Object.keys(o))).toEqual([
      OFFER_KEYS_WITH_MERCHANT_NAME,
      OFFER_KEYS_WITH_MERCHANT_NAME,
    ]);
    expect(secondBody.offers).toEqual(firstBody.offers);
  });
});

describe('GET /api/v1/products — listing €/g embed from the cheapest current offer (task 2.2, change honest-trust-surfaces)', () => {
  const EMBED_ITEM_KEYS = [
    'id',
    'name',
    'brand',
    'category',
    'alcoholByVolume',
    'unitVolume',
    'containerType',
    'lowestPriceCents',
    'merchantCount',
    'eurPerGram',
  ];

  /**
   * Embed fixture: product 1 mirrors the Kippis scrape shape (a
   * superseded cheaper alko scrape, its current pricier row, and a
   * pricier ESTIMATED merchant) so the embed must price exactly the
   * current 320 VERIFIED row — not the 300 scrape log, not the 420
   * ESTIMATED merchant. Products 2/3 pin provenance labeling and the
   * price-tie resolution.
   */
  function seedEmbedCatalog(db: DatabaseSync): void {
    seedProduct(db, {
      id: 1,
      name: 'Karhu III',
      alcoholByVolume: 0.047,
      unitVolume: 0.33,
    });
    seedOffer(db, {
      id: 11,
      productId: 1,
      merchant: 'alko',
      priceCents: 300,
      observedAt: '2026-09-01T06:00:00.000Z',
    });
    seedOffer(db, {
      id: 12,
      productId: 1,
      merchant: 'alko',
      priceCents: 320,
      observedAt: '2026-09-10T06:00:00.000Z',
    });
    seedOffer(db, {
      id: 13,
      productId: 1,
      merchant: 'saksoinet',
      priceCents: 420,
      reliabilityStatus: 'ESTIMATED',
    });
    seedProduct(db, {
      id: 2,
      name: 'Koff III',
      alcoholByVolume: 0.035,
      unitVolume: 0.33,
    });
    seedOffer(db, {
      id: 21,
      productId: 2,
      merchant: 'eu-import',
      priceCents: 250,
      reliabilityStatus: 'ESTIMATED',
    });
    seedProduct(db, {
      id: 3,
      name: 'Olvi III',
      alcoholByVolume: 0.047,
      unitVolume: 0.33,
    });
    seedOffer(db, {
      id: 31,
      productId: 3,
      merchant: 'alko',
      priceCents: 320,
      observedAt: '2026-09-10T06:00:00.000Z',
    });
    seedOffer(db, {
      id: 32,
      productId: 3,
      merchant: 'saksoinet',
      priceCents: 320,
      reliabilityStatus: 'ESTIMATED',
    });
  }

  /**
   * The detail route's own cheapest-offer metric for a product: the
   * first strictly-smallest price over the id-ASC offers (the shared
   * lowest-current-offer rule), with that offer's provenance. The
   * listing embed must equal this — never disagree.
   */
  async function detailCheapestMetric(
    app: ReturnType<typeof buildApp>,
    env: Env,
    productId: number,
  ): Promise<Record<string, unknown>> {
    const res = await request(app, env, `/api/v1/products/${productId}`, {
      headers: AGE,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      offers: Array<{ id: number; priceCents: number; eurPerGram: Record<string, unknown> }>;
    };
    return body.offers.reduce(
      (best, offer) => (offer.priceCents < best.priceCents ? offer : best),
    ).eurPerGram;
  }

  it('the browse embed equals the cheapest current detail offer — a fully-valid fixture computes (no NaN path)', async () => {
    const { db, d1 } = openMigratedD1();
    seedEmbedCatalog(db);
    const app = buildApp();
    const env = permissiveEnv(d1);

    const detailMetric = await detailCheapestMetric(app, env, 1);

    const res = await request(app, env, '/api/v1/products', { headers: AGE });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ id: number; eurPerGram: Record<string, unknown> }>;
    };
    const item = body.items.find((i) => i.id === 1)!;
    // embed == cheapest-current-detail-offer, the identical shape the
    // detail page computed for offer 12 (320 c, VERIFIED).
    expect(item.eurPerGram).toEqual(detailMetric);
    // 0.33 l × 0.047 × 789 g/l ≈ 12.23739 g; 320 ¢ / that ≈ 26.1494 ¢/g.
    expect(item.eurPerGram).toMatchObject({
      status: 'computed',
      priceReliability: 'VERIFIED',
    });
    expect((item.eurPerGram as { centsPerGram: number }).centsPerGram).toBeCloseTo(26.1494, 4);
    expect((item.eurPerGram as { ethanolGrams: number }).ethanolGrams).toBeCloseTo(12.23739, 5);
    // The superseded all-time-low 300 scrape prices neither the value
    // nor the provenance.
    expect((item.eurPerGram as { centsPerGram: number }).centsPerGram).not.toBeCloseTo(
      300 / 12.23739,
      3,
    );
    expect(Object.keys(item)).toEqual(EMBED_ITEM_KEYS);
  });

  it('ranked-q and ids rows carry the same embed as the detail page for every product', async () => {
    const { db, d1 } = openMigratedD1();
    seedEmbedCatalog(db);
    const app = buildApp();
    const env = permissiveEnv(d1);

    const detailById = new Map<number, Record<string, unknown>>();
    for (const id of [1, 2, 3]) {
      detailById.set(id, await detailCheapestMetric(app, env, id));
    }

    const ranked = await request(app, env, '/api/v1/products?q=iii', { headers: AGE });
    const rankedBody = (await ranked.json()) as {
      items: Array<{ id: number; eurPerGram: Record<string, unknown> }>;
    };
    expect(rankedBody.items.map((i) => i.id).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    for (const item of rankedBody.items) {
      expect(item.eurPerGram).toEqual(detailById.get(item.id));
    }

    const byIds = await request(app, env, '/api/v1/products?ids=1,2,3', { headers: AGE });
    const idsBody = (await byIds.json()) as {
      items: Array<{ id: number; eurPerGram: Record<string, unknown> }>;
    };
    for (const item of idsBody.items) {
      expect(item.eurPerGram).toEqual(detailById.get(item.id));
    }
  });

  it('an ESTIMATED cheapest offer labels the embed ESTIMATED — the value still returns', async () => {
    const { db, d1 } = openMigratedD1();
    seedEmbedCatalog(db);
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/products', { headers: AGE });
    const body = (await res.json()) as {
      items: Array<{
        id: number;
        eurPerGram: { status: string; priceReliability: string; centsPerGram: number };
      }>;
    };
    const koff = body.items.find((i) => i.id === 2)!;
    expect(koff.eurPerGram.status).toBe('ESTIMATED');
    expect(koff.eurPerGram.priceReliability).toBe('ESTIMATED');
    // 0.33 l × 0.035 × 789 ≈ 9.11295 g; 250 ¢ / that ≈ 27.4335 ¢/g.
    expect(koff.eurPerGram.centsPerGram).toBeCloseTo(27.4335, 4);
  });

  it('a price tie resolves to the lowest offer id — the detail route’s own pick', async () => {
    const { db, d1 } = openMigratedD1();
    seedEmbedCatalog(db);
    const app = buildApp();
    const env = permissiveEnv(d1);

    const detailMetric = await detailCheapestMetric(app, env, 3);

    const res = await request(app, env, '/api/v1/products', { headers: AGE });
    const body = (await res.json()) as {
      items: Array<{
        id: number;
        eurPerGram: { priceReliability: string } & Record<string, unknown>;
      }>;
    };
    const olvi = body.items.find((i) => i.id === 3)!;
    // Offers 31 (alko, VERIFIED) and 32 (saksoinet, ESTIMATED) tie at
    // 320 — the detail derivation lands on the lowest id, so the embed
    // must carry VERIFIED, never the tied row's looser status.
    expect(olvi.eurPerGram).toEqual(detailMetric);
    expect(olvi.eurPerGram.priceReliability).toBe('VERIFIED');
  });

  it('no current offer → MISSING_PRICE on every listing path, never a value', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 9, name: 'Offerless Olut', alcoholByVolume: 0.047, unitVolume: 0.33 });
    const app = buildApp();
    const env = permissiveEnv(d1);

    const expected = {
      status: 'unavailable',
      centsPerGram: null,
      ethanolGrams: null,
      reason: 'MISSING_PRICE',
    };
    for (const path of [
      '/api/v1/products',
      '/api/v1/products?q=offerless',
      '/api/v1/products?ids=9',
    ]) {
      const res = await request(app, env, path, { headers: AGE });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: Array<{ id: number; lowestPriceCents: number | null; eurPerGram: unknown }>;
      };
      const item = body.items.find((i) => i.id === 9)!;
      expect(item.lowestPriceCents).toBeNull();
      expect(item.eurPerGram).toEqual(expected);
    }
  });

  it('a corrupt unit volume keeps INVALID_VOLUME even with a current offer', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, unitVolume: 0 });
    seedOffer(db, { id: 11, productId: 1, priceCents: 320 });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/products', { headers: AGE });
    const body = (await res.json()) as {
      items: Array<{ id: number; eurPerGram: Record<string, unknown> }>;
    };
    expect(body.items[0]!.eurPerGram).toEqual({
      status: 'unavailable',
      centsPerGram: null,
      ethanolGrams: null,
      reason: 'INVALID_VOLUME',
    });
  });

  it('an alcohol-free product reports ZERO_ETHANOL on the listing', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, name: 'Karhu 0,0', alcoholByVolume: 0 });
    seedOffer(db, { id: 11, productId: 1, priceCents: 320 });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/products', { headers: AGE });
    const body = (await res.json()) as {
      items: Array<{ id: number; eurPerGram: Record<string, unknown> }>;
    };
    // Present and valid ABV data, physically undefined metric — the
    // honest reason, never INVALID_ALCOHOL_FRACTION (design D2).
    expect(body.items[0]!.eurPerGram).toEqual({
      status: 'unavailable',
      centsPerGram: null,
      ethanolGrams: null,
      reason: 'ZERO_ETHANOL',
    });
  });

  it('the live 2900 pack row prices the package: 24 name-parsed units × per-unit 0.33 l → ≈ 6.64 ¢/g', async () => {
    const { db, d1 } = openMigratedD1();
    // The live product-2900 shape after the task-1.x volume correction:
    // per-unit litres stored, the pack count only in the name. The
    // task-6.1 amendment derives 24 units from the name at read time,
    // so the 2199 ¢ pack divides by 24 × 0.33 l — ≈ 6.64 ¢/g, not the
    // 159.35 ¢/g the single-can denominator produced live pre-fix.
    seedProduct(db, {
      id: 1,
      name: 'Karhu Olut 5.3% 24×33 l',
      alcoholByVolume: 0.053,
      unitVolume: 0.33,
    });
    seedOffer(db, { id: 11, productId: 1, priceCents: 2199 });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/products', { headers: AGE });
    const body = (await res.json()) as {
      items: Array<{
        id: number;
        eurPerGram: {
          status: string;
          centsPerGram: number;
          ethanolGrams: number;
          priceReliability: string;
        };
      }>;
    };
    const embed = body.items[0]!.eurPerGram;
    expect(embed.status).toBe('computed');
    expect(embed.priceReliability).toBe('VERIFIED');
    // 24 × 0.33 l × 0.053 × 789 ≈ 331.19 g of ethanol in the package.
    expect(embed.ethanolGrams).toBeCloseTo(331.19064, 5);
    expect(embed.centsPerGram).toBeCloseTo(6.6397, 3);
    // Sane beer band at package granularity — the corrupted 159.35 and
    // the pack-total-volume 1.59 both sit far outside it.
    expect(embed.centsPerGram).toBeGreaterThanOrEqual(4);
    expect(embed.centsPerGram).toBeLessThanOrEqual(12);
  });

  it('pack-row parity: the listing embed equals the detail offer embed on a 24×33 l row', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, {
      id: 1,
      name: 'Karhu Olut 5.3% 24×33 l',
      alcoholByVolume: 0.053,
      unitVolume: 0.33,
    });
    seedOffer(db, { id: 11, productId: 1, priceCents: 2199 });
    const app = buildApp();
    const env = permissiveEnv(d1);

    const listing = await request(app, env, '/api/v1/products', { headers: AGE });
    const listingBody = (await listing.json()) as {
      items: Array<{ id: number; eurPerGram: Record<string, unknown> }>;
    };
    const detail = await request(app, env, '/api/v1/products/1', { headers: AGE });
    const detailBody = (await detail.json()) as {
      offers: Array<{ eurPerGram: Record<string, unknown> }>;
    };

    // Same name → same name-parsed units on both embed paths (task
    // 6.1): a pack row cannot disagree between listing and detail.
    expect(listingBody.items[0]!.eurPerGram).toEqual(
      detailBody.offers[0]!.eurPerGram,
    );
    // Both denominators carry the 24 units, not one can.
    expect(
      (detailBody.offers[0]!.eurPerGram as { ethanolGrams: number }).ethanolGrams,
    ).toBeCloseTo(331.19064, 5);
  });

  it('the reversed notation order applies units too: "33CL x 24" → 24 units', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, {
      id: 1,
      name: 'Siideri 33CL x 24',
      alcoholByVolume: 0.05,
      unitVolume: 0.33,
    });
    seedOffer(db, { id: 11, productId: 1, priceCents: 1200 });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/products', { headers: AGE });
    const body = (await res.json()) as {
      items: Array<{
        id: number;
        eurPerGram: { ethanolGrams: number; centsPerGram: number };
      }>;
    };
    // 24 × 0.33 l × 0.05 × 789 ≈ 312.44 g — the trailing count applies.
    expect(body.items[0]!.eurPerGram.ethanolGrams).toBeCloseTo(312.444, 5);
    expect(body.items[0]!.eurPerGram.centsPerGram).toBeCloseTo(3.8406882513, 8);
  });

  it('single-unit products are byte-identical to the pre-amendment embed', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 }); // name 'Karhu III' — no pack notation
    seedOffer(db, { id: 11, productId: 1, priceCents: 350 });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/products', { headers: AGE });
    const body = (await res.json()) as {
      items: Array<{ id: number; eurPerGram: Record<string, unknown> }>;
    };
    // The name states no pack size → the units default to 1 → the exact
    // bytes the pre-amendment formula produced (350 ¢ / 12.23739 g).
    expect(JSON.stringify(body.items[0]!.eurPerGram)).toBe(
      '{"status":"computed","centsPerGram":28.60086995674731,"ethanolGrams":12.237390000000001,"priceReliability":"VERIFIED"}',
    );
  });
});

describe('GET /api/v1/declaration/:recordId', () => {
  it('entitlement admits anonymous and PREMIUM callers; both get the degraded summary', async () => {
    const { db, d1 } = openMigratedD1();
    seedAccount(db, { id: 11, userId: 'user-11', email: 'p@example.invalid', tier: 'PREMIUM' });
    seedProduct(db, { id: 1 });
    seedCalculationRecord(db, { id: 5, productMasterId: 1 });
    const token = await issueSessionToken(d1, 11);
    const app = buildApp();

    // The entitlement check (declaration:summary) passes for every tier
    // today, so the request reaches the handler. The D1 record adapter
    // carries the factual 'NotPersisted' classification marker, which the
    // declaration assembly degrades: no derived obligation, no fabricated
    // liability flags — never a 500.
    for (const headers of [
      AGE,
      { ...AGE, cookie: `rajahinta_session=${token}` },
    ]) {
      const res = await request(app, permissiveEnv(d1), '/api/v1/declaration/5', { headers });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        advanceNoticeInfo: { required: boolean };
        guidance: { liabilityNotice: unknown };
      };
      expect(body.advanceNoticeInfo.required).toBe(false);
      expect(body.guidance.liabilityNotice).toBeNull();
    }
  });

  it('age gate denies before the entitlement check (class-level guard order)', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const res = await request(app, permissiveEnv(d1), '/api/v1/declaration/5');
    await expectEnvelope(res, 403, {
      message: expect.stringMatching(/age confirmation required/i),
    });
  });

  describe('handler parity on a bare app', () => {
    function bareApp(): ReturnType<typeof createApp> {
      const app = new Hono<AppEnv>();
      // The createApp error composition, without guards — the handler's
      // thrown ApiHttpError must render the unified envelope.
      app.onError((err, c) => respondToError(c, err));
      app.use(errorBoundary());
      registerDeclarationRoutes(app);
      return app as ReturnType<typeof createApp>;
    }

    it('404s a missing calculation record (CalculationRecordNotFoundError mapping)', async () => {
      const { d1 } = freshD1();
      const app = bareApp();
      const res = await request(app, permissiveEnv(d1), '/api/v1/declaration/999');
      await expectEnvelope(res, 404, {
        message: 'Calculation record 999 not found',
        error: 'Not Found',
      });
    });

    it('degrades factually on a persisted record whose classification is unpersisted', async () => {
      // The record adapter degrades the un-persisted classification to the
      // factual marker; the assembly derives no advance-notice obligation
      // and fabricates no liability flags from a label it does not know.
      const { db, d1 } = freshD1();
      seedProduct(db, { id: 1 });
      seedCalculationRecord(db, { id: 5, productMasterId: 1 });
      const app = bareApp();

      const res = await request(app, permissiveEnv(d1), '/api/v1/declaration/5');
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        advanceNoticeInfo: { required: boolean };
        guidance: { liabilityNotice: unknown };
      };
      expect(body.advanceNoticeInfo).toEqual({ required: false });
      expect(body.guidance.liabilityNotice).toBeNull();
    });
  });
});
