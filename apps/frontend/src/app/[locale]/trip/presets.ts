/**
 * Trip route presets (price-intelligence-roadmap task 4.3): pure data for
 * the Helsinki–Tallinn ferry patterns offered on the trip page.
 *
 * Guardrails: a preset only PREFILLS the break-even form's editable
 * inputs — it never locks a field, never submits, and never bypasses the
 * estimate: every result keeps deriving from the current editable inputs
 * at submit time. Labels and the example derivations live in the message
 * catalogs (`TripPage.presets.*`); this module carries only stable ids
 * and catalog keys so the data stays localizable and test-addressable.
 *
 * @module TripPresets
 */

import type { TripVehicleType } from './trip.types';

/** The break-even form's editable travel-side inputs a preset fills. */
export interface TripFormPrefill {
  /** Raw field values, exactly as the form's own inputs hold them. */
  readonly passengers: string;
  readonly vehicleType: TripVehicleType;
  readonly ticketEur: string;
  readonly fuelEur: string;
}

/** One route preset: identity, catalog keys, and the editable values. */
export interface TripRoutePreset {
  /** Stable id — the chip's test handle and re-apply semantics; never displayed. */
  readonly id: string;
  /** Label key under `TripPage.presets`. */
  readonly labelKey: string;
  /**
   * Example-derivation description key under `TripPage.presets` — the
   * preset is a clearly-labeled example, so the figures state where they
   * come from (return tickets for the vehicle + passengers; fuel from a
   * typical driven distance, consumption, and price).
   */
  readonly descriptionKey: string;
  /** The editable inputs this preset prefills. */
  readonly prefill: TripFormPrefill;
}

/**
 * Helsinki–Tallinn ferry patterns. The figures are plausible, clearly
 * labeled examples — not quotes. The catalog descriptions derive each
 * value (tickets; distance × consumption × fuel price) so every prefilled
 * number stays explainable, and all of them remain editable.
 */
export const TRIP_ROUTE_PRESETS: readonly TripRoutePreset[] = [
  {
    id: 'helsinki-tallinn-car',
    labelKey: 'helsinkiTallinnCar.label',
    descriptionKey: 'helsinkiTallinnCar.description',
    prefill: {
      passengers: '2',
      vehicleType: 'car',
      ticketEur: '120,00',
      fuelEur: '55,00',
    },
  },
  {
    id: 'helsinki-tallinn-van',
    labelKey: 'helsinkiTallinnVan.label',
    descriptionKey: 'helsinkiTallinnVan.description',
    prefill: {
      passengers: '3',
      vehicleType: 'van',
      ticketEur: '220,00',
      fuelEur: '95,00',
    },
  },
];
