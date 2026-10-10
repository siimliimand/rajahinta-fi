/**
 * Internal cache-revalidation endpoint (change revalidate-guides-on-publish;
 * spec web-application "Internal cache-revalidation endpoint").
 *
 * The API worker's ops-console publish transition calls this after a
 * successful blog-post publish so published content is visible on the first
 * request instead of up to 900 s later (the guide/blog server fetches cache
 * their API responses with `next: { revalidate: 900 }` — tags added by the
 * same change).
 *
 * Contract:
 *   - POST only (any other method: framework 405);
 *   - `x-revalidate-token` header vs the `REVALIDATE_TOKEN` worker secret,
 *     compared in constant time — no secret configured → 503 (feature off,
 *     deliberately not a 401 so a misconfigured deployment is distinguishable
 *     from an unauthorized caller);
 *   - body `{ tags: string[] }` filtered against the allowlist — an empty
 *     intersection → 400;
 *   - responses never echo the secret.
 */

import { revalidateTag } from 'next/cache';
import { getCloudflareContext } from '@opennextjs/cloudflare';

export const dynamic = 'force-dynamic';

/** Tags this endpoint may revalidate — keep in sync with the server fetches. */
const ALLOWED_TAGS: readonly string[] = ['guides', 'blog'];

/** The header the API worker sends. */
const TOKEN_HEADER = 'x-revalidate-token';

/**
 * Resolve the worker secret. The OpenNext adapter exposes worker bindings
 * through `getCloudflareContext().env`; outside the worker (next dev without
 * the adapter, vitest) that throws, so fall back to `process.env`.
 */
function resolveExpectedToken(): string | undefined {
  try {
    const env = getCloudflareContext().env as Record<string, unknown> | undefined;
    const fromBinding = env?.REVALIDATE_TOKEN;
    if (typeof fromBinding === 'string' && fromBinding.length > 0) {
      return fromBinding;
    }
  } catch {
    // No Cloudflare context in this runtime — fall through to process.env.
  }
  const fromProcess = process.env.REVALIDATE_TOKEN;
  return typeof fromProcess === 'string' && fromProcess.length > 0
    ? fromProcess
    : undefined;
}

/**
 * Length-independent constant-time comparison: always scans the longer
 * input so response timing does not leak the secret's length or a matching
 * prefix.
 */
function tokensMatch(provided: string, expected: string): boolean {
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(expected);
  const length = Math.max(a.length, b.length);
  let mismatch = a.length === b.length ? 0 : 1;
  for (let i = 0; i < length; i += 1) {
    mismatch |= (a[i % a.length] ?? 0) ^ (b[i % b.length] ?? 0);
  }
  return mismatch === 0;
}

export async function POST(request: Request): Promise<Response> {
  const expected = resolveExpectedToken();
  if (expected === undefined) {
    return Response.json(
      { error: 'Revalidation is not configured' },
      { status: 503 },
    );
  }

  const provided = request.headers.get(TOKEN_HEADER);
  if (typeof provided !== 'string' || !tokensMatch(provided, expected)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Body must be JSON' }, { status: 400 });
  }

  const rawTags = (body as { tags?: unknown } | null)?.tags;
  if (!Array.isArray(rawTags)) {
    return Response.json(
      { error: 'Body must be { tags: string[] }' },
      { status: 400 },
    );
  }

  const tags = [...new Set(rawTags)].filter(
    (tag): tag is string => typeof tag === 'string' && ALLOWED_TAGS.includes(tag),
  );
  if (tags.length === 0) {
    return Response.json(
      { error: `No revalidatable tags — allowed: ${ALLOWED_TAGS.join(', ')}` },
      { status: 400 },
    );
  }

  for (const tag of tags) {
    revalidateTag(tag);
  }

  return Response.json({ revalidated: tags, revalidatedAt: new Date().toISOString() });
}
