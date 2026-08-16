/**
 * Tests for ManualReviewService.
 *
 * The service is high-liability code — incorrect enqueue/review logic can
 * block product pipeline flows or let low-confidence matches slip through
 * without human oversight.
 *
 * @module ManualReviewServiceTests
 */
import { describe, it, expect, vi } from 'vitest';
import { ManualReviewService } from '../manual-review.service';
import type { IManualReviewRepository } from '../ports/manual-review-repository.port';
import type { PendingReview } from '../manual-review.types';
import type { NormalizedProduct } from '../normalization.types';
import type { ProductMatchResult } from '../product-matcher.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createFakeRepository(
  overrides?: Partial<IManualReviewRepository>,
): IManualReviewRepository {
  const store = new Map<string, PendingReview>();

  return {
    create: vi.fn().mockImplementation(async (entry: PendingReview) => {
      store.set(entry.id, entry);
    }),
    findById: vi.fn().mockImplementation(async (id: string) => {
      return store.get(id) ?? null;
    }),
    findByStatus: vi.fn().mockImplementation(async (status) => {
      return Array.from(store.values())
        .filter((e) => e.status === status)
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
    }),
    updateStatus: vi.fn().mockImplementation(async (id, status, resolution, resolvedAt) => {
      const existing = store.get(id);
      if (existing) {
        store.set(id, { ...existing, status, resolution, resolvedAt });
      }
    }),
    ...overrides,
  };
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

function makeMatchResult(
  overrides?: Partial<ProductMatchResult>,
): ProductMatchResult {
  return {
    matched: true,
    productId: 10,
    confidence: 'MEDIUM',
    matchMethod: 'fuzzy',
    candidates: [{ productId: 10, score: 60 }],
    requiresManualReview: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// enqueueForReview
// ---------------------------------------------------------------------------

describe('ManualReviewService.enqueueForReview', () => {
  it('creates a pending review entry with a UUID id', async () => {
    const repo = createFakeRepository();
    const service = new ManualReviewService(repo);
    const matchResult = makeMatchResult();

    const entry = await service.enqueueForReview(baseProduct, matchResult);

    expect(entry.id).toBeDefined();
    expect(entry.id.length).toBeGreaterThan(0);
    expect(entry.status).toBe('pending');
    expect(repo.create).toHaveBeenCalledWith(entry);
  });

  it('preserves rawProduct from NormalizedProduct.originalInput', async () => {
    const repo = createFakeRepository();
    const service = new ManualReviewService(repo);

    const entry = await service.enqueueForReview(baseProduct, makeMatchResult());

    expect(entry.rawProduct).toEqual(baseProduct.originalInput);
  });

  it('captures match candidates and engine confidence', async () => {
    const repo = createFakeRepository();
    const service = new ManualReviewService(repo);
    const matchResult = makeMatchResult({
      candidates: [
        { productId: 10, score: 60 },
        { productId: 20, score: 45 },
      ],
      confidence: 'MEDIUM',
    });

    const entry = await service.enqueueForReview(baseProduct, matchResult);

    expect(entry.matchCandidates).toHaveLength(2);
    expect(entry.engineConfidence).toBe('MEDIUM');
  });

  it('sets createdAt as ISO 8601 string', async () => {
    const repo = createFakeRepository();
    const service = new ManualReviewService(repo);

    const entry = await service.enqueueForReview(baseProduct, makeMatchResult());

    expect(entry.createdAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );
  });

  it('is idempotent-safe: each call creates a separate entry', async () => {
    const repo = createFakeRepository();
    const service = new ManualReviewService(repo);

    const a = await service.enqueueForReview(baseProduct, makeMatchResult());
    const b = await service.enqueueForReview(baseProduct, makeMatchResult());

    expect(a.id).not.toBe(b.id);
  });
});

// ---------------------------------------------------------------------------
// resolveReview
// ---------------------------------------------------------------------------

describe('ManualReviewService.resolveReview', () => {
  it('marks a pending entry as resolved with accept', async () => {
    const repo = createFakeRepository();
    const service = new ManualReviewService(repo);
    const entry = await service.enqueueForReview(baseProduct, makeMatchResult());

    await service.resolveReview(entry.id, 'accept');

    const updated = await repo.findById(entry.id);
    expect(updated?.status).toBe('resolved');
    expect(updated?.resolution).toBe('accept');
    expect(updated?.resolvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('marks a pending entry as resolved with reject', async () => {
    const repo = createFakeRepository();
    const service = new ManualReviewService(repo);
    const entry = await service.enqueueForReview(baseProduct, makeMatchResult());

    await service.resolveReview(entry.id, 'reject');

    const updated = await repo.findById(entry.id);
    expect(updated?.status).toBe('resolved');
    expect(updated?.resolution).toBe('reject');
  });

  it('marks a pending entry as resolved with new_product', async () => {
    const repo = createFakeRepository();
    const service = new ManualReviewService(repo);
    const entry = await service.enqueueForReview(baseProduct, makeMatchResult());

    await service.resolveReview(entry.id, 'new_product');

    const updated = await repo.findById(entry.id);
    expect(updated?.status).toBe('resolved');
    expect(updated?.resolution).toBe('new_product');
  });

  it('throws when the entry does not exist', async () => {
    const repo = createFakeRepository();
    const service = new ManualReviewService(repo);

    await expect(
      service.resolveReview('non-existent-id', 'accept'),
    ).rejects.toThrow('entry not found');
  });

  it('throws when the entry is already resolved', async () => {
    const repo = createFakeRepository();
    const service = new ManualReviewService(repo);
    const entry = await service.enqueueForReview(baseProduct, makeMatchResult());
    await service.resolveReview(entry.id, 'accept');

    await expect(
      service.resolveReview(entry.id, 'reject'),
    ).rejects.toThrow('already resolved');
  });
});

// ---------------------------------------------------------------------------
// listPending
// ---------------------------------------------------------------------------

describe('ManualReviewService.listPending', () => {
  it('returns empty array when no pending entries exist', async () => {
    const repo = createFakeRepository();
    const service = new ManualReviewService(repo);

    const pending = await service.listPending();

    expect(pending).toEqual([]);
  });

  it('returns only pending (not resolved) entries', async () => {
    const repo = createFakeRepository();
    const service = new ManualReviewService(repo);

    const entryA = await service.enqueueForReview(baseProduct, makeMatchResult());
    const entryB = await service.enqueueForReview(baseProduct, makeMatchResult());
    await service.resolveReview(entryA.id, 'accept');

    const pending = await service.listPending();

    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(entryB.id);
  });

  it('returns pending entries sorted newest first', async () => {
    vi.useFakeTimers();
    const repo = createFakeRepository();
    const service = new ManualReviewService(repo);

    const first = await service.enqueueForReview(
      baseProduct,
      makeMatchResult(),
    );
    // Advance time by 1 ms so the second entry has a newer createdAt
    vi.advanceTimersByTime(1);
    const second = await service.enqueueForReview(
      baseProduct,
      makeMatchResult(),
    );

    const pending = await service.listPending();

    expect(pending).toHaveLength(2);
    expect(pending[0].id).toBe(second.id);
    expect(pending[1].id).toBe(first.id);

    vi.useRealTimers();
  });
});