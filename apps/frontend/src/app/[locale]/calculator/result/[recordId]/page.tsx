'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import type { CalculatorResult as CalculatorResultType } from '@/lib/types';
import { ApiFetchError, getCalculationResult } from '@/lib/api';
import { EmptyState, ErrorState } from '@/components/ui';
import CalculatorResultView from '../../components/CalculatorResult';
import ProductHistoryPanel from '../../components/ProductHistoryPanel';
import CorrectionFlagPanel from '../../components/CorrectionFlagPanel';
import DeclarationGuidancePanel from '../../components/DeclarationGuidancePanel';

// ---------------------------------------------------------------------------
// Load-failure classification (task 5.3)
// ---------------------------------------------------------------------------

/**
 * A failed record load classified for the designed states: a missing
 * record (404 or a malformed ID) is an empty/not-found situation and
 * renders the EmptyState; anything else is a retryable error.
 */
interface ResultLoadError {
  readonly message: string;
  readonly notFound: boolean;
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

/**
 * Calculation result detail page.
 *
 * Fetches a previous calculation result by record ID and displays the full
 * itemized breakdown, traceable inputs, rate dataset version, and timestamp.
 * Links back to the calculator for new calculations.
 */
export default function CalculationResultPage() {
  const params = useParams();
  const recordId = Number(params.recordId);
  const t = useTranslations('ResultPage');
  const tCommon = useTranslations('Common');
  const tNav = useTranslations('Nav');

  const [result, setResult] = useState<CalculatorResultType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ResultLoadError | null>(null);

  // Cancellation token for the in-flight load: each run mints a token, and
  // a superseded or unmounted load's state writes are dropped. (The effect
  // cleanup swaps tokens on recordId/locale change; a ref outlives both.)
  const loadTokenRef = useRef<object | null>(null);

  /**
   * Load the record and classify failures for the designed states. Runs
   * on mount, on record change, and again from the error state's retry.
   */
  const runLoad = useCallback(() => {
    if (!Number.isFinite(recordId)) {
      setError({ message: t('invalidId'), notFound: true });
      setLoading(false);
      return;
    }

    const token = {};
    loadTokenRef.current = token;
    setLoading(true);
    setError(null);

    getCalculationResult(recordId)
      .then((data) => {
        if (loadTokenRef.current !== token) return;
        setResult(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (loadTokenRef.current !== token) return;
        if (err instanceof ApiFetchError && err.status === 404) {
          // A missing record is an absence, not a failure — the
          // EmptyState explains it and points back to the calculator.
          setError({ message: t('notFoundBody'), notFound: true });
        } else {
          setError({
            message: err instanceof Error ? err.message : t('loadFailed'),
            notFound: false,
          });
        }
        setLoading(false);
      });
  }, [recordId, t]);

  useEffect(() => {
    runLoad();
    // Drop in-flight state writes from the load this effect owned.
    return () => {
      loadTokenRef.current = null;
    };
  }, [runLoad]);

  /** Re-run the record fetch from the error state's retry action. */
  function handleRetry() {
    runLoad();
  }

  // ── Loading state ──
  if (loading) {
    return (
      <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-48 rounded bg-gray-200" />
          <div className="h-4 w-72 rounded bg-gray-100" />
          <div className="h-64 rounded-lg bg-gray-100" />
        </div>
      </main>
    );
  }

  // ── Error / not-found states (task 5.3) ──
  if (error !== null) {
    return (
      <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        {error.notFound ? (
          // A missing record is an absence: calm, explanatory, with a
          // route back to the calculator. role="status" (EmptyState)
          // announces it politely instead of asserting an error.
          <EmptyState
            title={t('notFoundTitle')}
            description={error.message}
            className="rounded-lg border border-gray-200 bg-white shadow-sm"
            action={
              <Link
                href="/calculator"
                className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
              >
                {tNav('backToCalculator')}
              </Link>
            }
          />
        ) : (
          // Any other load failure is retryable: re-run the fetch.
          <ErrorState
            title={t('loadFailedTitle')}
            description={error.message}
            onRetry={handleRetry}
            retryLabel={tCommon('retry')}
          />
        )}
      </main>
    );
  }

  // ── Result state ──
  if (result === null) {
    return null;
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      {/* ── Heading ── */}
      <h1 className="mb-1 text-2xl font-bold text-primary-700">
        {t('title')}
      </h1>
      <p className="mb-8 text-sm text-gray-500">
        {t('recordMeta', {
          id: result.calculationRecordId,
          date: new Date(result.metadata.calculationTimestamp).toLocaleString('fi-FI'),
        })}
      </p>

      {/* ── Full result display ── */}
      <CalculatorResultView result={result} />

      {/* ── Historical charts (flag-gated; hidden and unfetched when off) ── */}
      <div className="mt-6">
        <ProductHistoryPanel
          productId={result.metadata.input.productId}
          showMerchantFilter
        />
      </div>

      {/* ── Declaration guidance (flag-gated; hidden and unfetched when
          off) — informational, read-only ── */}
      <DeclarationGuidancePanel recordId={result.calculationRecordId} />

      {/* ── Traceable inputs section ── */}
      <section className="mt-8 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-400">
          {t('traceableInputs')}
        </h2>

        <div className="divide-y divide-gray-100">
          {/* Product */}
          <div className="py-3">
            <h3 className="text-sm font-medium text-gray-900">{t('product')}</h3>
            <dl className="mt-1 space-y-1 text-xs text-gray-500">
              <div className="flex justify-between">
                <dt>{t('productId')}</dt>
                <dd className="tabular-nums">{result.metadata.productMasterId}</dd>
              </div>
              <div className="flex justify-between">
                <dt>{t('name')}</dt>
                <dd>{result.metadata.productName}</dd>
              </div>
              <div className="flex justify-between">
                <dt>{t('volume')}</dt>
                <dd className="tabular-nums">
                  {t('volumeValue', {
                    value: result.metadata.volumeLitres.toFixed(3),
                  })}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>{tCommon('abvLabel')}</dt>
                <dd className="tabular-nums">
                  {result.metadata.alcoholByVolume}%
                </dd>
              </div>
            </dl>
          </div>

          {/* Retail offers */}
          <div className="py-3">
            <h3 className="text-sm font-medium text-gray-900">
              {t('retailOffers')}
            </h3>
            <p className="mt-1 text-xs text-gray-500">
              {result.metadata.retailOfferIds.length > 0
                ? t('offersReferenced', {
                    count: result.metadata.retailOfferIds.length,
                  })
                : t('noOffers')}
            </p>
            {result.metadata.retailOfferIds.length > 0 && (
              <p className="mt-0.5 text-xs text-gray-400">
                {t('offerIds', {
                  ids: result.metadata.retailOfferIds.join(', '),
                })}
              </p>
            )}
          </div>

          {/* Transport offer */}
          <div className="py-3">
            <h3 className="text-sm font-medium text-gray-900">
              {tCommon('transport')}
            </h3>
            <p className="mt-1 text-xs text-gray-500">
              {result.metadata.transportOfferId !== null
                ? t('transportOffer', { id: result.metadata.transportOfferId })
                : t('transportEstimated')}
            </p>
          </div>

          {/* Input parameters */}
          <div className="py-3">
            <h3 className="text-sm font-medium text-gray-900">
              {t('calculationInputs')}
            </h3>
            <dl className="mt-1 space-y-1 text-xs text-gray-500">
              <div className="flex justify-between">
                <dt>{tCommon('quantity')}</dt>
                <dd className="tabular-nums">
                  {tCommon('unitCount', { count: result.metadata.quantity })}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>{t('destination')}</dt>
                <dd>{result.metadata.destination}</dd>
              </div>
              <div className="flex justify-between">
                <dt>{t('transportMethod')}</dt>
                <dd>
                  {result.metadata.input.transportMethod ?? t('defaultMethod')}
                </dd>
              </div>
            </dl>
          </div>

          {/* Input parameters from input block */}
          {result.metadata.input.sessionId && (
            <div className="py-3">
              <h3 className="text-sm font-medium text-gray-900">
                {t('session')}
              </h3>
              <p className="mt-1 text-xs text-gray-500">
                {tCommon('sessionId', { id: result.metadata.input.sessionId })}
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ── Dataset versions ── */}
      {result.metadata.datasetVersions.length > 0 && (
        <section className="mt-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
            {t('rateDatasetVersions')}
          </h2>
          <ul className="space-y-1">
            {result.metadata.datasetVersions.map((version, i) => (
              <li
                key={i}
                className="flex items-center gap-2 text-xs text-gray-600"
              >
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary-400" />
                {version}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Correction flag affordance ── */}
      <CorrectionFlagPanel
        recordId={result.calculationRecordId}
        productName={result.metadata.productName}
      />

      {/* ── Footer nav ── */}
      <nav className="mt-8 text-center">
        <Link
          href="/calculator"
          className="inline-flex items-center rounded-md bg-primary-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-primary-700"
        >
          {tNav('calculateAnother')}
        </Link>
      </nav>
    </main>
  );
}
