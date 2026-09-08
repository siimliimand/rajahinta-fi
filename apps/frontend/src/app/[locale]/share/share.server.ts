/**
 * Share-snapshot server fetch (trust-and-reach-roadmap task 6.2; API
 * contract committed in task 6.1, apps/api-worker share.routes.ts).
 *
 * Outcome semantics (the distinction the page renders on):
 *   - unknown or malformed publicId → `{ kind: 'not-found' }` (the API
 *     answers the SAME 404 for both — no identifier-existence leakage —
 *     and this module carries no logic that could re-introduce one)
 *   - fetch failure                → `{ kind: 'unavailable' }` (backend
 *     down, unexpected shape — a live link must not die on a transient
 *     outage, so it degrades instead of 404ing)
 *   - found                        → `{ kind: 'ok', snapshot }`
 *
 * Fetch pattern: the snapshot is a frozen copy, so the read caches with
 * the site's 900 s revalidation cadence. The endpoint is public and
 * unguarded — no age-confirmation header, no session.
 *
 * @module ShareServer
 */

import { ApiFetchError, request } from '@/lib/api';
import type { ShareSnapshotResponse } from '@/lib/types';

/** What the share page renders on. */
export type ShareSnapshotOutcome =
  | { readonly kind: 'ok'; readonly snapshot: ShareSnapshotResponse }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'unavailable' };

/** Structural guard on the response — an unexpected shape degrades. */
function isShareSnapshotResponse(value: unknown): value is ShareSnapshotResponse {
  if (typeof value !== 'object' || value === null) return false;
  const res = value as Record<string, unknown>;
  if (typeof res.publicId !== 'string' || typeof res.createdAt !== 'string') {
    return false;
  }
  const snap = res.snapshot as Record<string, unknown> | null | undefined;
  return (
    typeof snap === 'object' &&
    snap !== null &&
    typeof snap.type === 'string' &&
    typeof snap.totalCents === 'number' &&
    typeof snap.calculatedAt === 'string'
  );
}

/**
 * One frozen share snapshot by public id. Shape validation happens
 * FIRST in the route (malformed ids can never exist), so this fetch
 * needs no client-side mirror of the id contract — the API's uniform
 * 404 is the not-found signal.
 */
export async function getServerShareSnapshot(
  publicId: string,
): Promise<ShareSnapshotOutcome> {
  try {
    const snapshot = await request<ShareSnapshotResponse>(
      `/api/v1/share/${encodeURIComponent(publicId)}`,
      {
        headers: { accept: 'application/json' },
        next: { revalidate: 900 },
      },
    );
    if (!isShareSnapshotResponse(snapshot)) {
      return { kind: 'unavailable' };
    }
    return { kind: 'ok', snapshot };
  } catch (err: unknown) {
    if (err instanceof ApiFetchError && err.status === 404) {
      return { kind: 'not-found' };
    }
    return { kind: 'unavailable' };
  }
}
