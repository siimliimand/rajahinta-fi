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
 * - the public endpoints return PUBLISHED posts only.
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
