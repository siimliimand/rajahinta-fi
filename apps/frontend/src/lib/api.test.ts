/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { searchProducts } from './api';

const COOKIE_KEY = 'age_confirmed';

describe('request() header injection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Clear any cookies set by previous tests
    document.cookie = `${COOKIE_KEY}=; max-age=0; path=/`;
  });

  it('sends x-age-confirmed header when cookie is present', async () => {
    document.cookie = `${COOKIE_KEY}=true; path=/`;

    const mockData = { items: [], total: 0, page: 1, limit: 20 };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    });

    await searchProducts('test');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/products'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-age-confirmed': 'true',
        }),
      }),
    );
  });

  it('does not send x-age-confirmed header when cookie is absent', async () => {
    const mockData = { items: [], total: 0, page: 1, limit: 20 };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    });

    await searchProducts('test');

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers['x-age-confirmed']).toBeUndefined();
  });

  it('reads the same cookie key "age_confirmed" that AgeGate writes', async () => {
    // Design invariant: AgeGate writes to cookie key 'age_confirmed'
    // and the API reads from the same key. This test exercises the read path.
    document.cookie = `${COOKIE_KEY}=1; path=/`;

    const mockData = { items: [], total: 0, page: 1, limit: 20 };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    });

    await searchProducts('test');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-age-confirmed': '1',
        }),
      }),
    );
  });
});