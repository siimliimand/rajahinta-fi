'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input } from '@/components/ui';
import type { TripCategoryKey, TripVehicleType } from '../trip.types';

// ---------------------------------------------------------------------------
// Caps — mirror the server-side zod caps (trip-feasibility.routes.ts, task 5.3)
// ---------------------------------------------------------------------------

export const MIN_PASSENGERS = 1;
export const MAX_PASSENGERS = 9;
/** €100 000 — the server's 1..10 000 000 cents window for trip costs. */
export const MAX_TRIP_COST_EUR = 100_000;
/** €1000/l — the server's 0..100 000 cents-per-litre window for prices. */
export const MAX_PRICE_EUR_PER_LITRE = 1000;

/** The canonical allowance categories, in their fixed order — the price rows. */
const CATEGORIES: readonly TripCategoryKey[] = [
  'beer',
  'wine_still',
  'wine_sparkling',
  'intermediate_products',
  'other_fermented',
  'spirits',
];

/** The MVP vehicle set, in display order. */
const VEHICLES: readonly TripVehicleType[] = ['car', 'van'];

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/** Parse a positive integer from a text input value; anything else is NaN. */
function parseCount(value: string): number {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return Number.NaN;
  return Number.parseInt(trimmed, 10);
}

/**
 * Parse a euro amount (`"2,50"` / `"2.5"` / `"2"`) into whole cents.
 * Finnish decimal commas are accepted. `null` when the field is empty,
 * `NaN` when malformed or out of cap. A zero price is legitimate here
 * (the server's window is 0..100 000 cents/l — a zero-difference line is
 * reported as NO_BREAK_EVEN, not rejected), unlike the trip costs, which
 * the server requires to be positive.
 */
