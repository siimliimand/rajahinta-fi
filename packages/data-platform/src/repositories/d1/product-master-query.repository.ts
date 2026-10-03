/**
 * D1 ProductMasterQueryRepository — the D1 adapter for the matcher's
 * {@link IProductMasterQuery} port (task 1.3, change
 * alko-reference-matching-pipeline, design D3), plus the pure assembly
 * functions that turn `product_master` rows into the two domain shapes
 * the matching pass consumes: {@link ProductMasterRecord} (what the
 * port returns) and {@link NormalizedProduct} (the seed the pass feeds
 * to `ProductMatcherService.findMatch`). The assembly lives here rather
 * than in the worker adapter layer because the matching pass script
 * imports data-platform repositories directly (the
 * `reclassify-category.mts` precedent) and the row→domain mapping must
 * sit beside the SQL whose bands it mirrors — one module, zero drift.
 *
 * ## Blocked candidate retrieval — the exact bucket math (design D3)
 *
 * `findCandidates` narrows the two disjoint product universes (≈4.4k
 * foreign + ≈4.2k Alko rows) to a scoring-sized candidate set with
 * three axes; `scoreProduct` then ranks inside the result:
 *
 * 1. **Category equality** — `category = ?` on the STORED tax-rule key,
 *    riding `product_master_category_idx` (migration 0023; asserted by
 *    EXPLAIN QUERY PLAN in the suite). The port speaks
 *    `CanonicalCategory`, the column is CHECK-constrained to the six
 *    tax keys, so {@link canonicalCategoryToStored} maps through the
 *    representative table pinned to
 *    `source-category.mapper`'s `CANONICAL_TO_TAX_CATEGORY`. The round
 *    trip stored → canonical ({@link storedCategoryToCanonical}, used
 *    by the assembly) → stored (this query) is the identity on all six
 *    stored keys, so a seed assembled from a `product_master` row
 *    always blocks on its own stored key.
 *
 * 2. **ABV band** — both sides bucket to the nearest 0.5 percentage
 *    points, ±1 bucket: `bucket(p) = round(p / 0.5)`. The seed side
 *    buckets in JS ({@link abvBucketFromPercent}); the candidate side
 *    buckets in SQL. The column stores the ABV FRACTION — every
 *    ingestion adapter divides the source percent by 100, and the
 *    excise engine consumes the fraction — so the SQL predicate is
 *    `ROUND((alcohol_by_volume * 100.0) / 0.5)`. A 4.7 % seed (bucket
 *    9) keeps buckets 8–10: 4.0–5.0 % plus the rounding edges, so
 *    German-label drift ("4,8 %", "5 %") stays in window. For
 *    non-negative values SQLite's ROUND (half away from zero) and JS
 *    `Math.round` (half toward +∞) agree, so both sides of the band
 *    round identically; the stored fractions' binary noise
 *    (0.45 × 20 = 9.000…002) is absorbed by the ROUND.
 *
 * 3. **Unit-volume band** — both sides bucket to the nearest 0.05 l,
 *    ±1 bucket: `bucket(v) = round(v / 0.05)`. The column already
 *    stores litres, so the SQL predicate is
 *    `ROUND(unit_volume / 0.05)` against the JS
 *    {@link volumeBucketFromLitres}. A 0.5 l seed (bucket 10) keeps
 *    0.45–0.55 l plus rounding edges; scrape noise like `"0. 7 l"`
 *    parses to a true litre value and lands in the right bucket.
 *
 * **Widening, never crashing (design D3).** A seed value is USABLE
 * when it is finite and > 0. The port passes numbers, and the
 * normalizer clamps missing/invalid ABV to 0, so an unusable seed
 * value arrives as 0 (or non-finite from a pathological row). An
 * unusable seed value DROPS its band predicate entirely: a null/0
 * -volume or null/0-ABV seed matches every bucket — and every
 * null-valued candidate with it. The reverse is deliberately
 * stricter: when the seed value IS usable, a candidate without a
 * usable value fails the band comparison (`ROUND(NULL)` is NULL; a
 * stored `unit_volume = 0` buckets to 0, outside every real band) and
 * is excluded — there the numeric axis is real signal. Such rows still
 * surface through the seed-unusable direction, where they are scored
 * on name/brand/category alone and the numeric mismatch is visible to
 * the reviewer (design D3's honesty surface: degraded to larger
 * candidate sets, never a crash, never a silent drop of the seed).
 *
 * **Brand is not a blocking axis.** The port doc's "same brand"
 * suggestion is superseded by design D3 for this adapter: foreign
 * scrape brands are name-derived noise (no live feed carries one), so
 * brand is a scoring axis (`scoreBrandSimilarity`, 20 %), not a SQL
 * equality — a brand predicate would manufacture missed pairs.
 *
 * The result is capped at {@link FIND_CANDIDATES_LIMIT} rows, `id ASC`
 * — deterministic under truncation. Usable-numeric seeds see tens of
 * candidates (design D3's math); the fully-widened degenerate seed can
 * exceed the cap and truncates at the lowest ids, which the matching
 * pass's `--stats` surfaces as yield.
 *
 * ## ABV representation (assembly)
 *
 * The stored column is a fraction; the port and `NormalizedProduct`
 * contracts speak percent 0–100 (`validateAbv`'s scale,
 * `scoreAbvMatch`'s percentage-point tolerances), so the assembly
 * multiplies by 100. Tolerant parsing: null/non-finite/≤ 0 → 0 (the
 * normalizer's own clamp semantics); a stored value > 1 cannot be a
 * fraction (> 100 % ABV is impossible), so it is treated as an
 * already-percentage-scale straggler and used as-is rather than
 * multiplied past physical possibility; the result clamps at 100.
 * Zero volumes stay zero — they are the documented unusable-for-
 * matching signal, not an error.
 *
 * `findByEan` scans: `product_master.ean` carries no index (the
 * upsert path queries it the same way) — bounded by the ~10⁴-row
 * catalog and called once per seed product.
 *
 * @module D1ProductMasterQueryRepository
 */
