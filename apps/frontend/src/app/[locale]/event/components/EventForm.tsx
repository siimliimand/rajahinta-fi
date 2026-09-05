'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input } from '@/components/ui';
import type {
  EventDrinkType,
  EventProfile,
  SourcingCountry,
  SourcingLineRequest,
  SourcingRequest,
} from '../event.types';

// ---------------------------------------------------------------------------
// Caps — mirror the server-side zod caps (event-calc.routes.ts, tasks 4.3/4.5)
// ---------------------------------------------------------------------------

export const MIN_GUESTS = 1;
export const MAX_GUESTS = 500;
export const MIN_DURATION_HOURS = 1;
export const MAX_DURATION_HOURS = 72;
/** €/l price basis cap — the server's 1..100 000 cents window in euros. */
export const MAX_PRICE_EUR_PER_LITRE = 1000;

/** The MVP simple mode's closed profile set, in display order. */
const PROFILES: readonly EventProfile[] = [
  'casual_gathering',
  'dinner_party',
  'celebration',
];

/** The canonical drink types, in their fixed order — the sourcing rows. */
const DRINK_TYPES: readonly EventDrinkType[] = [
  'beer',
  'wine_still',
  'wine_sparkling',
  'intermediate_products',
  'other_fermented',
  'spirits',
];

/** Candidate sourcing countries, in the backend's fixed comparison order. */
const COUNTRIES: readonly SourcingCountry[] = ['EE', 'LV', 'LT', 'SE', 'DE'];

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parse a positive integer from a text input value; anything else is NaN.
 */
function parseCount(value: string): number {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return Number.NaN;
  return Number.parseInt(trimmed, 10);
}

/**
 * Parse a euro price (`"2,50"` / `"2.5"` / `"2"`) into whole cents per
 * litre; `null` when the field is empty (an unpriced row), `NaN` when
 * malformed or out of cap. Finnish decimal commas are accepted.
 */
