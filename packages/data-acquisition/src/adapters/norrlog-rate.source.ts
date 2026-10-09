/**
 * Norrlog (norrlog.com) carrier rate source — manually curated dataset.
 *
 * Norrlog publishes no machine-readable price feed; its FI price page is
 * a clean WordPress/Elementor HTML table (no bot protection), so the
 * DE→FI rates are transcribed into the curated dataset below and updated
 * by hand, exactly like the Fransberg and Omniva sources. When Norrlog
 * reprices, edit the bracket tables and bump {@link NORRLOG_OBSERVED_AT}
 * to the review date; the monthly curated-rate-refresh cron re-ingests
 * the dataset through the same governance-gated pipeline as the network
 * sources and skips the append while the newest stored norrlog
 * observation still carries the current dataset date — the
 * transport-offer write is append-only history, and re-appending an
 * unchanged dataset writes duplicate rows, not new history.
 *
 * Dataset contract (transcribed 2026-10-09 from the FI price page,
 * https://norrlog.com/fi/hinnat-ehdet/hinnasto/ — the authoritative
 * source; the DE/EN pages lag it — with carton/pallet specifics from the
 * freight-specifications page, https://norrlog.com/gross-schwer-gib-her/):
 * - Lane: Germany→Finland, destination all of Finland. The recipient
 *   pays shipping, so `sellerInvolvementIndicator` is false on every
 *   row.
 * - Parcels (packageTier "parcel") are home delivery only ("Kotiinkul-
 *   jetus (DHL)"), priced per 12-slot carton at €37.00. The pickup-
 *   point/locker service (DHL→Posti, €28.00 per carton) is deliberately
 *   EXCLUDED per design D1: the offer model has no service-level
 *   dimension and bracket selection is first-match, so two service
 *   levels sharing one weight bracket would make the quoted price
 *   row-order-dependent. It is recorded here as excluded, not missed.
 * - Carton → kg mapping: a carton is 12 slots (12×1 L bottles, 6×3 L
 *   Bag-in-Box, or 3 trays of 24×0.33 L cans), roughly 20–25 kg gross.
 *   The synthetic brackets use a conservative 25 kg carton cap (design
 *   D1): carton N maps onto [(N−1)·25 kg + ε, N·25 kg], so the existing
 *   quantity-scaled weight lookup selects the carton count natively.
 * - The carton ladder is capped at 10 cartons (250 kg): beyond that the
 *   carrier ships pallet freight in practice, so the weight-derived
 *   parcel tier hands off to the pallet rows above 250 kg instead of
 *   quoting a €1,000+ carton train against a €447 pallet.
 * - Pallets (packageTier "pallet", truck freight to door) are priced by
 *   destination postal-code zone; the offer model has no zone dimension,
 *   so each bracket is stored once at the most expensive zone, postal
 *   codes 8*–9* (€447 → €1,527), per design D3 — the price is then
 *   conservative for every Finnish destination. The published final two
 *   brackets (3,700 kg and 5,000 kg) both cost €1,527: prices are
 *   monotone non-decreasing, and the flat step is transcribed verbatim,
 *   not "fixed".
 *
 * Caveats: prices are "from" prices finalised at checkout; the optional
 * transport insurance (€3.80 per carton) is excluded from the rate rows;
 * without insurance, carrier liability follows NSAB 2000 at €0.80/kg.
 *
 * Admin procedure (same contract as Fransberg/Omniva): edit the dataset,
 * bump NORRLOG_OBSERVED_AT, deploy — the monthly cron appends; the
 * per-carrier skip guards duplicates.
 *
 * @module NorrlogRateSource
 */

import type {
  CarrierRateOffer,
  ICarrierRateSource,
} from '../interfaces/carrier-rate-source.port';

// ---------------------------------------------------------------------------
// Curated dataset — edit here when norrlog.com changes its price page
// ---------------------------------------------------------------------------

/** Review date of the current transcription — the observation time every offer carries. */
export const NORRLOG_OBSERVED_AT = new Date('2026-10-09T00:00:00Z');

