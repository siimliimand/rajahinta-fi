'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ApiFetchError, request } from '@/lib/api';
import type { ApiFailureClass } from '@/lib/api';
import type {
  UnitPriceRankingItem,
  UnitPriceRankingResponse,
} from '@/lib/types';
import { RELIABILITY_STATUS_META } from '@/lib/design/status';
import {
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  ReliabilityBadge,
} from '@/components/ui';
import { Link } from '@/i18n/navigation';
import type { ValueCategoryKey } from '../categories';

// ---------------------------------------------------------------------------
// Stale-while-error cache (listing-failure-honesty task 2.2)
// ---------------------------------------------------------------------------

/**
 * localStorage key of one category's last-good ranking response. The
 * category is part of the key, so a failed fetch of one category never
 * falls back to another category's rows.
 */
const CACHE_KEY_PREFIX = 'rajahinta.value-ranking.';

/** A persisted last-good response: the parsed payload plus its fetch time. */
interface CachedRanking {
  readonly response: UnitPriceRankingResponse;
  /** ISO timestamp of the fetch that produced the response. */
  readonly fetchedAt: string;
}

/**
 * Read the persisted last-good response for one category. Returns null
 * when nothing is stored, storage is unavailable (SSR, private mode), or
 * the entry does not parse or has lost its shape — a corrupted entry
 * behaves exactly like an absent one and never crashes the surface.
 */
function readCachedRanking(category: string): CachedRanking | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY_PREFIX + category);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as CachedRanking).fetchedAt !== 'string' ||
      !Array.isArray((parsed as CachedRanking).response?.items)
    ) {
      return null;
    }
    return parsed as CachedRanking;
  } catch {
    return null;
  }
}

/**
 * Persist one successful response per category, called before the
 * response reaches state so the fallback can never trail the render.
 * Best-effort: a full or unavailable localStorage only turns the
 * stale-while-error fallback off; it never fails the fetch itself.
 */
