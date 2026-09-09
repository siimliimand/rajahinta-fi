/**
 * Blog route tests (task 5.1, change trust-and-reach-roadmap) over the
 * FULL app composition on the fake-D1 harness.
 *
 * Pins (spec content-publication):
 * - drafts are invisible publicly: the index and the slug page answer
 *   the same shapes whether a DRAFT exists or not (no existence
 *   leakage);
 * - only the ops console publish action makes a post public, audited,
 *   and only when the body passes the content-policy lint;
 * - PUBLISHED is terminal (409 on re-publish);
 * - the public endpoints return PUBLISHED posts only;
 * - the blog index lists RATE_CHANGE only and the guides index GUIDE
 *   only, with operator-created GUIDE drafts created/edited/published
 *   through the same console gate (insight-surfaces 5.1, spec
 *   guides-hub).
 *
 * @module BlogRoutesTest
 */

import { describe, it, expect } from 'vitest';
import {
  buildApp,
  expectEnvelope,
  FAKE_OPS_TOKEN,
  openMigratedD1,
  permissiveEnv,
  request,
} from './harness';
import { D1BlogPostRepository } from '../../../../../packages/data-platform/src/repositories/d1/blog-post.repository';
import { WorkerAuditService } from '../../adapters/audit';

const OPS = { authorization: `Bearer ${FAKE_OPS_TOKEN}` };

/** Seed one FI draft + one FI published post + one EN draft. */
async function seedPosts(d1: ReturnType<typeof openMigratedD1>['d1']): Promise<{
  draftFiId: number;
  publishedId: number;
  draftEnId: number;
}> {
  const repo = new D1BlogPostRepository(d1);
  const draftFi = await repo.create({
    slug: 'veromuutos-v2026-09',
    locale: 'fi',
    title: 'Veromuutos v2026-09',
    bodyMarkdown:
      'Veroaineiston versio v2026-09 tulee voimaan 2026-09-15.\n\n' +
      'Lasketun kokonaishinnan arvio on arvio, ei lopullinen verovelka.',
    rateDatasetVersion: 'v2026-09',
  });
  const draftEn = await repo.create({
    slug: 'veromuutos-v2026-09',
    locale: 'en',
    title: 'Tax change v2026-09',
    bodyMarkdown:
      'Rate dataset version v2026-09 takes effect on 2026-09-15.\n\n' +
      'The estimated total cost is an estimate, not a final tax liability.',
    rateDatasetVersion: 'v2026-09',
  });
  const published = await repo.create({
    slug: 'veromuutos-v2026-01',
    locale: 'fi',
    title: 'Aiempi veromuutos',
    bodyMarkdown: 'Versio v2026-01 tuli voimaan 2026-01-01.',
    rateDatasetVersion: 'v2026-01',
  });
  expect(await repo.publish(published.id)).not.toBeNull();
  return { draftFiId: draftFi.id, publishedId: published.id, draftEnId: draftEn.id };
}

describe('GET /api/v1/blog/posts — PUBLISHED only', () => {
  it('returns published posts only; drafts are invisible', async () => {
    const { d1 } = openMigratedD1();
    await seedPosts(d1);
    const app = buildApp();
    const res = await request(app, permissiveEnv(d1), '/api/v1/blog/posts?locale=fi');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ slug: string; status?: string }>;
      total: number;
    };
    expect(body.total).toBe(1);
    expect(body.items[0]!.slug).toBe('veromuutos-v2026-01');
    // Index items carry no body and no lifecycle status.
    expect(body.items[0]).not.toHaveProperty('status');
    expect(body.items[0]).not.toHaveProperty('bodyMarkdown');
  });

  it('indexes per locale — the EN index stays empty while the EN post is a draft', async () => {
    const { d1 } = openMigratedD1();
    await seedPosts(d1);
    const app = buildApp();
    const res = await request(app, permissiveEnv(d1), '/api/v1/blog/posts?locale=en');
    const body = (await res.json()) as { total: number };
    expect(body.total).toBe(0);
  });

  it('rejects an unknown locale with 400', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const res = await request(app, permissiveEnv(d1), '/api/v1/blog/posts?locale=sv');
    await expectEnvelope(res, 400, { error: 'ValidationError' });
  });
});

