/**
 * Operator-console curated-entry route tests (task 7.1, change
 * product-roadmap-phases-1-4) over the FULL app composition
 * (createApp() — registerOpsRoutes rides the /ops/console guard prefix)
 * on the fake-D1 harness, mirroring the producer-link console tests.
 *
 * Pinning here: create lands DRAFT with a normalized slug echoed back,
 * the audited publish AND unpublish transitions (spec: curated-lists —
 * entries are created, updated, AND unpublished; unlike the
 * ferry/producer lifecycles PUBLISHED is not terminal), the no-deploy
 * edit of a PUBLISHED entry (spec: content changes require no deploys),
 * the mandatory deletion reason, the exactly-one-target rule, the
 * complete-record listing with per-slug filtering, and the audit
 * contract — entityType 'curated_entry', one append-only event per
 * mutation, acting operator from the shared console operator field.
 * The public list API (7.2) reads only the repository's
 * listPublishedBySlug; drafts never surface (pinned via the public
 * read path).
 *
 * @module CuratedEntriesRoutesTest
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
import { D1CuratedEntriesRepository } from '../../../../../packages/data-platform/src/repositories/d1/curated-entries.repository';
import { D1AuditEventRepository } from '../../../../../packages/data-platform/src/repositories/d1/audit-event.repository';
import type { Env } from '../../env';
import type { D1DatabaseLike } from '../../../../../packages/data-platform/src/d1/executor';

const OPS = { authorization: `Bearer ${FAKE_OPS_TOKEN}` };
const OPS_JSON = { 'content-type': 'application/json', ...OPS };
const OPERATOR = 'ops@example.invalid';

function env(d1: D1DatabaseLike): Env {
  return permissiveEnv(d1);
}

/** The console DTO — target is the product side (external-ref cases override). */
const ENTRY = {
  operator: OPERATOR,
  listSlug: 'alkon-hylkaamat',
  productId: 1,
  rationale: 'Discontinued at Alko; cheaper across the border.',
  evidenceLinks: [
    { label: 'Alko archive', url: 'https://alko.example/archive/1' },
  ],
  reviewer: 'curator@example.invalid',
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

/** Create one entry through the console and return its id + echoed body. */
async function createEntry(
  app: ReturnType<typeof buildApp>,
  e: Env,
  overrides: Record<string, unknown> = {},
): Promise<{ id: number; status: string; listSlug: string }> {
  const res = await post(app, e, '/ops/console/curated-entries', {
    ...ENTRY,
    ...overrides,
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { id: number; status: string; listSlug: string };
}

/**
 * Audit actions of one entity, compared ORDER-INSENSITIVELY (the
 * repository orders newest-first by timestamp with a random-UUID
 * tie-break — same-millisecond writes have no deterministic sequence;
 * ferry/producer console-test parity).
 */
async function auditActions(d1: D1DatabaseLike): Promise<string[]> {
  const entries = await new D1AuditEventRepository(d1).query({
    entityType: 'curated_entry',
  });
  for (const entry of entries) {
    expect(entry.entityType).toBe('curated_entry');
    expect(entry.author).toBe(OPERATOR);
  }
  return entries.map((entry) => entry.action).sort();
}

/** The 7.2 public read path — what the public list would serve now. */
async function publicSlugs(d1: D1DatabaseLike, slug: string): Promise<number[]> {
  const served = await new D1CuratedEntriesRepository(d1).listPublishedBySlug(slug);
  return served.map((entry) => entry.id);
}

describe('/ops/console/curated-entries — audited CRUD', () => {
  it('creates a DRAFT, publishes it, and audits both actions', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    const app = buildApp();
    const e = env(d1);

    const created = await createEntry(app, e);
    expect(created.status).toBe('DRAFT');
    expect(created.listSlug).toBe('alkon-hylkaamat');

    // Drafts are invisible to the public list (spec "Draft entries hidden").
    expect(await publicSlugs(d1, 'alkon-hylkaamat')).toEqual([]);

    const published = await post(app, e, `/ops/console/curated-entries/${created.id}/publish`, {
      operator: OPERATOR,
    });
    expect(published.status).toBe(200);
    expect(((await published.json()) as { status: string }).status).toBe('PUBLISHED');

    // ...and the public read reflects the publish on the next read.
    expect(await publicSlugs(d1, 'alkon-hylkaamat')).toEqual([created.id]);

    // The console listing carries the COMPLETE editorial record.
    const list = await request(app, e, '/ops/console/curated-entries', {
      headers: OPS,
    });
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      items: {
        id: number;
        listSlug: string;
        productId: number | null;
        externalRef: string | null;
        rationale: string;
        evidenceLinks: { label: string; url: string }[];
        reviewer: string;
        status: string;
      }[];
      total: number;
    };
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({
      id: created.id,
      listSlug: 'alkon-hylkaamat',
      productId: 1,
      externalRef: null,
      rationale: ENTRY.rationale,
      evidenceLinks: ENTRY.evidenceLinks,
      reviewer: ENTRY.reviewer,
      status: 'PUBLISHED',
    });

    const rows = await new D1AuditEventRepository(d1).query({
      entityType: 'curated_entry',
    });
    expect(rows.map((row) => row.action).sort()).toEqual(['confirmed', 'created']);
    for (const row of rows) {
      expect(row.entityType).toBe('curated_entry');
      expect(row.entityId).toBe(String(created.id));
      expect(row.author).toBe(OPERATOR);
    }
  });

  it('edits a PUBLISHED entry without a deploy (spec) and unpublishes it off the public list', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    const app = buildApp();
    const e = env(d1);

    const { id } = await createEntry(app, e);
    await post(app, e, `/ops/console/curated-entries/${id}/publish`, {
      operator: OPERATOR,
    });

    // The no-deploy content update: a PUBLISHED entry is editable —
    // audited with before/after values (this is the deliberate
    // lifecycle difference from ferry/producer rows).
    const updated = await post(app, e, `/ops/console/curated-entries/${id}`, {
      operator: OPERATOR,
      rationale: 'Re-verified: still discontinued, still cheaper abroad.',
      note: 'editorial re-review',
    });
    expect(updated.status).toBe(200);
    const updatedBody = (await updated.json()) as { status: string; rationale: string };
    expect(updatedBody.status).toBe('PUBLISHED');
    expect(updatedBody.rationale).toBe('Re-verified: still discontinued, still cheaper abroad.');
    expect(await publicSlugs(d1, 'alkon-hylkaamat')).toEqual([id]);

    // Unpublish: off the public list, record retained.
    const unpublished = await post(app, e, `/ops/console/curated-entries/${id}/unpublish`, {
      operator: OPERATOR,
    });
    expect(unpublished.status).toBe(200);
    expect(((await unpublished.json()) as { status: string }).status).toBe('DRAFT');
    expect(await publicSlugs(d1, 'alkon-hylkaamat')).toEqual([]);

    // Both content mutations audited as 'updated' (the audit action
    // vocabulary has no separate verb; before/after values carry the
    // status flip).
    expect(await auditActions(d1)).toEqual(['confirmed', 'created', 'updated', 'updated']);
  });

  it('creates an external-ref entry, lists per slug, and swaps the target', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    const app = buildApp();
    const e = env(d1);

    // Slug must arrive console-valid kebab (the console enforces the
    // URL-key format; the repository normalizes case/whitespace as the
    // storage-side backstop — repo tests pin that rule).
    const external = await createEntry(app, e, {
      productId: undefined,
      externalRef: 'https://systembolaget.example/produkt/karhu-export',
      listSlug: 'alkon-hylkaamat',
    });
    expect(external.listSlug).toBe('alkon-hylkaamat');

    const otherList = await createEntry(app, e, { listSlug: 'toinen-lista' });

    const filtered = await request(
      app,
      e,
      '/ops/console/curated-entries?slug=Alkon-Hylkaamat',
      { headers: OPS },
    );
    const filteredBody = (await filtered.json()) as {
      items: { id: number; externalRef: string | null }[];
      total: number;
    };
    expect(filteredBody.total).toBe(1);
    expect(filteredBody.items[0].id).toBe(external.id);
    expect(filteredBody.items[0].externalRef).toBe(
      'https://systembolaget.example/produkt/karhu-export',
    );

    // One-sided target patch = wholesale swap (exactly-one invariant).
    const swapped = await post(app, e, `/ops/console/curated-entries/${external.id}`, {
      operator: OPERATOR,
      productId: 1,
    });
    expect(swapped.status).toBe(200);
    const swappedBody = (await swapped.json()) as {
      productId: number | null;
      externalRef: string | null;
    };
    expect(swappedBody.productId).toBe(1);
    expect(swappedBody.externalRef).toBeNull();

    // The other slug is untouched by the filter.
    const all = await request(app, e, '/ops/console/curated-entries', { headers: OPS });
    expect(((await all.json()) as { total: number }).total).toBe(2);
    expect(otherList.id).toBeGreaterThan(0);
  });

  it('deletes with a mandatory reason, removes the entry, and audits the deletion', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    const app = buildApp();
    const e = env(d1);

    const { id } = await createEntry(app, e);
    await post(app, e, `/ops/console/curated-entries/${id}/publish`, {
      operator: OPERATOR,
    });

    // Reason mandatory.
    const noReason = await post(app, e, `/ops/console/curated-entries/${id}/delete`, {
      operator: OPERATOR,
    });
    expect(noReason.status).toBe(400);

    const removed = await post(app, e, `/ops/console/curated-entries/${id}/delete`, {
      operator: OPERATOR,
      reason: 'entry duplicated',
    });
    expect(removed.status).toBe(200);

    const list = await request(app, e, '/ops/console/curated-entries', {
      headers: OPS,
    });
    expect(((await list.json()) as { total: number }).total).toBe(0);
    expect(await publicSlugs(d1, 'alkon-hylkaamat')).toEqual([]);

    expect(await auditActions(d1)).toEqual(['confirmed', 'created', 'deleted']);
  });
});

