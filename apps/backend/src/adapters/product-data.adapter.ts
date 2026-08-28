/**
 * Product Data Adapter — domain-port implementation for IProductDataPort.
 *
 * Maps between the Drizzle ProductRepository (data-platform layer) and the
 * CalculatorProductData / CalculatorRetailOfferData read models that the
 * domain-level LandedCostCalculatorService expects.
 *
 * ## Key transformations
 *
 * | Database column      | Domain field          | Notes                        |
 * |----------------------|-----------------------|------------------------------|
 * | `unitVolume` (string)| `volumeLitres` (num.) | parseFloat — numeric string  |
 * | `alcoholByVolume`    | `alcoholByVolume`     | parseFloat or 0 when null    |
 * | `name`               | `normalizedName`      | direct copy                  |
 * | — (no weight field)  | `weightKg`            | estimated: vol × 1.0 kg/L    |
 *
 * @module ProductDataAdapter
 */

import { Injectable } from '@nestjs/common';
import { ProductRepository } from '@rajahinta/data-platform';
import type {
  IProductDataPort,
  CalculatorProductData,
  CalculatorRetailOfferData,
  ReliabilityStatus,
} from '@rajahinta/core-domain';

/**
 * Parse a Drizzle numeric string to a float.
 * Drizzle maps `numeric()` columns to `string` in inferred types.
 */
function parseNumeric(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Estimate weight in kilograms from volume in litres.
 *
 * Uses a density of 1.0 kg/L as a reasonable approximation for most
 * beverages (water-based). When the product master gains an actual
 * weight field, this estimate should be replaced with the real value.
 */
function estimateWeightKg(volumeLitres: number): number {
  return volumeLitres * 1.0;
}

@Injectable()
export class ProductDataAdapter implements IProductDataPort {
  constructor(private readonly repo: ProductRepository) {}

  /**
   * Look up a product by ID and map to CalculatorProductData.
   */
  async findProductById(id: number): Promise<CalculatorProductData | null> {
    const record = await this.repo.findById(id);
    if (record === null) return null;

    const volumeLitres = parseNumeric(record.unitVolume);

    return {
      id: record.id,
      regulatoryClassification: record.regulatoryClassification,
      category: record.category,
      volumeLitres,
      alcoholByVolume: record.alcoholByVolume !== null
        ? parseNumeric(record.alcoholByVolume)
        : 0,
      containerType: record.containerType,
      depositSystemStatus: record.depositSystemStatus,
      weightKg: estimateWeightKg(volumeLitres),
      normalizedName: record.name,
    };
  }

  /**
   * Return retail offers for a product, mapped to CalculatorRetailOfferData.
   *
   * Conversion-state columns (design D2 / task 1.5) pass through so live
   * offers carry their FX provenance: `hasValidEurConversion` excludes
   * offers whose non-EUR original lacks a recorded FX dataset version.
   * Null columns are omitted rather than nulled — "absent" is the
   * read-model state the domain contract expects for unknown provenance.
   */
  async findRetailOffers(productId: number): Promise<CalculatorRetailOfferData[]> {
    const offers = await this.repo.findOffers(productId);

    return offers.map((o) => ({
      id: o.id,
      priceCents: o.priceCents,
      currency: o.currency,
      merchant: o.merchant,
      country: o.country,
      reliabilityStatus: toReliabilityStatus(o.reliabilityStatus),
      ...(o.originalPriceCents !== null
        ? { originalPriceCents: o.originalPriceCents }
        : {}),
      ...(o.originalCurrency !== null
        ? { originalCurrency: o.originalCurrency }
        : {}),
      ...(o.fxDatasetVersion !== null
        ? { fxDatasetVersion: o.fxDatasetVersion }
        : {}),
    }));
  }
}

/**
 * Narrow a persisted reliability string to the domain union.
 *
 * The database column is a free string; rows written before the vocabulary
 * unification may hold legacy values such as 'EXACT'. Unknown or legacy
 * values degrade to ESTIMATED — reliability is never overstated.
 */
function toReliabilityStatus(value: string): ReliabilityStatus {
  return value === 'VERIFIED' || value === 'STALE' || value === 'UNAVAILABLE'
    ? value
    : 'ESTIMATED';
}