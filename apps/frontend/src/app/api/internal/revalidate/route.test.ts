/**
 * Route-handler tests for the internal cache-revalidation endpoint (change
 * revalidate-guides-on-publish; spec web-application "Internal
 * cache-revalidation endpoint").
 *
 * `next/cache` and the OpenNext context are mocked — the handler's contract
 * under test is the auth matrix, the tag allowlist, and that an accepted
 * call revalidates exactly the allowlisted tags it was given.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const revalidateTag = vi.fn();

vi.mock('next/cache', () => ({
  revalidateTag: (tag: string) => revalidateTag(tag),
}));

const mockEnv: { REVALIDATE_TOKEN?: string } = {};

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => ({ env: mockEnv }),
}));

import { POST } from './route';

const TOKEN = 'test-token-0123456789abcdef';

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request('https://rajahinta.fi/api/internal/revalidate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  revalidateTag.mockClear();
  delete mockEnv.REVALIDATE_TOKEN;
});

describe('POST /api/internal/revalidate', () => {
  it('answers 503 (feature off) when no secret is configured', async () => {
    const res = await post({ tags: ['guides'] });
    expect(res.status).toBe(503);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('answers 401 on a missing secret header', async () => {
    mockEnv.REVALIDATE_TOKEN = TOKEN;
    const res = await post({ tags: ['guides'] });
    expect(res.status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('answers 401 on a wrong secret and never leaks match length', async () => {
    mockEnv.REVALIDATE_TOKEN = TOKEN;
    const res = await post({ tags: ['guides'] }, { 'x-revalidate-token': 'x' });
    expect(res.status).toBe(401);
    const short = await post({ tags: ['guides'] }, { 'x-revalidate-token': 'short' });
    expect(short.status).toBe(401);
    const prefix = await post({ tags: ['guides'] }, { 'x-revalidate-token': TOKEN.slice(0, 8) });
    expect(prefix.status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('revalidates allowlisted tags on a correct secret', async () => {
    mockEnv.REVALIDATE_TOKEN = TOKEN;
    const res = await post({ tags: ['guides', 'blog'] }, { 'x-revalidate-token': TOKEN });
    expect(res.status).toBe(200);
    expect(revalidateTag).toHaveBeenCalledTimes(2);
    expect(revalidateTag).toHaveBeenCalledWith('guides');
    expect(revalidateTag).toHaveBeenCalledWith('blog');
    const body = (await res.json()) as { revalidated: string[] };
    expect(body.revalidated).toEqual(['guides', 'blog']);
  });

  it('filters non-allowlisted tags and answers 400 when nothing remains', async () => {
    mockEnv.REVALIDATE_TOKEN = TOKEN;
    const partial = await post(
      { tags: ['guides', 'products', 42] },
      { 'x-revalidate-token': TOKEN },
    );
    expect(partial.status).toBe(200);
    expect(revalidateTag).toHaveBeenCalledTimes(1);
    expect(revalidateTag).toHaveBeenCalledWith('guides');

    const empty = await post({ tags: ['products'] }, { 'x-revalidate-token': TOKEN });
    expect(empty.status).toBe(400);
    expect(revalidateTag).toHaveBeenCalledTimes(1);
  });

  it('answers 400 on a non-array tags field or invalid JSON', async () => {
    mockEnv.REVALIDATE_TOKEN = TOKEN;
    const noTags = await post({}, { 'x-revalidate-token': TOKEN });
    expect(noTags.status).toBe(400);

    const badJson = POST(
      new Request('https://rajahinta.fi/api/internal/revalidate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-revalidate-token': TOKEN },
        body: 'not json',
      }),
    );
    await expect(badJson).resolves.toMatchObject({ status: 400 });
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('falls back to process.env when no Cloudflare context binding is set', async () => {
    process.env.REVALIDATE_TOKEN = TOKEN;
    try {
      const res = await post({ tags: ['guides'] }, { 'x-revalidate-token': TOKEN });
      expect(res.status).toBe(200);
      expect(revalidateTag).toHaveBeenCalledWith('guides');
    } finally {
      delete process.env.REVALIDATE_TOKEN;
    }
  });
});
