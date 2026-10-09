/**
 * Savings page tests (insight-surfaces task 2.4, spec savings-discovery).
 *
 * Two harnesses, mirroring the repo's blog-page test precedent:
 *
 *   Server shell (renderToString, Next server plumbing mocked):
 *   1. The ordering rule is stated in the copy exactly as the ranking
 *      rule behaves (largest saving first, product-name tiebreaker), and
 *      the category selector renders URL-state links.
 *
 *   Client listing (@testing-library/react, request mocked — the listing
 *   is a client island because the endpoint is age-gated):
 *   2. Zero rows → the honest empty state PLUS the as-of/coverage
 *      header, so the funnel size stays visible when a category
 *      narrows to nothing.
 *   3. Rows render the landed total, the Alko reference, the gap
 *      (cents + basis points), and the reliability badge.
 *   4. Each row is a whole-row link to that product's detail page,
 *      with the figures and position of the unlinked form.
 *   5. Fetch failure → the retryable error state.
 *
 * @module SavingsPagesTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import SavingsPage, {
  generateMetadata as savingsMetadata,
} from './page';
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
      // Walk dot-paths so nested keys (SavingsPage.category.beer)
      // resolve like the real next-intl lookup.
      let value: unknown = table[ns];
      for (const part of key.split('.')) {
        if (typeof value !== 'object' || value === null) {
          value = undefined;
          break;
        }
        value = (value as Record<string, unknown>)[part];
      }
      if (typeof value !== 'string') return `__MISSING_${ns}.${key}__`;
      return values === undefined
        ? value
        : value.replace(/\{(\w+)\}/g, (_, k: string) =>
            values[k] === undefined ? `{${k}}` : String(values[k]),
          );
    };
  },
}));

// The i18n Link double serializes typed href objects through the real
// routing vocabulary (the shared testing double).
vi.mock('@/i18n/navigation', async () => {
  const { TestI18nLink } = await import('@/lib/testing/i18n-navigation');
  return { Link: TestI18nLink };
});

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
  // The market overview (task 5.2) is a server-side fetch through
  // global fetch; default to the degradation path (section absent) —
  // the overview tests override it. Keeps every render hermetic.
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new Error('overview fetch not mocked')),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
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

/** Market-overview payload (task 5.2) as the endpoint serves it. */
const OVERVIEW_OK = {
  asOf: '2026-09-08',
  categories: [
    {
      category: 'beer',
      productCount: 12,
      averageObservedPriceCents: 325,
      largestDifference: {
        productId: 7,
        productName: 'Testia olut 0,5 l',
        merchant: 'Viro-kauppa',
        merchantCountry: 'EE',
        observedPriceCents: 150,
        referenceCents: 3500,
        gapCents: -2266,
        gapBasisPoints: -64742,
      },
    },
    {
      category: 'wine_still',
      productCount: 4,
      averageObservedPriceCents: 890,
      largestDifference: null,
    },
  ],
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
  it('states the ordering rule (largest saving first, name tiebreaker) and renders the selector', async () => {
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
    expect(html).toContain('suurimman säästön mukaan ensin');
    expect(html).toContain('tuotenimen aakkosjärjestys');
    expect(html).toContain('suurin säästö ensin');
    // URL-state category links — localized segment, English param (D7).
    expect(html).toContain('href="/saastolista?category=beer"');
    expect(html).toContain('href="/saastolista?category=spirits"');
  });
});

// ---------------------------------------------------------------------------
// Localized metadata (change localize-fi-route-pathnames, design D6/D7)
// ---------------------------------------------------------------------------

describe('SavingsPage localized metadata', () => {
  it('emits the localized canonical and hreflang pair; the default category stays canonical-clean', async () => {
    const bare = await savingsMetadata({
      params: Promise.resolve({ locale: 'fi' }),
      searchParams: Promise.resolve({}),
    });
    expect(bare.alternates?.canonical).toBe('/saastolista');
    expect(bare.alternates?.languages).toEqual({
      fi: '/saastolista',
      en: '/en/savings',
      'x-default': '/saastolista',
    });

    const filtered = await savingsMetadata({
      params: Promise.resolve({ locale: 'fi' }),
      searchParams: Promise.resolve({ category: 'spirits' }),
    });
    expect(filtered.alternates?.canonical).toBe(
      '/saastolista?category=spirits',
    );

    const en = await savingsMetadata({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });
    expect(en.alternates?.canonical).toBe('/en/savings');
  });
});

