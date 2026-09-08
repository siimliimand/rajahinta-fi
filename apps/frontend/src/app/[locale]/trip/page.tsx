'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, EmptyState } from '@/components/ui';
import {
  calculateTripFeasibility,
  classifyTripCalcError,
  fillTripAllowance,
  type TripCalcErrorKind,
} from './trip.client';
import type {
  TripCategoryKey,
  TripFeasibilityResponse,
  TripFillResponse,
  TripVehicleType,
} from './trip.types';
import TripForm from './components/TripForm';
import TripBreakEvenResult from './components/TripBreakEvenResult';
import TripFillForm from './components/TripFillForm';
import TripFillResult from './components/TripFillResult';

/** The page's two calculation modes. */
type TripMode = 'breakeven' | 'fill';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Today as an ISO `YYYY-MM-DD` calendar date in the user's local time.
 *
 * The API requires a date because allowances resolve by effective window,
 * but the MVP form has no date input — the trip is assumed upcoming, so
 * the page supplies today (event page precedent). Local components (not
 * UTC) so the date is the calendar day the user is on.
 */
function todayIsoDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

/**
 * Trip feasibility page (task 5.4, change product-roadmap-phases-1-4;
 * fill mode added by task 8.3, change trust-and-reach-roadmap).
 *
 * Behaviour:
 *  - Two modes behind a toggle. Break-even (default): submit posts to
 *    `/api/v1/trip-feasibility`; the 200 body renders as break-even
 *    lines with allowance capping, the dataset citation, the structural
 *    disclaimer, and the separate partner block. Fill: submit posts the
 *    candidate set to `/api/v1/trip/fill`; the 200 body renders as the
 *    per-line itemization with contributions and headroom.
 *  - 409 `NoPublishedAllowances` (no dataset covers the travel date) is
 *    an expected state in both modes → a calm empty state, not a red
 *    error. 401 on the fill surface (it requires a signed-in user)
 *    degrades to a sign-in note.
 *  - The structural disclaimer from the response is rendered with the
 *    result — never a UI-only string. The ferry block stays display-only
 *    and separate in both modes.
 *
 * @module TripPage
 */
export default function TripPage() {
  const t = useTranslations('TripPage');

  // ── Mode ──
  const [mode, setMode] = useState<TripMode>('breakeven');

  // ── Submission state ──
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<TripFeasibilityResponse | null>(null);
  const [fillResult, setFillResult] = useState<TripFillResponse | null>(null);
  const [fillProductNames, setFillProductNames] = useState<ReadonlyMap<number, string>>(
    new Map(),
  );
  const [errorKind, setErrorKind] = useState<TripCalcErrorKind | null>(null);

  // Guard against duplicate submits (either mode)
  const submitInFlight = useRef(false);

  const clearForSubmit = useCallback(() => {
    submitInFlight.current = true;
    setSubmitting(true);
    setErrorKind(null);
    setResult(null);
    setFillResult(null);
  }, []);

  const handleSubmit = useCallback(
    async (input: {
      passengers: number;
      vehicleType: TripVehicleType;
      ticketCostCents: number;
      fuelCostCents: number;
      prices: {
        category: TripCategoryKey;
        domesticPriceCentsPerLitre: number;
        foreignPriceCentsPerLitre: number;
      }[];
    }) => {
      if (submitInFlight.current) return;

      clearForSubmit();

      try {
        const res = await calculateTripFeasibility({
          ...input,
          travelDate: todayIsoDate(),
        });
        setResult(res);
      } catch (err: unknown) {
        setErrorKind(classifyTripCalcError(err).kind);
      } finally {
        setSubmitting(false);
        submitInFlight.current = false;
      }
    },
    [clearForSubmit],
  );

  const handleFillSubmit = useCallback(
    async (items: { productId: number; maxQuantity: number; productName: string }[]) => {
      if (submitInFlight.current) return;

      clearForSubmit();
      // Display names travel with the selection so the itemization can
      // label its lines; the API request itself carries only ids and
      // bounds (data minimization).
      setFillProductNames(
        new Map(items.map((item) => [item.productId, item.productName])),
      );

      try {
        const res = await fillTripAllowance({
          travelDate: todayIsoDate(),
          items: items.map(({ productId, maxQuantity }) => ({
            productId,
            maxQuantity,
          })),
        });
        setFillResult(res);
      } catch (err: unknown) {
        setErrorKind(classifyTripCalcError(err).kind);
      } finally {
        setSubmitting(false);
        submitInFlight.current = false;
      }
    },
    [clearForSubmit],
  );

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      {/* ── Header ── */}
      <h1 className="mb-1 text-2xl font-bold text-primary-700">{t('title')}</h1>
      <p className="mb-8 text-sm text-gray-500">{t('subtitle')}</p>

      {/* ── Mode toggle ── */}
      <div className="mb-8 flex gap-2" data-testid="trip-mode-toggle">
        <button
          type="button"
          data-testid="trip-mode-breakeven"
          aria-pressed={mode === 'breakeven'}
          onClick={() => setMode('breakeven')}
          className={
            mode === 'breakeven'
              ? 'rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2'
              : 'rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2'
          }
        >
          {t('mode.breakeven')}
        </button>
        <button
          type="button"
          data-testid="trip-mode-fill"
          aria-pressed={mode === 'fill'}
          onClick={() => setMode('fill')}
          className={
            mode === 'fill'
              ? 'rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2'
              : 'rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2'
          }
        >
          {t('mode.fill')}
        </button>
      </div>

      {/* ── Form ── */}
      <section className="mb-8">
        <Card>
          {mode === 'breakeven' ? (
            <TripForm onSubmit={handleSubmit} submitting={submitting} />
          ) : (
            <TripFillForm onSubmit={handleFillSubmit} submitting={submitting} />
          )}
        </Card>
      </section>

      {/* ── 409: no published allowance dataset covers the date — an
              expected state, rendered calmly (never an error) ── */}
      {errorKind === 'no-allowances' && (
        <div className="mb-8">
          <EmptyState
            title={t('noAllowances.title')}
            description={t('noAllowances.body')}
          />
        </div>
      )}

      {/* ── Error (classified failure; degrade, never crash) ── */}
      {errorKind !== null && errorKind !== 'no-allowances' && (
        <p role="alert" className="mb-8 text-sm text-red-600">
          {t(`errors.${errorKind}`)}
        </p>
      )}

      {/* ── Result: break-even lines + citation + disclaimer + partners ── */}
      {mode === 'breakeven' && result && <TripBreakEvenResult result={result} />}

      {/* ── Result: fill itemization + citation + disclaimer + partners ── */}
      {mode === 'fill' && fillResult && (
        <TripFillResult result={fillResult} productNames={fillProductNames} />
      )}
    </main>
  );
}
