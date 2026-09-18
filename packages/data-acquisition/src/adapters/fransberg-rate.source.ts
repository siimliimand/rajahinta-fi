/**
 * Fransberg (fransberg.eu) carrier rate source — manually curated dataset.
 *
 * fransberg.eu publishes no machine-readable price feed — its pricing page
 * is a WordPress/Elementor HTML table. Scraping it would couple the
 * pipeline to layout drift (the page even carries commented-out rows the
 * carrier does not offer), so the rates are transcribed into the curated
 * dataset below and updated by hand: when Fransberg changes its prices,
 * edit the price tables and bump {@link FRANSBERG_OBSERVED_AT} to the
 * review date. The monthly refresh cron re-ingests this dataset through
 * the same governance-gated pipeline as the network sources and skips the
 * append while the newest stored fransberg observation still carries the
 * current dataset date — the transport-offer write is append-only history,
 * and re-appending an unchanged dataset writes duplicate rows, not new
 * history.
 *
 * Dataset contract (transcribed 2026-09-17 from fransberg.eu/pricing):
 * - Home-delivery prices only; pickup-point delivery is a separate service
 *   level the transport-offer schema does not dimension on.
 * - Lanes: Germany→Finland and Croatia→Finland; destination is all of
 *   Finland. Prices include VAT.
 * - Parcels are priced per PACKAGE COUNT (1–15), not per weight bracket.
 *   Count N maps onto the weight bracket a shipment fills at Fransberg's
 *   31.5 kg per-package maximum: [(N−1)·31.5, N·31.5]. Pallets carry the
 *   page's own 720 kg-per-pallet brackets. The recipient pays shipping, so
 *   `sellerInvolvementIndicator` is false on every row.
 * - The page's hidden (commented-out) 16–19-package and 4-pallet rows are
 *   not offered and are not transcribed.
 *
 * @module FransbergRateSource
 */

import type {
  CarrierRateOffer,
  ICarrierRateSource,
} from '../interfaces/carrier-rate-source.port';

// ---------------------------------------------------------------------------
// Curated dataset — edit here when fransberg.eu changes its pricing page
// ---------------------------------------------------------------------------

/** Review date of the current transcription — the observation time every offer carries. */
export const FRANSBERG_OBSERVED_AT = new Date('2026-09-17T00:00:00Z');

/** Per-package weight maximum (kg) — Fransberg prices parcels by package count. */
export const FRANSBERG_MAX_PARCEL_KG = 31.5;

/** Weight a pallet is priced up to (kg), per the pricing page. */
export const FRANSBERG_PALLET_KG = 720;

/**
 * Boundary offset between consecutive count-derived brackets (1 g). Weight
 * brackets match inclusively on both ends (`inBracket`), so without the
 * offset a basket weighing exactly N × 31.5 kg would match both the
 * N-package and the (N+1)-package bracket and the first DB hit would
 * decide the price. The offset pins the boundary weight to the smaller
 * (cheaper) bracket; no gram-resolution product weight can fall in the gap.
 */
const BRACKET_BOUNDARY_EPSILON_KG = 0.001;

/** Home-delivery prices in euro cents by package count — Germany → Finland. */
const HOME_DELIVERY_DE_CENTS: readonly number[] = [
  3499, 6799, 10199, 13199, 15599, 18699, 22299, 24999, 26999, 27999,
  29999, 31999, 32999, 33999, 34999,
];

/** Home-delivery prices in euro cents by package count — Croatia → Finland. */
const HOME_DELIVERY_HR_CENTS: readonly number[] = [
  3499, 6799, 10199, 12399, 15599, 18699, 22299, 24999, 26999, 27999,
  29999, 31999, 32999, 33999, 34999,
];

/** Home-delivery prices in euro cents by pallet count — identical for both origins. */
const HOME_DELIVERY_PALLET_CENTS: readonly number[] = [38999, 69999, 89999];

/**
 * Build the curated Fransberg rate rows.
 *
 * Pure and deterministic — the same dataset always produces identical
 * rows, so a refresh appends nothing new while the dataset (and its
 * observedAt) is unchanged and the cron's unchanged-check guards it.
 */
export function buildFransbergRates(): CarrierRateOffer[] {
  const rates: CarrierRateOffer[] = [];

  const parcelOrigins = [
    ['DE', HOME_DELIVERY_DE_CENTS],
    ['HR', HOME_DELIVERY_HR_CENTS],
  ] as const;
  for (const [origin, prices] of parcelOrigins) {
    prices.forEach((priceCents, index) => {
      const count = index + 1;
      rates.push({
        carrier: 'fransberg',
        originCountry: origin,
        destinationCountry: 'FI',
        weightMinKg:
          count === 1
            ? 0
            : (count - 1) * FRANSBERG_MAX_PARCEL_KG + BRACKET_BOUNDARY_EPSILON_KG,
        weightMaxKg: count * FRANSBERG_MAX_PARCEL_KG,
        packageTier: 'parcel',
        priceCents,
        currency: 'EUR',
        sellerInvolvementIndicator: false,
        observedAt: FRANSBERG_OBSERVED_AT,
      });
    });
  }

  for (const origin of ['DE', 'HR'] as const) {
    HOME_DELIVERY_PALLET_CENTS.forEach((priceCents, index) => {
      const count = index + 1;
      rates.push({
        carrier: 'fransberg',
        originCountry: origin,
        destinationCountry: 'FI',
        weightMinKg:
          count === 1
            ? 0
            : (count - 1) * FRANSBERG_PALLET_KG + BRACKET_BOUNDARY_EPSILON_KG,
        weightMaxKg: count * FRANSBERG_PALLET_KG,
        packageTier: 'pallet',
        priceCents,
        currency: 'EUR',
        sellerInvolvementIndicator: false,
        observedAt: FRANSBERG_OBSERVED_AT,
      });
    });
  }

  return rates;
}

/**
 * The Fransberg rate source — a static curated dataset behind the same
 * `ICarrierRateSource` port the network sources implement, so the
 * governance-gated refresh pipeline ingests it without special-casing.
 */
export class FransbergCarrierRateSource implements ICarrierRateSource {
  readonly carrierId = 'fransberg';

  async fetchRates(): Promise<{ rates: CarrierRateOffer[]; errors: string[] }> {
    // A curated dataset has no fetch to fail; the errors channel exists
    // for network sources and stays empty here.
    return { rates: buildFransbergRates(), errors: [] };
  }
}
