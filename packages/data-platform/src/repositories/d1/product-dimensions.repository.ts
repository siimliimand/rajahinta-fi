/**
 * D1 ProductDimensionsRepository — curated physical packaging dimensions
 * (task 3.1, change product-roadmap-phases-1-4). Read paths serve the
 * packing optimizer's batch load; the write path replaces a product's row
 * wholesale — a new observation supersedes the previous one, never
 * appends history. ISO-8601 TEXT instants convert to Date at the
 * repository boundary (design D2).
 *
 * Absence of a row is a normal, meaningful state (design R3): a product
 * without dimensions is flagged ESTIMATED by callers, never defaulted.
 * The abstract class is co-located with the single concrete
 * implementation (the price-alert precedent) — there is no pg
 * counterpart for this change's tables, so no abstracts.ts contract
 * exists to extend.
 *
 * @module D1ProductDimensionsRepository
 */
import { Injectable } from '@nestjs/common';
import type { D1DatabaseLike } from '../../d1/executor';

/** Packaging material of the measured unit — the mixing warning's classification. */
export type ProductDimensionMaterial = 'GLASS' | 'CAN' | 'PLASTIC' | 'OTHER';

/** Contract row — camelCase projection of the snake_case D1 row. */
export interface ProductDimensionRecord {
  readonly id: number;
  readonly productId: number;
  readonly weightG: number;
  readonly heightMm: number;
  readonly diameterMm: number;
  readonly material: ProductDimensionMaterial;
  readonly source: string;
  readonly reliabilityStatus: string;
  readonly observedAt: Date;
}

/** A new observation for a product — replaces the row wholesale. */
export interface ProductDimensionUpsertInput {
  readonly productId: number;
  readonly weightG: number;
  readonly heightMm: number;
  readonly diameterMm: number;
  readonly material: ProductDimensionMaterial;
  /** Provenance: where the measurement came from (source page, carrier sheet, operator note). */
  readonly source: string;
  /** Reliability vocabulary (VERIFIED/ESTIMATED/STALE/UNAVAILABLE); defaults to ESTIMATED. */
  readonly reliabilityStatus?: string;
  /** When the measurement was observed; defaults to the current instant. */
  readonly observedAt?: Date;
}

/**
 * Curated dimension facts contract (spec: product-data-model, design R3).
 * Absence of a row is a normal state — callers flag those products
 * ESTIMATED and omit them from breakage-risk reasoning rather than
 * guessing.
 */
@Injectable()
export abstract class ProductDimensionsRepository {
  /** Dimensions of one product, or null when none are known. */
  abstract findByProductId(productId: number): Promise<ProductDimensionRecord | null>;

  /** Dimensions for a batch of products — ids without a row are absent from the result. */
  abstract findByProductIds(productIds: readonly number[]): Promise<ProductDimensionRecord[]>;

  /** Insert or replace the dimension row of a product (one row per product). */
  abstract upsert(input: ProductDimensionUpsertInput): Promise<ProductDimensionRecord>;
}

/** Raw D1 product_dimensions row. */
interface D1ProductDimensionRow {
  readonly id: number;
  readonly product_id: number;
  readonly weight_g: number;
  readonly height_mm: number;
  readonly diameter_mm: number;
  readonly material: string;
  readonly source: string;
  readonly reliability_status: string;
  readonly observed_at: string;
}

function toContractDimension(row: D1ProductDimensionRow): ProductDimensionRecord {
  return {
    id: row.id,
    productId: row.product_id,
    weightG: row.weight_g,
    heightMm: row.height_mm,
    diameterMm: row.diameter_mm,
    material: row.material as ProductDimensionMaterial,
    source: row.source,
    reliabilityStatus: row.reliability_status,
    observedAt: new Date(row.observed_at),
  };
}

const DIMENSION_COLUMNS = `
  id, product_id, weight_g, height_mm, diameter_mm, material, source,
  reliability_status, observed_at`;

const FIND_BY_PRODUCT_SQL = `
  SELECT ${DIMENSION_COLUMNS} FROM product_dimensions WHERE product_id = ?`;

// Replace-on-conflict: every observation column moves to the new values,
// so a refreshed row never mixes facts from two observations.
const UPSERT_SQL = `
  INSERT INTO product_dimensions (
    product_id, weight_g, height_mm, diameter_mm, material, source,
    reliability_status, observed_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (product_id) DO UPDATE SET
    weight_g = excluded.weight_g,
    height_mm = excluded.height_mm,
    diameter_mm = excluded.diameter_mm,
    material = excluded.material,
    source = excluded.source,
    reliability_status = excluded.reliability_status,
    observed_at = excluded.observed_at
  RETURNING ${DIMENSION_COLUMNS}`;

@Injectable()
export class D1ProductDimensionsRepository extends ProductDimensionsRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /** @inheritdoc */
  async findByProductId(productId: number): Promise<ProductDimensionRecord | null> {
    const row = await this.d1
      .prepare(FIND_BY_PRODUCT_SQL)
      .bind(productId)
      .first<D1ProductDimensionRow>();
    return row ? toContractDimension(row) : null;
  }

  /** @inheritdoc */
  async findByProductIds(productIds: readonly number[]): Promise<ProductDimensionRecord[]> {
    if (productIds.length === 0) {
      return [];
    }
    // One bound placeholder per id — the IN-list is never interpolated.
    const placeholders = productIds.map(() => '?').join(', ');
    const rows = (
      await this.d1
        .prepare(
          `SELECT ${DIMENSION_COLUMNS} FROM product_dimensions WHERE product_id IN (${placeholders}) ORDER BY product_id`,
        )
        .bind(...productIds)
        .all<D1ProductDimensionRow>()
    ).results;
    return rows.map(toContractDimension);
  }

  /** @inheritdoc */
  async upsert(input: ProductDimensionUpsertInput): Promise<ProductDimensionRecord> {
    const row = await this.d1
      .prepare(UPSERT_SQL)
      .bind(
        input.productId,
        input.weightG,
        input.heightMm,
        input.diameterMm,
        input.material,
        input.source,
        input.reliabilityStatus ?? 'ESTIMATED',
        input.observedAt?.toISOString() ?? new Date().toISOString(),
      )
      .first<D1ProductDimensionRow>();
    if (!row) {
      throw new Error('product_dimensions upsert .. RETURNING returned no row');
    }
    return toContractDimension(row);
  }
}
