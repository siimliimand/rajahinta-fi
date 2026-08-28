/**
 * Carrier rate-source port (task 7.4, design D6 — Posti first).
 *
 * The transport-rate pipeline consumes carriers through this port the
 * same way the price pipeline consumes merchants through IFeedAdapter:
 * merchant/carrier-specific concerns live behind it, the pipeline stays
 * source-agnostic, and every rate that crosses it carries an observation
 * timestamp and provenance so the freshness invariant (newest offer ≤
 * 7 days) measures carrier data age, not our fetch cadence.
 *
 * @module CarrierRateSourcePort
 */

/** One carrier shipping rate row, normalised for the transport-offers table. */
export interface CarrierRateOffer {
  /** Carrier identifier (e.g. "posti") — matches transportOffers.carrier. */
  readonly carrier: string;
  /** Shipping origin country (ISO 3166-1 alpha-2). */
  readonly originCountry: string;
  /** Shipping destination country (ISO 3166-1 alpha-2). */
  readonly destinationCountry: string;
  /** Weight-bracket lower bound in kg (null = no lower limit). */
  readonly weightMinKg: number | null;
  /** Weight-bracket upper bound in kg (null = no upper limit). */
  readonly weightMaxKg: number | null;
  /** Package tier (parcel/box/pallet) — matches basket dominant type. */
  readonly packageTier: string;
  /** Price in smallest currency unit (cents). */
  readonly priceCents: number;
  /** Price currency (ISO 4217) — the pipeline ingests EUR only for now. */
  readonly currency: string;
  /** True when the seller pays shipping (landed-cost attribution). */
  readonly sellerInvolvementIndicator: boolean;
  /**
   * When the carrier published/observed this rate — the timestamp the
   * freshness threshold is measured against. Must come from the source
   * payload, never from fetch time.
   */
  readonly observedAt: Date;
}

/** A carrier rate source — one implementation per carrier. */
export interface ICarrierRateSource {
  /** Stable carrier identifier (governance gates refreshes by this key). */
  readonly carrierId: string;

  /**
   * Fetch the carrier's current rate table.
   *
   * Recoverable failures are reported in `errors`; implementations must
   * not throw for them. `rates` contains only rows that passed
   * validation.
   */
  fetchRates(): Promise<{ rates: CarrierRateOffer[]; errors: string[] }>;
}

/** Injection token for the map of carrier rate sources, keyed by carrierId. */
export const CARRIER_RATE_SOURCES_TOKEN = 'CARRIER_RATE_SOURCES';

/** Posti's public rate-table endpoint — the default refresh source. */
export const POSTI_RATE_FEED_URL =
  'https://www.posti.fi/api/price-list/parcels.json';
