/**
 * ProductMatcherService — resolves NormalizedProduct instances to existing
 * Product Master records, de-duplicating across foreign-retailer feeds.
 *
 * Matching strategy (in order of precedence):
 *  1. **Deterministic**: exact GTIN-13 / EAN barcode match when the input
 *     carries one.
 *  2. **Fuzzy**: weighted scoring of name similarity, brand, volume, ABV,
 *     and category when no barcode is available or no barcode match exists.
 *
 * After matching, results with MEDIUM or LOW confidence are automatically
 * enqueued for manual review via ManualReviewService. The match result
 * carries a `requiresManualReview` flag and a `reviewId` when enqueued.
 *
 * All fuzzy-matching helpers are exported as pure functions so they can be
 * unit-tested independently of the repository adapter.
 *
 * @module ProductMatcherService
 */

import { Inject, Injectable } from '@nestjs/common';
import type { NormalizedProduct } from './normalization.types';
import type { ProductMatchResult, MatchConfidence, ProductMatchCandidate } from './product-matcher.types';
import type { IProductMasterQuery, ProductMasterRecord } from './ports/product-master-query.port';
import { PRODUCT_MASTER_QUERY_PORT } from './ports/product-master-query.port';
import { ManualReviewService } from './manual-review.service';

/** Confidence levels that require manual review before the match is accepted. */
const REQUIRES_REVIEW: ReadonlySet<MatchConfidence> = new Set<MatchConfidence>(['MEDIUM', 'LOW', 'NONE']);

// ---------------------------------------------------------------------------
// Pure helpers — exported for unit testing
// ---------------------------------------------------------------------------

/**
 * Tokenize a string into lowercase words, dropping punctuation.
 * Runs of whitespace are collapsed; tokens shorter than 2 characters are
 * discarded to eliminate noise.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9åäöæøüéèêëàâîïôùûç \n]/g, '')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

/**
 * Jaccard similarity coefficient between two token sets.
 * Returns 1 for identical sets, 0 for disjoint sets.
 */
export function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 1 : intersection / union;
}

/**
 * Levenshtein (edit) distance between two strings.
 * Case-sensitive — callers should normalise case beforehand.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Use two-row optimisation for O(n) memory
  let prev: number[] = [];
  let curr: number[] = [];

  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,          // deletion
        curr[j - 1] + 1,      // insertion
        prev[j - 1] + cost,   // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[b.length];
}

/**
 * Compute a normalised name-similarity score (0–100) between two product
 * names using a blend of Jaccard token similarity and Levenshtein distance.
 *
 * - Jaccard on token sets (weight 60 %)
 * - Levenshtein on full lowercased strings normalised to [0,1] (weight 40 %)
 */
export function scoreNameSimilarity(nameA: string, nameB: string): number {
  const tokensA = tokenize(nameA);
  const tokensB = tokenize(nameB);

  const jaccard = jaccardSimilarity(tokensA, tokensB);

  const a = nameA.toLowerCase().trim();
  const b = nameB.toLowerCase().trim();
  const maxLen = Math.max(a.length, b.length, 1);
  const levNormalised = 1 - levenshteinDistance(a, b) / maxLen;

  return Math.round(jaccard * 60 + levNormalised * 40);
}

/**
 * Compute a brand-match score (0–100).
 * Returns 100 for exact match, 80 for close match (Levenshtein ≤ 2),
 * 0 otherwise. Comparison is case-insensitive.
 */
export function scoreBrandSimilarity(brandA: string, brandB: string): number {
  const a = brandA.toLowerCase().trim();
  const b = brandB.toLowerCase().trim();
  if (a === b) return 100;
  if (levenshteinDistance(a, b) <= 2) return 80;
  return 0;
}

/**
 * Compute a volume-tolerance score (0–100).
 * Returns 100 when within 0.5 %, 80 when within 1.0 %, 0 otherwise.
 */
export function scoreVolumeMatch(actual: number, candidate: number): number {
  if (candidate === 0 && actual === 0) return 100;
  if (candidate === 0) return 0;
  const diff = Math.abs(actual - candidate) / candidate;
  if (diff <= 0.005) return 100;
  if (diff <= 0.01) return 80;
  return 0;
}

/**
 * Compute an ABV-tolerance score (0–100).
 * Returns 100 when within 0.2 pp, 80 when within 0.5 pp, 0 otherwise.
 * When both values are 0 or very close to 0, treat as exact.
 */
export function scoreAbvMatch(actual: number, candidate: number): number {
  if (actual === 0 && candidate === 0) return 100;
  const diff = Math.abs(actual - candidate);
  if (diff <= 0.2) return 100;
  if (diff <= 0.5) return 80;
  return 0;
}

/**
 * Compute a category-match score (0–100).
 * Returns 100 for identical category, 0 otherwise.
 */
export function scoreCategoryMatch(
  actual: string,
  candidate: string,
): number {
  return actual === candidate ? 100 : 0;
}

