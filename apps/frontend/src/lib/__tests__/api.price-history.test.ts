/**
 * Price-history fetch client tests.
 *
 * Tests that {@link getPriceHistory} builds the correct request (param
 * names, defaults, merchant handling per the historical DTO) and that
 * failures surface as typed errors via {@link classifyPriceHistoryError}
 * rather than bare strings.  Uses vi.fn() to mock fetch.
 *
 * @module ApiPriceHistoryTest
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getPriceHistory,
  classifyPriceHistoryError,
  ApiFetchError,
} from '../api';
import type { PriceHistoryResponse } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const API_BASE = 'http://localhost:3000';

/**
 * Factory for a mock fetch that returns a given JSON body and status.
 */
function mockFetchOnce(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValueOnce(body),
  });
}

/** Minimal valid response body — shape mirrors PriceHistoryResponse. */
function sampleResponse(): PriceHistoryResponse {
  return {
    productId: 42,
    merchant: null,
    metric: 'price',
    granularity: 'day',
    from: '2026-01-01',
    to: '2026-01-31',
    series: [
      {
        periodStart: '2026-01-01',
        openCents: 1099,
        closeCents: 1099,
        minCents: 1099,
        maxCents: 1099,
        avgCents: 1099,
        observationCount: 2,
        reliability: 'VERIFIED',
      },
      {
        periodStart: '2026-01-02',
        openCents: 1099,
        closeCents: 1149,
        minCents: 1099,
        maxCents: 1149,
        avgCents: 1124,
        observationCount: 3,
        reliability: 'ESTIMATED',
      },
    ],
    attribution: [
      {
        merchant: 'systembolaget',
        classification: 'TAX_RULE_CHANGE',
        fromObservedAt: '2026-01-01T06:00:00.000Z',
        toObservedAt: '2026-01-02T06:00:00.000Z',
        movedInputs: {
          exciseRule: true,
          containerDutyRule: false,
          merchantPrice: false,
          transport: false,
        },
        exciseRuleBoundary: {
          fromVersionLabel: 'excise-2025H2',
          toVersionLabel: 'excise-2026H1',
        },
        containerDutyRuleBoundary: null,
      },
    ],
    earliestAvailableObservationDate: '2025-11-03T06:00:00.000Z',
  };
}

// ---------------------------------------------------------------------------
// Request construction
// ---------------------------------------------------------------------------

describe('getPriceHistory()', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends a GET request with default metric and granularity', async () => {
    globalThis.fetch = mockFetchOnce(sampleResponse());

    await getPriceHistory(42, { from: '2026-01-01', to: '2026-01-31' });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(calledUrl).toBe(
      `${API_BASE}/api/v1/products/42/price-history?metric=price&granularity=day&from=2026-01-01&to=2026-01-31`,
    );
  });

  it('passes explicit metric, granularity, and merchant through', async () => {
    globalThis.fetch = mockFetchOnce(sampleResponse());

    await getPriceHistory(7, {
      metric: 'landed-cost',
      granularity: 'week',
      from: '2026-01-01',
      to: '2026-03-31',
      merchant: 'systembolaget',
    });

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(calledUrl).toContain('metric=landed-cost');
    expect(calledUrl).toContain('granularity=week');
    expect(calledUrl).toContain('from=2026-01-01');
    expect(calledUrl).toContain('to=2026-03-31');
    expect(calledUrl).toContain('merchant=systembolaget');
  });

  it('omits the merchant param when no merchant filter is given', async () => {
    globalThis.fetch = mockFetchOnce(sampleResponse());

    await getPriceHistory(42, { from: '2026-01-01', to: '2026-01-31' });

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(calledUrl).not.toContain('merchant=');
  });

  it('returns the parsed typed response', async () => {
    const body = sampleResponse();
    globalThis.fetch = mockFetchOnce(body);

    const result = await getPriceHistory(42, {
      from: '2026-01-01',
      to: '2026-01-31',
    });

    expect(result).toEqual(body);
    expect(result.series[0].reliability).toBe('VERIFIED');
    expect(result.attribution[0].classification).toBe('TAX_RULE_CHANGE');
    expect(result.earliestAvailableObservationDate).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Typed error surfacing
// ---------------------------------------------------------------------------

describe('classifyPriceHistoryError()', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('classifies 400 validation failures (range over 365 days) with the server message attached', async () => {
    globalThis.fetch = mockFetchOnce(
      {
        statusCode: 400,
        message: 'requested range must not exceed 365 days',
        error: 'ValidationError',
      },
      400,
    );

    const err = await getPriceHistory(42, {
      from: '2024-01-01',
      to: '2026-01-01',
    }).catch((e: unknown) => e);

    const { kind, error } = classifyPriceHistoryError(err);
    expect(kind).toBe('validation');
    expect(error).toBeInstanceOf(ApiFetchError);
    expect(error?.status).toBe(400);
    expect(error?.body?.message).toBe('requested range must not exceed 365 days');
  });

  it('classifies 403 as forbidden (flag disabled / age gate)', async () => {
    globalThis.fetch = mockFetchOnce(
      { statusCode: 403, message: 'Feature flag disabled', error: 'Forbidden' },
      403,
    );

    const err = await getPriceHistory(42, {
      from: '2026-01-01',
      to: '2026-01-31',
    }).catch((e: unknown) => e);

    expect(classifyPriceHistoryError(err).kind).toBe('forbidden');
  });

  it('classifies 429 as rate-limited', async () => {
    globalThis.fetch = mockFetchOnce(
      { statusCode: 429, message: 'Too many requests', error: 'RateLimit' },
      429,
    );

    const err = await getPriceHistory(42, {
      from: '2026-01-01',
      to: '2026-01-31',
    }).catch((e: unknown) => e);

    expect(classifyPriceHistoryError(err).kind).toBe('rate-limited');
  });

  it('classifies 404 as not-found', async () => {
    globalThis.fetch = mockFetchOnce(
      { statusCode: 404, message: 'Product 42 not found', error: 'NotFound' },
      404,
    );

    const err = await getPriceHistory(42, {
      from: '2026-01-01',
      to: '2026-01-31',
    }).catch((e: unknown) => e);

    expect(classifyPriceHistoryError(err).kind).toBe('not-found');
  });

  it('classifies fetch rejections (no HTTP response) as network', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const err = await getPriceHistory(42, {
      from: '2026-01-01',
      to: '2026-01-31',
    }).catch((e: unknown) => e);

    const { kind, error } = classifyPriceHistoryError(err);
    expect(kind).toBe('network');
    expect(error).toBeNull();
  });

  it('falls back to unknown for unmapped HTTP statuses', async () => {
    globalThis.fetch = mockFetchOnce(
      { statusCode: 500, message: 'Internal error', error: 'Internal' },
      500,
    );

    const err = await getPriceHistory(42, {
      from: '2026-01-01',
      to: '2026-01-31',
    }).catch((e: unknown) => e);

    const { kind, error } = classifyPriceHistoryError(err);
    expect(kind).toBe('unknown');
    expect(error).toBeInstanceOf(ApiFetchError);
  });
});
