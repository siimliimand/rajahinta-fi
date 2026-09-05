/**
 * Curated lists route tests (task 7.2, change product-roadmap-phases-1-4)
 * over the FULL app composition (createApp() + registerCuratedListsRoutes
 * — the exact composition index.ts wires, flag gate + rate limit on the
 * routes themselves) on the fake-D1 harness.
 *
 * Pinning here: flag-off 403 on BOTH endpoints (CURATED_LISTS),
 * published-only responses (DRAFT entries never surface), complete
 * evidence per entry (rationale + non-empty {label, url} links),
 * criteria metadata on every known-list response, slug normalization
 * over the wire, the 200-empty vs 404 slug contract (known list with
 * no published entries is an answer, an unknown slug is a 404), the
 * published-only catalog (the sitemap's slug source), and the per-IP
 * DEFAULT rate-limit profile (60/min → 429 on the 61st).
 *
 * @module CuratedListsRoutesTest
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
import { registerCuratedListsRoutes } from '../curated-lists.routes';
import { D1CuratedEntriesRepository } from '../../../../../packages/data-platform/src/repositories/d1/curated-entries.repository';
import type { Env } from '../../env';
import type { D1DatabaseLike } from '../../../../../packages/data-platform/src/d1/executor';

/**
 * index.ts registers both list reads behind their route-level gate+
 * limiter (same slot as the other route ports); the test composition
 * mirrors that exactly.
 */
function listsApp(): ReturnType<typeof buildApp> {
  const app = buildApp();
  registerCuratedListsRoutes(app);
  return app;
}

function listsEnv(d1: D1DatabaseLike, overrides: Partial<Env> = {}): Env {
  return permissiveEnv(d1, { ...overrides, FF_CURATED_LISTS: 'true' });
}

interface EntryJson {
  id: number;
  productId: number | null;
  externalRef: string | null;
  rationale: string;
  evidenceLinks: { label: string; url: string }[];
}

interface ListJson {
  slug: string;
  title: string;
  criteria: string[];
  entries: EntryJson[];
}

interface CatalogJson {
  lists: { slug: string; title: string }[];
}

async function getList(
  app: ReturnType<typeof buildApp>,
  env: Env,
  slug: string,
): Promise<Response> {
  return request(app, env, `/api/v1/lists/${slug}`);
}

async function getCatalog(
  app: ReturnType<typeof buildApp>,
  env: Env,
): Promise<Response> {
  return request(app, env, '/api/v1/lists');
}

/** Seed one curated entry (DRAFT by default; publish on request). */
async function seedEntry(
  d1: D1DatabaseLike,
  entry: {
    publish?: boolean;
    productId?: number;
    externalRef?: string;
    rationale?: string;
  } = {},
): Promise<number> {
  const repo = new D1CuratedEntriesRepository(d1);
  const created = await repo.create({
    listSlug: 'Alkon-Hylkaamat', // arrives unnormalized — stored normalized
    productId: entry.productId,
    externalRef: entry.externalRef,
    rationale: entry.rationale ?? 'Alko poisti tuotteen valikoimasta; saatavilla Ruotsissa.',
    evidenceLinks: [
      { label: 'Systembolaget', url: 'https://systembolaget.example/produkt/karhu-export' },
    ],
    reviewer: 'curator@example.invalid',
  });
  if (entry.publish ?? true) {
    const published = await repo.publish(created.id);
    expect(published).not.toBeNull();
  }
  return created.id;
}

// ---------------------------------------------------------------------------
// Gate: flag-off 403 (CURATED_LISTS) — both endpoints
// ---------------------------------------------------------------------------

describe('GET /api/v1/lists(/:slug) — gate', () => {
  it('rejects the per-slug read with 403 while CURATED_LISTS is off (route 403 envelope shape)', async () => {
    const { d1 } = openMigratedD1();
    const app = listsApp();
    const res = await getList(app, lockedEnv(d1), 'alkon-hylkaamat');
    await expectEnvelope(res, 403, {
      message: 'Feature "CURATED_LISTS" is not enabled',
    });
  });

  it('rejects the catalog read with 403 while CURATED_LISTS is off (route 403 envelope shape)', async () => {
    const { d1 } = openMigratedD1();
    const app = listsApp();
    const res = await getCatalog(app, lockedEnv(d1));
    await expectEnvelope(res, 403, {
      message: 'Feature "CURATED_LISTS" is not enabled',
    });
  });
});

// ---------------------------------------------------------------------------
// Published list payload — published-only, complete evidence, criteria
// ---------------------------------------------------------------------------