// ---------------------------------------------------------------------------
// Market overview (task 5.2) — server-rendered section
// ---------------------------------------------------------------------------

describe('SavingsPage market overview (task 5.2)', () => {
  async function renderShell(): Promise<string> {
    const element = await SavingsPage({
      params: Promise.resolve({ locale: 'fi' }),
      searchParams: Promise.resolve({}),
    });
    return renderToString(
      <NextIntlClientProvider locale="fi" messages={(await import('@/messages/fi.json')).default}>
        {element}
      </NextIntlClientProvider>,
    );
  }

  it('renders the overview section with traceable aggregates and explicit direction wording', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => OVERVIEW_OK,
      }),
    );
    const html = await renderShell();

    expect(html).toContain('data-testid="savings-overview"');
    // What the aggregates are and over what — stated in copy.
    expect(html).toContain('Markkinakatsaus');
    expect(html).toContain('viimeisimmästä havaintopäivästä');
    // Average observed price per category (integer cents → the listing's
    // euro form).
    expect(html).toContain('3.25 €');
    expect(html).toContain('Havaittuja tuotteita: 12');
    // Largest difference carries the product, the figure, and the
    // explicit cheaper/dearer wording (gap < 0 → cheaper abroad).
    expect(html).toContain('Testia olut 0,5 l');
    expect(html).toContain('22.66 €');
    expect(html).toContain('halvempi kuin Alkon vertailuhinta');
    // Canonical categories reuse the listing's established labels.
    expect(html).toContain('Makuuviini');
    // A category without a qualifying largestDifference row still shows
    // its aggregates.
    expect(html).toContain('8.90 €');
  });

  it('renders WITHOUT the section when the overview fetch fails', async () => {
    const html = await renderShell();

    expect(html).not.toContain('data-testid="savings-overview"');
    // The rest of the shell is intact.
    expect(html).toContain('href="/saastolista?category=beer"');
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

  it('links each row to its product detail page with figures and position unchanged', async () => {
    mockedRequest.mockResolvedValue({
      asOf: '2026-09-08',
      category: 'beer',
      coverage: { evaluated: 42, withReference: 2, listed: 2 },
      rows: [
        savingsRow(),
        savingsRow({
          productId: 7,
          productName: 'Toinen juoma 0,33 l',
          landedTotalCents: 999,
          alkoReferenceCents: 2100,
          gapCents: 1101,
          gapBasisPoints: 11010,
        }),
      ],
    });

    render(<SavingsListing category="beer" />, { wrapper: Provider });

    const listing = await screen.findByTestId('savings-listing');
    const rows = [
      ...listing.querySelectorAll('tbody tr'),
    ] as HTMLTableRowElement[];
    expect(rows.length).toBe(2);

    // The spec scenario (homepage-live-gap-hero): the row is a link to
    // that product's detail page — one anchor per row, resolved through
    // the i18n navigation into the localized segment (fi bare).
    expect(
      within(rows[0]).getByRole('link', { name: 'Testia olut 0,5 l' })
        .getAttribute('href'),
    ).toBe('/tuotteet/1');
    expect(
      within(rows[1]).getByRole('link', { name: 'Toinen juoma 0,33 l' })
        .getAttribute('href'),
    ).toBe('/tuotteet/7');

    // Figures and position identical to the unlinked form, in API order
    // (largest saving first — the endpoint's contract).
    expect(within(rows[0]).getByText('1')).toBeTruthy(); // position
    expect(within(rows[0]).getByText('12.34 €')).toBeTruthy(); // landed total
    expect(within(rows[0]).getByText('35.00 €')).toBeTruthy(); // Alko reference
    expect(within(rows[0]).getByText('22.66 €')).toBeTruthy(); // gap
    expect(within(rows[0]).getByText('18363 bp')).toBeTruthy(); // gap, bp
    expect(within(rows[1]).getByText('2')).toBeTruthy(); // position
    expect(within(rows[1]).getByText('9.99 €')).toBeTruthy();
    expect(within(rows[1]).getByText('21.00 €')).toBeTruthy();
  });

  it('renders the retryable error state when the backend fails', async () => {
    mockedRequest.mockRejectedValue(new Error('backend down'));

    render(<SavingsListing category="beer" />, { wrapper: Provider });

    await waitFor(() => {
      expect(screen.getByText('Luetteloa ei saatu haettua')).toBeTruthy();
    });
  });
});
