'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useFeatureFlags } from '@/lib/feature-flags';
import { Card, EmptyState } from '@/components/ui';
import {
  calculateTripFeasibility,
  classifyTripCalcError,
  type TripCalcErrorKind,
} from './trip.client';
import { isTripCalculatorFlagEnabled } from './trip-calculator-flag';
import type {
  TripCategoryKey,
  TripFeasibilityResponse,
  TripVehicleType,
} from './trip.types';
import TripForm from './components/TripForm';
import TripBreakEvenResult from './components/TripBreakEvenResult';

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
 * Trip feasibility page (task 5.4, change product-roadmap-phases-1-4).
 *
 * Behaviour:
 *  - `TRIP_CALCULATOR` off ⇒ renders nothing. The flag state is resolved
 *    server-side and inlined with the initial HTML payload (design R13),
 *    so the page is hidden from the first render — the account/alerts/
 *    event gating treatment.
 *  - Submit posts to `/api/v1/trip-feasibility`; the 200 body renders as
 *    break-even lines with allowance capping, the dataset citation, the
 *    structural disclaimer, and the separate partner block.
 *  - 409 `NoPublishedAllowances` (no dataset covers the travel date) is
 *    an expected state → a calm empty state, not a red error.
 *  - The structural disclaimer from the response is rendered with the
 *    result — never a UI-only string.
 *
 * @module TripPage
 */
export default function TripPage() {
  const t = useTranslations('TripPage');

  // ── Feature flags (server-resolved, inlined with the initial HTML) ──
  const flags = useFeatureFlags();
  const flagEnabled = isTripCalculatorFlagEnabled(flags);

  // ── Submission state ──
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<TripFeasibilityResponse | null>(null);
  const [errorKind, setErrorKind] = useState<TripCalcErrorKind | null>(null);

  // Guard against duplicate submits
  const submitInFlight = useRef(false);

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

      submitInFlight.current = true;
      setSubmitting(true);
      setErrorKind(null);
      setResult(null);

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
    [],
  );

  // ── Hidden state: flag off in the inlined payload ──
  if (!flagEnabled) {
    return null;
  }

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      {/* ── Header ── */}
      <h1 className="mb-1 text-2xl font-bold text-primary-700">{t('title')}</h1>
      <p className="mb-8 text-sm text-gray-500">{t('subtitle')}</p>

      {/* ── Form ── */}
      <section className="mb-8">
        <Card>
          <TripForm onSubmit={handleSubmit} submitting={submitting} />
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

      {/* ── Error (classified failure; the 403 case covers a flag flipped
              off server-side mid-session — degrade, never crash) ── */}
      {errorKind !== null && errorKind !== 'no-allowances' && (
        <p role="alert" className="mb-8 text-sm text-red-600">
          {t(`errors.${errorKind}`)}
        </p>
      )}

      {/* ── Result: break-even lines + citation + disclaimer + partners ── */}
      {result && <TripBreakEvenResult result={result} />}
    </main>
  );
}
