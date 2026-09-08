/**
 * Embed calculator route tests (task 6.3) — the GET flow: no
 * confirmation token → gate view and zero API calls; confirm → cookie
 * is set and the form renders; search and calculate pass through the
 * SAME guarded API endpoints the calculator page uses, with the token
 * forwarded as `x-age-confirmed`; 429 → throttled view; gated 403 →
 * the gate re-renders; unknown locale → 404.
 *
 * The `request` seam is mocked (not `apiFetch`): `request()` calls
 * `apiFetch` through a same-module binding a namespace mock cannot
 * intercept, and `request` is exactly the client path the calculator
 * page's calls take (calculateLandedCost / searchProducts).
 *
 * @module EmbedCalculatorRouteTest
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { request, ApiFetchError } from '@/lib/api';
import type { ApiError } from '@/lib/types';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    request: vi.fn(),
  };
});

const mockedRequest = vi.mocked(request);

function apiError(partial: Partial<ApiError>): ApiError {
  return {
    statusCode: 500,
    message: 'error',
    error: 'ServerError',
    timestamp: '2026-09-08T10:00:00.000Z',
    path: '/api/v1/test',
    ...partial,
  };
}

const SEARCH_RESPONSE = {
  items: [
    {
      id: 12,
      name: 'Beer 0,5 l',
      brand: 'Brand',
      category: 'beer',
      alcoholByVolume: 4.7,
      unitVolume: '0,5 l',
      containerType: 'CAN',
      lowestPriceCents: 1298,
      merchantCount: 3,
    },
  ],
  total: 1,
  page: 1,
  limit: 20,
  totalPages: 1,
};

const RESULT_RESPONSE = {
  itemizedCosts: [],
  excludedOffers: [],
  foreignRetailPrice: 0,
  transportCost: 0,
  alcoholExciseEstimate: 0,
  containerDutyEstimate: 0,
  totalCents: 1468,
  currency: 'EUR',
  confidence: 'MEDIUM',
  confidenceBreakdown: [],
  disclaimer: {
    text: 'Estimoitu hinta: laskelma ei ole tarjous.',
    language: 'fi',
    version: '1.0',
  },
  classification: {
    classification: 'DistanceBuying',
    confidence: 'HIGH',
    evidence: [],
    evidenceSummary: 'Evidence summary.',
  },
  metadata: {
    input: { productId: 12, quantity: 2, destination: 'FI' },
    calculationTimestamp: '2026-09-08T10:00:00.000Z',
    productMasterId: 12,
    retailOfferIds: [1],
    quantity: 2,
    destination: 'FI',
    productName: 'Beer 0,5 l',
    volumeLitres: 1,
    alcoholByVolume: 4.7,
    category: 'beer',
    datasetVersions: ['v3.0-2026'],
    transportOfferId: null,
  },
  calculationRecordId: 42,
};

function embedRequest(
  locale: string,
  query = '',
  headers: Record<string, string> = {},
): Request {
  const suffix = locale === 'en' ? '/en' : '';
  const url = new URL(`http://localhost:3000${suffix}/embed/calculator${query}`);
  return new Request(url, { headers });
}

async function get(
  locale: string,
  query = '',
  headers: Record<string, string> = {},
): Promise<Response> {
  return GET(embedRequest(locale, query, headers), {
    params: Promise.resolve({ locale }),
  });
}

beforeEach(() => {
  mockedRequest.mockReset();
});

describe('GET /embed/calculator — age gate', () => {
  it('rejects unknown locale segments with 404', async () => {
    const res = await get('xx');
    expect(res.status).toBe(404);
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('renders the gate prompt and calls nothing without a confirmation token', async () => {
    const res = await get('fi');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Ikätarkistus');
    expect(html).toContain('href="?confirm=1"');
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('renders the declined state and clears the cookie on decline', async () => {
    const res = await get('fi', '?declined=1');
    const html = await res.text();
    expect(html).toContain('Pääsy rajattu');
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('sets the same age cookie on confirm and renders the form — no API calls yet', async () => {
    const res = await get('fi', '?confirm=1');
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('age_confirmed=true');
    expect(res.headers.get('set-cookie')).toContain('SameSite=Lax');
    const html = await res.text();
    expect(html).toContain('name="q"');
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('accepts the age_confirmed cookie the main app writes', async () => {
    const res = await get('fi', '', { cookie: 'age_confirmed=true' });
    const html = await res.text();
    expect(html).not.toContain('Ikätarkistus');
    expect(html).toContain('name="q"');
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});

describe('GET /embed/calculator — search and calculate via the normal API path', () => {
  it('runs the same product search the calculator page runs, with the age header', async () => {
    mockedRequest.mockResolvedValueOnce(SEARCH_RESPONSE);
    const res = await get('fi', '?confirm=1&q=beer');
    const html = await res.text();

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(mockedRequest.mock.calls[0]?.[0]).toBe(
      '/api/v1/products?q=beer&sort=ALPHABETICAL&page=1&limit=20',
    );
    expect(mockedRequest.mock.calls[0]?.[1]).toEqual({
      headers: { 'x-age-confirmed': 'true' },
    });

    expect(html).toContain('Hakutulokset');
    expect(html).toContain('name="product" value="12"');
  });

  it('posts the same calculator endpoint the page submits, with the age header', async () => {
    mockedRequest.mockResolvedValueOnce(RESULT_RESPONSE);
    const res = await get('fi', '?confirm=1&q=beer&product=12&quantity=2');
    const html = await res.text();

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(mockedRequest.mock.calls[0]?.[0]).toBe('/api/v1/calculator');
    expect(mockedRequest.mock.calls[0]?.[1]).toEqual({
      method: 'POST',
      body: JSON.stringify({ productId: 12, quantity: 2, destination: 'FI' }),
      headers: { 'x-age-confirmed': 'true' },
    });

    expect(html).toContain('role="note">Estimoitu hinta: laskelma ei ole tarjous.');
    expect(html).toContain('<strong>€14.68</strong>');
  });

  it('clamps an out-of-range quantity like the page does', async () => {
    mockedRequest.mockResolvedValueOnce(RESULT_RESPONSE);
    await get('fi', '?confirm=1&product=12&quantity=5000');
    const init = mockedRequest.mock.calls[0]?.[1];
    expect(JSON.parse((init as { body: string }).body).quantity).toBe(99);
  });

  it('forwards the presented cookie token, not a fabricated one', async () => {
    mockedRequest.mockResolvedValueOnce(SEARCH_RESPONSE);
    await get('fi', '?q=beer', { cookie: 'age_confirmed=some-existing-token' });
    expect(mockedRequest.mock.calls[0]?.[1]).toEqual({
      headers: { 'x-age-confirmed': 'some-existing-token' },
    });
  });

  it('renders the throttled view with the Retry-After wait on a 429', async () => {
    mockedRequest.mockRejectedValueOnce(
      new ApiFetchError(429, apiError({ statusCode: 429, retryAfterSeconds: 30 }), null),
    );
    const res = await get('fi', '?confirm=1&product=12&quantity=2');
    const html = await res.text();
    expect(html).toContain('Yritä uudelleen 30 sekunnin kuluttua.');
    expect(html).toContain('href="/embed/calculator?confirm=1&amp;product=12&amp;quantity=2"');
  });

  it('re-renders the age gate when the API rejects with AGE_GATE_REQUIRED', async () => {
    mockedRequest.mockRejectedValueOnce(
      new ApiFetchError(
        403,
        apiError({ statusCode: 403, code: 'AGE_GATE_REQUIRED' }),
        null,
      ),
    );
    const res = await get('fi', '?confirm=1&q=beer');
    const html = await res.text();
    expect(html).toContain('Ikätarkistus');
    expect(mockedRequest).toHaveBeenCalledTimes(1);
  });

  it('renders the unavailable view on other API failures', async () => {
    mockedRequest.mockRejectedValueOnce(new ApiFetchError(500, null, null));
    const html = await (await get('fi', '?confirm=1&q=beer')).text();
    expect(html).toContain('Laskelma ei ole nyt saatavilla');
  });

  it('serves the English locale from the /en prefix', async () => {
    mockedRequest.mockResolvedValueOnce(SEARCH_RESPONSE);
    const res = await get('en', '?confirm=1&q=beer');
    const html = await res.text();
    expect(html).toContain('lang="en"');
    expect(html).toContain('Search results');
  });
});