import { Injectable } from '@nestjs/common';
import type {
  CanonicalCategory,
  CanonicalContainerType,
  IProductMasterQuery,
  NormalizedProduct,
  ProductMasterRecord,
  RawProductInput,
} from '@rajahinta/core-domain';
import type { D1DatabaseLike } from '../../d1/executor';

// ---------------------------------------------------------------------------
// Bucket constants and helpers
// ---------------------------------------------------------------------------

/** ABV bucket width in percentage points (design D3). */
export const ABV_BUCKET_PERCENT = 0.5;

/** Unit-volume bucket width in litres (design D3). */
export const VOLUME_BUCKET_LITRES = 0.05;

/** Band half-width in buckets on each side of the seed's bucket. */
export const CANDIDATE_TOLERANCE_BUCKETS = 1;

/**
 * Defensive cap on candidate rows (see the module header). Far above
 * the tens of candidates usable numerics produce; bounds the in-memory
 * scoring when a degenerate seed widens to a whole category.
 */
export const FIND_CANDIDATES_LIMIT = 200;

/** Seed-side ABV bucket: nearest 0.5-percentage-point bucket index. */
export function abvBucketFromPercent(percent: number): number {
  return Math.round(percent / ABV_BUCKET_PERCENT);
}

/** Seed-side volume bucket: nearest 0.05-litre bucket index. */
export function volumeBucketFromLitres(litres: number): number {
  return Math.round(litres / VOLUME_BUCKET_LITRES);
}

/**
 * A seed numeric is usable for band blocking only when finite and > 0 —
 * the normalizer clamps missing/invalid values to 0, so 0 IS the
 * "unknown" signal at this boundary (design D3: widen, never crash).
 */
