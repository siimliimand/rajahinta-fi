/**
 * What-if API client tests (task 8.3) — the 429 Retry-After capture the
 * throttle countdown depends on, plus the error classification parity
 * with the trip/event clients.
 *
 * @module WhatIfClientTest
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiFetch, ApiFetchError } from '@/lib/api';
import {
  calculateWhatIfExcise,
  classifyWhatIfError,
  parseRetryAfterSeconds,
  WhatIfRateLimitError,
} from './what-if.client';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    apiFetch: vi.fn(),
  };
});

const mockedApiFetch = vi.mocked(apiFetch);

const INPUT = {
  hypotheticalRate: 18.1,
  products: [
    {
      id: 'beer-05',
      category: 'beer' as const,
      abv: 0.047,
      volumeLitres: 1,
      alkoPriceCents: 1298,
      importPriceCents: 89,
    },
  ],
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

beforeEach(() => {
  mockedApiFetch.mockReset();
});

describe('calculateWhatIfExcise', () => {
  it('returns the parsed 200 body', async () => {
    const body = { hypotheticalRate: 18.1, shareToken: 'wi1.a.b' };
    mockedApiFetch.mockResolvedValueOnce(jsonResponse(body));
    await expect(calculateWhatIfExcise(INPUT)).resolves.toEqual(body);
  });

  it('throws WhatIfRateLimitError carrying the Retry-After seconds', async () => {
    mockedApiFetch.mockResolvedValueOnce(jsonResponse({}, { status: 429 }));
    mockedApiFetch.mockResolvedValueOnce(
      jsonResponse({}, { status: 429, headers: { 'Retry-After': '30' } }),
    );
    await expect(calculateWhatIfExcise(INPUT)).rejects.toThrow(WhatIfRateLimitError);
    await expect(calculateWhatIfExcise(INPUT)).rejects.toMatchObject({
      retryAfterSeconds: 30,
    });
  });

  it('translates other non-2xx into ApiFetchError', async () => {
    mockedApiFetch.mockResolvedValueOnce(
      jsonResponse({ error: 'Forbidden' }, { status: 403 }),
    );
    const err = await calculateWhatIfExcise(INPUT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiFetchError);
    expect((err as ApiFetchError).status).toBe(403);
  });

  it('rethrows aborts untranslated (superseded requests, not failures)', async () => {
    const abort = new DOMException('aborted', 'AbortError');
    mockedApiFetch.mockRejectedValueOnce(abort);
    await expect(calculateWhatIfExcise(INPUT)).rejects.toBe(abort);
  });
});

describe('parseRetryAfterSeconds', () => {
  it('parses integer seconds and falls back to the one-minute window', () => {
    expect(parseRetryAfterSeconds('30')).toBe(30);
    expect(parseRetryAfterSeconds(null)).toBe(60);
    expect(parseRetryAfterSeconds('')).toBe(60);
    expect(parseRetryAfterSeconds('nonsense')).toBe(60);
  });

  it('supports the HTTP-date form with a positive floor', () => {
    const soon = new Date(Date.now() + 15_000).toUTCString();
    expect(parseRetryAfterSeconds(soon)).toBeGreaterThanOrEqual(1);
    expect(parseRetryAfterSeconds(soon)).toBeLessThanOrEqual(16);
  });
});

describe('classifyWhatIfError', () => {
  it('maps statuses to kinds and carries the retry seconds', () => {
    expect(
      classifyWhatIfError(new WhatIfRateLimitError(45)),
    ).toEqual({ kind: 'rate-limited', retryAfterSeconds: 45 });
    expect(
      classifyWhatIfError(new ApiFetchError(429, null)),
    ).toEqual({ kind: 'rate-limited', retryAfterSeconds: 60 });
    expect(
      classifyWhatIfError(new ApiFetchError(400, null)).kind,
    ).toBe('validation');
    expect(
      classifyWhatIfError(new ApiFetchError(403, null)).kind,
    ).toBe('forbidden');
    expect(
      classifyWhatIfError(new ApiFetchError(500, null)).kind,
    ).toBe('unknown');
    expect(classifyWhatIfError(new Error('no response')).kind).toBe('network');
  });
});
