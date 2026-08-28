'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import type { CalculatorResult as CalculatorResultType } from '@/lib/types';
import { getCalculationResult } from '@/lib/api';
import CalculatorResultView from '../../components/CalculatorResult';
import ProductHistoryPanel from '../../components/ProductHistoryPanel';
import CorrectionFlagPanel from '../../components/CorrectionFlagPanel';
import DeclarationGuidancePanel from '../../components/DeclarationGuidancePanel';

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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(recordId)) {
      setError(t('invalidId'));
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchResult() {
      try {
        const data = await getCalculationResult(recordId);
        if (!cancelled) {
          setResult(data);
          setLoading(false);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : t('loadFailed');
          setError(message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchResult();
    return () => {
      cancelled = true;
    };
  }, [recordId, t]);

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

  // ── Error state ──
  if (error !== null) {
    return (
      <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <h1 className="mb-2 text-lg font-semibold text-red-800">
            {t('notFoundTitle')}
          </h1>
          <p className="mb-4 text-sm text-red-600">{error}</p>
          <Link
            href="/calculator"
            className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
          >
            {tNav('backToCalculator')}
          </Link>
        </div>
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