/**
 * Boundary offset between consecutive brackets (1 g). Weight brackets
 * match inclusively on both ends (`inBracket`), so without the offset a
 * basket weighing exactly at a bracket edge (25, 50, …, 250 kg) would
 * match both the cheaper and the dearer bracket and the first DB hit
 * would decide the price. The offset pins the boundary weight to the
 * cheaper bracket; no gram-resolution product weight can fall in the gap.
 */
const BRACKET_BOUNDARY_EPSILON_KG = 0.001;

/**
 * Norrlog home-delivery parcels (Kotiinkuljetus DHL), Germany→Finland —
 * €37.00 per 12-slot carton, mapped onto synthetic kg brackets at the
 * documented 25 kg carton cap and capped at 10 cartons (250 kg; see the
 * module docblock for the carton-cap derivation and ladder ceiling).
 * Each entry is [bracket upper bound (kg), price (cents)]; a bracket's
 * lower bound is the previous bracket's upper bound + the boundary
 * epsilon (the first bracket has no lower bound), so a listed edge
 * weight always prices in the cheaper band.
 */
const NORRLOG_PARCEL_DE_FI: readonly (readonly [number, number])[] = [
  [25, 3700],
  [50, 7400],
  [75, 11100],
  [100, 14800],
  [125, 18500],
  [150, 22200],
  [175, 25900],
  [200, 29600],
  [225, 33300],
  [250, 37000],
];

/**
 * Norrlog pallets (truck freight to door), Germany→Finland, transcribed
 * from the most expensive destination zone (postal codes 8*–9*) per
 * design D3, so the price is conservative for every Finnish destination.
 * The final two brackets share €1,527 on the published page — the flat
 * step is verbatim, not an error.
 */
const NORRLOG_PALLET_ZONE_8_9_DE_FI: readonly (readonly [number, number])[] = [
  [740, 44700],
  [900, 50700],
  [1480, 71600],
  [2220, 97700],
  [2960, 124700],
  [3700, 152700],
  [5000, 152700],
];

/**
 * Build one tier's rows from an [upperKg, cents] bracket table. Pure and
 * deterministic; the first bracket is open-bounded below and every later
 * bracket starts one epsilon above the previous upper bound.
 */
function buildTierRates(
  packageTier: 'parcel' | 'pallet',
  table: readonly (readonly [number, number])[],
): CarrierRateOffer[] {
  return table.map(([weightMaxKg, priceCents], index) => ({
    carrier: 'norrlog',
    originCountry: 'DE',
    destinationCountry: 'FI',
    weightMinKg:
      index === 0 ? null : table[index - 1][0] + BRACKET_BOUNDARY_EPSILON_KG,
    weightMaxKg,
    packageTier,
    priceCents,
    currency: 'EUR',
    sellerInvolvementIndicator: false,
    observedAt: NORRLOG_OBSERVED_AT,
  }));
}

/**
 * Build the curated Norrlog rate rows.
 *
 * Pure and deterministic — the same dataset always produces identical
 * rows, so a refresh appends nothing new while the dataset (and its
 * observedAt) is unchanged and the cron's unchanged-check guards it.
 */
export function buildNorrlogRates(): CarrierRateOffer[] {
  return [
    ...buildTierRates('parcel', NORRLOG_PARCEL_DE_FI),
    ...buildTierRates('pallet', NORRLOG_PALLET_ZONE_8_9_DE_FI),
  ];
}

/**
 * The Norrlog rate source — a static curated dataset behind the same
 * `ICarrierRateSource` port the network sources implement, so the
 * governance-gated refresh pipeline ingests it without special-casing.
 */
export class NorrlogCarrierRateSource implements ICarrierRateSource {
  readonly carrierId = 'norrlog';

  async fetchRates(): Promise<{ rates: CarrierRateOffer[]; errors: string[] }> {
    // A curated dataset has no fetch to fail; the errors channel exists
    // for network sources and stays empty here.
    return { rates: buildNorrlogRates(), errors: [] };
  }
}