function writeCachedRanking(
  category: string,
  response: UnitPriceRankingResponse,
): void {
  if (typeof window === 'undefined') return;
  try {
    const entry: CachedRanking = {
      response,
      fetchedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(
      CACHE_KEY_PREFIX + category,
      JSON.stringify(entry),
    );
  } catch {
    // Quota exceeded or storage blocked — no fallback, nothing to recover.
  }
}

// ---------------------------------------------------------------------------
// Failure classification (listing-failure-honesty task 2.1)
// ---------------------------------------------------------------------------

/**
 * Map a ranking-fetch rejection to its failure class. `request()` already
 * wraps every transport rejection in an `ApiFetchError`; the raw-abort
 * branch is belt-and-braces for an unwrapped TimeoutError/AbortError, and
 * anything else joins the transient server/network family — the classes
 * the transient affordance covers.
 */
function classifyFailure(err: unknown): ApiFailureClass {
  if (err instanceof ApiFetchError) return err.failureClass;
  if (
    (err instanceof DOMException || err instanceof Error) &&
    (err.name === 'AbortError' || err.name === 'TimeoutError')
  ) {
    return 'timeout';
  }
  return 'server';
}

/**
 * Format an ISO timestamp with the fi-FI conventions used across the app
 * (locale-adjusted, same as the group-order helper); an unparseable value
 * renders as-is rather than "Invalid Date".
 */
function formatTimestamp(iso: string, locale: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(locale === 'en' ? 'en-IE' : 'fi-FI', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * The per-category €/g ranking table (trust-and-reach-roadmap task 7.2).
 *
 * Data comes from the age-gated `GET /api/v1/unitprice/ranking` through
 * the shared API client, so the visitor's confirmation cookie travels.
 * A failure renders its class-distinct state (listing-failure-honesty
 * 2.1): a 403 age-gate rejection renders the age confirmation CTA — never
 * the backend-unavailable copy — a 429 renders backoff copy, and the
 * transient family (timeout, server, network) keeps the established
 * ErrorState with retry. On any failure the category's persisted
 * last-good response, if one exists, renders above the affordance with a
 * visible as-of label (stale-while-error, 2.2); with no cached rows the
 * class-distinct state renders alone. Every successful response is
 * persisted before it reaches state.
 *
 * Every row carries the standard reliability badge (canonical
 * VERIFIED/ESTIMATED presentation, labels resolved through the root
 * translator and RELIABILITY_STATUS_META — the same source of truth as
 * the compare view). An empty category renders the honest empty state;
 * rows are never invented.
 */
export default function ValueRanking({
  category,
}: {
  category: ValueCategoryKey;
}) {
  const t = useTranslations('ValuePage');
  // Root translator: status labels resolve through the canonical labelKey
  // contract in RELIABILITY_STATUS_META.
  const tRoot = useTranslations();
  const locale = useLocale();

  const [data, setData] = useState<UnitPriceRankingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  /** Failure class of the latest fetch; null while it stands. */
  const [failure, setFailure] = useState<ApiFailureClass | null>(null);
  /** Persisted last-good response for this category, read on failure. */
  const [stale, setStale] = useState<CachedRanking | null>(null);
  // Bumping this value re-runs the effect — the retry affordance.
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailure(null);
    setStale(null);

    request<UnitPriceRankingResponse>(
      `/api/v1/unitprice/ranking?category=${encodeURIComponent(category)}`,
      // The API computes the ranking live (design D7); a dead backend used
      // to leave this fetch pending for the browser's ~100 s default. The
      // timeout surfaces the failure through the existing ErrorState/retry
      // in seconds instead.
      { signal: AbortSignal.timeout(10_000) },
    )
      .then((res) => {
        if (!cancelled) {
          // Persist before the response reaches state, so a failure of a
          // later fetch always finds this one as the fallback.
          writeCachedRanking(category, res);
          setData(res);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setFailure(classifyFailure(err));
          setStale(readCachedRanking(category));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [category, reloadToken]);

  const retry = useCallback(() => setReloadToken((n) => n + 1), []);

  // The table markup is shared verbatim by the success path and the
  // stale-while-error path — the fallback renders the same rows the API
  // once served, never a reshaped variant.
  const renderTable = (response: UnitPriceRankingResponse) => (
    <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <table className="w-full text-sm">
        <caption className="sr-only">
          {/* The validated prop, not the echoed response field — the
              caption key must always resolve to a known category. */}
          {t('tableCaption', { category: t(`category.${category}`) })}
        </caption>
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
            <th scope="col" className="pb-2 pr-4 font-medium">
              {t('columnPosition')}
            </th>
            <th scope="col" className="pb-2 pr-4 font-medium">
              {t('columnProduct')}
            </th>
            <th scope="col" className="pb-2 pr-4 font-medium">
              {t('columnEurPerGram')}
            </th>
            <th scope="col" className="pb-2 pr-4 font-medium">
              {t('columnEthanol')}
            </th>
            <th scope="col" className="pb-2 font-medium">
              {t('columnReliability')}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {response.items.map((item, index) => (
            <RankingRow
              key={item.productId}
              item={item}
              position={index + 1}
              labelStatus={tRoot(
                RELIABILITY_STATUS_META[item.reliabilityStatus].labelKey,
              )}
              unitLabel={t('unit')}
            />
          ))}
        </tbody>
      </table>
    </section>
  );

  if (loading) {
    return (
      <div aria-live="polite">
        {/* Skeleton is decorative; the live region announces the wait. */}
        <LoadingSkeleton variant="text" count={6} />
        <span className="sr-only">{t('loading')}</span>
      </div>
    );
  }

  if (failure !== null) {
    // Stale-while-error: the persisted response stands in above the
    // class-appropriate affordance, visibly dated. A cached response with
    // no rows cannot stand in for a listing, so it behaves as absent.
    const cached =
      stale !== null && stale.response.items.length > 0 ? stale : null;
    return (
      <div className="space-y-4">
        {cached !== null && (
          <div>
            <p className="mb-2 text-sm text-gray-500">
              {t('staleAsOfLabel', {
                date: formatTimestamp(cached.fetchedAt, locale),
              })}
            </p>
            {renderTable(cached.response)}
          </div>
        )}
        <RankingFailureNotice failureClass={failure} onRetry={retry} />
      </div>
    );
  }

  if (data === null || data.items.length === 0) {
    return <EmptyState title={t('emptyTitle')} description={t('emptyBody')} />;
  }

  return renderTable(data);
}

// ---------------------------------------------------------------------------
// Failure notice
// ---------------------------------------------------------------------------

/**
 * The class-distinct failure affordance (listing-failure-honesty 2.1).
 *
 * Age-gate rejection (403) renders the age confirmation CTA — the visit
 * is missing a confirmation, not suffering a backend outage, so the
 * backend-unavailable copy never appears here; the link rides the
 * ErrorState children row (the component's documented slot for a link
 * affordance). Rate limiting (429) renders backoff copy with retry.
 * Timeout, server, network, and the honest unknown residual render the
 * established transient ErrorState with retry, unchanged.
 */
function RankingFailureNotice({
  failureClass,
  onRetry,
}: {
  failureClass: ApiFailureClass;
  onRetry: () => void;
}) {
  const t = useTranslations('ValuePage');
  const tCommon = useTranslations('Common');

  if (failureClass === 'age-gate') {
    return (
      <ErrorState
        title={t('ageGateCtaTitle')}
        description={t('ageGateCtaBody')}
      >
        <Link
          href="/age-gate"
          className="font-medium text-error-fg underline hover:text-error"
        >
          {t('ageGateCtaLink')}
        </Link>
      </ErrorState>
    );
  }

  if (failureClass === 'rate-limited') {
    return (
      <ErrorState
        title={t('errorTitle')}
        description={t('rateLimitBody')}
        onRetry={onRetry}
        retryLabel={tCommon('retry')}
      />
    );
  }

  // timeout / server / network / unknown — the transient family.
  return (
    <ErrorState
      title={t('errorTitle')}
      description={t('errorBody')}
      onRetry={onRetry}
      retryLabel={tCommon('retry')}
    />
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

/**
 * One table row. Number columns are tabular-nums so the ascending values
 * align visually; the €/g presentation matches the compare view's
 * (toFixed(2) plus the localized unit).
 */
function RankingRow({
  item,
  position,
  labelStatus,
  unitLabel,
}: {
  item: UnitPriceRankingItem;
  position: number;
  labelStatus: string;
  unitLabel: string;
}) {
  return (
    <tr>
      <td className="py-2 pr-4 tabular-nums text-gray-400">{position}</td>
      <td className="py-2 pr-4">
        <span className="font-medium text-gray-900">{item.name}</span>
        {item.brand !== '' && (
          <span className="block text-xs text-gray-500">{item.brand}</span>
        )}
      </td>
      <td className="py-2 pr-4 font-semibold tabular-nums text-gray-900">
        {item.centsPerGram.toFixed(2)} {unitLabel}
      </td>
      <td className="py-2 pr-4 tabular-nums text-gray-700">
        {item.ethanolGrams.toFixed(1)} g
      </td>
      <td className="py-2">
        <ReliabilityBadge status={item.reliabilityStatus}>
          {labelStatus}
        </ReliabilityBadge>
      </td>
    </tr>
  );
}
