/**
 * Savings page tests (insight-surfaces task 2.4, spec savings-discovery).
 *
 * Two harnesses, mirroring the repo's blog-page test precedent:
 *
 *   Server shell (renderToString, Next server plumbing mocked):
 *   1. The ordering rule is stated in the copy exactly as the ranking
 *      rule behaves (largest gap first, product-name tiebreaker), and
 *      the category selector renders URL-state links.
 *
 *   Client listing (@testing-library/react, request mocked — the listing
 *   is a client island because the endpoint is age-gated):
 *   2. Zero rows → the honest empty state PLUS the as-of/coverage
 *      header, so the funnel size stays visible when a category
 *      narrows to nothing.
 *   3. Rows render the landed total, the Alko reference, the gap
 *      (cents + basis points), and the reliability badge.
 *   4. Fetch failure → the retryable error state.
 *
 * @module SavingsPagesTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SavingsPage from './page';
import SavingsListing from './components/SavingsListing';
import { request } from '@/lib/api';

/** The [locale] layout's client-intl context, resolved from the FI catalog. */
function Provider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = React.useState<Record<string, unknown> | null>(
    null,
  );
  React.useEffect(() => {
    import('@/messages/fi.json').then((m) => setMessages(m.default as Record<string, unknown>));
  }, []);
  if (messages === null) return null;
  return (
    <NextIntlClientProvider locale="fi" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

// ---------------------------------------------------------------------------
// Mocked Next server plumbing — next-intl/server resolved straight from the
// Finnish catalog, with {param} interpolation (blog-pages test precedent).
// ---------------------------------------------------------------------------

vi.mock('next-intl/server', () => ({
  setRequestLocale: () => undefined,
  getTranslations: async (
    opts?: string | { locale?: string; namespace?: string },
  ) => {
    const ns = typeof opts === 'string' ? opts : (opts?.namespace ?? '');
    const table = (await import('@/messages/fi.json')).default as Record<
      string,
      unknown
    >;
    return (key: string, values?: Record<string, unknown>) => {
      const value = (table[ns] as Record<string, unknown> | undefined)?.[key];
      if (typeof value !== 'string') return `__MISSING_${ns}.${key}__`;
      return values === undefined
        ? value
        : value.replace(/\{(\w+)\}/g, (_, k: string) =>
            values[k] === undefined ? `{${k}}` : String(values[k]),
          );
    };
  },
}));

vi.mock('@/i18n/navigation', () => ({
  Link: (
    props: { href?: unknown; children?: React.ReactNode } & Record<
      string,
      unknown
    >,
  ) => {
    const { href, children, ...rest } = props;
    return React.createElement(
      'a',
      { ...rest, href: String(href ?? '') },
      children,
    );
  },
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    request: vi.fn(),
  };
});

const mockedRequest = vi.mocked(request);

beforeEach(() => {
  mockedRequest.mockReset();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EMPTY_OK = {
  asOf: '2026-09-08',
  category: 'beer',
  coverage: { evaluated: 42, withReference: 7, listed: 0 },
  rows: [],
};

function savingsRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    productId: 1,
    productName: 'Testia olut 0,5 l',
    category: 'beer',
    merchant: 'Viro-kauppa',
    merchantCountry: 'EE',
    priceCents: 150,
    observedAt: '2026-09-08T06:00:00.000Z',
    landedTotalCents: 1234,
    alkoReferenceCents: 3500,
    alkoObservedAt: '2026-09-07T06:00:00.000Z',
    gapCents: 2266,
    gapBasisPoints: 18363,
    reliability: 'VERIFIED',
    confidence: 'HIGH',
    taxDatasetVersion: '2026-2',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Server shell
// ---------------------------------------------------------------------------

describe('SavingsPage shell', () => {
  it('states the ordering rule (largest gap first, name tiebreaker) and renders the selector', async () => {
    const element = await SavingsPage({
      params: Promise.resolve({ locale: 'fi' }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToString(
      <NextIntlClientProvider locale="fi" messages={(await import('@/messages/fi.json')).default}>
        {element}
      </NextIntlClientProvider>,
    );

    // The ordering rule, stated in copy exactly as sortSavingsRows orders.
    expect(html).toContain('suurimman eron mukaan ensin');
    expect(html).toContain('tuotenimen aakkosjärjestys');
    // URL-state category links.
    expect(html).toContain('href="/savings?category=beer"');
    expect(html).toContain('href="/savings?category=spirits"');
  });
});

// ---------------------------------------------------------------------------
// Client listing
// ---------------------------------------------------------------------------

describe('SavingsListing', () => {
  it('renders the honest zero state with the coverage header when a category has no rows', async () => {
    mockedRequest.mockResolvedValue(EMPTY_OK);

    render(<SavingsListing category="beer" />, { wrapper: Provider });

    await waitFor(() => {
      expect(screen.getByTestId('savings-empty')).toBeTruthy();
    });
    // The empty state is an answer, not an error — and the header keeps
    // the funnel visible: evaluated 42, withReference 7, listed 0.
    expect(screen.getByTestId('savings-coverage').textContent).toContain('42');
    expect(screen.getByTestId('savings-coverage').textContent).toContain('7');
    expect(screen.getByTestId('savings-coverage').textContent).toContain(
      'Listattuja: 0',
    );
    expect(screen.getByTestId('savings-empty').textContent).toContain(
      'Ei näytettäviä rivejä',
    );
    expect(mockedRequest).toHaveBeenCalledWith(
      '/api/v1/savings?category=beer',
    );
  });

  it('renders rows with landed total, Alko reference, gap, and the reliability badge', async () => {
    mockedRequest.mockResolvedValue({
      asOf: '2026-09-08',
      category: 'beer',
      coverage: { evaluated: 42, withReference: 1, listed: 1 },
      rows: [savingsRow()],
    });

    render(<SavingsListing category="beer" />, { wrapper: Provider });

    const listing = await screen.findByTestId('savings-listing');
    expect(listing.textContent).toContain('Testia olut 0,5 l');
    expect(listing.textContent).toContain('12.34 €'); // landed total
    expect(listing.textContent).toContain('35.00 €'); // Alko reference
    expect(listing.textContent).toContain('22.66 €'); // gap, cents
    expect(listing.textContent).toContain('18363 bp'); // gap, basis points
    // Reliability label resolves through the canonical fi catalog key.
    expect(listing.textContent).toContain('Vahvistettu');
  });

  it('renders the retryable error state when the backend fails', async () => {
    mockedRequest.mockRejectedValue(new Error('backend down'));

    render(<SavingsListing category="beer" />, { wrapper: Provider });

    await waitFor(() => {
      expect(screen.getByText('Luetteloa ei saatu haettua')).toBeTruthy();
    });
  });
});
