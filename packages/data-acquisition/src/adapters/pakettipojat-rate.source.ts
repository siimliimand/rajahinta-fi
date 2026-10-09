/**
 * Pakettipojat (pakettipojat.com) carrier rate source — manually curated
 * dataset.
 *
 * pakettipojat.com publishes no machine-readable feed and gates its
 * price-list page behind a JS "Client Challenge", so the DE→FI rows are
 * transcribed into the curated dataset below and updated by hand,
 * exactly like the Fransberg and Omniva sources. When Pakettipojat
 * reprices, edit the bracket tables and bump {@link PAKETTIPOJAT_OBSERVED_AT}
 * to the review date; the monthly curated-rate-refresh cron re-ingests
 * the dataset through the same governance-gated pipeline as the network
 * sources and skips the append while the newest stored pakettipojat
 * observation still carries the current dataset date — the
 * transport-offer write is append-only history, and re-appending an
 * unchanged dataset writes duplicate rows, not new history.
 *
 * Dataset contract (transcribed 2026-10-09 from the published price list
 * "Kuljetushinnat", https://www.pakettipojat.com/page/5/kuljetushinnat —
 * the live page requires JS and serves bots a Client Challenge, so the
 * transcription was taken from the Wayback capture
 * http://web.archive.org/web/20260807200917/https://www.pakettipojat.com/page/5/kuljetushinnat,
 * captured 2026-08-07):
 * - Lane: Germany→Finland, destination all of Finland. Prices include
 *   VAT; the recipient pays shipping, so `sellerInvolvementIndicator`
 *   is false on every row.
 * - Parcel rows are the "DHL kotiinkuljetus Suomessa" (home delivery)
 *   service only. Parcels are priced per 28 kg unit up to the published
 *   540 kg ceiling; each listed edge is a unit-count ceiling
 *   (28/56/…/540 kg), transcribed verbatim — never reconstructed from
 *   the ×36,90 unit pattern.
 * - Pickup-point delivery ("DHL pakettitoimitus Suomeen (lähimpään
 *   noutopisteeseen)", 29,90 € per 28 kg unit up to 600 kg) is
 *   deliberately EXCLUDED, not missed: it is a separate service level
 *   the transport-offer schema does not dimension on, and encoding both
 *   services into one weight bracket would let the first DB hit decide
 *   the price (design D1; same rationale as Omniva's Premium tier).
 * - Pallet rows are "Lavarahti perille toimitettuna" (door delivery) at
 *   the most expensive postal zone, zone 9 (postinumerot 94000–97999),
 *   per the conservative max-zone rule (design D3): the exact
 *   destination postcode is unknown at quote time, so a basket must
 *   never be underpriced by quoting a cheaper zone.
 *
 * Known anomalies in the upstream tables — flagged here, NOT inherited:
 * - The pickup-point column lists a "169 kg 209,30 €" row between the
 *   168 kg and 224 kg rows (the unit pattern says 196 kg). It belongs
 *   to the excluded service and does not affect this dataset; re-check
 *   the table before ever transcribing pickup prices.
 * - Pallet zone 6 lists "800 kg 309 €" between 770 kg 384 € and
 *   1480 kg 489 € (the zone pattern says ~409 €). Zone 9 is
 *   transcribed instead, so the typo does not propagate — but any
 *   future re-zoning must re-verify the table rather than trust it.
 * - Within the transcribed home-delivery column the 140 kg row is
 *   179,50 € where the ×36,90 unit pattern would say 184,50 €, and the
 *   392 kg row is 502,60 € where the pattern would say 516,60 €. Both
 *   are published values, kept verbatim on purpose — the sanity tests
 *   pin them so a well-meant "fix" cannot silently reprice them.
 *
 * Transport insurance: Pakettipojat requires a separate transport
 * insurance for shipments containing alcohol or liquids ("Jos
 * kuljetustilauksesi sisältää alkoholia tai nesteitä, tarvitaan aina
 * erillinen kuljetusvakuutus. Ilman sitä korvausvaatimusta ei
 * käsitellä."), and since 10.7.2019 all shipments are uninsured unless
 * the customer purchases insurance. The insurance price is not part of
 * these rate rows and must not be folded into them — the landed-cost
 * calculator carries it as its own line.
 *
 * @module PakettipojatRateSource
 */

import type {
  CarrierRateOffer,
  ICarrierRateSource,
} from '../interfaces/carrier-rate-source.port';

