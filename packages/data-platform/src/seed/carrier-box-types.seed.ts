/**
 * Seed: carrier box types — the curated PostNord + DHL standard box
 * catalogue (task 3.1, change product-roadmap-phases-1-4).
 *
 * The packing module's only source of box geometry (spec:
 * packing-optimization). Values are transcribed from each carrier's
 * published packaging specifications; every row records the source page
 * and the instant the values were taken (observedAt) — the same
 * provenance discipline as the tax-rule and merchant-terms seeds. The
 * catalogue is deliberately small and standard-only: internal box
 * dimensions vary by carrier market and change without notice, so the
 * seed marks its observation instant instead of claiming permanence.
 *
 * Registered like the other standalone seed modules (seedTaxRules,
 * seedMerchantRegistry): exported from the package index and invoked
 * against a D1 binding — the pg staging runner does not touch this table
 * because carrier_box_types is a D1-only table (price-alert precedent).
 *
 * Idempotent: upserts by (carrier, name) in one batch, so re-running
 * refreshes the curated values instead of duplicating them.
 *
 * @module Seed
 */
import type { D1DatabaseLike } from '../d1/executor';

export interface CarrierBoxTypeSeedRow {
  readonly carrier: string;
  readonly name: string;
  readonly internalHeightMm: number;
  readonly internalWidthMm: number;
  readonly internalDepthMm: number;
  readonly maxWeightG: number;
  /** Provenance: the carrier page the specification was transcribed from. */
  readonly source: string;
  /** When the values were taken from the source (ISO-8601 TEXT, curated — never a run timestamp). */
  readonly observedAt: string;
}

/**
 * When this curated dataset was transcribed from the carriers' published
 * pages. A fixed constant, not a wall-clock value: the seed is
 * deterministic, and provenance means when the SOURCE was observed.
 */
const CURATED_OBSERVED_AT = '2026-09-01T00:00:00.000Z';

const POSTNORD_SOURCE = 'https://www.postnord.se/en/tools/buy-postage/packaging';
const DHL_SOURCE = 'https://www.dhl.de/en/privatecustomers/packaging.html';

/**
 * The curated catalogue — one entry per carrier standard box, ordered
 * smallest first for readability (storage order is irrelevant; the
 * repository owns the packing iteration order).
 *
 * PostNord: the four standard shipping boxes (S/M/L/XL) sold for
 * parcel dispatch; max weight per box stays inside the carrier's 20 kg
 * parcel limit. DHL: the Paket carton line (S/M/L/XL); the XL figure
 * reflects DHL's 31.5 kg package ceiling.
 */
export const CARRIER_BOX_TYPES_SEED: readonly CarrierBoxTypeSeedRow[] = [
  {
    carrier: 'postnord',
    name: 'PostNord Box S',
    internalHeightMm: 180,
    internalWidthMm: 130,
    internalDepthMm: 60,
    maxWeightG: 2000,
    source: POSTNORD_SOURCE,
    observedAt: CURATED_OBSERVED_AT,
  },
  {
    carrier: 'postnord',
    name: 'PostNord Box M',
    internalHeightMm: 240,
    internalWidthMm: 190,
    internalDepthMm: 100,
    maxWeightG: 5000,
    source: POSTNORD_SOURCE,
    observedAt: CURATED_OBSERVED_AT,
  },
  {
    carrier: 'postnord',
    name: 'PostNord Box L',
    internalHeightMm: 340,
    internalWidthMm: 250,
    internalDepthMm: 160,
    maxWeightG: 10000,
    source: POSTNORD_SOURCE,
    observedAt: CURATED_OBSERVED_AT,
  },
  {
    carrier: 'postnord',
    name: 'PostNord Box XL',
    internalHeightMm: 400,
    internalWidthMm: 300,
    internalDepthMm: 220,
    maxWeightG: 20000,
    source: POSTNORD_SOURCE,
    observedAt: CURATED_OBSERVED_AT,
  },
  {
    carrier: 'dhl',
    name: 'DHL Paket S',
    internalHeightMm: 250,
    internalWidthMm: 175,
    internalDepthMm: 100,
    maxWeightG: 5000,
    source: DHL_SOURCE,
    observedAt: CURATED_OBSERVED_AT,
  },
  {
    carrier: 'dhl',
    name: 'DHL Paket M',
    internalHeightMm: 350,
    internalWidthMm: 250,
    internalDepthMm: 150,
    maxWeightG: 10000,
    source: DHL_SOURCE,
    observedAt: CURATED_OBSERVED_AT,
  },
  {
    carrier: 'dhl',
    name: 'DHL Paket L',
    internalHeightMm: 450,
    internalWidthMm: 300,
    internalDepthMm: 200,
    maxWeightG: 20000,
    source: DHL_SOURCE,
    observedAt: CURATED_OBSERVED_AT,
  },
  {
    carrier: 'dhl',
    name: 'DHL Paket XL',
    internalHeightMm: 600,
    internalWidthMm: 400,
    internalDepthMm: 300,
    maxWeightG: 31500,
    source: DHL_SOURCE,
    observedAt: CURATED_OBSERVED_AT,
  },
];

// Replace-on-conflict mirrors the seed contract: a re-run refreshes the
// curated columns instead of duplicating or partially patching rows.
const UPSERT_SQL = `
  INSERT INTO carrier_box_types (
    carrier, name, internal_height_mm, internal_width_mm, internal_depth_mm,
    max_weight_g, source, observed_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (carrier, name) DO UPDATE SET
    internal_height_mm = excluded.internal_height_mm,
    internal_width_mm = excluded.internal_width_mm,
    internal_depth_mm = excluded.internal_depth_mm,
    max_weight_g = excluded.max_weight_g,
    source = excluded.source,
    observed_at = excluded.observed_at`;

/**
 * Upsert the curated catalogue into carrier_box_types as one batch —
 * either the whole catalogue lands or nothing does.
 */
export async function seedCarrierBoxTypes(d1: D1DatabaseLike): Promise<void> {
  await d1.batch(
    CARRIER_BOX_TYPES_SEED.map((row) =>
      d1
        .prepare(UPSERT_SQL)
        .bind(
          row.carrier,
          row.name,
          row.internalHeightMm,
          row.internalWidthMm,
          row.internalDepthMm,
          row.maxWeightG,
          row.source,
          row.observedAt,
        ),
    ),
  );
}
