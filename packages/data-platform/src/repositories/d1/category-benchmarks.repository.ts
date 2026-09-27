/**
 * D1 CategoryBenchmarkRepository — read-model for the category price
 * benchmarks (task 3.1, change client-experience-improvement, spec
 * price-benchmarks): per canonical excise category, the current average
 * price per litre computed from observed catalog offers, split into the
 * domestic Alko average and the cross-border webshop average.
 *
 * ## DISPLAY-ONLY
 *
 * Everything this module computes surfaces only as display fields.
 * Nothing here may enter a calculation total, a breakdown, or any
 * ranking input (proposal decision D1) — pinned by the
 * benchmarks-display-only compliance test: no ranking/calculation
 * input-producing module may import this file, and calculation/ranking
 * output is byte-identical across zero, one, and many benchmark rows.
 *
 * ## Semantics
 *
 * - "Current catalog offers" is the SAME collapse the detail endpoint
 *   serves (repo findOffers): retail_offers is append-per-scrape, so the
 *   latest observation per (product, merchant) pair is its MAX(id) row.
 *   A superseded cheaper scrape must not drag an average down.
 * - Segment membership: `merchant === ALKO_MERCHANT` → the domestic Alko
 *   segment (the domestic reference feed is identified by its merchant
 *   identity — savings-snapshots.ts inlines the same constant); other
 *   offers whose seller `country` differs from `'FI'` → the cross-border
 *   webshop segment. A domestic non-Alko offer fits NEITHER named
 *   segment and is excluded from both (a third bucket would fabricate a
 *   coverage the endpoint does not claim).
 * - Each figure is the mean of the covering offers' cents-per-litre
 *   (price_cents / unit_volume), rounded to two decimals; it carries its
 *   as-of date (the covering set's latest observed_at, date part) and a
 *   reliability status (the WEAKEST covering-offer status — an average
 *   is only as reliable as its least reliable input). Unknown stored
 *   statuses are treated as UNAVAILABLE, never VERIFIED.
 * - Absence is honest: a category or segment without covering offers is
 *   `null` — never a zero, never a guessed average (spec price-benchmarks).
 *
 * The pure aggregation lives in exported functions so the repository
 * tests can pin the math without SQL (product-search.repository
 * tokenize/buildMatchExpression precedent).
 *
 * @module D1CategoryBenchmarkRepository
 */
import { Injectable } from '@nestjs/common';
import { PRODUCT_CATEGORIES } from '../../d1/schema';
import type { D1DatabaseLike } from '../../d1/executor';

/**
 * The domestic reference merchant identity. Inlined on purpose (the
 * savings-snapshots precedent): the calculator's private constant is not
 * importable across the boundary, and this value is the domain's single
 * Alko identity.
 */
const ALKO_MERCHANT = 'alko';

/** The destination market — offers sold outside it are cross-border. */
const DOMESTIC_COUNTRY = 'FI';

/** One collapsed catalog offer joined with its product's benchmark keys. */
export interface CategoryBenchmarkOfferRow {
  readonly productId: number;
  readonly merchant: string;
  readonly country: string;
  readonly category: string;
  /** Litres — the product_master NOT NULL unit_volume, as stored REAL. */
  readonly unitVolumeLitres: number;
  readonly priceCents: number;
  /** ISO-8601 TEXT as stored. */
  readonly observedAt: string;
  readonly reliabilityStatus: string;
}

/** The reliability value set the offer CHECK enforces (schema.ts). */
export type BenchmarkReliabilityStatus =
  | 'VERIFIED'
  | 'STALE'
  | 'ESTIMATED'
  | 'UNAVAILABLE';

/** One segment figure — every field the spec requires rides along. */
export interface CategoryBenchmarkFigures {
  /** Mean cents-per-litre over the covering offers, 2-decimal rounding. */
  readonly averageCentsPerLitre: number;
  /** The covering offers actually priced into the average. */
  readonly offerCount: number;
  /** Distinct products behind those offers. */
  readonly productCount: number;
  /** The covering set's latest observed_at, date part (YYYY-MM-DD). */
  readonly asOf: string;
  /** Weakest covering-offer status — never stronger than its inputs. */
  readonly reliabilityStatus: BenchmarkReliabilityStatus;
}

/** One category's benchmark row — a segment without coverage is null. */
export interface CategoryBenchmarkRow {
  readonly category: string;
  readonly alko: CategoryBenchmarkFigures | null;
  readonly crossBorder: CategoryBenchmarkFigures | null;
}

/** SQL for the collapsed current-offer read (module docblock). */
const CATEGORY_BENCHMARK_ROWS_SQL = `
  SELECT o.product_id AS product_id,
         o.merchant AS merchant,
         o.country AS country,
         o.price_cents AS price_cents,
         o.observed_at AS observed_at,
         o.reliability_status AS reliability_status,
         p.category AS category,
         p.unit_volume AS unit_volume
    FROM retail_offers o
    JOIN (SELECT product_id, merchant, MAX(id) AS id
            FROM retail_offers
        GROUP BY product_id, merchant) m
      ON m.id = o.id
    JOIN product_master p ON p.id = o.product_id`;

@Injectable()
export class D1CategoryBenchmarkRepository {
  constructor(private readonly d1: D1DatabaseLike) {}