// ---------------------------------------------------------------------------
// Curated dataset — edit here when pakettipojat.com changes its price list
// ---------------------------------------------------------------------------

/** Review date of the current transcription — the observation time every offer carries. */
export const PAKETTIPOJAT_OBSERVED_AT = new Date('2026-10-09T00:00:00Z');

/**
 * Boundary offset between consecutive brackets (1 g). Weight brackets
 * match inclusively on both ends (`inBracket`), so without the offset a
 * basket weighing exactly at a listed bracket edge (28, 56, …, 540 kg
 * parcel; 740, 770, …, 5180 kg pallet) would match both the cheaper and
 * the dearer bracket and the first DB hit would decide the price. The
 * offset pins the boundary weight to the cheaper bracket; no
 * gram-resolution product weight can fall in the gap.
 */
const BRACKET_BOUNDARY_EPSILON_KG = 0.001;

/**
 * "DHL kotiinkuljetus Suomessa" (home delivery), Germany→Finland —
 * VAT-inclusive euro cents per 28 kg unit bracket, transcribed verbatim
 * from the published table (each entry is [bracket upper bound (kg),
 * price (cents)]; a bracket's lower bound is the previous bracket's
 * upper bound + the boundary epsilon, the first bracket starts at
 * 0 kg). The 140 kg and 392 kg rows deviate from the ×36,90 unit
 * pattern on purpose — see the module docblock.
 */
const PARCEL_HOME_DELIVERY_DE_FI: readonly (readonly [number, number])[] = [
  [28, 3690],
  [56, 7380],
  [84, 11070],
  [112, 14760],
  [140, 17950],
  [168, 22140],
  [196, 25830],
  [224, 29520],
  [252, 33210],
  [280, 36900],
  [308, 40590],
  [336, 44280],
  [364, 47970],
  [392, 50260],
  [450, 53850],
  [480, 57440],
  [510, 61030],
  [540, 64620],
];

/**
 * "Lavarahti perille toimitettuna" (door delivery pallet freight),
 * postal zone 9 (94000–97999) — the most expensive Finnish zone, quoted
 * per the conservative max-zone rule (design D3). VAT-inclusive euro
 * cents by weight bracket, same [upperBoundKg, cents] shape as the
 * parcel table.
 */
const PALLET_DOOR_DELIVERY_DE_FI_ZONE_9: readonly (readonly [number, number])[] = [
  [740, 39500],
  [770, 42000],
  [800, 44500],
  [1480, 52900],
  [2220, 78500],
  [2960, 104500],
  [3700, 131500],
  [4440, 156500],
  [5180, 181500],
];

/**
 * Build the curated Pakettipojat rate rows.
 *
 * Pure and deterministic — the same dataset always produces identical
 * rows, so a refresh appends nothing new while the dataset (and its
 * observedAt) is unchanged and the cron's unchanged-check guards it.
 */
export function buildPakettipojatRates(): CarrierRateOffer[] {
  const tierTables = [
    ['parcel', PARCEL_HOME_DELIVERY_DE_FI],
    ['pallet', PALLET_DOOR_DELIVERY_DE_FI_ZONE_9],
  ] as const;

  return tierTables.flatMap(([packageTier, table]) =>
    table.map(([weightMaxKg, priceCents], index) => {
      const previousMaxKg = index === 0 ? null : table[index - 1][0];
      return {
        carrier: 'pakettipojat',
        originCountry: 'DE',
        destinationCountry: 'FI',
        weightMinKg:
          previousMaxKg === null
            ? 0
            : previousMaxKg + BRACKET_BOUNDARY_EPSILON_KG,
        weightMaxKg,
        packageTier,
        priceCents,
        currency: 'EUR',
        sellerInvolvementIndicator: false,
        observedAt: PAKETTIPOJAT_OBSERVED_AT,
      };
    }),
  );
}

/**
 * The Pakettipojat rate source — a static curated dataset behind the
 * same `ICarrierRateSource` port the network sources implement, so the
 * governance-gated refresh pipeline ingests it without special-casing.
 */
export class PakettipojatCarrierRateSource implements ICarrierRateSource {
  readonly carrierId = 'pakettipojat';

  async fetchRates(): Promise<{ rates: CarrierRateOffer[]; errors: string[] }> {
    // A curated dataset has no fetch to fail; the errors channel exists
    // for network sources and stays empty here.
    return { rates: buildPakettipojatRates(), errors: [] };
  }
}