describe('GET /api/v1/lists/:slug — published list served', () => {
  it('returns only PUBLISHED entries with complete rationale + evidence, plus criteria metadata', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 7, name: 'Karhu Export' });
    const productEntryId = await seedEntry(d1, { productId: 7 });
    // DRAFT work in progress — invisible to the public API.
    await seedEntry(d1, {
      externalRef: 'https://systembolaget.example/produkt/draft-only',
      publish: false,
    });
    const externalEntryId = await seedEntry(d1, {
      externalRef: 'https://systembolaget.example/produkt/karhu-export',
      rationale: 'Alkon hylkäämä; jatkaa myyntiä Systembolaget-valikoimassa.',
    });

    const app = listsApp();
    const res = await getList(app, listsEnv(d1), 'alkon-hylkaamat');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListJson;

    // Identity + criteria travel with every known-list response.
    expect(body.slug).toBe('alkon-hylkaamat');
    expect(body.title).toBe('Alkon hylkäämät');
    expect(Array.isArray(body.criteria)).toBe(true);
    expect(body.criteria.length).toBeGreaterThan(0);

    // Id order; the DRAFT entry never surfaces (spec "Draft entries hidden").
    expect(body.entries).toEqual([
      {
        id: productEntryId,
        productId: 7,
        externalRef: null,
        rationale: 'Alko poisti tuotteen valikoimasta; saatavilla Ruotsissa.',
        evidenceLinks: [
          {
            label: 'Systembolaget',
            url: 'https://systembolaget.example/produkt/karhu-export',
          },
        ],
      },
      {
        id: externalEntryId,
        productId: null,
        externalRef: 'https://systembolaget.example/produkt/karhu-export',
        rationale: 'Alkon hylkäämä; jatkaa myyntiä Systembolaget-valikoimassa.',
        evidenceLinks: [
          {
            label: 'Systembolaget',
            url: 'https://systembolaget.example/produkt/karhu-export',
          },
        ],
      },
    ] satisfies EntryJson[]);
  });

  it('normalizes the slug over the wire — mixed-case param hits the canonical list', async () => {
    const { d1 } = openMigratedD1();
    await seedEntry(d1, { externalRef: 'https://systembolaget.example/produkt/x' });

    const app = listsApp();
    const canonical = await getList(app, listsEnv(d1), 'alkon-hylkaamat');
    const wire = await getList(app, listsEnv(d1), 'Alkon-Hylkaamat');
    expect(wire.status).toBe(200);
    expect((await wire.json()) as ListJson).toEqual((await canonical.json()) as ListJson);
  });

  it('returns 200 with empty entries for a known slug with no published entries (never a 404)', async () => {
    const { d1 } = openMigratedD1();
    // DRAFT-only content — the list exists but is not yet public.
    await seedEntry(d1, { externalRef: 'https://systembolaget.example/produkt/x', publish: false });

    const app = listsApp();
    const res = await getList(app, listsEnv(d1), 'alkon-hylkaamat');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListJson;
    expect(body.slug).toBe('alkon-hylkaamat');
    expect(body.entries).toEqual([]);
  });

  it('rejects an unknown slug with 404 (normalized echo in the message)', async () => {
    const { d1 } = openMigratedD1();
    const app = listsApp();
    const res = await getList(app, listsEnv(d1), 'Ei-Ole-Olemassa');
    await expectEnvelope(res, 404, { message: 'List "ei-ole-olemassa" not found' });
  });
});

// ---------------------------------------------------------------------------
// Catalog — the sitemap's published-slug source
// ---------------------------------------------------------------------------

describe('GET /api/v1/lists — catalog', () => {
  it('lists a slug only once it has published content', async () => {
    const { d1 } = openMigratedD1();
    const app = listsApp();
    const env = listsEnv(d1);

    const empty = await getCatalog(app, env);
    expect(empty.status).toBe(200);
    expect((await empty.json()) as CatalogJson).toEqual({ lists: [] });

    await seedEntry(d1, { externalRef: 'https://systembolaget.example/produkt/x' });
    const live = await getCatalog(app, env);
    expect(live.status).toBe(200);
    expect((await live.json()) as CatalogJson).toEqual({
      lists: [{ slug: 'alkon-hylkaamat', title: 'Alkon hylkäämät' }],
    });
  });
});

// ---------------------------------------------------------------------------
// Rate-limit profile — DEFAULT, public unauthenticated read (60/min)
// ---------------------------------------------------------------------------

describe('GET /api/v1/lists/:slug — rate-limit profile', () => {
  it('admits sixty requests per minute per IP (DEFAULT) and rejects the sixty-first with 429', async () => {
    const { d1 } = openMigratedD1();
    await seedEntry(d1, { externalRef: 'https://systembolaget.example/produkt/x' });
    const app = listsApp();
    const env = listsEnv(d1); // one shared env = one shared DO limiter bucket

    for (let i = 0; i < 60; i++) {
      const res = await getList(app, env, 'alkon-hylkaamat');
      expect(res.status).toBe(200);
    }

    const sixtyFirst = await getList(app, env, 'alkon-hylkaamat');
    await expectEnvelope(sixtyFirst, 429, { error: 'TooManyRequests' });
    expect(sixtyFirst.headers.get('Retry-After')).not.toBeNull();
  });
});