  /**
   * The current catalog offers with their benchmark keys, optionally
   * narrowed to one category. `category` must be validated against
   * `PRODUCT_CATEGORIES` by the caller (the API route 400s unknown
   * values); any non-undefined value filters by exact equality.
   */
  async categoryOfferRows(category?: string): Promise<CategoryBenchmarkOfferRow[]> {
    const filtered = category !== undefined;
    const rows = (
      await this.d1
        .prepare(
          filtered
            ? `${CATEGORY_BENCHMARK_ROWS_SQL} WHERE p.category = ? ORDER BY o.id ASC`
            : `${CATEGORY_BENCHMARK_ROWS_SQL} ORDER BY o.id ASC`,
        )
        .bind(...(filtered ? [category] : []))
        .all<{
          product_id: number;
          merchant: string;
          country: string;
          price_cents: number;
          observed_at: string;
          reliability_status: string;
          category: string;
          unit_volume: number;
        }>()
    ).results;
    return rows.map((row) => ({
      productId: row.product_id,
      merchant: row.merchant,
      country: row.country,
      category: row.category,
      unitVolumeLitres: row.unit_volume,
      priceCents: row.price_cents,
      observedAt: row.observed_at,
      reliabilityStatus: row.reliability_status,
    }));
  }
}

/**
 * Segment membership (module docblock): the Alko reference feed is
 * domestic by identity; every other offer is cross-border when its
 * seller country differs from the destination. `null` = fits neither
 * named segment (domestic non-Alko) and is excluded from both.
 */
export function benchmarkSegmentOf(
  row: Pick<CategoryBenchmarkOfferRow, 'merchant' | 'country'>,
): 'alko' | 'crossBorder' | null {
  if (row.merchant === ALKO_MERCHANT) return 'alko';
  if (row.country !== DOMESTIC_COUNTRY) return 'crossBorder';
  return null;
}

/**
 * Weakness order — a figure is never presented as more reliable than its
 * least reliable input. An unknown stored status maps to UNAVAILABLE
 * (unreadable provenance is the worst honest claim).
 */
const RELIABILITY_WEAKNESS: Record<string, number> = {
  VERIFIED: 0,
  STALE: 1,
  ESTIMATED: 2,
  UNAVAILABLE: 3,
};

function weakestReliability(
  statuses: readonly string[],
): BenchmarkReliabilityStatus {
  let weakest: BenchmarkReliabilityStatus = 'VERIFIED';
  let weakness = RELIABILITY_WEAKNESS.VERIFIED;
  for (const status of statuses) {
    const candidate = RELIABILITY_WEAKNESS[status] ?? RELIABILITY_WEAKNESS.UNAVAILABLE;
    if (candidate > weakness) {
      weakness = candidate;
      weakest =
        status === 'STALE' || status === 'ESTIMATED' || status === 'UNAVAILABLE'
          ? status
          : 'UNAVAILABLE';
    }
  }
  return weakest;
}

/**
 * Aggregate one segment's covering offers. Empty coverage (or a set
 * priced-in to nothing — every row with a non-positive volume, which the
 * ingestion data-quality gate prevents) is honest `null`, never a zero.
 */
export function aggregateBenchmarkSegment(
  rows: readonly CategoryBenchmarkOfferRow[],
): CategoryBenchmarkFigures | null {
  const usable = rows.filter((row) => row.unitVolumeLitres > 0);
  if (usable.length === 0) return null;
  const totalCentsPerLitre = usable.reduce(
    (sum, row) => sum + row.priceCents / row.unitVolumeLitres,
    0,
  );
  const mean = totalCentsPerLitre / usable.length;
  const asOf = usable.reduce(
    (latest, row) =>
      Date.parse(row.observedAt) > Date.parse(latest) ? row.observedAt : latest,
    usable[0]!.observedAt,
  );
  return {
    averageCentsPerLitre: Math.round(mean * 100) / 100,
    offerCount: usable.length,
    productCount: new Set(usable.map((row) => row.productId)).size,
    asOf: asOf.slice(0, 10),
    reliabilityStatus: weakestReliability(
      usable.map((row) => row.reliabilityStatus),
    ),
  };
}

/**
 * Per-category benchmark rows over the collapsed offer set. Categories
 * keep the canonical set's order (deterministic bytes); a category the
 * caller narrowed to may be passed alone. Segments without covering
 * offers are `null` — honest absence (spec price-benchmarks).
 */
export function aggregateCategoryBenchmarks(
  rows: readonly CategoryBenchmarkOfferRow[],
  categories: readonly string[] = PRODUCT_CATEGORIES,
): CategoryBenchmarkRow[] {
  const bySegment = new Map<
    string,
    { alko: CategoryBenchmarkOfferRow[]; crossBorder: CategoryBenchmarkOfferRow[] }
  >();
  for (const row of rows) {
    const segment = benchmarkSegmentOf(row);
    if (segment === null) continue;
    const entry = bySegment.get(row.category) ?? { alko: [], crossBorder: [] };
    entry[segment].push(row);
    bySegment.set(row.category, entry);
  }
  return categories.map((category) => {
    const entry = bySegment.get(category);
    return {
      category,
      alko: entry ? aggregateBenchmarkSegment(entry.alko) : null,
      crossBorder: entry ? aggregateBenchmarkSegment(entry.crossBorder) : null,
    };
  });
}