describe('/ops/console/curated-entries — validation', () => {
  it.each([
    ['slug format', { listSlug: 'Not A Slug' }],
    ['slug uppercase', { listSlug: 'Alkon-Hylkaamat' }],
    ['blank rationale', { rationale: '' }],
    ['evidence url scheme', { evidenceLinks: [{ label: 'x', url: 'ftp://x.example' }] }],
    ['empty evidence array', { evidenceLinks: [] }],
    ['non-array evidence', { evidenceLinks: 'https://x.example' }],
    ['missing both targets', { productId: undefined }],
    ['both targets', { externalRef: 'https://x.example/ref' }],
    ['operator', { operator: '' }],
  ])('rejects a bad %s with 400', async (_label, overrides) => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    const app = buildApp();
    const res = await post(app, env(d1), '/ops/console/curated-entries', {
      ...ENTRY,
      ...overrides,
    });
    expect(res.status).toBe(400);
  });

  it('answers 404 for mutations on an unknown id and 409 for invalid transitions', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    const app = buildApp();
    const e = env(d1);

    await expectEnvelope(
      await post(app, e, '/ops/console/curated-entries/999999', {
        operator: OPERATOR,
        rationale: 'x',
      }),
      404,
      { message: 'Curated entry 999999 not found' },
    );
    await expectEnvelope(
      await post(app, e, '/ops/console/curated-entries/999999/publish', {
        operator: OPERATOR,
      }),
      404,
      { message: 'Curated entry 999999 not found' },
    );
    await expectEnvelope(
      await post(app, e, '/ops/console/curated-entries/999999/unpublish', {
        operator: OPERATOR,
      }),
      404,
      { message: 'Curated entry 999999 not found' },
    );
    await expectEnvelope(
      await post(app, e, '/ops/console/curated-entries/999999/delete', {
        operator: OPERATOR,
        reason: 'cleanup',
      }),
      404,
      { message: 'Curated entry 999999 not found' },
    );

    const { id } = await createEntry(app, e);
    // Republishing a published entry is a 409, not a silent no-op.
    await post(app, e, `/ops/console/curated-entries/${id}/publish`, {
      operator: OPERATOR,
    });
    await expectEnvelope(
      await post(app, e, `/ops/console/curated-entries/${id}/publish`, {
        operator: OPERATOR,
      }),
      409,
      { error: 'InvalidTransition' },
    );
    // ...and unpublishing a draft (never published) is the mirror 409.
    const second = await createEntry(app, e);
    await expectEnvelope(
      await post(app, e, `/ops/console/curated-entries/${second.id}/unpublish`, {
        operator: OPERATOR,
      }),
      409,
      { error: 'InvalidTransition' },
    );
  });
});
