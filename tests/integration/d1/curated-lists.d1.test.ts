/**
 * Curated lists integration suite (task 7.4, change
 * product-roadmap-phases-1-4) — the spec: curated-lists checklist
 * against the real stack: the FULL createApp() composition (index.ts
 * already wires registerCuratedListsRoutes AND registerOpsRoutes, so
 * createApp() IS the production composition for both ports — no extra
 * registration) over a real migrated D1 and in-memory DO namespaces.
 *
 * Audit (task 7.4 text → existing coverage → what this file adds):
 *
 * - 7.1 repository tests (curated-entries.repository.test.ts) cover
 *   the storage layer: DRAFT-on-create, evidence-links zod, schema
 *   CHECKs, the publish AND unpublish transitions, and the
 *   published-only public read path.
 * - 7.1 route tests (curated-entries.routes.test.ts) cover console
 *   CRUD over the composed app, the 409/404 transition contract, and
 *   the audit CONTRACT read through the repository — with every
 *   "public visibility" leg asserted on the repository's
 *   listPublishedBySlug, NOT on the public HTTP API.
 * - 7.2 route tests (curated-lists.routes.test.ts) cover the public
 *   list API: published-only payloads (repository-seeded), 404 vs
 *   200-empty slug semantics, wire slug normalization, the catalog,
 *   the DEFAULT rate-limit profile, and flag-off 403 — with flag-off
 *   exercised on an EMPTY database.
 * - 7.3 page tests (lists/[slug]/page.test.tsx) cover the rendering
 *   side against a mocked fetch client.
 *
 * Integration deltas ADDED here (tests/integration/**):
 * - "Draft entries hidden" END-TO-END: console-create over HTTP
 *   (lands DRAFT) → public API absent (200 known-empty + catalog
 *   excludes the slug) → console-publish over HTTP → present with
 *   complete evidence → console-unpublish → absent again. The full
 *   public lifecycle crossing BOTH ports over HTTP — no earlier
 *   suite chains console → public-API in one flow.
 * - "Console publish audited" over the composed app: the
 *   /ops/console/audit endpoint (the operator's trail view) shows the
 *   created + confirmed events with the acting operator, the entry id,
 *   and the curated_entry entity type.
 * - "Flag-off 403" composed with DATA PRESENT: flag ON serves the
 *   list on the SAME composition and data, flag OFF 403s the SAME
 *   request — the flag is the only variable (7.2 proved the gate on
 *   an empty database; here the OFF verdict refuses content that
 *   actually exists). Both the per-slug read and the catalog, plus
 *   the fully locked env.
 *
 * @module CuratedListsD1IntegrationTest
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  createApp,
  expectEnvelope,
  FAKE_OPS_TOKEN,
  lockedEnv,
  openMigratedD1,
  permissiveEnv,
  request,
  seedProduct,
} from '../../../apps/api-worker/src/routes/__tests__/harness';
import { D1CuratedEntriesRepository } from '../../../packages/data-platform/src/repositories/d1/curated-entries.repository';
import type { Env } from '../../../apps/api-worker/src/env';
import type { D1DatabaseLike } from '../../../packages/data-platform/src/d1/executor';

// ---------------------------------------------------------------------------
// Fixtures and composition — full production stack for BOTH ports
// ---------------------------------------------------------------------------

const OPS = { authorization: `Bearer ${FAKE_OPS_TOKEN}` };
const OPS_JSON = { 'content-type': 'application/json', ...OPS };
const OPERATOR = 'ops-integration@example.invalid';

/**
 * index.ts registers the public list reads (flag gate + limiter) and
 * the ops console (guard prefix) on the one app — the composition
 * under test is exactly what production serves.
 */
function fullApp(): ReturnType<typeof createApp> {
  return createApp();
}

/** Lists flag ON + console open (permissive base) — the serving path. */
function curatedEnv(d1: D1DatabaseLike, overrides: Partial<Env> = {}): Env {
  return permissiveEnv(d1, { ...overrides, FF_CURATED_LISTS: 'true' });
}

/** The console DTO — target is the product side (FK parent seeded). */
const ENTRY = {
  operator: OPERATOR,
  listSlug: 'alkon-hylkaamat',
  productId: 1,
  rationale: 'Alko poisti tuotteen valikoimasta; saatavissa yhä EU-alueen verkkokaupasta.',
  evidenceLinks: [
    { label: 'Systembolaget', url: 'https://systembolaget.example/produkt/karhu-export' },
  ],
  reviewer: 'curator@example.invalid',
};

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

interface AuditItem {
  entityType: string;
  entityId: string;
  action: string;
  author: string | null;
}

function consolePost(
  app: ReturnType<typeof createApp>,
  env: Env,
  path: string,
  body: unknown,
): Promise<Response> {
  return request(app, env, path, {
    method: 'POST',
    headers: OPS_JSON,
    body: JSON.stringify(body),
  });
}