describe('GET /api/v1/blog/posts/:slug — the slug page', () => {
  it('returns the published body for the locale', async () => {
    const { d1 } = openMigratedD1();
    await seedPosts(d1);
    const app = buildApp();
    const res = await request(
      app,
      permissiveEnv(d1),
      '/api/v1/blog/posts/veromuutos-v2026-01?locale=fi',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { slug: string; bodyMarkdown: string };
    expect(body.slug).toBe('veromuutos-v2026-01');
    expect(body.bodyMarkdown).toContain('2026-01-01');
  });

  it('answers a DRAFT slug with the SAME 404 as an unknown slug', async () => {
    const { d1 } = openMigratedD1();
    await seedPosts(d1);
    const app = buildApp();

    const draftRes = await request(
      app,
      permissiveEnv(d1),
      '/api/v1/blog/posts/veromuutos-v2026-09?locale=fi',
    );
    const unknownRes = await request(
      app,
      permissiveEnv(d1),
      '/api/v1/blog/posts/never-existed?locale=fi',
    );
    expect(draftRes.status).toBe(404);
    expect(unknownRes.status).toBe(404);
    // Same 404 envelope (path/timestamp are per-request metadata).
    const normalize = (b: Record<string, unknown>) => ({
      statusCode: b.statusCode,
      message: b.message,
      error: b.error,
    });
    expect(normalize((await draftRes.json()) as Record<string, unknown>)).toEqual(
      normalize((await unknownRes.json()) as Record<string, unknown>),
    );
  });
});

describe('POST /ops/console/blog/posts/:id/publish — the human gate', () => {
  it('publishes a draft (audited); the post then appears publicly', async () => {
    const { d1 } = openMigratedD1();
    const { draftFiId } = await seedPosts(d1);
    const app = buildApp();

    const res = await request(
      app,
      permissiveEnv(d1),
      `/ops/console/blog/posts/${draftFiId}/publish`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...OPS },
        body: JSON.stringify({ operator: 'ops-1' }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; publishedAt: string | null };
    expect(body.status).toBe('PUBLISHED');
    expect(body.publishedAt).not.toBeNull();

    // Public visibility after publish.
    const publicRes = await request(
      app,
      permissiveEnv(d1),
      '/api/v1/blog/posts/veromuutos-v2026-09?locale=fi',
    );
    expect(publicRes.status).toBe(200);

    // The action is audited.
    const entries = await new WorkerAuditService(d1).queryChanges({ limit: 10 });
    const event = entries.find((e) => e.entityType === 'blog_post');
    expect(event).toBeDefined();
    expect(event!.action).toBe('confirmed');
    expect(event!.author).toBe('ops-1');
  });

  it('refuses a body that violates the content policy (draft stays a draft)', async () => {
    const { d1 } = openMigratedD1();
    const repo = new D1BlogPostRepository(d1);
    const violating = await repo.create({
      slug: 'veromuutos-paras',
      locale: 'fi',
      title: 'Paras veromuutos',
      bodyMarkdown: 'Tämä on paras ja halvin veromuutos koska.',
      rateDatasetVersion: 'v-x',
    });

    const app = buildApp();
    const res = await request(
      app,
      permissiveEnv(d1),
      `/ops/console/blog/posts/${violating.id}/publish`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...OPS },
        body: JSON.stringify({ operator: 'ops-1' }),
      },
    );
    await expectEnvelope(res, 400, { error: 'ContentPolicyViolation' });

    const after = await repo.findById(violating.id);
    expect(after!.status).toBe('DRAFT');
  });

  it('answers 409 on re-publish (PUBLISHED is terminal)', async () => {
    const { d1 } = openMigratedD1();
    const { publishedId } = await seedPosts(d1);
    const app = buildApp();
    const res = await request(
      app,
      permissiveEnv(d1),
      `/ops/console/blog/posts/${publishedId}/publish`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...OPS },
        body: JSON.stringify({ operator: 'ops-1' }),
      },
    );
    await expectEnvelope(res, 409, { error: 'InvalidTransition' });
  });

  it('denies the console without ops access (fail-closed prefix)', async () => {
    const { d1 } = openMigratedD1();
    const { draftFiId } = await seedPosts(d1);
    const app = buildApp();
    const res = await request(
      app,
      { ...permissiveEnv(d1), OPS_BEARER_TOKEN: undefined },
      `/ops/console/blog/posts/${draftFiId}/publish`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operator: 'ops-1' }),
      },
    );
    await expectEnvelope(res, 403, { message: 'Forbidden' });
  });

  it('requires the operator identity with 400', async () => {
    const { d1 } = openMigratedD1();
    const { draftFiId } = await seedPosts(d1);
    const app = buildApp();
    const res = await request(
      app,
      permissiveEnv(d1),
      `/ops/console/blog/posts/${draftFiId}/publish`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...OPS },
        body: JSON.stringify({}),
      },
    );
    await expectEnvelope(res, 400, {});
  });
});