function parseEuroToCents(value: string, minimumCents: number): number | null {
  const trimmed = value.trim().replace(',', '.');
  if (trimmed === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return Number.NaN;
  const cents = Math.round(Number.parseFloat(trimmed) * 100);
  if (!Number.isSafeInteger(cents) || cents < minimumCents || cents > MAX_TRIP_COST_EUR * 100) {
    return Number.NaN;
  }
  return cents;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** Per-category price row state — raw input strings, parsed at the boundary. */
interface PriceRow {
  readonly domestic: string;
  readonly foreign: string;
}

const EMPTY_ROW: PriceRow = { domestic: '', foreign: '' };

interface TripFormProps {
  /** Raised with parsed, in-cap values once the inputs validate. */
  readonly onSubmit: (input: {
    passengers: number;
    vehicleType: TripVehicleType;
    ticketCostCents: number;
    fuelCostCents: number;
    prices: {
      category: TripCategoryKey;
      domesticPriceCentsPerLitre: number;
      foreignPriceCentsPerLitre: number;
    }[];
  }) => void;
  /** Disables the submit control while a calculation is in flight. */
  readonly submitting: boolean;
}

/**
 * Trip form: passengers, vehicle, and the trip's shared ticket and fuel
 * costs — plus the per-category per-litre price basis (domestic vs
 * foreign) the break-even divides by. At least one fully priced category
 * row is required; partially filled rows invalidate the form instead of
 * being silently dropped.
 *
 * The travel date is intentionally absent — the MVP form has no date
 * input (event simple-mode precedent); the page supplies today
 * client-side because the server resolves allowances by effective date.
 *
 * All user-visible copy comes from the `TripPage` message namespace.
 *
 * @module TripForm
 */
export default function TripForm({ onSubmit, submitting }: TripFormProps) {
  const t = useTranslations('TripPage');

  // ── Field state (strings — parse and clamp at the submit boundary) ──
  const [passengers, setPassengers] = useState('2');
  const [vehicleType, setVehicleType] = useState<TripVehicleType>('car');
  const [ticketEur, setTicketEur] = useState('');
  const [fuelEur, setFuelEur] = useState('');
  const [prices, setPrices] = useState<ReadonlyMap<TripCategoryKey, PriceRow>>(
    new Map(CATEGORIES.map((category) => [category, EMPTY_ROW])),
  );

  const passengerCount = parseCount(passengers);
  const passengersValid =
    Number.isInteger(passengerCount) &&
    passengerCount >= MIN_PASSENGERS &&
    passengerCount <= MAX_PASSENGERS;

  // Trip costs must be positive — a zero-cost trip is a caller bug (the
  // server rejects it with 400), so the form demands ≥ €0.01.
  const ticketCents = parseEuroToCents(ticketEur, 1);
  const fuelCents = parseEuroToCents(fuelEur, 1);
  const costsValid = Number.isInteger(ticketCents) && Number.isInteger(fuelCents);

  // Price validity: a row counts only when BOTH bases are filled; a
  // partially filled row is malformed, not ignorable.
  const pricedRows: {
    category: TripCategoryKey;
    domesticCents: number;
    foreignCents: number;
  }[] = [];
  let pricesMalformed = false;
  for (const category of CATEGORIES) {
    const row = prices.get(category) ?? EMPTY_ROW;
    const domesticCents = parseEuroToCents(row.domestic, 0);
    const foreignCents = parseEuroToCents(row.foreign, 0);
    if (Number.isNaN(domesticCents) || Number.isNaN(foreignCents)) {
      pricesMalformed = true;
      continue;
    }
    if (domesticCents === null && foreignCents === null) continue;
    if (domesticCents === null || foreignCents === null) {
      pricesMalformed = true;
      continue;
    }
    pricedRows.push({ category, domesticCents, foreignCents });
  }
  const pricesValid = !pricesMalformed && pricedRows.length > 0;

  const valid = passengersValid && costsValid && pricesValid;

  const setRow = useCallback((category: TripCategoryKey, patch: Partial<PriceRow>) => {
    setPrices((prev) => {
      const next = new Map(prev);
      next.set(category, { ...(prev.get(category) ?? EMPTY_ROW), ...patch });
      return next;
    });
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!valid || submitting) return;
      // `valid` guarantees these parsed successfully; the check narrows
      // the null branch for the compiler.
      if (ticketCents === null || fuelCents === null) return;

      onSubmit({
        passengers: passengerCount,
        vehicleType,
        ticketCostCents: ticketCents,
        fuelCostCents: fuelCents,
        prices: pricedRows.map(({ category, domesticCents, foreignCents }) => ({
          category,
          domesticPriceCentsPerLitre: domesticCents,
          foreignPriceCentsPerLitre: foreignCents,
        })),
      });
    },
    [valid, submitting, passengerCount, vehicleType, ticketCents, fuelCents, pricedRows, onSubmit],
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="trip-form">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          id="trip-passengers"
          label={t('form.passengers')}
          type="number"
          inputMode="numeric"
          min={MIN_PASSENGERS}
          max={MAX_PASSENGERS}
          step={1}
          value={passengers}
          onChange={(e) => setPassengers(e.target.value)}
          required
        />
        <div>
          <label
            htmlFor="trip-vehicle"
            className="mb-1 block text-sm font-medium text-gray-700"
          >
            {t('form.vehicle')}
          </label>
          <select
            id="trip-vehicle"
            value={vehicleType}
            onChange={(e) => setVehicleType(e.target.value as TripVehicleType)}
            className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            {VEHICLES.map((vehicle) => (
              <option key={vehicle} value={vehicle}>
                {t(`vehicle.${vehicle}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          id="trip-ticket"
          label={t('form.ticket')}
          inputMode="decimal"
          value={ticketEur}
          onChange={(e) => setTicketEur(e.target.value)}
          placeholder="120,00"
          required
        />
        <Input
          id="trip-fuel"
          label={t('form.fuel')}
          inputMode="decimal"
          value={fuelEur}
          onChange={(e) => setFuelEur(e.target.value)}
          placeholder="80,00"
          required
        />
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-700">{t('form.pricesHeading')}</p>
        {CATEGORIES.map((category) => {
          const row = prices.get(category) ?? EMPTY_ROW;
          return (
            <div key={category} className="grid grid-cols-2 gap-2">
              <Input
                id={`trip-price-domestic-${category}`}
                label={t('form.domesticPrice', {
                  category: t(`category.${category}`),
                })}
                inputMode="decimal"
                value={row.domestic}
                onChange={(e) => setRow(category, { domestic: e.target.value })}
                placeholder="5,00"
              />
              <Input
                id={`trip-price-foreign-${category}`}
                label={t('form.foreignPrice')}
                inputMode="decimal"
                value={row.foreign}
                onChange={(e) => setRow(category, { foreign: e.target.value })}
                placeholder="2,00"
              />
            </div>
          );
        })}
        <p className="text-xs text-gray-500">{t('form.priceHint')}</p>
        {pricesMalformed && (
          <p role="alert" className="text-xs text-red-600">
            {t('form.priceError')}
          </p>
        )}
      </div>

      <Button type="submit" disabled={!valid || submitting} className="w-full">
        {submitting ? t('submitting') : t('submit')}
      </Button>
    </form>
  );
}