async function getJson<T>(res: Response): Promise<T> {
  expect(res.status).toBe(200);
  return (await res.json()) as T;
}

// ===========================================================================
// 1. Draft entries hidden — end-to-end: console-create (DRAFT) → public API
//    absent → console-publish → present → console-unpublish → absent again
//    (spec "Draft entries hidden" + "Entry published from console")
// ===========================================================================

describe('curated entry lifecycle over HTTP: console ↔ public list API (task 7.4)', () => {
  let db: NonNullable<Parameters<typeof seedProduct>[0]>;
  let d1: D1DatabaseLike;
  let app: ReturnType<typeof createApp>;
  let env: Env;

  beforeEach(() => {
    const opened = openMigratedD1();
    db = opened.db;
    d1 = opened.d1;
    app = fullApp();
    env = curatedEnv(d1);
  });

  afterEach(() => {
    db.close();
  });

  it('hides a DRAFT entry on the public API, shows it after console-publish, hides it again after unpublish', async () => {
    seedProduct(db, { id: 1, name: 'Karhu Export' });

    // Console-create: the only sanctioned first write. Lands DRAFT.
    const created = await consolePost(app, env, '/ops/console/curated-entries', ENTRY);
    expect(created.status).toBe(200);
    const createdBody = (await getJson<{ id: number; status: string }>(created));
    expect(createdBody.status).toBe('DRAFT');

    // While DRAFT: the public per-slug read answers 200 known-empty
    // (the slug IS registered; its content is not yet public) — and the
    // catalog (the sitemap feed) excludes the slug entirely.
    const slug = 'alkon-hylkaamat';
    const absent = await getJson<ListJson>(
      await request(app, env, `/api/v1/lists/${slug}`),
    );
    expect(absent.slug).toBe('alkon-hylkaamat');
    expect(absent.entries).toEqual([]);
    expect(await getJson<CatalogJson>(await request(app, env, '/api/v1/lists'))).toEqual({
      lists: [],
    });

    // Console-publish: the operator's explicit human gate — the only
    // route to PUBLISHED.
    const published = await consolePost(
      app,
      env,
      `/ops/console/curated-entries/${createdBody.id}/publish`,
      { operator: OPERATOR },
    );
    expect(published.status).toBe(200);
    expect((await getJson<{ status: string }>(published)).status).toBe('PUBLISHED');

    // Present — the public API serves the entry with its COMPLETE
    // evidence (rationale + validated links), nothing else.
    const present = await getJson<ListJson>(
      await request(app, env, `/api/v1/lists/${slug}`),
    );
    expect(present.title).toBe('Alkon hylkäämät');
    expect(present.entries).toHaveLength(1);
    expect(present.entries[0]).toMatchObject({
      productId: 1,
      externalRef: null,
      rationale: ENTRY.rationale,
      evidenceLinks: ENTRY.evidenceLinks,
    });
    // The catalog now carries the slug (sitemap reflects published content).
    expect(await getJson<CatalogJson>(await request(app, env, '/api/v1/lists'))).toEqual({
      lists: [{ slug: 'alkon-hylkaamat', title: 'Alkon hylkäämät' }],
    });

    // Console-unpublish: off the public list, record retained — the
    // public API drops it on the next read.
    const unpublished = await consolePost(
      app,
      env,
      `/ops/console/curated-entries/${createdBody.id}/unpublish`,
      { operator: OPERATOR },
    );
    expect(unpublished.status).toBe(200);
    expect((await getJson<{ status: string }>(unpublished)).status).toBe('DRAFT');
    expect(
      (await getJson<ListJson>(await request(app, env, `/api/v1/lists/${slug}`))).entries,
    ).toEqual([]);
    expect(await getJson<CatalogJson>(await request(app, env, '/api/v1/lists'))).toEqual({
      lists: [],
    });
  });
});

// ===========================================================================
// 2. Console publish audited — the /ops/console/audit trail records actor +
//    action over the composed app (spec: "the audit trail SHALL record the
//    actor and action")
// ===========================================================================

