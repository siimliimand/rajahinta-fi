'use client';

/**
 * ProductHistoryPanel — integrating container for {@link HistoryChart}.
 *
 * Owns everything HistoryChart deliberately does not (task 5.3): the
 * feature-flag gate, data fetching, metric switching, and the per-merchant
 * filter on the calculator result view.
 *
 * Behaviour:
 *  - `enable_historical_price_intelligence` off ⇒ the section renders
 *    nothing and the price-history request is never fired (guard runs
 *    before fetch, not as error-handling after). A failed flag lookup also
 *    degrades to hidden.
 *  - Default view: product-wide series (merchant = null), daily buckets,
 *    90-day inclusive range — well under the API's 365-day cap.
 *  - Truncated history: `earliestAvailableObservationDate` from the
 *    response is passed through so the chart states "data available from"
 *    instead of implying a longer history.
 *  - Rate-limited / network failures degrade to a neutral retry
 *    affordance; a 403 (flag flipped server-side) hides the section.
 *  - Neutrality: the metric buttons and the merchant select treat every
 *    option identically — no option is visually promoted.
 *
 * @module ProductHistoryPanel
 */

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type {
  PriceHistoryMetric,
  PriceHistoryResponse,
} from '@/lib/types';
import {
  classifyPriceHistoryError,
  getFeatureFlags,
  getPriceHistory,
  getProductDetail,
} from '@/lib/api';
import HistoryChart from './HistoryChart';

// ---------------------------------------------------------------------------
// Constants and helpers
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/**
 * Default chart range: 90 days inclusive — a readable daily series that
 * stays far under the API's 365-day cap.
 */
const DEFAULT_RANGE_DAYS = 90;

/** Format a Date as an ISO date 'YYYY-MM-DD' (UTC). */
function toIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The default from/to pair: today UTC minus 89 days through today UTC
 * (inclusive) — exactly 90 daily buckets.
 */
export function defaultHistoryRange(
  now: Date = new Date(),
): { from: string; to: string } {
  const todayMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return {
    from: toIsoDate(todayMs - (DEFAULT_RANGE_DAYS - 1) * DAY_MS),
    to: toIsoDate(todayMs),
  };
}

/** Identical button styling for both metric options; only state differs. */
const metricButtonClass = (active: boolean): string =>
  `rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
    active
      ? 'border-primary-600 bg-primary-600 text-white'
      : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400'
  }`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ProductHistoryPanelProps {
  /** Canonical product whose history is charted. */
  readonly productId: number;
  /**
   * Offer a per-merchant filter next to the product-wide series
   * (calculator result view). The compare page keeps product-wide only.
   */
  readonly showMerchantFilter?: boolean;
}

type FlagState = 'checking' | 'enabled' | 'disabled';

/** Retryable failures get a retry affordance; hidden failures render nothing. */
type FailureState = 'retryable' | 'hidden' | null;

export default function ProductHistoryPanel({
  productId,
  showMerchantFilter = false,
}: ProductHistoryPanelProps) {
  const t = useTranslations('ProductHistoryPanel');
  const tCommon = useTranslations('Common');
  const [flag, setFlag] = useState<FlagState>('checking');
  const [metric, setMetric] = useState<PriceHistoryMetric>('price');
  const [merchant, setMerchant] = useState<string | null>(null);
  const [merchants, setMerchants] = useState<readonly string[]>([]);
  const [data, setData] = useState<PriceHistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<FailureState>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  // ── Feature flag: hide and skip the request when off ──
  useEffect(() => {
    let cancelled = false;
    getFeatureFlags()
      .then((res) => {
        if (cancelled) return;
        setFlag(
          res.flags.HISTORICAL_PRICE_INTELLIGENCE ? 'enabled' : 'disabled',
        );
      })
      .catch(() => {
        // Flag state unreachable — degrade as if disabled.
        if (!cancelled) setFlag('disabled');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Merchant filter options (result view only, after the flag is on) ──
  useEffect(() => {
    if (flag !== 'enabled' || !showMerchantFilter) return;
    let cancelled = false;
    getProductDetail(productId)
      .then((detail) => {
        if (cancelled) return;
        const names = [...new Set(detail.offers.map((o) => o.merchant))].sort();
        setMerchants(names);
      })
      .catch(() => {
        // Degrade to the product-wide series only — the chart still works.
      });
    return () => {
      cancelled = true;
    };
  }, [flag, productId, showMerchantFilter]);

  // ── History fetch — guarded by the flag, never fired when disabled ──
  useEffect(() => {
    // 'checking' and 'disabled' both return before any request (design
    // decision 7: the UI skips the fetch, not just the rendering).
    if (flag !== 'enabled') return;

    let cancelled = false;
    setLoading(true);
    setFailure(null);

    const { from, to } = defaultHistoryRange();
    getPriceHistory(productId, {
      metric,
      granularity: 'day',
      from,
      to,
      ...(merchant !== null ? { merchant } : {}),
    })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const { kind } = classifyPriceHistoryError(err);
        if (kind === 'rate-limited' || kind === 'network' || kind === 'unknown') {
          setFailure('retryable');
        } else {
          // 'forbidden' (flag off server-side / age gate), 'validation',
          // 'not-found' — hiding the section is the honest degradation.
          setFailure('hidden');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [flag, productId, metric, merchant, retryNonce]);

  // ── Hidden states: flag off, still checking, or hidden failure ──
  if (flag !== 'enabled' || failure === 'hidden') {
    return null;
  }

  return (
    <section aria-label={t('ariaLabel')} data-testid="product-history-panel">
      {/* ── Controls: metric switch + optional merchant filter ── */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div
          className="flex items-center gap-1"
          role="group"
          aria-label={t('metricGroup')}
        >
          <button
            type="button"
            data-testid="history-metric-price"
            aria-pressed={metric === 'price'}
            className={metricButtonClass(metric === 'price')}
            onClick={() => setMetric('price')}
          >
            {t('metricPrice')}
          </button>
          <button
            type="button"
            data-testid="history-metric-landed-cost"
            aria-pressed={metric === 'landed-cost'}
            className={metricButtonClass(metric === 'landed-cost')}
            onClick={() => setMetric('landed-cost')}
          >
            {t('metricLandedCost')}
          </button>
        </div>

        {showMerchantFilter && merchants.length > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-gray-500">
            {tCommon('merchant')}
            <select
              data-testid="history-merchant-select"
              value={merchant ?? ''}
              onChange={(e) => setMerchant(e.target.value === '' ? null : e.target.value)}
              className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
            >
              <option value="">{t('allMerchants')}</option>
              {merchants.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* ── Loading skeleton ── */}
      {loading && (
        <div
          className="animate-pulse rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
          data-testid="history-loading"
        >
          <div className="mb-2 h-3 w-40 rounded bg-gray-200" />
          <div className="h-56 rounded bg-gray-100" />
        </div>
      )}

      {/* ── Neutral retry affordance for rate-limit / network failures ── */}
      {!loading && failure === 'retryable' && (
        <div
          className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
          data-testid="history-retry"
        >
          <p className="text-sm text-gray-500">{t('unavailable')}</p>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="mt-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:border-gray-400"
          >
            {t('tryAgain')}
          </button>
        </div>
      )}

      {/* ── Chart: response values are authoritative (echoed metric etc.) ── */}
      {!loading && failure === null && data !== null && (
        <HistoryChart
          metric={data.metric}
          granularity={data.granularity}
          series={[{ merchant: data.merchant, points: data.series }]}
          attribution={data.attribution}
          earliestAvailableObservationDate={
            data.earliestAvailableObservationDate
          }
        />
      )}
    </section>
  );
}
