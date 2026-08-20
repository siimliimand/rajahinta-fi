/**
 * API analytics client tests.
 *
 * Tests that {@link logClick} makes the correct HTTP request
 * and handles the response.  Uses vi.fn() to mock fetch.
 *
 * @module ApiAnalyticsTest
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { logClick } from '../api';

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('logClick()', () => {
  beforeEach(() => {
    // Wrap fetch in a spy so we can assert on it
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends a POST request to /api/v1/analytics/click', async () => {
    globalThis.fetch = mockFetchOnce({ success: true, count: 1 });

    await logClick('alko', 'https://www.alko.fi/tuotteet/olut');

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${API_BASE}/api/v1/analytics/click`,
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('sends merchantId and url as JSON body', async () => {
    globalThis.fetch = mockFetchOnce({ success: true, count: 1 });

    await logClick('alko', 'https://www.alko.fi/tuotteet/olut');

    const callBody = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body;
    expect(JSON.parse(callBody)).toEqual({
      merchantId: 'alko',
      url: 'https://www.alko.fi/tuotteet/olut',
    });
  });

  it('sets Content-Type to application/json', async () => {
    globalThis.fetch = mockFetchOnce({ success: true, count: 1 });

    await logClick('alko', 'https://www.alko.fi/tuotteet/olut');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('resolves successfully when the backend returns success', async () => {
    globalThis.fetch = mockFetchOnce({ success: true, count: 3 });

    // Should not throw
    await expect(logClick('alko', 'https://www.alko.fi/tuotteet/olut')).resolves.toBeUndefined();
  });

  it('throws an error when the backend returns a non-2xx status', async () => {
    globalThis.fetch = mockFetchOnce(
      { statusCode: 400, message: '"merchantId" is required', error: 'ValidationError' },
      400,
    );

    await expect(
      logClick('', 'https://www.alko.fi/tuotteet/olut'),
    ).rejects.toThrow();
  });

  it('can record clicks for different merchants', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce({ success: true, count: 1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce({ success: true, count: 1 }),
      });

    globalThis.fetch = fetchMock;

    await logClick('alko', 'https://www.alko.fi/tuotteet/olut');
    await logClick('citymarket', 'https://www.citymarket.fi/olut');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).merchantId).toBe('alko');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).merchantId).toBe('citymarket');
  });
});