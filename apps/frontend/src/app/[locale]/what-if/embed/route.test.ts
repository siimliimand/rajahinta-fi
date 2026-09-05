/**
 * Embed widget route tests (task 8.3) — the GET flow over the real
 * flag gate, read-only token decode, and recompute path: flag off →
 * closed view; tampered token → invalid view; valid token → result view
 * carrying the structural disclaimer; 429 → throttled view with the
 * Retry-After meta refresh; unknown locale → 404.
 *
 * @module WhatIfEmbedRouteTest
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { apiFetch, getServerFeatureFlags } from '@/lib/api';
import { encodeWhatIfShareToken } from '../share-token';
import type { WhatIfResponse } from '../what-if.types';
import type { FeatureFlagsResponse } from '@/lib/types';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    getServerFeatureFlags: vi.fn(),
    apiFetch: vi.fn(),
  };
});

const mockedFlags = vi.mocked(getServerFeatureFlags);
const mockedApiFetch = vi.mocked(apiFetch);

const FLAGS_ON = {
  flags: { EXCISE_WHAT_IF: true },
} as unknown as FeatureFlagsResponse;
const FLAGS_OFF = { flags: {} } as FeatureFlagsResponse;

const TOKEN = encodeWhatIfShareToken({
  hypotheticalRate: 18.1,
  products: [
    {
      id: 'beer-05',
      category: 'beer',
      abv: 0.047,
      volumeLitres: 1,
      alkoPriceCents: 1298,
      importPriceCents: 89,
    },
  ],
});

const DISCLAIMER = {
  text: 'Hypoteettinen laskelma: laskelma ei ole ennuste.',
  language: 'fi' as const,
  version: '1.0',
};

const RESULT: WhatIfResponse = {
  hypotheticalRate: 18.1,
  baselineTaxDatasetVersion: 'v3.0-2026',
  disclaimer: DISCLAIMER,
  lines: [],
  totals: {
    baselineExciseCents: 0,
    hypotheticalExciseCents: 0,
    gapBaselineCents: 0,
    gapHypotheticalCents: 0,
  },
  shareToken: TOKEN,
};

function embedRequest(locale: string, token?: string): Request {
  const url = new URL(`http://localhost:3000${locale === 'en' ? '/en' : ''}/what-if/embed`);
  if (token !== undefined) url.searchParams.set('token', token);
  return new Request(url);
}

async function get(locale: string, token?: string): Promise<Response> {
  return GET(embedRequest(locale, token), {
    params: Promise.resolve({ locale }),
  });
}

beforeEach(() => {
  mockedFlags.mockReset();
  mockedApiFetch.mockReset();
  mockedFlags.mockResolvedValue(FLAGS_ON);
});

describe('GET /what-if/embed', () => {
  it('returns the closed view while EXCISE_WHAT_IF is off — no decode, no recompute', async () => {
    mockedFlags.mockResolvedValue(FLAGS_OFF);
    const res = await get('fi', TOKEN);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await res.text()).toContain('Mitä jos -laskuri ei ole käytettävissä');
    expect(mockedApiFetch).not.toHaveBeenCalled();
  });

  it('rejects unknown locale segments with 404', async () => {
    const res = await get('xx', TOKEN);
    expect(res.status).toBe(404);
    expect(mockedApiFetch).not.toHaveBeenCalled();
  });

  it('renders the invalid view for a missing or tampered token — read-only decode', async () => {
    for (const token of [undefined, 'not-a-token', `${TOKEN}x`]) {
      const res = await get('fi', token);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('Linkkiä ei voitu lukea');
    }
    expect(mockedApiFetch).not.toHaveBeenCalled();
  });

  it('recomputes the decoded scenario and renders the disclaimer with the result', async () => {
    mockedApiFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(RESULT), { headers: { 'content-type': 'application/json' } }),
    );
    const res = await get('fi', TOKEN);
    const html = await res.text();

    expect(mockedApiFetch).toHaveBeenCalledTimes(1);
    const [path, init] = mockedApiFetch.mock.calls[0]!;
    expect(path).toBe('/api/v1/what-if/excise');
    expect(JSON.parse((init as { body: string }).body)).toEqual({
      hypotheticalRate: 18.1,
      products: [
        {
          id: 'beer-05',
          category: 'beer',
          abv: 0.047,
          volumeLitres: 1,
          alkoPriceCents: 1298,
          importPriceCents: 89,
        },
      ],
    });

    expect(html).toContain('lang="fi"');
    expect(html).toContain(`role="note">${DISCLAIMER.text}`);
    expect(html).toContain('Vertailun verokanta-aineisto: v3.0-2026');
  });

  it('renders the throttled view with the Retry-After meta refresh on a 429', async () => {
    mockedApiFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'TooManyRequests' }), {
        status: 429,
        headers: { 'Retry-After': '30' },
      }),
    );
    const html = await (await get('fi', TOKEN)).text();
    expect(html).toContain('<meta http-equiv="refresh" content="30">');
    expect(html).toContain('Näkymä päivittyy automaattisesti 30 sekunnin kuluttua.');
  });

  it('renders the unavailable view on other API failures', async () => {
    mockedApiFetch.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    const html = await (await get('fi', TOKEN)).text();
    expect(html).toContain('Laskelma ei ole nyt saatavilla');
  });

  it('serves the English locale from the /en prefix', async () => {
    mockedApiFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(RESULT), { headers: { 'content-type': 'application/json' } }),
    );
    const html = await (await get('en', TOKEN)).text();
    expect(html).toContain('lang="en"');
    expect(html).toContain('Baseline rate dataset: v3.0-2026');
  });
});