function parsePriceToCents(value: string): number | null {
  const trimmed = value.trim().replace(',', '.');
  if (trimmed === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return Number.NaN;
  const cents = Math.round(Number.parseFloat(trimmed) * 100);
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > MAX_PRICE_EUR_PER_LITRE * 100) {
    return Number.NaN;
  }
  return cents;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** Per-type price row state — raw input strings, parsed at the boundary. */
interface PriceRow {
  readonly domestic: string;
  readonly foreign: string;
}

const EMPTY_ROW: PriceRow = { domestic: '', foreign: '' };

interface EventFormProps {
  /** Raised with parsed, in-cap values once the inputs validate. */
  readonly onSubmit: (input: {
    guests: number;
    durationHours: number;
    eventProfile: EventProfile;
    /** Present only in sourcing mode — the V2 comparison request. */
    sourcing?: SourcingRequest;
  }) => void;
  /** Disables the submit control while a calculation is in flight. */
  readonly submitting: boolean;
  /** Whether the packing-recommendations opt-in may be offered (flag-gated). */
  readonly packingAvailable?: boolean;
}

/**
 * Event form: guests, duration, profile — plus the V2 cross-border
 * sourcing mode (task 4.5). The simple mode stays the default: the
 * sourcing toggle is off and the request payload is then byte-identical
 * to the MVP's. Sourcing mode prices the drink-type lines against one
 * candidate country (the API is richer than the UI on purpose), with an
 * optional budget and an optional packing opt-in (flag-gated).
 *
 * The event date is intentionally absent — the MVP simple mode has no date
 * input (spec event-calculator "MVP simple mode"); the page supplies today
 * client-side because the API resolves norms by effective date.
 *
 * All user-visible copy comes from the `EventPage` message namespace.
 *
 * @module EventForm
 */
export default function EventForm({
  onSubmit,
  submitting,
  packingAvailable = false,
}: EventFormProps) {
  const t = useTranslations('EventPage');

  // ── Field state (strings — parse and clamp at the submit boundary) ──
  const [guests, setGuests] = useState('10');
  const [durationHours, setDurationHours] = useState('4');
  const [eventProfile, setEventProfile] = useState<EventProfile>('casual_gathering');

  // ── Sourcing mode (V2) ──
  const [sourcingEnabled, setSourcingEnabled] = useState(false);
  const [country, setCountry] = useState<SourcingCountry>('EE');
  const [budgetEur, setBudgetEur] = useState('');
  const [packing, setPacking] = useState(false);
  const [prices, setPrices] = useState<ReadonlyMap<EventDrinkType, PriceRow>>(
    new Map(DRINK_TYPES.map((drinkType) => [drinkType, EMPTY_ROW])),
  );

  const guestsCount = parseCount(guests);
  const durationCount = parseCount(durationHours);
  const baseValid =
    Number.isInteger(guestsCount) &&
    guestsCount >= MIN_GUESTS &&
    guestsCount <= MAX_GUESTS &&
    Number.isInteger(durationCount) &&
    durationCount >= MIN_DURATION_HOURS &&
    durationCount <= MAX_DURATION_HOURS;

  // Sourcing validity: at least one priced row; a row with a foreign
  // price needs its domestic basis (the plan compares against it).
  const pricedRows: { drinkType: EventDrinkType; row: PriceRow; domesticCents: number; foreignCents: number | null }[] = [];
  let sourcingMalformed = false;
  if (sourcingEnabled) {
    for (const drinkType of DRINK_TYPES) {
      const row = prices.get(drinkType) ?? EMPTY_ROW;
      const domesticCents = parsePriceToCents(row.domestic);
      const foreignCents = parsePriceToCents(row.foreign);
      if (Number.isNaN(domesticCents) || Number.isNaN(foreignCents)) {
        sourcingMalformed = true;
        continue;
      }
      if (domesticCents === null && foreignCents === null) continue;
      if (domesticCents === null) {
        // Foreign without domestic — the comparison is impossible.
        sourcingMalformed = true;
        continue;
      }
      pricedRows.push({ drinkType, row, domesticCents, foreignCents });
    }
  }
  const sourcingValid = !sourcingEnabled || (!sourcingMalformed && pricedRows.length > 0);

  const budgetCents = sourcingEnabled ? parseCount(budgetEur) * 100 : 0;
  // Budget is optional: an empty field is fine, a malformed one is not.
  const budgetValid = !sourcingEnabled || budgetEur.trim() === '' || Number.isInteger(budgetCents);

  const valid = baseValid && sourcingValid && budgetValid;

  const setRow = useCallback((drinkType: EventDrinkType, patch: Partial<PriceRow>) => {
    setPrices((prev) => {
      const next = new Map(prev);
      next.set(drinkType, { ...(prev.get(drinkType) ?? EMPTY_ROW), ...patch });
      return next;
    });
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!valid || submitting) return;

      let sourcing: SourcingRequest | undefined;
      if (sourcingEnabled) {
        const lines: SourcingLineRequest[] = pricedRows.map(({ drinkType, domesticCents, foreignCents }) => ({
          drinkType,
          // The backend prices excise per ABV; this UI revision sends the
          // norms derivation's documented typical value for the type
          // (see abvByDrinkType below) rather than collecting it per row.
          abvPercent: abvByDrinkType(drinkType),
          container: containerByDrinkType(drinkType),
          domesticPricePerLitreCents: domesticCents,
          ...(foreignCents !== null ? { foreign: [{ country, pricePerLitreCents: foreignCents }] } : {}),
        }));
        sourcing = {
          lines,
          ...(Number.isInteger(budgetCents) && budgetCents > 0 ? { budgetCents } : {}),
          ...(packing && packingAvailable ? { packing: true } : {}),
        };
      }

      onSubmit({
        guests: guestsCount,
        durationHours: durationCount,
        eventProfile,
        ...(sourcing !== undefined ? { sourcing } : {}),
      });
    },
    [
      valid,
      submitting,
      sourcingEnabled,
      pricedRows,
      country,
      budgetCents,
      packing,
      packingAvailable,
      onSubmit,
      guestsCount,
      durationCount,
      eventProfile,
    ],
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="event-form">
      <Input
        id="event-guests"
        label={t('form.guests')}
        type="number"
        inputMode="numeric"
        min={MIN_GUESTS}
        max={MAX_GUESTS}
        step={1}
        value={guests}
        onChange={(e) => setGuests(e.target.value)}
        required
      />
      <Input
        id="event-duration"
        label={t('form.duration')}
        type="number"
        inputMode="numeric"
        min={MIN_DURATION_HOURS}
        max={MAX_DURATION_HOURS}
        step={1}
        value={durationHours}
        onChange={(e) => setDurationHours(e.target.value)}
        required
      />
      <div>
        <label
          htmlFor="event-profile"
          className="mb-1 block text-sm font-medium text-gray-700"
        >
          {t('form.profile')}
        </label>
        <select
          id="event-profile"
          value={eventProfile}
          onChange={(e) => setEventProfile(e.target.value as EventProfile)}
          className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        >
          {PROFILES.map((profile) => (
            <option key={profile} value={profile}>
              {t(`profile.${profile}`)}
            </option>
          ))}
        </select>
      </div>

      {/* ── V2 sourcing mode ── */}
      <div className="rounded-md border border-gray-200 p-3">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <input
            type="checkbox"
            data-testid="event-sourcing-toggle"
            checked={sourcingEnabled}
            onChange={(e) => setSourcingEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          />
          {t('form.sourcing.toggle')}
        </label>

        {sourcingEnabled && (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="event-sourcing-country"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  {t('form.sourcing.country')}
                </label>
                <select
                  id="event-sourcing-country"
                  value={country}
                  onChange={(e) => setCountry(e.target.value as SourcingCountry)}
                  className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                >
                  {COUNTRIES.map((code) => (
                    <option key={code} value={code}>
                      {t(`form.sourcing.countryName.${code}`)}
                    </option>
                  ))}
                </select>
              </div>
              <Input
                id="event-sourcing-budget"
                label={t('form.sourcing.budget')}
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={budgetEur}
                onChange={(e) => setBudgetEur(e.target.value)}
                placeholder="200"
              />
            </div>

            {packingAvailable && (
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  data-testid="event-packing-toggle"
                  checked={packing}
                  onChange={(e) => setPacking(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                {t('form.sourcing.packing')}
              </label>
            )}

            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-700">{t('form.sourcing.pricesHeading')}</p>
              {DRINK_TYPES.map((drinkType) => {
                const row = prices.get(drinkType) ?? EMPTY_ROW;
                return (
                  <div key={drinkType} className="grid grid-cols-2 gap-2">
                    <Input
                      id={`price-domestic-${drinkType}`}
                      label={t('form.sourcing.domesticPrice', {
                        type: t(`drinkType.${drinkType}`),
                      })}
                      inputMode="decimal"
                      value={row.domestic}
                      onChange={(e) => setRow(drinkType, { domestic: e.target.value })}
                      placeholder="5,00"
                    />
                    <Input
                      id={`price-foreign-${drinkType}`}
                      label={t('form.sourcing.foreignPrice')}
                      inputMode="decimal"
                      value={row.foreign}
                      onChange={(e) => setRow(drinkType, { foreign: e.target.value })}
                      placeholder="2,00"
                    />
                  </div>
                );
              })}
              <p className="text-xs text-gray-500">{t('form.sourcing.priceHint')}</p>
              {sourcingMalformed && (
                <p role="alert" className="text-xs text-red-600">
                  {t('form.sourcing.priceError')}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <Button type="submit" disabled={!valid || submitting} className="w-full">
        {submitting ? t('submitting') : t('submit')}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Per-type defaults for the fields this UI revision does not collect
// ---------------------------------------------------------------------------

/**
 * Typical ABV per drink type — the same figures the consumption-norms
 * seed's derivation assumes (beer 4.7 %, still wine 12 %, sparkling
 * 11.5 %, intermediate 18 %, cider/long drink 5.5 %, spirits 40 %). The
 * backend requires an ABV per priced line for the excise engines; this
 * UI revision does not collect it per user, so the norms derivation's
 * documented typical value is sent. The plan's figures remain fully
 * traceable: the response names the engines and datasets behind every
 * component, and the ABV assumption matches the published norms.
 */
function abvByDrinkType(drinkType: EventDrinkType): number {
  switch (drinkType) {
    case 'beer':
      return 4.7;
    case 'wine_still':
      return 12;
    case 'wine_sparkling':
      return 11.5;
    case 'intermediate_products':
      return 18;
    case 'other_fermented':
      return 5.5;
    case 'spirits':
      return 40;
  }
}

/**
 * Retail container per drink type — mirrors the retail-units catalogue
 * (cans for beer/cider, glass bottles for the rest).
 */
function containerByDrinkType(drinkType: EventDrinkType): 'can' | 'glass' | 'plastic' | 'other' {
  return drinkType === 'beer' || drinkType === 'other_fermented' ? 'can' : 'glass';
}
