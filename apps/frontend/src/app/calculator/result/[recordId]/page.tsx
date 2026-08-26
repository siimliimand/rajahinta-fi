'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { CalculatorResult as CalculatorResultType } from '@/lib/types';
import { getCalculationResult } from '@/lib/api';
import CalculatorResultView from '../../components/CalculatorResult';
import ProductHistoryPanel from '../../components/ProductHistoryPanel';
import CorrectionFlagPanel from '../../components/CorrectionFlagPanel';

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

  const [result, setResult] = useState<CalculatorResultType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(recordId)) {
      setError('Invalid calculation record ID.');
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
            err instanceof Error
              ? err.message
              : 'Failed to load calculation result.';
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
  }, [recordId]);

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
            Calculation not found
          </h1>
          <p className="mb-4 text-sm text-red-600">{error}</p>
          <Link
            href="/calculator"
            className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
          >
            Back to calculator
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
      {/* ── Navigation ── */}
      <nav className="mb-6">
        <Link
          href="/calculator"
          className="text-sm text-primary-600 hover:text-primary-800"
        >
          &larr; Back to calculator
        </Link>
      </nav>

      {/* ── Heading ── */}
      <h1 className="mb-1 text-2xl font-bold text-primary-700">
        Calculation result
      </h1>
      <p className="mb-8 text-sm text-gray-500">
        Record #{result.calculationRecordId} &middot;{' '}
        {new Date(result.metadata.calculationTimestamp).toLocaleString('fi-FI')}
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

      {/* ── Traceable inputs section ── */}
      <section className="mt-8 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-400">
          Traceable inputs
        </h2>

        <div className="divide-y divide-gray-100">
          {/* Product */}
          <div className="py-3">
            <h3 className="text-sm font-medium text-gray-900">Product</h3>
            <dl className="mt-1 space-y-1 text-xs text-gray-500">
              <div className="flex justify-between">
                <dt>Product ID</dt>
                <dd className="tabular-nums">{result.metadata.productMasterId}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Name</dt>
                <dd>{result.metadata.productName}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Volume</dt>
                <dd className="tabular-nums">
                  {result.metadata.volumeLitres.toFixed(3)} L
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>ABV</dt>
                <dd className="tabular-nums">
                  {result.metadata.alcoholByVolume}%
                </dd>
              </div>
            </dl>
          </div>

          {/* Retail offers */}
          <div className="py-3">
            <h3 className="text-sm font-medium text-gray-900">
              Retail offers
            </h3>
            <p className="mt-1 text-xs text-gray-500">
              {result.metadata.retailOfferIds.length > 0
                ? `${result.metadata.retailOfferIds.length} offer(s) referenced`
                : 'No retail offers used'}
            </p>
            {result.metadata.retailOfferIds.length > 0 && (
              <p className="mt-0.5 text-xs text-gray-400">
                Offer IDs:{' '}
                {result.metadata.retailOfferIds.join(', ')}
              </p>
            )}
          </div>

          {/* Transport offer */}
          <div className="py-3">
            <h3 className="text-sm font-medium text-gray-900">
              Transport
            </h3>
            <p className="mt-1 text-xs text-gray-500">
              {result.metadata.transportOfferId !== null
                ? `Transport offer #${result.metadata.transportOfferId}`
                : 'Estimated (no transport offer selected)'}
            </p>
          </div>

          {/* Input parameters */}
          <div className="py-3">
            <h3 className="text-sm font-medium text-gray-900">
              Calculation inputs
            </h3>
            <dl className="mt-1 space-y-1 text-xs text-gray-500">
              <div className="flex justify-between">
                <dt>Quantity</dt>
                <dd className="tabular-nums">
                  {result.metadata.quantity} unit(s)
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>Destination</dt>
                <dd>{result.metadata.destination}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Transport method</dt>
                <dd>
                  {result.metadata.input.transportMethod ?? 'Default'}
                </dd>
              </div>
            </dl>
          </div>

          {/* Input parameters from input block */}
          {result.metadata.input.sessionId && (
            <div className="py-3">
              <h3 className="text-sm font-medium text-gray-900">
                Session
              </h3>
              <p className="mt-1 text-xs text-gray-500">
                Session ID: {result.metadata.input.sessionId}
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ── Dataset versions ── */}
      {result.metadata.datasetVersions.length > 0 && (
        <section className="mt-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
            Rate dataset versions
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
          Calculate another product
        </Link>
      </nav>
    </main>
  );
}