// ---------------------------------------------------------------------------
// Guides (insight-surfaces 5.1) — operator-created GUIDE drafts, published
// through the same human gate; guides carry no rate-version provenance and
// kinds never mix in listings (spec guides-hub + content-publication).
// ---------------------------------------------------------------------------

/** Clean FI guide body — passes the content-policy lint. */
const GUIDE_FI_BODY =
  'Tämä opas käsittelee Alkon hintarakenteen ja matkatavaramäärien laskennan perusteet.\n\n' +
  'Lasketun kokonaishinnan arvio on arvio, ei lopullinen verovelka.';

/** Clean EN guide body — passes the content-policy lint. */
const GUIDE_EN_BODY =
  'This guide explains the Finnish retail price structure and allowance calculation basics.\n\n' +
  'The estimated total cost is an estimate, not a final tax liability.';

interface CreatedGuide {
  readonly id: number;
  readonly slug: string;
  readonly locale: string;
  readonly kind: string;
  readonly status: string;
}

/** Create one GUIDE draft through the ops console. */
async function createGuide(
  app: ReturnType<typeof buildApp>,
  env: ReturnType<typeof permissiveEnv>,
  overrides: {
    slug?: string;
    locale?: string;
    title?: string;
    bodyMarkdown?: string;
  } = {},
): Promise<CreatedGuide> {
  const res = await request(app, env, '/ops/console/blog/guides', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...OPS },
    body: JSON.stringify({
      operator: 'ops-1',
      slug: overrides.slug ?? 'opas-hintarakenteesta',
      locale: overrides.locale ?? 'fi',
      title: overrides.title ?? 'Opas hintarakenteesta',
      bodyMarkdown: overrides.bodyMarkdown ?? GUIDE_FI_BODY,
    }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as CreatedGuide;
}

describe('POST /ops/console/blog/guides — GUIDE draft creation', () => {
  it('creates a GUIDE draft without rate provenance; invisible publicly', async () => {
    const { d1 } = openMigratedD1();
    await seedPosts(d1);
    const app = buildApp();
    const created = await createGuide(app, permissiveEnv(d1));

    expect(created.kind).toBe('GUIDE');
    expect(created.status).toBe('DRAFT');

    // The stored row carries the kind and NO rate-dataset version.
    const repo = new D1BlogPostRepository(d1);
    const stored = await repo.findById(created.id);
    expect(stored).not.toBeNull();
    expect(stored!.kind).toBe('GUIDE');
    expect(stored!.rateDatasetVersion).toBeNull();

    // Public surfaces: the draft does not exist.
    const blogIndex = await request(
      app,
      permissiveEnv(d1),
      '/api/v1/blog/posts?locale=fi',
    );
    const blogBody = (await blogIndex.json()) as { items: Array<{ slug: string }> };
    expect(blogBody.items.map((i) => i.slug)).not.toContain(created.slug);

    const guidesIndex = await request(
      app,
      permissiveEnv(d1),
      '/api/v1/guides?locale=fi',
    );
    const guidesBody = (await guidesIndex.json()) as { total: number };
    expect(guidesBody.total).toBe(0);

    const slugRes = await request(
      app,
      permissiveEnv(d1),
      `/api/v1/blog/posts/${created.slug}?locale=fi`,
    );
    expect(slugRes.status).toBe(404);
  });

  it('denies creation without ops access (fail-closed prefix)', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const res = await request(app, permissiveEnv(d1, { OPS_BEARER_TOKEN: undefined }), '/ops/console/blog/guides', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operator: 'ops-1',
        slug: 'opas-hintarakenteesta',
        locale: 'fi',
        title: 'Opas hintarakenteesta',
        bodyMarkdown: GUIDE_FI_BODY,
      }),
    });
    await expectEnvelope(res, 403, { message: 'Forbidden' });
  });

  it('rejects an invalid payload with 400', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);

    const badLocale = await request(app, env, '/ops/console/blog/guides', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...OPS },
      body: JSON.stringify({
        operator: 'ops-1',
        slug: 'opas',
        locale: 'sv',
        title: 'Opas',
        bodyMarkdown: GUIDE_FI_BODY,
      }),
    });
    await expectEnvelope(badLocale, 400, { error: 'ValidationError' });

    const badSlug = await request(app, env, '/ops/console/blog/guides', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...OPS },
      body: JSON.stringify({
        operator: 'ops-1',
        slug: 'Ei Kelpaa!',
        locale: 'fi',
        title: 'Opas',
        bodyMarkdown: GUIDE_FI_BODY,
      }),
    });
    await expectEnvelope(badSlug, 400, { error: 'ValidationError' });
  });

  it('answers 409 when the (slug, locale) already exists', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);
    await createGuide(app, env);

    const res = await request(app, env, '/ops/console/blog/guides', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...OPS },
      body: JSON.stringify({
        operator: 'ops-1',
        slug: 'opas-hintarakenteesta',
        locale: 'fi',
        title: 'Opas hintarakenteesta',
        bodyMarkdown: GUIDE_FI_BODY,
      }),
    });
    await expectEnvelope(res, 409, { error: 'SlugConflict' });
  });
});

