/**
 * Omniva (omniva.ee) carrier rate source — manually curated dataset.
 *
 * Omniva publishes its international-parcel price list for private
 * customers as a PDF, so the EE→FI rows are transcribed into the
 * curated dataset below and updated by hand, exactly like the Fransberg
 * and Posti sources. When Omniva reprices, edit the bracket table and
 * bump {@link OMNIVA_OBSERVED_AT} to the review date; the monthly
 * curated-rate-refresh cron re-ingests the dataset through the same
 * governance-gated pipeline as the network sources and skips the append
 * while the newest stored omniva observation still carries the current
 * dataset date — the transport-offer write is append-only history, and
 * re-appending an unchanged dataset writes duplicate rows, not new
 * history.
 *
 * Dataset contract (transcribed 2026-10-04 from the published price
 * list "International parcels for private customers — prices including
 * VAT in EUR, valid from 1.07.2025",
 * https://www.omniva.ee/wp-content/uploads/sites/7/2025/08/hinnakiri-rv-pakiteenused-era-est-en-2025-4.pdf):
 * - Lane: Estonia→Finland, destination all of Finland; Standard
 *   service (3–6 working days) — the default consumer parcel service
 *   and the only tier transcribed. Prices include VAT.
 * - Premium is deliberately omitted: it is a separate service level the
 *   transport-offer schema does not dimension on, and encoding both
 *   services into one weight bracket would let the first DB hit decide
 *   the price (same rationale as Posti's size classes: never encode an
 *   ambiguous choice into one weight bracket).
 * - Economy is omitted: it is capped at 0.5 kg, a sliver this
 *   calculator's baskets do not fit.
 * - The recipient pays shipping, so `sellerInvolvementIndicator` is
 *   false on every row.
 * - Omniva's commercial parcel prices are unaffected by the
 *   universal-postal-service price change of 1.10.2026 (that change
 *   covers universal-service letters/parcels only — omniva.ee news
 *   "New Postal Service Price List from 1 October", 01.09.2026), so
 *   this dataset needed no re-review at that date.
 *
 * Admin procedure (same contract as Fransberg/Posti): edit the dataset,
 * bump OMNIVA_OBSERVED_AT, deploy — the monthly cron appends; the
 * per-carrier skip guards duplicates.
 *
 * @module OmnivaRateSource
 */

import type {
  CarrierRateOffer,
  ICarrierRateSource,
} from '../interfaces/carrier-rate-source.port';

// ---------------------------------------------------------------------------
// Curated dataset — edit here when Omniva changes its international-parcel
// price list
// ---------------------------------------------------------------------------

/** Review date of the current transcription — the observation time every offer carries. */
export const OMNIVA_OBSERVED_AT = new Date('2026-10-04T00:00:00Z');

/**
 * Boundary offset between consecutive brackets (1 g). Weight brackets
 * match inclusively on both ends (`inBracket`), so without the offset a
 * basket weighing exactly at a listed bracket edge (0.25, 0.5, 1, 2, …,
 * 25 kg) would match both the cheaper and the dearer bracket and the
 * first DB hit would decide the price. The offset pins the boundary
 * weight to the cheaper bracket; no gram-resolution product weight can
 * fall in the gap.
 */
const BRACKET_BOUNDARY_EPSILON_KG = 0.001;

/**
 * Omniva Standard, Estonia→Finland — VAT-inclusive euro cents by weight
 * bracket, transcribed from the published international-parcel price
 * list for private customers (valid from 1.07.2025). Each entry is
 * [bracket upper bound (kg), price (cents)]; a bracket's lower bound is
 * the previous bracket's upper bound + the boundary epsilon (the first
 * bracket starts at 0 kg), so a listed edge weight always prices in the
 * cheaper band.
 */
const OMNIVA_STANDARD_EE_FI: readonly (readonly [number, number])[] = [
  [0.25, 1240],
  [0.5, 1251],
  [1, 1272],
  [2, 1315],
  [3, 1358],
  [5, 1443],
  [10, 1747],
  [15, 1961],
  [20, 2174],
  [25, 2388],
  [30, 2601],
];

/**
 * Build the curated Omniva rate rows.
 *
 * Pure and deterministic — the same dataset always produces identical
 * rows, so a refresh appends nothing new while the dataset (and its
 * observedAt) is unchanged and the cron's unchanged-check guards it.
 */
export function buildOmnivaRates(): CarrierRateOffer[] {
  return OMNIVA_STANDARD_EE_FI.map(([weightMaxKg, priceCents], index) => {
    const previousMaxKg = index === 0 ? null : OMNIVA_STANDARD_EE_FI[index - 1][0];
    return {
      carrier: 'omniva',
      originCountry: 'EE',
      destinationCountry: 'FI',
      weightMinKg:
        previousMaxKg === null ? 0 : previousMaxKg + BRACKET_BOUNDARY_EPSILON_KG,
      weightMaxKg,
      packageTier: 'parcel',
      priceCents,
      currency: 'EUR',
      sellerInvolvementIndicator: false,
      observedAt: OMNIVA_OBSERVED_AT,
    };
  });
}

/**
 * The Omniva rate source — a static curated dataset behind the same
 * `ICarrierRateSource` port the network sources implement, so the
 * governance-gated refresh pipeline ingests it without special-casing.
 */
export class OmnivaCarrierRateSource implements ICarrierRateSource {
  readonly carrierId = 'omniva';

  async fetchRates(): Promise<{ rates: CarrierRateOffer[]; errors: string[] }> {
    // A curated dataset has no fetch to fail; the errors channel exists
    // for network sources and stays empty here.
    return { rates: buildOmnivaRates(), errors: [] };
  }
}