/**
 * Overall fuzzy-match score (0–100) between a normalised product and a
 * candidate Product Master record.
 *
 * Weights:  name 50 %, brand 20 %, volume 15 %, ABV 10 %, category 5 %.
 */
export function scoreProduct(
  normalized: NormalizedProduct,
  candidate: ProductMasterRecord,
): number {
  const name = scoreNameSimilarity(
    normalized.normalizedName,
    candidate.normalizedName,
  );
  const brand = scoreBrandSimilarity(
    normalized.normalizedBrand,
    candidate.normalizedBrand,
  );
  const volume = scoreVolumeMatch(
    normalized.volumeLitres,
    candidate.volumeLitres,
  );
  const abv = scoreAbvMatch(
    normalized.alcoholByVolume,
    candidate.alcoholByVolume,
  );
  const category = scoreCategoryMatch(
    normalized.canonicalCategory,
    candidate.canonicalCategory,
  );

  return Math.round(
    name * 0.5 + brand * 0.2 + volume * 0.15 + abv * 0.1 + category * 0.05,
  );
}

/** Map a numeric score (0–100) to a MatchConfidence label. */
export function scoreToConfidence(score: number): MatchConfidence {
  if (score >= 90) return 'EXACT';
  if (score >= 75) return 'HIGH';
  if (score >= 50) return 'MEDIUM';
  if (score >= 25) return 'LOW';
  return 'NONE';
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Determines whether a normalised product matches an existing Product Master
 * record, either by exact EAN barcode or via fuzzy attribute scoring.
 */
@Injectable()
export class ProductMatcherService {
  constructor(
    @Inject(PRODUCT_MASTER_QUERY_PORT)
    private readonly productQuery: IProductMasterQuery,
    private readonly manualReview: ManualReviewService,
  ) {}

  /**
   * Attempt to find a matching Product Master for the given normalised product.
   *
   * 1. **EAN match** — if the normalised product carries a non-null EAN, query
   *    the repository. On exact hit, return immediately with EXACT confidence.
   * 2. **Fuzzy match** — query candidate products by broad criteria, score
   *    each one, and return the best match when confidence ≥ HIGH.
   * 3. **No match** — return with confidence NONE and matchMethod 'none'.
   *
   * When the resulting confidence is MEDIUM or lower, the result is
   * automatically enqueued for manual review. The returned result carries
   * `requiresManualReview: true` and a `reviewId` referencing the queue entry.
   */
  async findMatch(normalized: NormalizedProduct): Promise<ProductMatchResult> {
    const candidates: ProductMatchCandidate[] = [];

    // --- 1. Deterministic EAN match ---
    if (normalized.ean) {
      const record = await this.productQuery.findByEan(normalized.ean);
      if (record) {
        return {
          matched: true,
          productId: record.id,
          confidence: 'EXACT',
          matchMethod: 'ean',
          candidates: [{ productId: record.id, score: 100 }],
          requiresManualReview: false,
        };
      }
    }

    // --- 2. Fuzzy match ---
    const fuzzyCandidates = await this.productQuery.findCandidates({
      brand: normalized.normalizedBrand,
      category: normalized.canonicalCategory,
      volumeLitres: normalized.volumeLitres,
      abv: normalized.alcoholByVolume,
    });

    for (const candidate of fuzzyCandidates) {
      const score = scoreProduct(normalized, candidate);
      candidates.push({ productId: candidate.id, score });
    }

    // Sort descending by score
    candidates.sort((a, b) => b.score - a.score);

    if (candidates.length > 0 && candidates[0].score >= 75) {
      const best = candidates[0];
      const confidence = scoreToConfidence(best.score);
      const baseResult = {
        matched: true as const,
        productId: best.productId,
        confidence,
        matchMethod: 'fuzzy' as const,
        candidates,
      };

      // Build final result — auto-enqueue if confidence is MEDIUM or lower
      if (REQUIRES_REVIEW.has(confidence)) {
        const result: ProductMatchResult = {
          ...baseResult,
          requiresManualReview: true,
        };
        const review = await this.manualReview.enqueueForReview(normalized, result);
        return { ...result, reviewId: review.id };
      }

      return { ...baseResult, requiresManualReview: false };
    }

    // --- 3. No match (or low-confidence fuzzy) ---
    const confidence = candidates.length > 0 ? scoreToConfidence(candidates[0].score) : 'NONE';
    const baseResult = {
      matched: false as const,
      confidence,
      matchMethod: 'none' as const,
      candidates,
    };

    // Auto-enqueue for review (MEDIUM, LOW, or NONE)
    if (REQUIRES_REVIEW.has(confidence)) {
      const result: ProductMatchResult = {
        ...baseResult,
        requiresManualReview: true,
      };
      const review = await this.manualReview.enqueueForReview(normalized, result);
      return { ...result, reviewId: review.id };
    }

    return { ...baseResult, requiresManualReview: false };
  }
}