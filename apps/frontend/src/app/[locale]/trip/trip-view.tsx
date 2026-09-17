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
import { TRIP_ROUTE_PRESETS } from './presets';
import type { TripRoutePreset } from './presets';
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
// View component
// ---------------------------------------------------------------------------

/**
 * Trip feasibility view (price-intelligence-roadmap task 2.3, the D2
 * server-shell conversion): the interactive calculation flow moved intact
 * from the former single-file page. The server shell in `page.tsx` owns
 * the metadata, intro copy, and the method summary; this view renders
 * everything that needs the visitor's interaction state.
 *
 * Behaviour (task 5.4, change product-roadmap-phases-1-4; fill mode added
 * by task 8.3, change trust-and-reach-roadmap):
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
 * @module TripView
 */
export default function TripView() {
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

  // ── Route preset (task 4.3) ──
  // Applying a preset remounts the break-even form with the preset's
  // values as ordinary initial state; the application counter in the key
  // makes re-applying the same preset re-fill edited fields. The prefill
  // is a starting point only: every field stays editable and the
  // estimate always derives from the current inputs at submit time.
  const [appliedPreset, setAppliedPreset] = useState<{
    seq: number;
    preset: TripRoutePreset;
  } | null>(null);

  const applyPreset = useCallback((preset: TripRoutePreset) => {
    setAppliedPreset((prev) => ({ seq: (prev?.seq ?? 0) + 1, preset }));
    // The inputs are about to change — a result computed from the
    // previous values no longer matches what is on screen, so drop it.
    setResult(null);
    setFillResult(null);
    setErrorKind(null);
  }, []);

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
    <>
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
          {mode === 'breakeven' && (
            <div className="mb-6" data-testid="trip-presets">
              <p className="text-sm font-medium text-gray-700">
                {t('presets.heading')}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {TRIP_ROUTE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    data-testid={`trip-preset-${preset.id}`}
                    onClick={() => applyPreset(preset)}
                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-left transition-colors hover:border-primary-300 hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
                  >
                    <span className="block text-sm font-medium text-gray-900">
                      {t(`presets.${preset.labelKey}`)}
                    </span>
                    <span className="mt-0.5 block text-xs text-gray-500">
                      {t(`presets.${preset.descriptionKey}`)}
                    </span>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-gray-500">{t('presets.hint')}</p>
            </div>
          )}
          {mode === 'breakeven' ? (
            <TripForm
              key={
                appliedPreset
                  ? `preset-${appliedPreset.preset.id}-${appliedPreset.seq}`
                  : 'trip-form'
              }
              onSubmit={handleSubmit}
              submitting={submitting}
              {...(appliedPreset ? { prefill: appliedPreset.preset.prefill } : {})}
            />
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
    </>
  );
}
