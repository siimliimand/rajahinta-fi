/**
 * Traveller-allowance server fetch (task 4.2, change insight-surfaces;
 * API contract committed in task 4.1, api-worker allowances.routes.ts).
 *
 * The responses mirror the routes' serialization EXACTLY — date, the
 * dataset block (version label, citation, effective window) and the
 * per-category limit rows with their verbatim citations and windows.
 * The frontend types are declared here rather than in the shared
 * lib/types because the touch set is the allowances scope; the route
 * remains the single source of truth.
 *
 * Outcome semantics (the distinction the page renders on):
 *   - no published version covers the date → `{ kind: 'not-found' }`
 *     (the API's explicit 404 — an uncovered date is never guessed)
 *   - fetch failure → `{ kind: 'unavailable' }` (API 400/403/5xx,
 *     unreachable backend, unexpected shape — degrade, never error
 *     the response)
 *   - covered date → `{ kind: 'ok', payload }`
 *
 * Fetch pattern: server-side with the sitemap's 900 s revalidation
 * cadence (official reference data, amended rarely — not per-second
 * price data). Both endpoints sit behind the age gate, so the request
 * carries the same fixed first-party SSR token lib/api.ts uses for the
 * catalog reads; the constant is declared locally because lib/api.ts
 * keeps it module-private and this task's touch set excludes lib/.
 *
 * @module AllowancesServer
 */

import { ApiFetchError, request } from '@/lib/api';

/** Same fixed first-party SSR token as lib/api.ts (see module docblock). */
const SERVER_AGE_CONFIRMATION_TOKEN = 'server-prerender';

/** One per-category cap row — mirrors the route's serialization exactly. */
export interface AllowanceLimit {
  readonly category: string;
  /** Litre cap — null when the cap is quantity-only. */
  readonly volumeCapLitres: number | null;
  /** Unit cap — null when the cap is volume-only. */
  readonly quantityCap: number | null;
  /** The stored citation, passed through verbatim — never paraphrased. */
  readonly sourceCitation: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

/** The published dataset a date resolved to. */
export interface AllowanceDataset {
  readonly versionLabel: string;
  readonly sourceCitation: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

/** GET /api/v1/allowances?date= response. */
export interface AllowancesPayload {
  readonly date: string;
  readonly dataset: AllowanceDataset;
  readonly limits: readonly AllowanceLimit[];
}

/** GET /api/v1/allowances/versions — one published version row. */
export interface AllowanceVersionEntry {
  readonly versionLabel: string;
  readonly sourceCitation: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly limits: readonly AllowanceLimit[];
}

/** What the page renders on for the per-date read. */
export type AllowancesOutcome =
  | { readonly kind: 'ok'; readonly payload: AllowancesPayload }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'unavailable' };

/** What the page renders on for the version-history read. */
export type AllowanceVersionsOutcome =
  | { readonly kind: 'ok'; readonly versions: readonly AllowanceVersionEntry[] }
  | { readonly kind: 'unavailable' };

/** Today as a UTC calendar date — the API's query-less default. */
export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Narrow `?date=` to a real calendar date, defaulting to today. A
 * missing or malformed value resolves to today instead of reaching the
 * API for a 400 (the value page's category-normalization precedent);
 * a well-formed but impossible date (2026-02-30) resolves to today too
 * — the native date input cannot produce one, so it is a hand-crafted
 * query, and today is the page's honest default answer either way.
 */
export function resolveRequestedDate(raw: string | undefined): string {
  if (raw === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return todayIsoDate();
  }
  const [y, m, d] = raw.split('-').map((part) => Number.parseInt(part, 10));
  const asUtc = new Date(Date.UTC(y, m - 1, d));
  const real =
    asUtc.getUTCFullYear() === y &&
    asUtc.getUTCMonth() === m - 1 &&
    asUtc.getUTCDate() === d;
  return real ? raw : todayIsoDate();
}

/**
 * Fetch the allowances effective on one date, classified into the
 * page's three render outcomes. The explicit 404 (uncovered date)
 * maps to `not-found`; everything else the page cannot act on degrades
 * to `unavailable`, mirroring the curated-list degradation contract.
 */
export async function getServerAllowances(
  date: string,
): Promise<AllowancesOutcome> {
  try {
    const payload = await request<AllowancesPayload>(
      `/api/v1/allowances?date=${encodeURIComponent(date)}`,
      {
        headers: {
          accept: 'application/json',
          'x-age-confirmed': SERVER_AGE_CONFIRMATION_TOKEN,
        },
        next: { revalidate: 900 },
      },
    );
    if (
      typeof payload?.date !== 'string' ||
      typeof payload?.dataset?.versionLabel !== 'string' ||
      typeof payload?.dataset?.sourceCitation !== 'string' ||
      !Array.isArray(payload?.limits)
    ) {
      return { kind: 'unavailable' };
    }
    return { kind: 'ok', payload };
  } catch (err: unknown) {
    if (err instanceof ApiFetchError && err.status === 404) {
      return { kind: 'not-found' };
    }
    return { kind: 'unavailable' };
  }
}

/**
 * Fetch the published version history (superseded included, newest
 * effective window first — the API's served order, rendered verbatim).
 * Any failure degrades to `unavailable`.
 */
export async function getServerAllowanceVersions(): Promise<AllowanceVersionsOutcome> {
  try {
    const body = await request<{ versions: readonly AllowanceVersionEntry[] }>(
      '/api/v1/allowances/versions',
      {
        headers: {
          accept: 'application/json',
          'x-age-confirmed': SERVER_AGE_CONFIRMATION_TOKEN,
        },
        next: { revalidate: 900 },
      },
    );
    if (!Array.isArray(body?.versions)) {
      return { kind: 'unavailable' };
    }
    return { kind: 'ok', versions: body.versions };
  } catch {
    return { kind: 'unavailable' };
  }
}
