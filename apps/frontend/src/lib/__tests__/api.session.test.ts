/**
 * Auth semantics of the API client (design D8, change
 * email-password-auth).
 *
 * The anonymous issuance flow (first-touch 401 → POST /session → replay)
 * is deleted: an account-scoped 401 now propagates as ApiFetchError so
 * route-level code can redirect to `/login`, and sign-in happens only
 * through register/login. These tests pin that no issuance path exists
 * and that the credential flow functions hit the routes the API Worker
 * registers.
 *
 * @module ApiSessionTest
 */
// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ApiFetchError,
  confirmEmailVerification,
  ensureSession,
  listScenarios,
  loginAccount,
  registerAccount,
  request,
  requestPasswordReset,
  requestVerificationEmail,
  resetPassword,
  revokeSession,
  rotateSession,
  searchProducts,
} from '../api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const API_BASE = 'http://localhost:3000';

const ME = {
  userId: '11111111-2222-4333-8444-555555555555',
  email: 'kayttaja@example.fi',
  verified: false,
};

const SESSION_INFO = {
  userId: ME.userId,
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

/** Every POST issued to the (deleted) anonymous session endpoint. */
function issuanceCalls(): FetchCall[] {
  return lastCalls().filter(
    ([url, init]) =>
      url === `${API_BASE}/api/v1/account/session` && init.method === 'POST',
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('request() auth semantics — no anonymous issuance', () => {
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

  it('surfaces an account-scoped 401 without minting or replaying', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { statusCode: 401, message: 'Authentication required', error: 'SessionRequired' },
        401,
      ),
    );

    const err = await request('/api/v1/account/scenarios').catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(ApiFetchError);
    expect((err as ApiFetchError).status).toBe(401);
    // Exactly one exchange: no issuance POST, no replay.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(issuanceCalls()).toHaveLength(0);
  });

  it('propagates 401s for concurrent account calls with no shared issuance', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      jsonResponse({ statusCode: 401, error: 'SessionRequired' }, 401),
    );

    const results = await Promise.allSettled([
      request<number[]>('/api/v1/account/history'),
      request<number[]>('/api/v1/account/history'),
    ]);

    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    // 2 original calls — never an issuance, never a replay.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(issuanceCalls()).toHaveLength(0);
  });

  it('propagates a rotate/revoke 401 as-is', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          { statusCode: 401, message: 'Session token is invalid', error: 'InvalidSession' },
          401,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({ statusCode: 401, error: 'InvalidSession' }, 401),
      );

    await expect(rotateSession()).rejects.toBeInstanceOf(ApiFetchError);
    await expect(revokeSession()).rejects.toBeInstanceOf(ApiFetchError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(issuanceCalls()).toHaveLength(0);
  });

  it('propagates a 401 on non-account paths unchanged', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ statusCode: 401, message: 'no', error: 'No' }, 401),
    );

    await expect(request('/api/v1/products/42')).rejects.toBeInstanceOf(
      ApiFetchError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('ensureSession', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads GET /api/v1/account/me and returns the account identity', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse(ME));

    const status = await ensureSession();

    expect(status).toEqual(ME);
    const [probeUrl, probeInit] = lastCalls()[0];
    expect(probeUrl).toBe(`${API_BASE}/api/v1/account/me`);
    expect(probeInit.method).toBeUndefined(); // default GET
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces the 401 so callers can redirect to /login', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ statusCode: 401, error: 'SessionRequired' }, 401),
    );

    const err = await ensureSession().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiFetchError);
    expect((err as ApiFetchError).status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('credential flows (design D2 routes)', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registerAccount POSTs the email and password to /register', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(SESSION_INFO, 201),
    );

    const info = await registerAccount('Kayttaja@Example.fi', 'salasana-12-merkKIna');

    expect(info).toEqual(SESSION_INFO);
    const [url, init] = lastCalls()[0];
    expect(url).toBe(`${API_BASE}/api/v1/account/register`);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'Kayttaja@Example.fi',
      password: 'salasana-12-merkKIna',
    });
  });

  it('loginAccount POSTs to /login and surfaces the uniform 401', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          { statusCode: 401, message: 'Invalid email or password.', error: 'InvalidCredentials' },
          401,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ ...SESSION_INFO, verified: true }));

    await expect(loginAccount('kayttaja@example.fi', 'vasara')).rejects.toMatchObject({
      status: 401,
    });

    const info = await loginAccount('kayttaja@example.fi', 'salasana-12-merkKIna');
    expect(info.verified).toBe(true);

    const [loginUrl, loginInit] = lastCalls()[1];
    expect(loginUrl).toBe(`${API_BASE}/api/v1/account/login`);
    expect(loginInit.method).toBe('POST');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('confirmEmailVerification POSTs the token to the confirm endpoint', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ verified: true, userId: ME.userId, email: ME.email }),
    );

    const result = await confirmEmailVerification('token-abc');

    expect(result).toEqual({ verified: true, userId: ME.userId, email: ME.email });
    const [url, init] = lastCalls()[0];
    expect(url).toBe(`${API_BASE}/api/v1/account/verify-email/confirm`);
    expect(JSON.parse(init.body as string)).toEqual({ token: 'token-abc' });
  });

  it('requestVerificationEmail POSTs the sessionAuth resend endpoint', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ accepted: true }, 202),
    );

    await expect(requestVerificationEmail()).resolves.toEqual({ accepted: true });

    const [url, init] = lastCalls()[0];
    expect(url).toBe(`${API_BASE}/api/v1/account/verify-email/request`);
    expect(init.method).toBe('POST');
  });

  it('requestPasswordReset POSTs the email to the reset-request endpoint', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ accepted: true }, 202),
    );

    await expect(requestPasswordReset('kayttaja@example.fi')).resolves.toEqual({
      accepted: true,
    });

    const [url, init] = lastCalls()[0];
    expect(url).toBe(`${API_BASE}/api/v1/account/password/reset-request`);
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'kayttaja@example.fi',
    });
  });

  it('resetPassword POSTs token and newPassword to the reset endpoint', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ reset: true }),
    );

    await expect(resetPassword('token-abc', 'salasana-12-merkKIna')).resolves.toEqual({
      reset: true,
    });

    const [url, init] = lastCalls()[0];
    expect(url).toBe(`${API_BASE}/api/v1/account/password/reset`);
    expect(JSON.parse(init.body as string)).toEqual({
      token: 'token-abc',
      newPassword: 'salasana-12-merkKIna',
    });
  });
});
