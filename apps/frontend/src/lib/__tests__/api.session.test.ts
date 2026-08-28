/**
 * API session client tests (task 2.3).
 *
 * Verifies the client-side half of the server-issued session model:
 *   1. No client-generated identity exists — the retired `x-user-id`
 *      header is never attached, to any path.
 *   2. Every request carries credentials so the httpOnly
 *      `rajahinta_session` cookie travels.
 *   3. First account-touch: a 401 on an account-scoped path mints a
 *      session via POST /api/v1/account/session and replays the original
 *      request exactly once.
 *   4. Concurrent 401s share one single-flight issuance.
 *   5. The session lifecycle endpoints never trigger auto-issuance.
 *   6. ensureSession resolves the server-derived identity.
 *
 * @module ApiSessionTest
 */
// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ApiFetchError,
  ensureSession,
  listScenarios,
  request,
  rotateSession,
  searchProducts,
} from '../api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const API_BASE = 'http://localhost:3000';

const SESSION_INFO = {
  userId: '11111111-2222-4333-8444-555555555555',
  expiresAt: '2026-09-27T00:00:00.000Z',
  verified: false,
};

/** Build a fetch Response-like object for a JSON body and status. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

type FetchCall = [string, RequestInit];

function lastCalls(): FetchCall[] {
  return (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls as FetchCall[];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('session handling in request()', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never sends the retired x-user-id header on account-scoped paths', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([]),
    );

    await listScenarios();

    const [, init] = lastCalls()[0];
    expect(init.headers).not.toHaveProperty('x-user-id');
    expect((init.headers as Record<string, string>)['X-User-Id']).toBeUndefined();
  });

  it('sends credentials so the httpOnly session cookie travels', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([]),
    );

    await searchProducts('olut');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('issues a session and replays the request once on a first-touch 401', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ statusCode: 401, message: 'Authentication required', error: 'SessionRequired' }, 401))
      .mockResolvedValueOnce(jsonResponse(SESSION_INFO, 201))
      .mockResolvedValueOnce(jsonResponse([]));

    const result = await request<unknown[]>('/api/v1/account/scenarios');

    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const [replayedUrl, replayedInit] = lastCalls()[2];
    expect(replayedUrl).toBe(`${API_BASE}/api/v1/account/scenarios`);
    // The replay carries no identity header either.
    expect((replayedInit.headers as Record<string, string>)['x-user-id']).toBeUndefined();
  });

  it('shares one issuance across concurrent first-touch 401s', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    // Both account calls 401 before either is retried.
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'SessionRequired' }, 401))
      .mockResolvedValueOnce(jsonResponse({ error: 'SessionRequired' }, 401))
      .mockResolvedValueOnce(jsonResponse(SESSION_INFO, 201))
      .mockResolvedValueOnce(jsonResponse([1]))
      .mockResolvedValueOnce(jsonResponse([2]));

    const [a, b] = await Promise.all([
      request<number[]>('/api/v1/account/history'),
      request<number[]>('/api/v1/account/history'),
    ]);

    expect(a).toEqual([1]);
    expect(b).toEqual([2]);
    // 2 original + 1 shared issuance + 2 replays — never 2 issuances.
    expect(fetchMock).toHaveBeenCalledTimes(5);
    const issuanceCalls = lastCalls().filter(
      ([url, init]) => url === `${API_BASE}/api/v1/account/session` && init.method === 'POST',
    );
    expect(issuanceCalls).toHaveLength(1);
  });

  it('propagates a 401 without issuing when replay still fails', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'SessionRequired' }, 401))
      .mockResolvedValueOnce(jsonResponse(SESSION_INFO, 201))
      .mockResolvedValueOnce(jsonResponse({ error: 'InvalidSession' }, 401));

    await expect(
      request('/api/v1/account/scenarios'),
    ).rejects.toBeInstanceOf(ApiFetchError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('never auto-issues for the session lifecycle endpoints', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ statusCode: 401, message: 'Session token is invalid', error: 'InvalidSession' }, 401),
    );

    await expect(rotateSession()).rejects.toBeInstanceOf(ApiFetchError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never auto-issues for non-account paths', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ statusCode: 401, message: 'no', error: 'No' }, 401),
    );

    await expect(request('/api/v1/products/42')).rejects.toBeInstanceOf(
      ApiFetchError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ensureSession returns the server-derived identity', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ statusCode: 401, message: 'Authentication required', error: 'SessionRequired' }, 401),
      )
      .mockResolvedValueOnce(jsonResponse(SESSION_INFO, 201))
      .mockResolvedValueOnce(
        jsonResponse({
          userId: SESSION_INFO.userId,
          plan: 'FREE',
          active: true,
        }),
      );

    const status = await ensureSession();

    expect(status.userId).toBe(SESSION_INFO.userId);
    const [probeUrl] = lastCalls()[0];
    expect(probeUrl).toBe(`${API_BASE}/api/v1/account/subscription`);
  });
});