describe('POST /ops/console/blog/guides/:id — draft edits', () => {
  it('patches a DRAFT guide and appends to the audit trail', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);
    const created = await createGuide(app, env);

    const res = await request(app, env, `/ops/console/blog/guides/${created.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...OPS },
      body: JSON.stringify({
        operator: 'ops-2',
        title: 'Uusi opasotsikko',
        bodyMarkdown: GUIDE_EN_BODY,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { title?: string; status: string };
    expect(body.status).toBe('DRAFT');

    const stored = await new D1BlogPostRepository(d1).findById(created.id);
    expect(stored!.title).toBe('Uusi opasotsikko');
    expect(stored!.bodyMarkdown).toBe(GUIDE_EN_BODY);
    expect(stored!.rateDatasetVersion).toBeNull();

    const entries = await new WorkerAuditService(d1).queryChanges({ limit: 10 });
    const event = entries.find((e) => e.entityType === 'blog_post' && e.action === 'updated');
    expect(event).toBeDefined();
    expect(event!.author).toBe('ops-2');
  });

  it('refuses to edit a PUBLISHED guide with 409', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);
    const created = await createGuide(app, env);
    expect(
      (await request(app, env, `/ops/console/blog/posts/${created.id}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...OPS },
        body: JSON.stringify({ operator: 'ops-1' }),
      })).status,
    ).toBe(200);

    const res = await request(app, env, `/ops/console/blog/guides/${created.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...OPS },
      body: JSON.stringify({ operator: 'ops-1', title: 'Myöhäinen muutos' }),
    });
    await expectEnvelope(res, 409, { error: 'InvalidTransition' });
  });

  it('answers 404 for an unknown guide id', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const res = await request(app, permissiveEnv(d1), '/ops/console/blog/guides/9999', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...OPS },
      body: JSON.stringify({ operator: 'ops-1', title: 'Ei ole' }),
    });
    await expectEnvelope(res, 404, {});
  });
});

describe('GUIDE publication — the same human gate, kind-filtered listings', () => {
  it('publishes a guide: listed under /api/v1/guides, never on the blog index; audited', async () => {
    const { d1 } = openMigratedD1();
    await seedPosts(d1); // one PUBLISHED RATE_CHANGE post on the fi index
    const app = buildApp();
    const env = permissiveEnv(d1);
    const created = await createGuide(app, env);

    const res = await request(app, env, `/ops/console/blog/posts/${created.id}/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...OPS },
      body: JSON.stringify({ operator: 'ops-1' }),
    });
    expect(res.status).toBe(200);
    const published = (await res.json()) as { status: string; kind: string };
    expect(published.status).toBe('PUBLISHED');

    // The guides index lists it; the blog index does not (kinds never mix).
    const guidesIndex = await request(app, env, '/api/v1/guides?locale=fi');
    const guidesBody = (await guidesIndex.json()) as {
      items: Array<{ slug: string; rateDatasetVersion: string | null }>;
    };
    expect(guidesBody.items.map((i) => i.slug)).toEqual([created.slug]);
    expect(guidesBody.items[0]!.rateDatasetVersion).toBeNull();

    const blogIndex = await request(app, env, '/api/v1/blog/posts?locale=fi');
    const blogBody = (await blogIndex.json()) as { items: Array<{ slug: string }> };
    expect(blogBody.items.map((i) => i.slug)).toEqual(['veromuutos-v2026-01']);

    // The action is audited through the same trail.
    const entries = await new WorkerAuditService(d1).queryChanges({ limit: 10 });
    const event = entries.find(
      (e) => e.entityType === 'blog_post' && e.action === 'confirmed',
    );
    expect(event).toBeDefined();
    expect(event!.author).toBe('ops-1');
  });

  it('lint blocks a violating guide body in either locale (draft stays a draft)', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);

    const fi = await createGuide(app, env, {
      slug: 'opas-paras',
      title: 'Paras opas',
      bodyMarkdown: 'Tämä on paras ja halvin opas koska.',
    });
    await expectEnvelope(
      await request(app, env, `/ops/console/blog/posts/${fi.id}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...OPS },
        body: JSON.stringify({ operator: 'ops-1' }),
      }),
      400,
      { error: 'ContentPolicyViolation' },
    );

    const en = await createGuide(app, env, {
      slug: 'guide-cheapest',
      locale: 'en',
      title: 'The cheapest guide',
      bodyMarkdown: 'This is the cheapest and best guide there is.',
    });
    await expectEnvelope(
      await request(app, env, `/ops/console/blog/posts/${en.id}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...OPS },
        body: JSON.stringify({ operator: 'ops-1' }),
      }),
      400,
      { error: 'ContentPolicyViolation' },
    );

    const repo = new D1BlogPostRepository(d1);
    expect((await repo.findById(fi.id))!.status).toBe('DRAFT');
    expect((await repo.findById(en.id))!.status).toBe('DRAFT');
  });

  it('ops list filters by kind and reports the kind per item', async () => {
    const { d1 } = openMigratedD1();
    await seedPosts(d1);
    const app = buildApp();
    const env = permissiveEnv(d1);
    await createGuide(app, env);

    const guides = await request(app, env, '/ops/console/blog/posts?kind=GUIDE', {
      headers: OPS,
    });
    const guidesBody = (await guides.json()) as {
      items: Array<{ kind: string; slug: string }>;
      total: number;
    };
    expect(guidesBody.total).toBe(1);
    expect(guidesBody.items[0]!.kind).toBe('GUIDE');

    const rates = await request(app, env, '/ops/console/blog/posts?kind=RATE_CHANGE', {
      headers: OPS,
    });
    const ratesBody = (await rates.json()) as {
      items: Array<{ kind: string }>;
      total: number;
    };
    expect(ratesBody.total).toBe(3);
    expect(ratesBody.items.every((i) => i.kind === 'RATE_CHANGE')).toBe(true);

    const badKind = await request(app, env, '/ops/console/blog/posts?kind=GUIDEBOOK', {
      headers: OPS,
    });
    await expectEnvelope(badKind, 400, { error: 'ValidationError' });
  });
});