function isUsableSeedValue(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

// ---------------------------------------------------------------------------
// Category vocabulary — stored tax keys ↔ canonical categories
// ---------------------------------------------------------------------------

/**
 * Stored tax-rule key → its representative canonical category.
 *
 * The column is CHECK-constrained to the six tax keys; each maps to
 * the canonical category that dominates its residents, and the mapping
 * is chosen so stored → canonical → stored is the IDENTITY on all six
 * keys (the blocking round trip never moves a row to another key).
 */
export const STORED_CATEGORY_TO_CANONICAL: Readonly<
  Record<string, CanonicalCategory>
> = {
  beer: 'beer',
  wine_still: 'wine',
  wine_sparkling: 'sparkling-wine',
  intermediate_products: 'fortified-wine',
  other_fermented: 'cider',
  spirits: 'spirits',
};

/**
 * Canonical category → the stored tax-rule key its rows live under.
 * Pinned to `source-category.mapper`'s `CANONICAL_TO_TAX_CATEGORY`
 * (granular keys collapse exactly as ingestion collapses them:
 * liqueur → spirits; long-drink/sake/non-alcoholic/other →
 * other_fermented). The 22 % intermediate-products boundary that
 * re-keys fermented rows into `spirits` at ingestion is NOT re-applied
 * here: this change's only consumer (the matching pass) seeds from
 * stored rows, whose round trip is the identity above; a future
 * live-ingestion consumer feeding a raw `NormalizedProduct` above the
 * boundary must apply the ingestion guard itself — documented, not
 * silently guessed.
 */
export const CANONICAL_CATEGORY_TO_STORED: Readonly<
  Record<CanonicalCategory, string>
> = {
  beer: 'beer',
  wine: 'wine_still',
  'sparkling-wine': 'wine_sparkling',
  'fortified-wine': 'intermediate_products',
  cider: 'other_fermented',
  spirits: 'spirits',
  liqueur: 'spirits',
  'long-drink': 'other_fermented',
  sake: 'other_fermented',
  'non-alcoholic': 'other_fermented',
  other: 'other_fermented',
};

/** Narrow a stored category key; null when it is not a known key. */
export function storedCategoryToCanonical(key: string): CanonicalCategory | null {
  return Object.prototype.hasOwnProperty.call(
    STORED_CATEGORY_TO_CANONICAL,
    key,
  )
    ? STORED_CATEGORY_TO_CANONICAL[key]
    : null;
}

/** Map a canonical category onto the stored key its rows live under. */
export function canonicalCategoryToStored(category: CanonicalCategory): string {
  return CANONICAL_CATEGORY_TO_STORED[category];
}

// ---------------------------------------------------------------------------
// Container vocabulary — stored CHECK values → canonical container types
// ---------------------------------------------------------------------------

/**
 * Stored `container_type` CHECK values → canonical container types.
 * The stored vocabulary is the container-duty engine's spellings
 * (migration 0002's authoritative set); glass/bottle and can/metal
 * collapse onto their canonical counterparts. Unknown values degrade
 * to 'other' with a warning — never a throw.
 */
const STORED_CONTAINER_TO_CANONICAL: Readonly<
  Record<string, CanonicalContainerType>
> = {
  glass: 'glass-bottle',
  bottle: 'glass-bottle',
  plastic: 'plastic-bottle',
  can: 'metal-can',
  metal: 'metal-can',
  carton: 'carton',
  other: 'other',
};

// ---------------------------------------------------------------------------
// Tolerant numeric parsing
// ---------------------------------------------------------------------------

/**
 * Stored ABV fraction → port/percent scale (see the module header).
 */
export function abvPercentFromStored(value: number | null): number {
  if (value === null || !Number.isFinite(value) || value <= 0) return 0;
  // > 1 cannot be a fraction — percentage-scale straggler, use as-is.
  const percent = value > 1 ? value : value * 100;
  return Math.min(100, percent);
}

/**
 * Stored unit volume in litres, tolerant of the null/zero rows the
 * foreign feeds produce. Zero stays zero: the documented unusable-for-
 * matching signal, never an error.
 */
export function volumeLitresFromStored(value: number | null): number {
  if (value === null || !Number.isFinite(value) || value <= 0) return 0;
  return value;
}

// ---------------------------------------------------------------------------
// Row shape and the two domain mappings
// ---------------------------------------------------------------------------

/** Raw D1 product_master row as this module selects it (snake_case). */
export interface D1ProductMasterQueryRow {
  readonly id: number;
  readonly ean: string | null;
  readonly name: string;
  readonly brand: string;
  readonly category: string;
  readonly alcohol_by_volume: number | null;
  readonly container_type: string | null;
  /** NOT NULL in the schema; the tolerant callers may still see null. */
  readonly unit_volume: number | null;
}

/** The port-facing fields both mappings share, plus assembly warnings. */
interface ProductMasterPortFields {
  readonly normalizedName: string;
  readonly normalizedBrand: string;
  readonly canonicalCategory: CanonicalCategory;
  readonly volumeLitres: number;
  readonly alcoholByVolume: number;
  readonly ean: string | null;
  readonly warnings: readonly string[];
}

/** One row → the shared port fields; warnings only the assembly surfaces. */
function portFieldsFromRow(row: D1ProductMasterQueryRow): ProductMasterPortFields {
  const canonicalCategory = storedCategoryToCanonical(row.category);
  const volumeLitres = volumeLitresFromStored(row.unit_volume);
  const warnings: string[] = [];
  if (canonicalCategory === null) {
    warnings.push(
      `Stored category "${row.category}" is not a known product category; mapped to 'other'`,
    );
  }
  if (
    row.container_type !== null &&
    !Object.prototype.hasOwnProperty.call(STORED_CONTAINER_TO_CANONICAL, row.container_type)
  ) {
    warnings.push(
      `Unrecognised container type "${row.container_type}" mapped to 'other'`,
    );
  }
  if (row.unit_volume === null || !Number.isFinite(row.unit_volume)) {
    warnings.push('Unit volume is missing; clamped to 0');
  } else if (row.unit_volume <= 0) {
    warnings.push(`Unit volume is ${row.unit_volume}; unusable for matching`);
  }
  if (row.alcohol_by_volume === null || !Number.isFinite(row.alcohol_by_volume)) {
    warnings.push('Alcohol by volume is missing; clamped to 0');
  } else if (row.alcohol_by_volume > 1) {
    warnings.push(
      `Alcohol by volume ${row.alcohol_by_volume} is already percentage-scale; used as-is`,
    );
  }
  return {
    normalizedName: row.name,
    normalizedBrand: row.brand,
    canonicalCategory: canonicalCategory ?? 'other',
    volumeLitres,
    alcoholByVolume: abvPercentFromStored(row.alcohol_by_volume),
    ean: row.ean,
    warnings,
  };
}

/**
 * A `product_master` row → the port's {@link ProductMasterRecord}
 * (percent-scale ABV, canonical category, litres; zero values pass
 * through as the unusable-for-matching signal).
 */
export function productMasterRecordFromRow(
  row: D1ProductMasterQueryRow,
): ProductMasterRecord {
  const fields = portFieldsFromRow(row);
  return {
    id: row.id,
    ean: fields.ean,
    normalizedName: fields.normalizedName,
    normalizedBrand: fields.normalizedBrand,
    canonicalCategory: fields.canonicalCategory,
    volumeLitres: fields.volumeLitres,
    alcoholByVolume: fields.alcoholByVolume,
  };
}

/**
 * A `product_master` row → a {@link NormalizedProduct} seed for the
 * matcher (task 1.3). Never throws on missing/zero numerics: they
 * degrade to 0 with a `normalizationWarnings` entry, which is exactly
 * the widening signal design D3 prescribes. `images`/`description`
 * have no product_master columns and assemble empty; `originalInput`
 * is reconstructed from the row (the stored key rides `category` —
 * the original source string is not retained by the schema).
 */
export function normalizedProductFromMasterRow(
  row: D1ProductMasterQueryRow,
): NormalizedProduct {
  const fields = portFieldsFromRow(row);
  const containerType =
    row.container_type !== null &&
    Object.prototype.hasOwnProperty.call(STORED_CONTAINER_TO_CANONICAL, row.container_type)
      ? STORED_CONTAINER_TO_CANONICAL[row.container_type]
      : 'other';
  const originalInput: RawProductInput = {
    name: row.name,
    brand: row.brand,
    category: row.category,
    volume: fields.volumeLitres,
    volumeUnit: 'L',
    abv: fields.alcoholByVolume,
    packaging: row.container_type ?? undefined,
    ...(row.ean !== null ? { ean: row.ean } : {}),
  };
  return {
    normalizedName: fields.normalizedName,
    normalizedBrand: fields.normalizedBrand,
    canonicalCategory: fields.canonicalCategory,
    volumeLitres: fields.volumeLitres,
    alcoholByVolume: fields.alcoholByVolume,
    containerType,
    ean: fields.ean,
    images: [],
    description: '',
    originalInput,
    normalizationWarnings: fields.warnings,
  };
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

/** Column projection shared by this module's SELECTs (narrow by design). */
const PRODUCT_QUERY_COLUMNS = `
  SELECT id, ean, name, brand, category, alcohol_by_volume, container_type,
         unit_volume
    FROM product_master`;

/** Exact-barcode read — scans (no ean index), catalog-bounded. */
export const FIND_BY_EAN_SQL = `
  ${PRODUCT_QUERY_COLUMNS}
   WHERE ean = ?
   ORDER BY id ASC
   LIMIT 1`;

/** Candidate-side ABV band: stored fraction → percent → 0.5pp buckets. */
const ABV_BAND_PREDICATE = `ROUND((alcohol_by_volume * 100.0) / ${ABV_BUCKET_PERCENT}) BETWEEN ? AND ?`;

/** Candidate-side volume band: stored litres → 0.05l buckets. */
const VOLUME_BAND_PREDICATE = `ROUND(unit_volume / ${VOLUME_BUCKET_LITRES}) BETWEEN ? AND ?`;

/**
 * Assemble the blocked candidate query (see the module header for the
 * bucket math). An unusable seed numeric drops its band predicate
 * entirely — the widening is structural, in the SQL, not a post-filter.
 * Exported so the suite runs EXPLAIN QUERY PLAN on the exact statement
 * the repository executes.
 */
export function findCandidatesSql(options: {
  abvBlocked: boolean;
  volumeBlocked: boolean;
}): string {
  const predicates: string[] = ['category = ?'];
  if (options.abvBlocked) predicates.push(ABV_BAND_PREDICATE);
  if (options.volumeBlocked) predicates.push(VOLUME_BAND_PREDICATE);
  return `
  ${PRODUCT_QUERY_COLUMNS}
   WHERE ${predicates.join('\n   AND ')}
   ORDER BY id ASC
   LIMIT ${FIND_CANDIDATES_LIMIT}`;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

/**
 * The matcher's product-master read port over D1 (design D3). Bound
 * through `PRODUCT_MASTER_QUERY_PORT` by whichever composition root
 * runs the matcher; the matching pass script constructs it directly.
 */
@Injectable()
export class D1ProductMasterQueryRepository implements IProductMasterQuery {
  constructor(private readonly d1: D1DatabaseLike) {}

  /** @inheritdoc */
  async findByEan(ean: string): Promise<ProductMasterRecord | null> {
    const row = await this.d1
      .prepare(FIND_BY_EAN_SQL)
      .bind(ean)
      .first<D1ProductMasterQueryRow>();
    return row ? productMasterRecordFromRow(row) : null;
  }

  /**
   * @inheritdoc
   *
   * Blocked retrieval per design D3 (see the module header). The
   * port's `brand` parameter is deliberately not a blocking axis:
   * brand similarity is the scorer's job, foreign scrape brands are
   * name-derived noise, and a brand equality would manufacture the
   * missed pairs design D3 exists to prevent.
   */
  async findCandidates(params: {
    brand: string;
    category: CanonicalCategory;
    volumeLitres: number;
    abv: number;
  }): Promise<ProductMasterRecord[]> {
    const abvBlocked = isUsableSeedValue(params.abv);
    const volumeBlocked = isUsableSeedValue(params.volumeLitres);

    const args: Array<string | number> = [
      canonicalCategoryToStored(params.category),
    ];
    if (abvBlocked) {
      const bucket = abvBucketFromPercent(params.abv);
      args.push(
        bucket - CANDIDATE_TOLERANCE_BUCKETS,
        bucket + CANDIDATE_TOLERANCE_BUCKETS,
      );
    }
    if (volumeBlocked) {
      const bucket = volumeBucketFromLitres(params.volumeLitres);
      args.push(
        bucket - CANDIDATE_TOLERANCE_BUCKETS,
        bucket + CANDIDATE_TOLERANCE_BUCKETS,
      );
    }
    // The LIMIT is inlined by findCandidatesSql, not bound.
    const rows = (
      await this.d1
        .prepare(findCandidatesSql({ abvBlocked, volumeBlocked }))
        .bind(...args)
        .all<D1ProductMasterQueryRow>()
    ).results;
    return rows.map(productMasterRecordFromRow);
  }
}