describe('curated-entry console mutations land on the audited trail (task 7.4)', () => {
  let db: NonNullable<Parameters<typeof seedProduct>[0]>;
  let d1: D1DatabaseLike;
  let app: ReturnType<typeof createApp>;
  let env: Env;

  beforeEach(() => {
    const opened = openMigratedD1();
    db = opened.db;
    d1 = opened.d1;
    app = fullApp();
    env = curatedEnv(d1);
  });

  afterEach(() => {
    db.close();
  });

  /** The operator's trail view over HTTP — newest-first, order-insensitive use. */
  async function auditTrail(): Promise<AuditItem[]> {
    const res = await request(app, env, '/ops/console/audit', { headers: OPS });
    const body = await getJson<{ items: AuditItem[] }>(res);
    return body.items;
  }

  it('records created + confirmed on the trail with the acting operator and the entry id', async () => {
    seedProduct(db, { id: 1 });

    // Draft-only so far: the trail already shows the creation.
    const created = await consolePost(app, env, '/ops/console/curated-entries', ENTRY);
    const { id } = await getJson<{ id: number }>(created);

    let mine = (await auditTrail()).filter(
      (item) => item.entityType === 'curated_entry' && item.entityId === String(id),
    );
    expect(mine.map((item) => item.action).sort()).toEqual(['created']);
    expect(mine.every((item) => item.author === OPERATOR)).toBe(true);

    // The publish action is audited as 'confirmed' — attributed to the
    // acting operator, tied to the entry id.
    await consolePost(app, env, `/ops/console/curated-entries/${id}/publish`, {
      operator: OPERATOR,
    });

    mine = (await auditTrail()).filter(
      (item) => item.entityType === 'curated_entry' && item.entityId === String(id),
    );
    expect(mine.map((item) => item.action).sort()).toEqual(['confirmed', 'created']);
    expect(mine.every((item) => item.author === OPERATOR)).toBe(true);
  });

  it('records the unpublish action on the trail (spec: entries are created, updated, AND unpublished)', async () => {
    seedProduct(db, { id: 1 });

    const created = await consolePost(app, env, '/ops/console/curated-entries', ENTRY);
    const { id } = await getJson<{ id: number }>(created);
    await consolePost(app, env, `/ops/console/curated-entries/${id}/publish`, {
      operator: OPERATOR,
    });
    await consolePost(app, env, `/ops/console/curated-entries/${id}/unpublish`, {
      operator: OPERATOR,
    });

    const mine = (await auditTrail()).filter(
      (item) => item.entityType === 'curated_entry' && item.entityId === String(id),
    );
    expect(mine.map((item) => item.action).sort()).toEqual([
      'confirmed',
      'created',
      'updated',
    ]);
    expect(mine.every((item) => item.author === OPERATOR)).toBe(true);
  });
});

// ===========================================================================
// 3. Flag-off 403 composed — with data present, the flag is the only
//    variable (spec "Feature gating": lists are gated behind
//    enable_curated_lists; 7.2 proved the gate on an EMPTY database)
// ===========================================================================

describe('GET /api/v1/lists(/:slug) — flag gate end-to-end with data present (task 7.4)', () => {
  let db: NonNullable<Parameters<typeof seedProduct>[0]>;
  let d1: D1DatabaseLike;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    const opened = openMigratedD1();
    db = opened.db;
    d1 = opened.d1;
    app = fullApp();
  });

  afterEach(() => {
    db.close();
  });

  it('serves the published list with the flag ON, then 403s the identical requests with the flag OFF', async () => {
    seedProduct(db, { id: 1 });
    // Data EXISTS before any flag is touched: the OFF case must refuse
    // to serve content that is really there (non-vacuous gate proof).
    const repo = new D1CuratedEntriesRepository(d1);
    const created = await repo.create({
      listSlug: 'alkon-hylkaamat',
      productId: 1,
      rationale: ENTRY.rationale,
      evidenceLinks: ENTRY.evidenceLinks,
      reviewer: ENTRY.reviewer,
    });
    expect((await repo.publish(created.id))!.status).toBe('PUBLISHED');

    // Flag ON: the published entry serves and the catalog lists the slug.
    const slugBody = await getJson<ListJson>(
      await request(app, curatedEnv(d1), '/api/v1/lists/alkon-hylkaamat'),
    );
    expect(slugBody.entries).toHaveLength(1);
    const catalog = await getJson<CatalogJson>(
      await request(app, curatedEnv(d1), '/api/v1/lists'),
    );
    expect(catalog.lists).toEqual([{ slug: 'alkon-hylkaamat', title: 'Alkon hylkäämät' }]);

    // Flag OFF (flags otherwise open — the rollback semantics): the SAME
    // requests on the SAME data get the feature-disabled envelope.
    for (const path of ['/api/v1/lists/alkon-hylkaamat', '/api/v1/lists']) {
      await expectEnvelope(await request(app, permissiveEnv(d1), path), 403, {
        message: 'Feature "CURATED_LISTS" is not enabled',
        error: 'Forbidden',
      });
    }

    // Fully locked env (the 7.2 route-unit case) — same verdict composed.
    for (const path of ['/api/v1/lists/alkon-hylkaamat', '/api/v1/lists']) {
      await expectEnvelope(await request(app, lockedEnv(d1), path), 403, {
        message: 'Feature "CURATED_LISTS" is not enabled',
        error: 'Forbidden',
      });
    }
  });
});
