/**
 * Tests for ProductMatcherService pure helpers and the service itself.
 *
 * The fuzzy-matching helpers are HIGH-LIABILITY code — scoring determines
 * whether two products from different merchants are treated as the same
 * physical product, which directly affects price comparisons.
 *
 * @module ProductMatcherServiceTests
 */
import { describe, it, expect, vi } from 'vitest';
import {
  tokenize,
  jaccardSimilarity,
  levenshteinDistance,
  scoreNameSimilarity,
  scoreBrandSimilarity,
  scoreVolumeMatch,
  scoreAbvMatch,
  scoreCategoryMatch,
  scoreProduct,
  scoreToConfidence,
  ProductMatcherService,
} from '../product-matcher.service';
import type { NormalizedProduct } from '../normalization.types';
import type { ProductMasterRecord } from '../ports/product-master-query.port';
import type { IProductMasterQuery } from '../ports/product-master-query.port';
import { ManualReviewService } from '../manual-review.service';
import type { IManualReviewRepository } from '../ports/manual-review-repository.port';
import type { PendingReview } from '../manual-review.types';

// ---------------------------------------------------------------------------
// tokenize
// ---------------------------------------------------------------------------

describe('tokenize', () => {
  it('splits on whitespace and lowercases, keeping numeric tokens', () => {
    expect(tokenize('Session IPA 4.5%')).toEqual(['session', 'ipa', '45']);
  });

  it('discards tokens shorter than 2 characters', () => {
    expect(tokenize('a b c beer')).toEqual(['beer']);
  });

  it('strips punctuation', () => {
    expect(tokenize("O'Doherty's Irish Whiskey")).toEqual([
      'odohertys',
      'irish',
      'whiskey',
    ]);
  });

  it('handles Scandinavian characters', () => {
    expect(tokenize('Köbenhavn Øl')).toEqual(['köbenhavn', 'øl']);
  });

  it('returns empty array for empty string', () => {
    expect(tokenize('')).toEqual([]);
  });

  it('returns empty array for whitespace-only string', () => {
    expect(tokenize('   ')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// jaccardSimilarity
// ---------------------------------------------------------------------------

describe('jaccardSimilarity', () => {
  it('returns 1 for identical sets', () => {
    expect(jaccardSimilarity(['a', 'b'], ['a', 'b'])).toBe(1);
  });

  it('returns 0 for disjoint sets', () => {
    expect(jaccardSimilarity(['a', 'b'], ['c', 'd'])).toBe(0);
  });

  it('returns correct value for partial overlap', () => {
    // intersection = {b}, union = {a,b,c} → 1/3
    expect(jaccardSimilarity(['a', 'b'], ['b', 'c'])).toBeCloseTo(0.3333, 3);
  });

  it('returns 1 when both inputs are empty', () => {
    expect(jaccardSimilarity([], [])).toBe(1);
  });

  it('deduplicates within each input via Set', () => {
    // ['a', 'a', 'b'] → Set{a,b}, ['a', 'c'] → Set{a,c}
    // intersection = {a} (1), union = {a,b,c} (3) → 1/3 ≈ 0.333
    expect(jaccardSimilarity(['a', 'a', 'b'], ['a', 'c'])).toBeCloseTo(0.333, 3);
  });

  it('returns 0 when one input is empty and the other is not', () => {
    expect(jaccardSimilarity(['a'], [])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// levenshteinDistance
// ---------------------------------------------------------------------------

describe('levenshteinDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshteinDistance('hello', 'hello')).toBe(0);
  });

  it('returns length of first string when second is empty', () => {
    expect(levenshteinDistance('abc', '')).toBe(3);
  });

  it('returns length of second string when first is empty', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3);
  });

  it('detects single substitution', () => {
    expect(levenshteinDistance('cat', 'car')).toBe(1);
  });

  it('detects single insertion', () => {
    expect(levenshteinDistance('cat', 'cats')).toBe(1);
  });

  it('detects single deletion', () => {
    expect(levenshteinDistance('cats', 'cat')).toBe(1);
  });

  it('computes full edit distance', () => {
    // kitten → sitting: 3 (k→s, e→i, +g)
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
  });

  it('handles transposition as two edits', () => {
    // Levenshtein does not handle transposition as a single operation
    expect(levenshteinDistance('ab', 'ba')).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// scoreNameSimilarity
// ---------------------------------------------------------------------------

describe('scoreNameSimilarity', () => {
  it('scores identical names at 100', () => {
    expect(scoreNameSimilarity('Session IPA', 'Session IPA')).toBe(100);
  });

  it('scores empty strings at 100', () => {
    expect(scoreNameSimilarity('', '')).toBe(100);
  });

  it('scores similar names near 100', () => {
    // 'Session IPA' vs 'Session IPA 4.5%' — tokens differ by one extra
    const score = scoreNameSimilarity('Session IPA', 'Session IPA 4.5');
    expect(score).toBeGreaterThanOrEqual(60);
  });

  it('scores completely different names low', () => {
    const score = scoreNameSimilarity('Heineken', 'Château Margaux');
    expect(score).toBeLessThanOrEqual(30);
  });
});

// ---------------------------------------------------------------------------
// scoreBrandSimilarity
// ---------------------------------------------------------------------------

describe('scoreBrandSimilarity', () => {
  it('returns 100 for exact match', () => {
    expect(scoreBrandSimilarity('Brewdog', 'Brewdog')).toBe(100);
  });

  it('is case-insensitive', () => {
    expect(scoreBrandSimilarity('BREWDOG', 'brewdog')).toBe(100);
  });

  it('trims whitespace', () => {
    expect(scoreBrandSimilarity('  Brewdog  ', 'Brewdog')).toBe(100);
  });

  it('returns 80 for minor variation (Levenshtein ≤ 2)', () => {
    expect(scoreBrandSimilarity('Heineken', 'Heineken!')).toBe(80);
    expect(scoreBrandSimilarity('Coca Cola', 'Coca-Cola')).toBe(80);
    expect(scoreBrandSimilarity('Brewdog', 'BrewdogX')).toBe(80);
  });

  it('returns 0 for different brands', () => {
    expect(scoreBrandSimilarity('Brewdog', 'Heineken')).toBe(0);
  });

  it('returns 0 when brand differs by more than 2 edits', () => {
    expect(scoreBrandSimilarity('Brewdog', 'BrewdogXYZ')).toBe(0);
    expect(scoreBrandSimilarity('Heineken', 'Carlsberg')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// scoreVolumeMatch
// ---------------------------------------------------------------------------

describe('scoreVolumeMatch', () => {
  it('returns 100 for exact match', () => {
    expect(scoreVolumeMatch(0.33, 0.33)).toBe(100);
  });

  it('returns 100 within 0.5 % tolerance', () => {
    // 0.3315 / 0.33 = 1.0045 → 0.45 % diff
    expect(scoreVolumeMatch(0.3315, 0.33)).toBe(100);
  });

  it('returns 80 within 1 % tolerance', () => {
    // 0.3329 / 0.33 = 1.0088 → 0.88 % diff
    expect(scoreVolumeMatch(0.3329, 0.33)).toBe(80);
  });

  it('returns 0 beyond 1 % tolerance', () => {
    // 0.34 / 0.33 = 1.0303 → 3.03 % diff
    expect(scoreVolumeMatch(0.34, 0.33)).toBe(0);
  });

  it('handles both zero', () => {
    expect(scoreVolumeMatch(0, 0)).toBe(100);
  });

  it('handles candidate = 0 when actual is not zero', () => {
    expect(scoreVolumeMatch(0.5, 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// scoreAbvMatch
// ---------------------------------------------------------------------------

describe('scoreAbvMatch', () => {
  it('returns 100 for exact match', () => {
    expect(scoreAbvMatch(4.5, 4.5)).toBe(100);
  });

  it('returns 100 within 0.2 pp', () => {
    expect(scoreAbvMatch(4.6, 4.5)).toBe(100);
    expect(scoreAbvMatch(4.4, 4.5)).toBe(100);
  });

  it('returns 80 within 0.5 pp', () => {
    expect(scoreAbvMatch(5.0, 4.5)).toBe(80);
    expect(scoreAbvMatch(4.0, 4.5)).toBe(80);
  });

  it('returns 0 beyond 0.5 pp', () => {
    expect(scoreAbvMatch(6.0, 4.5)).toBe(0);
  });

  it('handles both zero', () => {
    expect(scoreAbvMatch(0, 0)).toBe(100);
  });

  it('handles one zero', () => {
    expect(scoreAbvMatch(0, 4.5)).toBe(0);
    expect(scoreAbvMatch(4.5, 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// scoreCategoryMatch
// ---------------------------------------------------------------------------

describe('scoreCategoryMatch', () => {
  it('returns 100 for same category', () => {
    expect(scoreCategoryMatch('beer', 'beer')).toBe(100);
  });

  it('returns 0 for different categories', () => {
    expect(scoreCategoryMatch('beer', 'wine')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// scoreToConfidence
// ---------------------------------------------------------------------------

describe('scoreToConfidence', () => {
  it('≥90 → EXACT', () => {
    expect(scoreToConfidence(90)).toBe('EXACT');
    expect(scoreToConfidence(100)).toBe('EXACT');
  });

  it('≥75 → HIGH', () => {
    expect(scoreToConfidence(75)).toBe('HIGH');
    expect(scoreToConfidence(89)).toBe('HIGH');
  });

  it('≥50 → MEDIUM', () => {
    expect(scoreToConfidence(50)).toBe('MEDIUM');
    expect(scoreToConfidence(74)).toBe('MEDIUM');
  });

  it('≥25 → LOW', () => {
    expect(scoreToConfidence(25)).toBe('LOW');
    expect(scoreToConfidence(49)).toBe('LOW');
  });

  it('<25 → NONE', () => {
    expect(scoreToConfidence(0)).toBe('NONE');
    expect(scoreToConfidence(24)).toBe('NONE');
  });
});

// ---------------------------------------------------------------------------
// scoreProduct — holistic score
// ---------------------------------------------------------------------------

describe('scoreProduct', () => {
  const normalized: NormalizedProduct = {
    normalizedName: 'Session IPA',
    normalizedBrand: 'Brewdog',
    canonicalCategory: 'beer',
    volumeLitres: 0.33,
    alcoholByVolume: 4.5,
    containerType: 'metal-can',
    ean: null,
    images: [],
    description: '',
    originalInput: {
      name: 'Session IPA',
      brand: 'Brewdog',
      category: 'beer',
      volume: 33,
      volumeUnit: 'cl',
      abv: 4.5,
      packaging: 'can',
    },
    normalizationWarnings: [],
  };

  it('scores an identical product at 100', () => {
    const candidate: ProductMasterRecord = {
      id: 1,
      ean: null,
      normalizedName: 'Session IPA',
      normalizedBrand: 'Brewdog',
      canonicalCategory: 'beer',
      volumeLitres: 0.33,
      alcoholByVolume: 4.5,
    };
    expect(scoreProduct(normalized, candidate)).toBe(100);
  });

  it('scores a close product ≥ 75 (HIGH)', () => {
    const candidate: ProductMasterRecord = {
      id: 2,
      ean: null,
      normalizedName: 'Session IPA 4.5',
      normalizedBrand: 'Brewdog',
      canonicalCategory: 'beer',
      volumeLitres: 0.33,
      alcoholByVolume: 4.5,
    };
    const score = scoreProduct(normalized, candidate);
    expect(score).toBeGreaterThanOrEqual(75);
  });

  it('scores a different product < 50', () => {
    const candidate: ProductMasterRecord = {
      id: 3,
      ean: null,
      normalizedName: 'Château Margaux',
      normalizedBrand: 'Château Margaux',
      canonicalCategory: 'wine',
      volumeLitres: 0.75,
      alcoholByVolume: 13.5,
    };
    const score = scoreProduct(normalized, candidate);
    expect(score).toBeLessThan(50);
  });
});

// ---------------------------------------------------------------------------
// ProductMatcherService — integration (with fake repository)
// ---------------------------------------------------------------------------

describe('ProductMatcherService', () => {
  /** Minimal fake implementing IProductMasterQuery. */
  function createFakeQuery(
    overrides?: Partial<IProductMasterQuery>,
  ): IProductMasterQuery {
    const defaultRecords: ProductMasterRecord[] = [
      {
        id: 10,
        ean: '6410660012348',
        normalizedName: 'Session IPA',
        normalizedBrand: 'Brewdog',
        canonicalCategory: 'beer',
        volumeLitres: 0.33,
        alcoholByVolume: 4.5,
      },
      {
        id: 20,
        ean: '6410660056789',
        normalizedName: 'Punk IPA',
        normalizedBrand: 'Brewdog',
        canonicalCategory: 'beer',
        volumeLitres: 0.33,
        alcoholByVolume: 5.6,
      },
    ];

    return {
      findByEan: vi.fn().mockImplementation(async (ean: string) => {
        if (ean === 'UNKNOWN_EAN') return null;
        return defaultRecords.find((r) => r.ean === ean) ?? null;
      }),
      findCandidates: vi.fn().mockImplementation(async () => defaultRecords),
      ...overrides,
    };
  }

  /** Fake IManualReviewRepository backed by an in-memory Map. */
  function createFakeReviewRepo(): IManualReviewRepository {
    const store = new Map<string, PendingReview>();
    return {
      create: vi.fn().mockImplementation(async (entry: PendingReview) => {
        store.set(entry.id, entry);
      }),
      findById: vi.fn().mockImplementation(async (id: string) => {
        return store.get(id) ?? null;
      }),
      findByStatus: vi.fn().mockImplementation(async () => {
        return Array.from(store.values());
      }),
      updateStatus: vi.fn().mockResolvedValue(undefined),
    };
  }

  function createService(
    queryOverrides?: Partial<IProductMasterQuery>,
  ): {
    service: ProductMatcherService;
    query: IProductMasterQuery;
    reviewRepo: IManualReviewRepository;
  } {
    const query = createFakeQuery(queryOverrides);
    const reviewRepo = createFakeReviewRepo();
    const reviewService = new ManualReviewService(reviewRepo);
    const service = new ProductMatcherService(query, reviewService);
    return { service, query, reviewRepo };
  }

  const baseProduct: NormalizedProduct = {
    normalizedName: 'Session IPA',
    normalizedBrand: 'Brewdog',
    canonicalCategory: 'beer',
    volumeLitres: 0.33,
    alcoholByVolume: 4.5,
    containerType: 'metal-can',
    ean: null,
    images: [],
    description: '',
    originalInput: {
      name: 'Session IPA',
      brand: 'Brewdog',
      category: 'beer',
      volume: 33,
      volumeUnit: 'cl',
      abv: 4.5,
      packaging: 'can',
    },
    normalizationWarnings: [],
  };

  it('returns EXACT match when EAN matches, no review needed', async () => {
    const { service, query } = createService();

    const result = await service.findMatch({
      ...baseProduct,
      ean: '6410660012348',
    });

    expect(result.matched).toBe(true);
    expect(result.productId).toBe(10);
    expect(result.confidence).toBe('EXACT');
    expect(result.matchMethod).toBe('ean');
    expect(result.requiresManualReview).toBe(false);
    expect(result.reviewId).toBeUndefined();
    expect(query.findByEan).toHaveBeenCalledWith('6410660012348');
    expect(query.findCandidates).not.toHaveBeenCalled();
  });

  it('falls back to fuzzy when EAN is null, EXACT confidence skips review', async () => {
    const { service, query } = createService();

    const result = await service.findMatch(baseProduct);

    expect(result.matched).toBe(true);
    expect(result.productId).toBe(10); // Session IPA scores highest
    expect(result.confidence).toBe('EXACT'); // identical → score 100
    expect(result.matchMethod).toBe('fuzzy');
    expect(result.requiresManualReview).toBe(false);
    expect(result.reviewId).toBeUndefined();
    expect(query.findByEan).not.toHaveBeenCalled();
    expect(query.findCandidates).toHaveBeenCalledTimes(1);
  });

  it('falls back to fuzzy when EAN does not match any record', async () => {
    const { service, query } = createService();

    const result = await service.findMatch({
      ...baseProduct,
      ean: 'UNKNOWN_EAN',
    });

    expect(result.matched).toBe(true);
    expect(result.matchMethod).toBe('fuzzy');
    expect(query.findByEan).toHaveBeenCalledWith('UNKNOWN_EAN');
    expect(query.findCandidates).toHaveBeenCalledTimes(1);
  });

  it('returns no match for completely different product', async () => {
    const { service } = createService();

    const result = await service.findMatch({
      ...baseProduct,
      normalizedName: 'Château Margaux',
      normalizedBrand: 'Château Margaux',
      canonicalCategory: 'wine',
      volumeLitres: 0.75,
      alcoholByVolume: 13.5,
    });

    expect(result.matched).toBe(false);
    expect(result.matchMethod).toBe('none');
    expect(result.confidence).toBe('NONE');
    expect(result.candidates.length).toBe(2);
  });

  it('enqueues for review when no match and confidence is NONE', async () => {
    const { service, reviewRepo } = createService();

    const result = await service.findMatch({
      ...baseProduct,
      normalizedName: 'Château Margaux',
      normalizedBrand: 'Château Margaux',
      canonicalCategory: 'wine',
      volumeLitres: 0.75,
      alcoholByVolume: 13.5,
    });

    expect(result.requiresManualReview).toBe(true);
    expect(result.reviewId).toBeDefined();
    // Verify the review entry was actually persisted
    const pending = await reviewRepo.findByStatus('pending');
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(result.reviewId);
  });

  it('enqueues for review when fuzzy match has MEDIUM confidence', async () => {
    // Create a single candidate that scores just above MEDIUM threshold
    const query = createFakeQuery({
      findCandidates: vi.fn().mockResolvedValue([
        {
          id: 99,
          ean: null,
          normalizedName: 'Generic Beer',
          normalizedBrand: 'Unknown',
          canonicalCategory: 'beer',
          volumeLitres: 0.33,
          alcoholByVolume: 4.5,
        },
      ]),
    });
    const reviewRepo = createFakeReviewRepo();
    const reviewService = new ManualReviewService(reviewRepo);
    const service = new ProductMatcherService(query, reviewService);

    const result = await service.findMatch({
      ...baseProduct,
      normalizedName: 'Generic Lager Beer',
      normalizedBrand: 'Unknown Brand',
    });

    // Name "Generic Lager Beer" vs "Generic Beer" — should be similar but not high
    expect(result.confidence).toBe('MEDIUM');
    expect(result.requiresManualReview).toBe(true);
    expect(result.reviewId).toBeDefined();
  });

  it('does not enqueue for review when fuzzy match has HIGH confidence', async () => {
    // The identical product should score EXACT (100), skipping review
    const { service, reviewRepo } = createService();

    const result = await service.findMatch(baseProduct);

    expect(result.confidence).toBe('EXACT');
    expect(result.requiresManualReview).toBe(false);
    expect(result.reviewId).toBeUndefined();

    // No pending entries should exist
    const pending = await reviewRepo.findByStatus('pending');
    expect(pending).toHaveLength(0);
  });

  it('returns all candidates sorted by score descending', async () => {
    const { service } = createService();

    const result = await service.findMatch(baseProduct);

    expect(result.candidates.length).toBe(2);
    expect(result.candidates[0].score).toBeGreaterThanOrEqual(
      result.candidates[1].score,
    );
  });

  it('passes correct params to findCandidates', async () => {
    const { service, query } = createService();

    await service.findMatch(baseProduct);

    expect(query.findCandidates).toHaveBeenCalledWith({
      brand: 'Brewdog',
      category: 'beer',
      volumeLitres: 0.33,
      abv: 4.5,
    });
  });

  it('handles empty candidate list gracefully', async () => {
    const { service } = createService({
      findCandidates: vi.fn().mockResolvedValue([]),
    });

    const result = await service.findMatch(baseProduct);

    expect(result.matched).toBe(false);
    expect(result.confidence).toBe('NONE');
    expect(result.matchMethod).toBe('none');
    expect(result.candidates).toEqual([]);
  });
});