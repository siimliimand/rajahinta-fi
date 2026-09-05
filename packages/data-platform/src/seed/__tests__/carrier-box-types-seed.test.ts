/**
 * Carrier box-type seed tests (task 3.1, change
 * product-roadmap-phases-1-4) on the node:sqlite harness with the
 * committed migrations applied. Covers the curated catalogue's
 * provenance completeness (source + observedAt on every row — the same
 * discipline as the tax-rule seed), carrier coverage, batch apply, and
 * the idempotent re-run contract (upsert refreshes, never duplicates).
 *
 * @module CarrierBoxTypesSeedTest
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from '../../repositories/d1/__tests__/d1-test-harness';
import {
  CARRIER_BOX_TYPES_SEED,
  seedCarrierBoxTypes,
} from '../carrier-box-types.seed';

const { db, d1 } = openMigratedD1();

function rowCount(): number {
  return (db.prepare('SELECT count(*) AS n FROM carrier_box_types').get() as { n: number }).n;
}

describe('carrier box-type seed', () => {
  it('covers both curated carriers (PostNord, DHL)', () => {
    const carriers = new Set(CARRIER_BOX_TYPES_SEED.map((row) => row.carrier));
    expect([...carriers].sort()).toEqual(['dhl', 'postnord']);
  });

  it('carries provenance on every row — a source-less or unobserved box is unrepresentable', () => {
    for (const row of CARRIER_BOX_TYPES_SEED) {
      expect(row.source.startsWith('https://')).toBe(true);
      expect(row.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      // Deterministic provenance: a fixed observation instant, never a
      // wall-clock value baked in at import time.
      expect(row.observedAt).toBe('2026-09-01T00:00:00.000Z');
    }
  });

  it('names are unique per carrier — the (carrier, name) upsert key never self-collides', () => {
    const keys = CARRIER_BOX_TYPES_SEED.map((row) => `${row.carrier}|${row.name}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('all values are positive integers (mirrors the schema CHECKs before they run)', () => {
    for (const row of CARRIER_BOX_TYPES_SEED) {
      for (const value of [
        row.internalHeightMm,
        row.internalWidthMm,
        row.internalDepthMm,
        row.maxWeightG,
      ]) {
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThan(0);
      }
    }
  });

  it('applies the whole catalogue in one batch and lands every row', async () => {
    await seedCarrierBoxTypes(d1);
    expect(rowCount()).toBe(CARRIER_BOX_TYPES_SEED.length);

    const postnord = db
      .prepare(`SELECT name FROM carrier_box_types WHERE carrier = 'postnord' ORDER BY name`)
      .all() as Array<{ name: string }>;
    expect(postnord.map((r) => r.name)).toEqual([
      'PostNord Box L',
      'PostNord Box M',
      'PostNord Box S',
      'PostNord Box XL',
    ]);
  });

  it('is idempotent: a re-run refreshes values in place, never duplicates', async () => {
    await seedCarrierBoxTypes(d1);
    await seedCarrierBoxTypes(d1);
    expect(rowCount()).toBe(CARRIER_BOX_TYPES_SEED.length);

    // The stored values match the curated constant exactly (replace, not drift).
    for (const row of CARRIER_BOX_TYPES_SEED) {
      const stored = db
        .prepare(
          `SELECT internal_height_mm, internal_width_mm, internal_depth_mm, max_weight_g, source, observed_at
           FROM carrier_box_types WHERE carrier = ? AND name = ?`,
        )
        .get(row.carrier, row.name) as {
        internal_height_mm: number;
        internal_width_mm: number;
        internal_depth_mm: number;
        max_weight_g: number;
        source: string;
        observed_at: string;
      };
      expect(stored).toEqual({
        internal_height_mm: row.internalHeightMm,
        internal_width_mm: row.internalWidthMm,
        internal_depth_mm: row.internalDepthMm,
        max_weight_g: row.maxWeightG,
        source: row.source,
        observed_at: row.observedAt,
      });
    }
  });
});
